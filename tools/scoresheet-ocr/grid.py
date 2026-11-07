"""Find the per-set score tables on a score sheet photo and cut them into cells.

Every sheet seen so far shares one skeleton: each set is a table whose body has
12 turn rows, and whose columns are
    [turn no.] [team A players ... | A total] [team B players ... | B total]
Team blocks and the total columns are separated by solid lines; player columns
by dotted lines. The rest of the layout (number of sets, header, where the
tables sit on the page) changes between tournaments, so nothing here relies on
absolute positions.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

WORK_LONG_SIDE = 2400  # resize photos to this long side for line detection
TURN_ROWS = 12


@dataclasses.dataclass
class Table:
    quad: np.ndarray  # 4x2 corners (tl, tr, br, bl) in work-image pixels
    image: np.ndarray  # rectified BGR table
    row_lines: list[int]  # y of the 13 lines bounding the 12 turn rows
    cols: list[int]  # x of the 6 solid lines: left, no.|A, A total, A|B, B total, right


def load(path: str | Path) -> np.ndarray:
    """Load a photo upright (EXIF) and scale it to the working size."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    scale = WORK_LONG_SIDE / max(im.size)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    return level(cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR))


def level(bgr: np.ndarray) -> np.ndarray:
    """Rotate the photo so the ruled lines are horizontal."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    w = gray.shape[1]
    lines = cv2.HoughLinesP(edges, 1, np.pi / 720, 200, minLineLength=w // 8, maxLineGap=10)
    if lines is None:
        return bgr
    angles = []
    for x1, y1, x2, y2 in lines[:, 0]:
        a = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(a) < 15:
            angles.append(a)
    if not angles:
        return bgr
    angle = float(np.median(angles))
    if abs(angle) < 0.3:
        return bgr
    h = gray.shape[0]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(bgr, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


def ink_mask(bgr: np.ndarray) -> np.ndarray:
    """Binary mask of dark strokes, robust to shadows and the grey row shading."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 35, 15
    )


@dataclasses.dataclass
class Segment:
    x0: float
    x1: float
    slope: float
    icpt: float  # y = slope * x + icpt

    def y_at(self, x: float) -> float:
        return self.slope * x + self.icpt

    @property
    def length(self) -> float:
        return self.x1 - self.x0


