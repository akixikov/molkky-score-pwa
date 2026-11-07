"""Score solved readings against games already entered by hand.

python3 evaluate.py <solved.json> <molkkylog.json> <photo_dir>

Each photo is matched to a tournament by its EXIF date (photos without one
take the date of the photo just before it by name), and each set to the
entered game of that tournament whose throws agree best.
"""

from __future__ import annotations

import collections
import difflib
import json
import sys
from pathlib import Path

from PIL import Image


def photo_dates(photo_dir: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    last = ""
    for p in sorted(photo_dir.iterdir(), key=lambda p: p.stem):
        exif = Image.open(p).getexif()
        dt = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        last = dt[:10].replace(":", "-") if dt else last
        out[p.stem] = last
    return out


def similarity(a: list[int], b: list[int]) -> float:
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def main() -> None:
    solved = json.loads(Path(sys.argv[1]).read_text())
    truth = json.loads(Path(sys.argv[2]).read_text())
    dates = photo_dates(Path(sys.argv[3]))

    games = collections.defaultdict(list)
    for g in truth:
        games[g["tournament"][:10]].append(g)

    used: set[int] = set()
    per_photo = collections.defaultdict(lambda: [0, 0, 0, 0])  # throws, wrong, flagged, wrong&unflagged
    lines = []
    for s in solved:
        photo = s["key"].split("/")[0]
        date = dates.get(photo, "")
        cands = [g for g in games.get(date, []) if id(g) not in used]
        got = [r["score"] for r in s["rows"]]
        if not cands:
            lines.append(f"{s['key']}: no entered game for {date or 'unknown date'}")
            continue
        g = max(cands, key=lambda g: similarity(got, [t["score"] for t in g["throws"]]))
        used.add(id(g))
        want = g["throws"]
        acc = per_photo[photo]
        diffs = []
        for k in range(max(len(want), len(got))):
            w = want[k] if k < len(want) else None
            r = s["rows"][k] if k < len(s["rows"]) else None
            acc[0] += 1
            flagged = bool(r and r["check"])
            acc[2] += flagged
            ok = w is not None and r is not None and w["score"] == r["score"] and w["player"] == r["player"]
            if not ok:
                acc[1] += 1
                acc[3] += not flagged
                diffs.append(
                    f"T{k + 1} want {w and (w['player'], w['score'])} got {r and (r['player'], r['score'])}"
                    + (f" [flagged: {r['check']}]" if flagged else "")
                )
        lines.append(f"{s['key']} = {g['game']} set {g['setNo']}: " + ("OK" if not diffs else "; ".join(diffs)))

    print("\n".join(lines))
    print()
    tot = [0, 0, 0, 0]
    for photo, (n, wrong, flagged, silent) in sorted(per_photo.items()):
        print(f"{photo}: {n} throws, {wrong} wrong ({silent} unflagged), {flagged} flagged")
        tot = [a + b for a, b in zip(tot, (n, wrong, flagged, silent))]
    n, wrong, flagged, silent = tot
    if n:
        print(
            f"\nTOTAL {len(per_photo)} sheets, {n} throws: accuracy {100 * (n - wrong) / n:.1f}%, "
            f"{wrong / len(per_photo):.2f} wrong per sheet ({silent} unflagged), {flagged / len(per_photo):.2f} flagged per sheet"
        )


if __name__ == "__main__":
    main()
