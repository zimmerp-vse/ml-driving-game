#!/usr/bin/env python3
"""Checks a set of class files against the data contract and summarises the data.

Works on the app's export and on ml/synth.py's output alike:

    python3 ml/check_files.py <folder>                 game_train.csv, game_test.csv, game_labels.csv
    python3 ml/check_files.py <folder> --raw game_raw_ABC123.csv

Checks (contract sections 4 and 4.4): columns, values, sorting, unique round ids, every
complete player with exactly --test-rounds test rows after their training rows, labels matching
the test rows; with --raw also that the files follow from the raw file by the rules.

Then a summary for calibrating the game: accident shares overall, by device, by sex and over
attempts; rounds per player; players who never or always crashed in training; and a logistic
fit of accident on the conditions and attempt, with the spread of the fitted probabilities
(the target: an overall share of about 0.3 to 0.5, and conditions that matter).

Exit code 1 if a check failed. Needs Python 3.9+ and numpy.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

TRAIN_COLUMNS = ["round_id", "player", "sex", "age", "device", "country", "attempt",
                 "trip_seconds", "car_rate", "obstacle_rate", "pedestrian_rate", "scene", "accident"]
TEST_COLUMNS = TRAIN_COLUMNS[:-1]
LABEL_COLUMNS = ["round_id", "accident"]
PLAYER_COLUMNS = ["sex", "age", "device", "country"]
CONDITIONS = ["trip_seconds", "car_rate", "obstacle_rate", "pedestrian_rate"]
ROUND_ID = re.compile(r"^[A-HJ-NP-Z2-9]{8}$")

errors: list[str] = []


def fail(msg: str) -> None:
    if len(errors) < 50:
        errors.append(msg)


def read(path: Path, columns: list[str] | None) -> list[dict]:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        fail(f"{path.name}: starts with a BOM")
    with path.open(newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        if columns is not None and r.fieldnames != columns:
            fail(f"{path.name}: columns {r.fieldnames}, expected {columns}")
        return list(r)


def is_number(s: str) -> bool:
    try:
        return math.isfinite(float(s)) and "e" not in s.lower()
    except ValueError:
        return False


def check_rows(name: str, rows: list[dict], with_accident: bool) -> None:
    for i, r in enumerate(rows, start=2):
        where = f"{name} line {i}"
        if not ROUND_ID.match(r["round_id"] or ""):
            fail(f"{where}: round_id {r['round_id']!r}")
        if not r["player"]:
            fail(f"{where}: empty player")
        if r["sex"] not in ("F", "M", ""):
            fail(f"{where}: sex {r['sex']!r}")
        if r["age"] and not (r["age"].isdigit() and 15 <= int(r["age"]) <= 99):
            fail(f"{where}: age {r['age']!r}")
        if r["device"] not in ("touch", "mouse"):
            fail(f"{where}: device {r['device']!r}")
        if r["country"] and not re.match(r"^[A-Z]{2}$", r["country"]):
            fail(f"{where}: country {r['country']!r}")
        if not (r["attempt"].isdigit() and int(r["attempt"]) >= 1):
            fail(f"{where}: attempt {r['attempt']!r}")
        for c in CONDITIONS:
            if not is_number(r[c]):
                fail(f"{where}: {c} {r[c]!r}")
        if not r["scene"]:
            fail(f"{where}: empty scene")
        if with_accident and r["accident"] not in ("0", "1"):
            fail(f"{where}: accident {r['accident']!r}")


def check_sorted(name: str, rows: list[dict]) -> None:
    keys = [(r["player"].lower(), r["player"], int(r["attempt"]) if r["attempt"].isdigit() else 0) for r in rows]
    for i in range(1, len(keys)):
        if keys[i] <= keys[i - 1]:
            fail(f"{name} line {i + 2}: not sorted by player then attempt (or a repeated attempt)")
            break


def check(folder: Path, test_rounds: int, raw_path: Path | None):
    train = read(folder / "game_train.csv", TRAIN_COLUMNS)
    test = read(folder / "game_test.csv", TEST_COLUMNS)
    labels_path = folder / "game_labels.csv"
    labels = read(labels_path, LABEL_COLUMNS) if labels_path.exists() else None

    check_rows("game_train.csv", train, True)
    check_rows("game_test.csv", test, False)
    check_sorted("game_train.csv", train)
    check_sorted("game_test.csv", test)

    ids = [r["round_id"] for r in train + test]
    if len(ids) != len(set(ids)):
        fail("round_id is not unique across game_train.csv and game_test.csv")

    by_player_train = defaultdict(list)
    for r in train:
        by_player_train[r["player"]].append(r)
    by_player_test = defaultdict(list)
    for r in test:
        by_player_test[r["player"]].append(r)
    for p, rows in by_player_test.items():
        if len(rows) != test_rounds:
            fail(f"game_test.csv: {p} has {len(rows)} rows, expected {test_rounds}")
        if p not in by_player_train:
            fail(f"game_test.csv: {p} has no training rows (rule 3)")
            continue
        if min(int(r["attempt"]) for r in rows) <= max(int(r["attempt"]) for r in by_player_train[p]):
            fail(f"game_test.csv: {p} has a test round before a training round")
        if any(tuple(r[c] for c in PLAYER_COLUMNS) != tuple(by_player_train[p][0][c] for c in PLAYER_COLUMNS) for r in rows):
            fail(f"{p}: sex, age, device or country differ between the files")
    for p, rows in by_player_train.items():
        if len({tuple(r[c] for c in PLAYER_COLUMNS) for r in rows}) > 1:
            fail(f"game_train.csv: {p}: sex, age, device or country differ between rows")

    if labels is not None:
        if [r["round_id"] for r in labels] != [r["round_id"] for r in test]:
            fail("game_labels.csv: round_ids are not those of game_test.csv in the same order")
        if any(r["accident"] not in ("0", "1") for r in labels):
            fail("game_labels.csv: accident not 0 or 1")

    if raw_path is not None:
        check_against_raw(read(raw_path, None), train, test, test_rounds)
    return train, test, labels


def check_against_raw(raw: list[dict], train: list[dict], test: list[dict], test_rounds: int) -> None:
    """The rules of section 4.4, applied to the raw file independently of the app."""
    per = defaultdict(list)
    for r in raw:
        per[r["player"]].append(r)
    want_train, want_test = set(), set()
    for p, rows in per.items():
        counted_train = sum(1 for r in rows if r["phase"] == "train" and r["counted"] == "true")
        complete = sum(1 for r in rows if r["test_index"]) >= test_rounds
        if counted_train == 0:
            continue
        for r in rows:
            if not r["round_ended_at"] or r["counted"] != "true":
                continue
            key = (p, r["attempt"])
            if complete and r["phase"] == "test":
                if r["test_index"]:
                    want_test.add(key)
            else:
                want_train.add(key)
            if r["outcome"] not in ("delivered", "crash_car", "crash_obstacle", "crash_pedestrian"):
                fail(f"raw: {p} attempt {r['attempt']}: counted but outcome {r['outcome']!r}")
    got_train = {(r["player"], r["attempt"]) for r in train}
    got_test = {(r["player"], r["attempt"]) for r in test}
    if got_train != want_train:
        fail(f"game_train.csv does not follow from the raw file: {len(got_train - want_train)} extra, {len(want_train - got_train)} missing rows")
    if got_test != want_test:
        fail(f"game_test.csv does not follow from the raw file: {len(got_test - want_test)} extra, {len(want_test - got_test)} missing rows")
    outcome = {(r["player"], r["attempt"]): r["outcome"] for r in raw}
    for r in train:
        if outcome.get((r["player"], r["attempt"]), "").startswith("crash") != (r["accident"] == "1"):
            fail(f"game_train.csv: {r['player']} attempt {r['attempt']}: accident does not match the raw outcome")
            break
    n_timeout = sum(1 for r in raw if r["round_ended_at"] and r["counted"] != "true")
    n_interrupted = sum(1 for r in raw if not r["round_ended_at"])
    print(f"raw: {len(raw)} rounds, {len(per)} players; timeouts or breakdowns {n_timeout}, interrupted {n_interrupted}")


# --- summary -----------------------------------------------------------------------------------

def share(rows: list[dict]) -> str:
    if not rows:
        return "  -  (0)"
    return f"{sum(r['accident'] == '1' for r in rows) / len(rows):.3f} ({len(rows)})"


def logistic_fit(X: np.ndarray, y: np.ndarray, ridge: float = 1e-3) -> np.ndarray:
    b = np.zeros(X.shape[1])
    for _ in range(50):
        p = 1 / (1 + np.exp(-(X @ b)))
        w = p * (1 - p)
        H = X.T @ (X * w[:, None]) + ridge * np.eye(X.shape[1])
        step = np.linalg.solve(H, X.T @ (y - p) - ridge * b)
        b += step
        if np.max(np.abs(step)) < 1e-8:
            break
    return b


def summary(train: list[dict], test: list[dict], labels: list[dict] | None) -> None:
    acc = {r["round_id"]: r["accident"] for r in labels} if labels else {}
    test_l = [{**r, "accident": acc[r["round_id"]]} for r in test if r["round_id"] in acc]
    rows = train + test_l
    players = sorted({r["player"] for r in train})
    print(f"\nplayers: {len(players)} in game_train.csv, {len({r['player'] for r in test})} complete (in game_test.csv)")
    print(f"accident share: train {share(train)}" + (f", test {share(test_l)}" if test_l else ""))
    for col in ("device", "sex"):
        parts = [f"{v or 'missing'} {share([r for r in train if r[col] == v])}" for v in sorted({r[col] for r in train})]
        print(f"  by {col}: " + ", ".join(parts))
    bins = [(1, 5), (6, 10), (11, 20), (21, 30), (31, 10_000)]
    print("  by attempt: " + ", ".join(
        f"{lo}-{hi if hi < 10_000 else ''} {share([r for r in rows if lo <= int(r['attempt']) <= hi])}" for lo, hi in bins))
    countries = sorted({r["country"] or "missing" for r in train})
    print(f"  countries: {', '.join(countries)}")

    per = defaultdict(list)
    for r in train:
        per[r["player"]].append(int(r["accident"]))
    n = np.array([len(v) for v in per.values()])
    print(f"training rows per player: min {n.min()}, median {int(np.median(n))}, max {n.max()}")
    never = [p for p, v in per.items() if sum(v) == 0]
    always = [p for p, v in per.items() if sum(v) == len(v)]
    print(f"players who never crashed in training: {len(never)}; who always crashed: {len(always)}")

    # Logistic fit on standardised conditions and log(attempt): which matter, and how far apart
    # the fitted probabilities are.
    feats = CONDITIONS + ["log_attempt", "touch"]
    X = np.array([[float(r[c]) for c in CONDITIONS] + [math.log(int(r["attempt"])), r["device"] == "touch"]
                  for r in rows], dtype=float)
    y = np.array([int(r["accident"]) for r in rows], dtype=float)
    mu, sd = X.mean(0), X.std(0)
    sd[sd == 0] = 1
    Z = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    b = logistic_fit(Z, y)
    p = 1 / (1 + np.exp(-(Z @ b)))
    print("logistic fit, change in log odds per standard deviation (all rounds with a label):")
    for f, coef in zip(feats, b[1:]):
        print(f"  {f:16s} {coef:+.2f}")
    q = np.quantile(p, [0.1, 0.5, 0.9])
    print(f"fitted accident probability: 10% {q[0]:.2f}, median {q[1]:.2f}, 90% {q[2]:.2f}")
    s = y.mean()
    if not 0.3 <= s <= 0.5:
        print(f"NOTE: the accident share {s:.2f} is outside the target 0.3 to 0.5")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("folder", type=Path)
    ap.add_argument("--raw", type=Path, help="the raw file, to check the files follow from it")
    ap.add_argument("--test-rounds", type=int, default=5)
    a = ap.parse_args()
    raw = a.raw if a.raw is None or a.raw.exists() else a.folder / a.raw
    train, test, labels = check(a.folder, a.test_rounds, raw)
    if errors:
        print("FAILED:")
        for e in errors:
            print("  " + e)
    else:
        print("files OK")
    summary(train, test, labels)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