def horizontal_segments(bgr: np.ndarray) -> list[Segment]:
    """Long, nearly horizontal ruled lines as fitted segments."""
    mask = ink_mask(bgr)
    h, w = mask.shape
    hor = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (w // 60, 1)))
    # Re-join pieces of a slightly tilted line without bridging the gap between tables.
    hor = cv2.morphologyEx(hor, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(hor, connectivity=8)
    segs = []
    for i in range(1, n):
        x, y, cw, ch, _area = stats[i]
        if cw < w * 0.08 or ch > cw * 0.15:
            continue
        ys, xs = np.nonzero(labels[y : y + ch, x : x + cw] == i)
        slope, icpt = np.polyfit(xs + x, ys + y, 1)
        segs.append(Segment(float(x), float(x + cw), float(slope), float(icpt)))
    return segs


def find_table_quads(bgr: np.ndarray) -> list[np.ndarray]:
    """Corners (tl, tr, br, bl) of each table's 12 turn rows, left to right.

    A table body shows up as 13 stacked horizontal lines that share their left
    and right ends and are evenly spaced. Lines partly hidden (by a clip or a
    hand) are shorter, so ends are taken as medians of the group.
    """
    segs = sorted(horizontal_segments(bgr), key=lambda s: -s.length)
    cands: list[tuple[float, np.ndarray]] = []
    for ref in segs:
        # Lines that overlap most of this one horizontally.
        group = []
        for j, s in enumerate(segs):
            ov = min(ref.x1, s.x1) - max(ref.x0, s.x0)
            if ov > 0.6 * ref.length and s.length < 1.3 * ref.length:
                group.append(j)
        mid = (ref.x0 + ref.x1) / 2
        group.sort(key=lambda j: segs[j].y_at(mid))
        ys = [segs[j].y_at(mid) for j in group]
        found = even_run(ys, TURN_ROWS + 1)
        if found is None:
            continue
        pick, score = found
        lines = [segs[group[k]] for k in pick]
        top, bot = lines[0], lines[-1]
        ys_mid = np.array([s.y_at(mid) for s in lines])
        # Ends drift with perspective, so fit them against y; lines cut
        # short by a clip or a hand are outliers.
        lx = edge_fit(ys_mid, np.array([s.x0 for s in lines]))
        rx = edge_fit(ys_mid, np.array([s.x1 for s in lines]))
        yt, yb = top.y_at(mid), bot.y_at(mid)
        q = np.array(
            [
                [lx(yt), top.y_at(lx(yt))],
                [rx(yt), top.y_at(rx(yt))],
                [rx(yb), bot.y_at(rx(yb))],
                [lx(yb), bot.y_at(lx(yb))],
            ],
            dtype=np.float32,
        )
        cands.append((score, q))
    # Overlapping candidates are the same table read with stray lines
    # (header, result box); keep the most evenly spaced one.
    quads: list[np.ndarray] = []
    for _score, q in sorted(cands, key=lambda c: c[0]):
        if not any(overlap(q, o) > 0.3 for o in quads):
            quads.append(q)
    quads.sort(key=lambda q: q[:, 0].mean())
    return quads


def edge_fit(ys: np.ndarray, xs: np.ndarray):
    """Robust straight-line fit x(y) through line ends."""
    keep = np.ones(len(ys), bool)
    a, b = 0.0, float(np.median(xs))
    for _ in range(3):
        a, b = np.polyfit(ys[keep], xs[keep], 1)
        resid = np.abs(xs - (a * ys + b))
        keep = resid <= max(6.0, float(np.median(resid)) * 2)
        if keep.sum() < 4:
            break
    return lambda y: float(a * y + b)


def overlap(a: np.ndarray, b: np.ndarray) -> float:
    """Intersection over the smaller box, using bounding boxes."""
    ax0, ay0 = a.min(axis=0)
    ax1, ay1 = a.max(axis=0)
    bx0, by0 = b.min(axis=0)
    bx1, by1 = b.max(axis=0)
    iw = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    ih = max(0.0, min(ay1, by1) - max(ay0, by0))
    small = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
    return float(iw * ih / small) if small > 0 else 0.0


def even_run(ys: list[float], k: int) -> tuple[list[int], float] | None:
    """Indices of k values (in order) that are the most evenly spaced, allowing stray lines between."""
    if len(ys) < k:
        return None
    best, best_score = None, 0.12
    n = len(ys)
    # Try every pair of first/second line to set the pitch, then walk.
    for a in range(n):
        for b in range(a + 1, n):
            pitch = ys[b] - ys[a]
            if pitch < 10:
                continue
            idx = [a, b]
            ok = True
            while len(idx) < k:
                target = ys[idx[-1]] + pitch
                c = min(range(idx[-1] + 1, n), key=lambda q: abs(ys[q] - target), default=None)
                if c is None or abs(ys[c] - target) > 0.2 * pitch:
                    ok = False
                    break
                idx.append(c)
            if not ok:
                continue
            gaps = np.diff([ys[q] for q in idx])
            score = gaps.std() / gaps.mean()
            if score < best_score:
                best, best_score = idx, score
    return None if best is None else (best, float(best_score))


ROW_PX = 64  # height of one turn row in the rectified table
HEADER_ROWS = 6  # rows of space kept above the body for team and player names
PAD = ROW_PX // 2  # margin around the body in the rectified table


@dataclasses.dataclass
class VLine:
    """A long vertical ruled line, x = slope * y + icpt."""

    slope: float
    icpt: float

    def x_at(self, y: float) -> float:
        return self.slope * y + self.icpt


def vertical_lines(img: np.ndarray, top: int, bottom: int) -> list[VLine]:
    """Solid vertical lines crossing most of the body, left to right.

    Dotted player separators and digits are shorter than a row, so a tall
    opening removes them.
    """
    mask = ink_mask(img)
    mask[:top] = 0
    mask[bottom:] = 0
    tall = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, ROW_PX)))
    tall = cv2.morphologyEx(tall, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (7, ROW_PX * 2)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(tall, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, _area = stats[i]
        if h < (bottom - top) * 0.6:
            continue
        ys, xs = np.nonzero(labels[y : y + h, x : x + w] == i)
        line = robust_line(ys + y, xs + x)
        if line is not None:
            out.append(line)
    mid = (top + bottom) / 2
    out.sort(key=lambda v: v.x_at(mid))
    # Merge both edges of a thick line.
    merged: list[VLine] = []
    for v in out:
        if merged and v.x_at(mid) - merged[-1].x_at(mid) < 8:
            continue
        merged.append(v)
    return merged


def robust_line(ys: np.ndarray, xs: np.ndarray) -> VLine | None:
    """Fit x = a*y + b to a line's pixels, ignoring digits written against it."""
    a, b = 0.0, float(np.median(xs))
    for _ in range(5):
        # Per pixel row, the ink closest to the current fit.
        resid = np.abs(xs - (a * ys + b))
        order = np.lexsort((resid, ys))
        ys_s, xs_s = ys[order], xs[order]
        first = np.concatenate([[True], ys_s[1:] != ys_s[:-1]])
        uy, ux = ys_s[first], xs_s[first].astype(float)
        keep = np.abs(ux - (a * uy + b)) < 4
        if keep.sum() < 20:
            return None
        a, b = np.polyfit(uy[keep], ux[keep], 1)
    if abs(a) > 0.06:
        return None
    return VLine(float(a), float(b))


# Solid lines of the body as fractions of its width: left, no.|A, A total
# (left, right), B total (left), right. Shared by every sheet seen so far.
FRAME = np.array([0.0, 0.0914, 0.453, 0.544, 0.909, 1.0])
SNAP_PX = 7


def frame_lines(lines: list[VLine], mid: float, guess_left: float, guess_width: float) -> list[VLine] | None:
    """Fit FRAME to the detected lines; lines that are hidden are filled in from the fit.

    Any two detected lines matched to two frame lines fix offset and scale;
    the fit that explains the most lines (at least 4 of 6) near the guess wins.
    """
    xs = np.array([v.x_at(mid) for v in lines])
    if len(xs) < 2:
        return None
    best = None
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            for a in range(6):
                for b in range(a + 1, 6):
                    width = (xs[j] - xs[i]) / (FRAME[b] - FRAME[a])
                    if not 0.85 * guess_width < width < 1.15 * guess_width:
                        continue
                    left = xs[i] - FRAME[a] * width
                    if abs(left - guess_left) > 2 * ROW_PX:
                        continue
                    pred = left + FRAME * width
                    dist = np.abs(xs[None, :] - pred[:, None]).min(axis=1)
                    hits = dist < SNAP_PX
                    key = (int(hits.sum()), -float(dist[hits].sum()))
                    if best is None or key > best[0]:
                        best = (key, pred)
    if best is None or best[0][0] < 4:
        return None
    pred = best[1]
    slopes = []
    out: list[VLine | None] = []
    for p in pred:
        k = int(np.abs(xs - p).argmin())
        if abs(xs[k] - p) < SNAP_PX:
            out.append(lines[k])
            slopes.append(lines[k].slope)
        else:
            out.append(None)
    slope = float(np.median(slopes))
    return [v if v is not None else VLine(slope, p - slope * mid) for v, p in zip(out, pred)]


def warp_body(bgr: np.ndarray, quad: np.ndarray, side: int) -> tuple[np.ndarray, np.ndarray, int]:
    """Rectify so the quad becomes the 12-row body; `side` extra pixels left and right."""
    tl, tr, br, bl = quad
    aspect = np.linalg.norm(tr - tl) / np.linalg.norm(bl - tl)
    width = int(round(aspect * TURN_ROWS * ROW_PX))
    top = HEADER_ROWS * ROW_PX
    body_h = TURN_ROWS * ROW_PX
    dst = np.array(
        [[side, top], [side + width, top], [side + width, top + body_h], [side, top + body_h]], np.float32
    )
    m = cv2.getPerspectiveTransform(quad, dst)
    img = cv2.warpPerspective(
        bgr, m, (width + 2 * side, top + body_h + PAD), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)
    )
    return img, m, width


def analyse(bgr: np.ndarray) -> list[Table]:
    top = HEADER_ROWS * ROW_PX
    bottom = top + TURN_ROWS * ROW_PX
    mid = (top + bottom) / 2
    tables = []
    for quad in find_table_quads(bgr):
        # First pass: rows are right, but the left/right ends may be off
        # (keystone, a clip joined to the lines), so look wider.
        side = 3 * ROW_PX
        rough, m, width = warp_body(bgr, quad, side)
        frame = frame_lines(vertical_lines(rough, top, bottom), mid, side, width)
        if frame is not None:
            left, right = frame[0], frame[-1]
            pts = np.array(
                [[left.x_at(top), top], [right.x_at(top), top], [right.x_at(bottom), bottom], [left.x_at(bottom), bottom]],
                np.float32,
            )
            quad = cv2.perspectiveTransform(pts[None], np.linalg.inv(m))[0]
        img, _, width = warp_body(bgr, quad, PAD)
        rows = [top + k * ROW_PX for k in range(TURN_ROWS + 1)]
        frame = frame_lines(vertical_lines(img, top, bottom), mid, PAD, width) if frame is not None else None
        if frame is None:
            continue  # not a full score table (e.g. cut off at the photo edge)
        cols = [PAD] + [int(round(v.x_at(mid))) for v in frame[1:-1]] + [PAD + width]
        tables.append(Table(quad, img, rows, cols))
    return tables


def debug_table(t: Table) -> np.ndarray:
    """The rectified table with the detected row and column lines drawn on it."""
    out = t.image.copy()
    h, w = out.shape[:2]
    for y in t.row_lines:
        cv2.line(out, (0, y), (w, y), (0, 0, 255), 2)
    for x in t.cols:
        cv2.line(out, (x, 0), (x, t.row_lines[-1]), (255, 0, 0), 3)
    return out
