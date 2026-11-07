"""Turn solved readings into app matches (the format of the team sheet's Json column).

Usage: matches.py <solved.json> <solved_them.json> <meta.json> > matches.json

meta.json lists the matches and, per game, the table key and who threw first:
  [{"id": "ocr-2026-10-17-1", "date": "2026-10-17", "tournament": "...", "opponent": "...",
    "ourTeam": "...", "games": [{"table": "IMG_0001/0", "first": "them"}, ...]}, ...]
"""
import json
import sys
import time


def interleave(first: list, second: list) -> list:
    """Throws in the order they were made; the first team may have one more."""
    assert len(first) - len(second) in (0, 1), (len(first), len(second))
    order = []
    for k, x in enumerate(first):
        order.append(x)
        if k < len(second):
            order.append(second[k])
    return order


def build(meta: dict, ours: dict, theirs: dict, now_ms: int) -> dict:
    sets = []
    for i, g in enumerate(meta["games"]):
        u, t = ours[g["table"]], theirs[g["table"]]
        seq = {"us": [("us", r["player"], r["score"]) for r in u["rows"]],
               "them": [("them", None, r["score"]) for r in t["rows"]]}
        first = g["first"]
        order = interleave(seq[first], seq["them" if first == "us" else "us"])
        sid = f"{meta['id']}-g{i + 1}"
        records = [{"id": f"{sid}-t{n + 1}", "team": team, **({"player": p} if p else {}), "score": s, "ts": now_ms + n}
                   for n, (team, p, s) in enumerate(order)]
        sets.append({"id": sid, "setNo": i + 1, "closed": True,
                     "config": {"firstTeam": first, "lineup": u["players"]}, "records": records})
    keys = ("id", "date", "tournament", "opponent", "ourTeam")
    return {**{k: meta[k] for k in keys}, "kind": "tournament", "sets": sets, "updatedAt": now_ms}


def main() -> None:
    ours = {r["key"]: r for r in json.loads(open(sys.argv[1]).read())}
    theirs = {r["key"]: r for r in json.loads(open(sys.argv[2]).read())}
    metas = json.loads(open(sys.argv[3]).read())
    now_ms = int(time.time() * 1000)
    out = [build(m, ours, theirs, now_ms) for m in metas]
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
