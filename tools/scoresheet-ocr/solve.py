"""Turn cell readings into rule-consistent throws.

Readings file (one set per line, '#' starts a comment):
    <photo>/<table> | <players in column order> | <row>; <row>; ...
Each row is "<col> <throw> <total>" for one of our turns, top to bottom:
    col    1-based player column the throw was written in, or _ if unclear
    throw  0-12, '-' for a miss, '_' unreadable/blank, 'a/b' either, 'x' struck out (row is ignored)
    total  running total as written, '_' blank/unreadable, 'a/b' either

The written throws and totals carry the same information twice. Rules
(running total, over 50 -> 25, exactly 50 ends the game, three misses in a
row end the team's game) decide between conflicting readings: we pick the
throws needing the fewest corrections to the readings, and flag rows that
were corrected, filled in, or still ambiguous.
"""

from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path

WIN = 50
RESET = 25
MAX_FAULTS = 3
ANY = tuple(range(13))


@dataclasses.dataclass
class Row:
    col: int | None
    throws: tuple[int, ...]  # candidate values; ANY when unreadable
    totals: tuple[int, ...] | None  # None when blank


@dataclasses.dataclass
class SetReading:
    key: str
    players: list[str]
    rows: list[Row]


def parse_values(tok: str, blank_any: bool) -> tuple[int, ...] | None:
    if tok == "_":
        return ANY if blank_any else None
    out = []
    for part in tok.split("/"):
        out.append(0 if part in ("-", "0") else int(part))
    return tuple(out)


def parse(path: Path) -> list[SetReading]:
    sets = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        key, players, rows_txt = [p.strip() for p in line.split("|")]
        rows = []
        for cell in rows_txt.split(";"):
            col, throw, total = cell.split()
            if throw == "x":
                continue
            rows.append(
                Row(
                    None if col == "_" else int(col),
                    parse_values(throw, blank_any=True),
                    parse_values(total, blank_any=False),
                )
            )
        sets.append(SetReading(key, players.split(), rows))
    return sets


def apply_throw(before: int, score: int) -> int:
    total = before + score
    return RESET if total > WIN else total


@dataclasses.dataclass
class Solved:
    throws: list[int]
    totals: list[int]
    cost: int
    notes: list[str]  # per row: '' or why it needs a look


def best_path(rows: list[Row], pin: tuple[int, int] | None = None) -> tuple[int, list[int]] | None:
    """Fewest corrections to the readings, by dynamic programming over the running total.

    State: (total, consecutive misses). Cost: 1 for a throw value that was not
    read, 1 for a written total that disagrees; unreadable cells cost nothing.
    `pin` = (row, value) forces one row's throw.
    """
    best: dict[tuple[int, int], tuple[int, list[int]]] = {(0, 0): (0, [])}
    for i, row in enumerate(rows):
        nxt: dict[tuple[int, int], tuple[int, list[int]]] = {}
        choices = (pin[1],) if pin and pin[0] == i else ANY
        for (before, faults), (cost, path) in best.items():
            if before == WIN or faults >= MAX_FAULTS:
                continue  # our game is over, so no further row fits
            for t in choices:
                c = cost + (0 if t in row.throws else 1)
                after = apply_throw(before, t)
                if row.totals is not None and after not in row.totals:
                    c += 1
                key = (after, faults + 1 if t == 0 else 0)
                if key not in nxt or c < nxt[key][0]:
                    nxt[key] = (c, path + [t])
        best = nxt
    if not best:
        return None
    return min(best.values(), key=lambda v: v[0])


def solve(rows: list[Row]) -> Solved:
    found = best_path(rows)
    if found is None:
        return Solved([], [], -1, ["no rule-consistent reading"] * len(rows))
    cost, path = found
    totals = []
    s = 0
    for t in path:
        s = apply_throw(s, t)
        totals.append(s)
    notes = []
    for i, (row, t, tot) in enumerate(zip(rows, path, totals)):
        why = []
        if row.throws == ANY:
            why.append(f"throw blank -> {t} from totals")
        elif len(row.throws) > 1:
            why.append(f"throw {'/'.join(map(str, row.throws))} -> {t}")
        elif t not in row.throws:
            why.append(f"throw read {row.throws[0]} -> {t}")
        if row.totals is not None and tot not in row.totals:
            why.append(f"total read {'/'.join(map(str, row.totals))} -> {tot}")
        # Another throw here that is just as consistent?
        rivals = [v for v in ANY if v != t and (alt := best_path(rows, (i, v))) and alt[0] == cost]
        if rivals:
            why.append(f"could also be {'/'.join(map(str, rivals))}")
        notes.append("; ".join(why))
    return Solved(path, totals, cost, notes)


def solve_set(r: SetReading) -> dict:
    solved = solve(r.rows)
    n = len(r.players)
    out_rows = []
    for k, (row, t, tot, note) in enumerate(zip(r.rows, solved.throws, solved.totals, solved.notes)):
        player = r.players[k % n]
        if row.col is not None and row.col != k % n + 1:
            note = (note + "; " if note else "") + f"written in column {row.col}, turn order says {player}"
        out_rows.append({"turn": k + 1, "player": player, "score": t, "total": tot, "check": note})
    return {"key": r.key, "players": r.players, "cost": solved.cost, "rows": out_rows}


def main() -> None:
    results = [solve_set(r) for r in parse(Path(sys.argv[1]))]
    json.dump(results, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
