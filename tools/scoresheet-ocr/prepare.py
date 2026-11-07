"""Cut score sheet photos into images that are easy to read reliably.

Step 1  python3 prepare.py headers <work_dir> <photo>...
        Finds the set tables in each photo, saves them to <work_dir>/tables/
        (with *_lines.jpg showing the detected grid), and writes headers.jpg: the team-name header of every table, so you can
        tell which side (A = left, B = right) is our team.

Step 2  python3 prepare.py strips <work_dir> <sides.json> [out_subdir]
        sides.json maps "<photo stem>/<table index>" to "A" or "B".
        Writes one image per photo with only our team's block of each set
        (turn no. | player cells | total), sets side by side, to <work_dir>/strips/
        (or out_subdir; pass the other sides there to read the opponents).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

import grid

NAME_ROWS = 3  # header rows kept above the body: team name + player names


def cmd_headers(work: Path, photos: list[Path]) -> None:
    tdir = work / "tables"
    tdir.mkdir(parents=True, exist_ok=True)
    meta = {}
    tiles = []
    for photo in photos:
        tables = grid.analyse(grid.load(photo))
        for i, t in enumerate(tables):
            key = f"{photo.stem}/{i}"
            cv2.imwrite(str(tdir / f"{photo.stem}_{i}.png"), t.image)
            cv2.imwrite(str(tdir / f"{photo.stem}_{i}_lines.jpg"), cv2.resize(grid.debug_table(t), None, fx=0.5, fy=0.5))
            meta[key] = {"photo": photo.name, "rows": t.row_lines, "cols": t.cols}
            y0 = t.row_lines[0] - NAME_ROWS * grid.ROW_PX - grid.ROW_PX // 2
            head = t.image[max(0, y0) : t.row_lines[0], t.cols[0] : t.cols[5]]
            tiles.append(label(cv2.resize(head, None, fx=0.5, fy=0.5), key))
        print(photo.name, len(tables), "tables")
    (work / "tables.json").write_text(json.dumps(meta, indent=1))
    save_grid(tiles, work / "headers.jpg", per_row=4)


def cmd_strips(work: Path, sides_path: Path, out_subdir: str = "strips") -> None:
    meta = json.loads((work / "tables.json").read_text())
    sides = json.loads(sides_path.read_text())
    by_photo: dict[str, list[tuple[str, str]]] = {}
    for key, side in sides.items():
        stem = key.split("/")[0]
        by_photo.setdefault(stem, []).append((key, side))
    sdir = work / out_subdir
    sdir.mkdir(exist_ok=True)
    for stem, items in sorted(by_photo.items()):
        parts = []
        for key, side in sorted(items):
            img = cv2.imread(str(work / "tables" / f"{key.replace('/', '_')}.png"))
            m = meta[key]
            parts.append(label(team_strip(img, m["rows"], m["cols"], side), f"table {key.split('/')[1]}"))
            parts.append(np.full((parts[-1].shape[0], 24, 3), 255, np.uint8))
        out = hstack_top(parts[:-1])
        cv2.imwrite(str(sdir / f"{stem}.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 90])
        print(stem, "->", sdir / f"{stem}.jpg")


def team_strip(img: np.ndarray, rows: list[int], cols: list[int], side: str) -> np.ndarray:
    """Turn numbers, then one team's player cells and total, with its name header."""
    top = rows[0] - NAME_ROWS * grid.ROW_PX
    bottom = rows[-1] + 2
    no = img[top:bottom, cols[0] - 2 : cols[1] + 2]
    a, b = (1, 3) if side == "A" else (3, 5)
    block = img[top:bottom, cols[a] - 2 : cols[b] + 3]
    return np.hstack([no, block])


def label(img: np.ndarray, text: str) -> np.ndarray:
    bar = np.full((30, img.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, text, (4, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 200), 2)
    return np.vstack([bar, img])


def hstack_top(parts: list[np.ndarray]) -> np.ndarray:
    h = max(p.shape[0] for p in parts)
    padded = [np.vstack([p, np.full((h - p.shape[0], p.shape[1], 3), 255, np.uint8)]) for p in parts]
    return np.hstack(padded)


def save_grid(tiles: list[np.ndarray], path: Path, per_row: int) -> None:
    w = max(t.shape[1] for t in tiles)
    h = max(t.shape[0] for t in tiles)
    rows = []
    for k in range(0, len(tiles), per_row):
        row = [cv2.copyMakeBorder(t, 0, h - t.shape[0], 0, w - t.shape[1] + 10, cv2.BORDER_CONSTANT, value=(255, 255, 255)) for t in tiles[k : k + per_row]]
        while len(row) < per_row:
            row.append(np.full((h, w + 10, 3), 255, np.uint8))
        rows.append(np.hstack(row))
    cv2.imwrite(str(path), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "headers":
        cmd_headers(Path(sys.argv[2]), [Path(p) for p in sys.argv[3:]])
    elif len(sys.argv) in (4, 5) and sys.argv[1] == "strips":
        cmd_strips(Path(sys.argv[2]), Path(sys.argv[3]), *sys.argv[4:])
    else:
        print(__doc__)
        sys.exit(2)
