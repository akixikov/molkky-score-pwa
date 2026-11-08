"""Review page: each read game as the app's score sheet, beside the sheet image it came from.

Usage: review.py <work> <matches.json> <meta.json> <out.html>

Reads solved.json / solved_them.json and tables/ from <work>. Optional per-match keys in meta.json:
  "label" (e.g. "予選 第1試合", defaults to "第N試合"), "court", and
  "notes": {"<game no>": ["note for the reviewer", ...]}.
"""
import base64
import html
import json
import sys
from pathlib import Path

import cv2

from grid import ROW_PX

HERE = Path(__file__).parent
IMG_WIDTH = 560


def img_uri(work: Path, key: str, rows: list) -> str:
    """The rectified table, from a little above the turn rows (names) to the bottom, as a JPEG data URI."""
    img = cv2.imread(str(work / "tables" / f"{key.replace('/', '_')}.png"))
    img = img[max(0, rows[0] - 4 * ROW_PX):, :]
    scale = IMG_WIDTH / img.shape[1]
    img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def main() -> None:
    work, matches_file, meta_file, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4])
    matches = json.loads(Path(matches_file).read_text())
    metas = {m["id"]: m for m in json.loads(Path(meta_file).read_text())}
    tables = json.loads((work / "tables.json").read_text())
    ours = {r["key"]: r for r in json.loads((work / "solved.json").read_text())}
    theirs = {r["key"]: r for r in json.loads((work / "solved_them.json").read_text())}

    page = []
    for n, m in enumerate(matches, 1):
        meta = metas[m["id"]]
        games = []
        for i, g in enumerate(meta["games"]):
            key = g["table"]
            notes = list(meta.get("notes", {}).get(str(i + 1), []))
            notes += [f"{x['turn']}投目: {x['check']}" for x in ours[key]["rows"] if x["check"]]
            notes += [f"相手 {x['turn']}投目: {x['check']}" for x in theirs[key]["rows"] if x["check"]]
            games.append({"img": img_uri(work, key, tables[key]["rows"]), "notes": notes})
        photo = meta["games"][0]["table"].split("/")[0]
        page.append({"label": meta.get("label", f"第{n}試合"), "court": meta.get("court"), "photo": photo, "games": games})

    first = matches[0]
    title = f"{first['tournament']} スコアシート"
    eyebrow = " · ".join(x for x in (first["date"], first["tournament"], first.get("ourTeam", "")) if x)
    data = json.dumps({"matches": matches, "page": page}, ensure_ascii=False).replace("</", "<\\/")
    text = (HERE / "review.html").read_text()
    text = text.replace("{{title}}", html.escape(title)).replace("{{eyebrow}}", html.escape(eyebrow))
    text = text.replace("{{sheets}}", str(len({p["photo"] for p in page}))).replace("/*DATA*/null", data)
    out.write_text(text)
    print("wrote", out, len(text) // 1024, "KB", file=sys.stderr)


if __name__ == "__main__":
    main()
