#!/usr/bin/env python3
"""Synthetic class for the driving study (data contract section 7).

Writes the four files of the data contract (sections 3 and 4) for an invented class, with the
same columns, rules and number formats as the app's export:

    game_train.csv, game_test.csv            (to students)
    game_labels.csv, game_raw_<CODE>.csv     (teacher only)

plus two teacher-only files the app does not have:

    game_truth_<CODE>.csv    round_id, p_true: the true accident probability of every counted round
    synth_model_<CODE>.json  the parameters and the model, so a class can be regenerated

The invented players have a skill each, learn over attempts (each at their own pace), crash more
on touch screens, differ slightly by sex, nearly all connect from one country, and meet
conditions drawn as the app draws them (uniform within the study's ranges). The accident
probability is logistic in all of that. Rounds take time: a delivered round lasts longer than a
crash, so crash-prone players fit more training rounds into the training time, as in the game.
Some rounds time out, a few are interrupted by a reload, and a few players leave early.

By default the intercept is calibrated so the share of accidents over counted rounds is about
--target-share.

    python3 ml/synth.py --out synth/ --players 30
    python3 ml/synth.py --out synth/ --params study_params.json --target-share 0.35

Needs Python 3.9+ and numpy. Everything the model assumes is in MODEL below: invented, not
measured. After the dry run it can be refitted to real data.
"""

from __future__ import annotations

import argparse
import json
import math
import string
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

# --- the study, as in the app (data contract section 2, v06) ---------------------------------

DEFAULT_PARAMS = {
    "training_seconds": 600,
    "max_training_rounds": None,
    "test_rounds": 5,
    "scene_count": 10,
    "ranges": {
        "trip_seconds": {"min": 13, "max": 33, "scale": "linear"},
        "car_rate": {"min": 0.01, "max": 0.09, "scale": "linear"},
        "obstacle_rate": {"min": 0.002, "max": 0.015, "scale": "linear"},
        "pedestrian_rate": {"min": 0.001, "max": 0.010, "scale": "linear"},
    },
    "fixed": {"malfunctionProbability": 0, "deliveryDistance": 200},
}

# The game's scenes, in its order (speedy-deliveries src/game/config.ts).
SCENES = [
    "Sunset Beach", "Mountain Pass", "City Night", "Desert Highway", "Rainy Town",
    "Coastal Road", "Autumn Forest", "Snow Valley", "Tropical Island", "Volcano Road",
]

# Money as in the game (GAME_CONFIG): reward per delivery, cost per crash type, start balance.
REWARD = 500
CRASH_COST = {"crash_car": 300, "crash_obstacle": 200, "crash_pedestrian": 150}
START_MONEY = 1000

# --- the invented model ------------------------------------------------------------------------
# logit p = intercept + skill_i
#           + car * x_car + obstacle * x_obstacle + pedestrian * x_pedestrian
#           + time_pressure * (1 - x_trip)          (a shorter time limit means driving faster)
#           + scene effect
#           - learning_i * (1 - exp(-(attempt - 1) / learning_attempts))
#           + touch * [device = touch] + sex_m * [sex = M]
# where x_c is the condition's position within its range, 0 at min and 1 at max.
# Age and country have no effect: features that carry nothing are part of the lesson.

MODEL = {
    "intercept": None,  # calibrated to --target-share unless given with --intercept
    "skill_sd": 0.7,
    "car": 1.4,
    "obstacle": 0.8,
    "pedestrian": 0.6,
    "time_pressure": 0.9,
    "scene": {"City Night": 0.15, "Rainy Town": 0.2, "Snow Valley": 0.25},
    "learning_mean": 0.9,
    "learning_sd": 0.3,
    "learning_attempts": 8.0,
    "touch": 0.35,
    "sex_m": -0.15,
    # Not part of p, but of what reaches the files:
    "timeout_logit": -3.2,          # timeout share among non-crash rounds, logit at x_trip = 1
    "timeout_time_pressure": 2.0,   # ... plus this times (1 - x_trip)
    "interrupt_share": 0.01,        # rounds interrupted by a reload (started, never ended)
    "leave_early_share": 0.03,      # players who leave within the first minute or two
    "leave_in_test_share": 0.05,    # players who leave during the test phase (not complete)
}

ROUND_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # as mlgame.random_code

ADJECTIVES = [
    "fast", "lucky", "brave", "quiet", "red", "blue", "green", "silver", "happy", "wild", "calm",
    "tiny", "big", "sunny", "rainy", "cool", "smart", "lazy", "busy", "crazy", "golden", "dark",
]
NOUNS = [
    "fox", "panda", "tiger", "otter", "eagle", "wolf", "koala", "shark", "falcon", "lynx", "bear",
    "driver", "rider", "pilot", "racer", "turtle", "rocket", "comet", "ninja", "owl", "hawk",
]


# --- helpers ---------------------------------------------------------------------------------

def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def draw_value(rng: np.random.Generator, r: dict) -> float:
    u = rng.random()
    lo, hi = float(r["min"]), float(r["max"])
    if r.get("scale") == "log":
        return math.exp(math.log(lo) + u * (math.log(hi) - math.log(lo)))
    return lo + u * (hi - lo)


def position(value: float, r: dict) -> float:
    lo, hi = float(r["min"]), float(r["max"])
    if hi == lo:
        return 0.5
    if r.get("scale") == "log":
        return (math.log(value) - math.log(lo)) / (math.log(hi) - math.log(lo))
    return (value - lo) / (hi - lo)


def iso(t: datetime) -> str:
    """Timestamps as Postgres writes timestamptz into JSON: trailing zeros of the fraction dropped."""
    s = t.isoformat(timespec="microseconds")
    head, frac_tz = s.split(".")
    frac, tz = frac_tz[:6].rstrip("0"), frac_tz[6:]
    return f"{head}.{frac}{tz}" if frac else f"{head}{tz}"


def format_number(x: float) -> str:
    """As the app's formatNumber: integers plain, otherwise at most 6 decimals, no exponent."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if not math.isfinite(x):
        return ""
    if float(x).is_integer():
        return str(int(x))
    return f"{x:.6f}".rstrip("0").rstrip(".")


def format_cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        s = "true" if v else "false"
    elif isinstance(v, (int, float)):
        s = format_number(v)
    elif isinstance(v, dict):
        # jsonb orders keys by length, then bytewise; and JSON.stringify adds no spaces.
        s = json.dumps({k: v[k] for k in sorted(v, key=lambda k: (len(k), k))}, separators=(",", ":"))
    else:
        s = str(v)
    if any(c in s for c in ',"\r\n') or s != s.strip():
        s = '"' + s.replace('"', '""') + '"'
    return s


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    lines = [",".join(columns)]
    lines += [",".join(format_cell(r.get(c)) for c in columns) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# --- the simulation --------------------------------------------------------------------------

@dataclass
class Player:
    nick: str
    sex: str | None
    age: int | None
    device: str
    country: str | None
    viewport: tuple[int, int]
    joined_at: datetime
    skill: float
    learning: float
    rounds: list[dict] = field(default_factory=list)


def make_nicks(rng: np.random.Generator, n: int) -> list[str]:
    nicks: list[str] = []
    seen: set[str] = set()
    while len(nicks) < n:
        a, b = rng.choice(ADJECTIVES), rng.choice(NOUNS)
        style = rng.random()
        if style < 0.4:
            nick = f"{a}{b}"
        elif style < 0.7:
            nick = f"{a.capitalize()}{b.capitalize()}"
        else:
            nick = f"{b}{rng.integers(1, 100)}"
        if nick.lower() not in seen:
            seen.add(nick.lower())
            nicks.append(nick)
    return nicks


def make_players(rng: np.random.Generator, n: int, start: datetime, model: dict) -> list[Player]:
    players = []
    for nick in make_nicks(rng, n):
        sex = rng.choice(["F", "M", None], p=[0.45, 0.5, 0.05])
        age = None if rng.random() < 0.05 else int(np.clip(round(rng.normal(22.5, 2.0)), 19, 35))
        device = "touch" if rng.random() < 0.4 else "mouse"
        country = rng.choice(["CZ", "SK", None], p=[0.93, 0.04, 0.03])
        viewport = (
            [(390, 844), (393, 852), (412, 915), (430, 932)] if device == "touch"
            else [(1280, 720), (1440, 900), (1536, 864), (1920, 1080)]
        )[rng.integers(0, 4)]
        players.append(Player(
            nick=nick, sex=sex, age=age, device=device, country=country, viewport=viewport,
            joined_at=start + timedelta(seconds=float(rng.uniform(0, 120))),
            skill=float(rng.normal(0, model["skill_sd"])),
            learning=float(max(0.0, rng.normal(model["learning_mean"], model["learning_sd"]))),
        ))
    return players


def accident_logit(model: dict, params: dict, pl: Player, attempt: int, x: dict, scene: str) -> float:
    m = model
    return (
        m["intercept"] + pl.skill
        + m["car"] * x["car_rate"] + m["obstacle"] * x["obstacle_rate"]
        + m["pedestrian"] * x["pedestrian_rate"] + m["time_pressure"] * (1 - x["trip_seconds"])
        + m["scene"].get(scene, 0.0)
        - pl.learning * (1 - math.exp(-(attempt - 1) / m["learning_attempts"]))
        + m["touch"] * (pl.device == "touch") + m["sex_m"] * (pl.sex == "M")
    )


def play(rng: np.random.Generator, pl: Player, params: dict, model: dict) -> None:
    """Plays one player's session as the app would record it (mlg_round_start / mlg_round_end)."""
    ranges = params["ranges"]
    training_s = float(params.get("training_seconds") or 600)
    max_train = params.get("max_training_rounds")
    test_rounds = int(params.get("test_rounds") or 5)
    scene_count = min(int(params.get("scene_count") or 10), len(SCENES))

    # When this player stops playing, if they leave early.
    u = rng.random()
    leave_at = None
    if u < model["leave_early_share"]:
        leave_at = ("early", float(rng.uniform(15, 120)))
    elif u < model["leave_early_share"] + model["leave_in_test_share"]:
        leave_at = ("test", float(rng.uniform(0, 90)))

    t = pl.joined_at + timedelta(seconds=float(rng.uniform(20, 60)))  # reading, Start driving
    first_start = None  # the server sets it at the first round that ends
    counted_test = 0
    balance = START_MONEY
    attempt = 0
    while counted_test < test_rounds and attempt < 400:
        attempt += 1
        if leave_at:
            kind, sec = leave_at
            if kind == "early" and t >= pl.joined_at + timedelta(seconds=sec):
                break
            if kind == "test" and first_start and t >= first_start + timedelta(seconds=training_s + sec):
                break

        values = {k: draw_value(rng, ranges[k]) for k in ("trip_seconds", "car_rate", "obstacle_rate", "pedestrian_rate")}
        # Stored as the app stores them: trip in whole tenths of a second, rates to 6 decimals.
        trip_ms = int(round(values["trip_seconds"] * 10) * 100)
        cond = {
            "tripDurationMs": trip_ms,
            "carSpawnRate": round(values["car_rate"], 6),
            "obstacleSpawnRate": round(values["obstacle_rate"], 6),
            "pedestrianSpawnRate": round(values["pedestrian_rate"], 6),
            "sceneIndex": int(min(scene_count - 1, math.floor(rng.random() * scene_count))),
        }
        trip_s = trip_ms / 1000
        stored = {"trip_seconds": round(trip_s, 1), "car_rate": cond["carSpawnRate"],
                  "obstacle_rate": cond["obstacleSpawnRate"], "pedestrian_rate": cond["pedestrianSpawnRate"]}
        x = {k: position(stored[k], ranges[k]) for k in stored}
        scene = SCENES[cond["sceneIndex"]]
        start = t
        rnd = {"attempt": attempt, "conditions": cond, "stored": stored, "started_at": start,
               "ended_at": None, "phase": None, "counted": None, "test_index": None, "outcome": None,
               "time_ms": None, "scene": None, "money_earned": None, "money_lost": None,
               "money_balance": None, "applied": None, "p_true": None}
        pl.rounds.append(rnd)

        if rng.random() < model["interrupt_share"]:
            # A reload: the round stays started, never ended; the next attempt follows the reload.
            t = start + timedelta(seconds=float(rng.uniform(3, trip_s) + rng.uniform(10, 30)))
            continue

        p = sigmoid(accident_logit(model, params, pl, attempt, x, scene))
        if rng.random() < p:
            w = np.array([model["car"] * x["car_rate"] + 0.3,
                          model["obstacle"] * x["obstacle_rate"] + 0.2,
                          model["pedestrian"] * x["pedestrian_rate"] + 0.15])
            outcome = ["crash_car", "crash_obstacle", "crash_pedestrian"][int(rng.choice(3, p=w / w.sum()))]
            dur = trip_s * rng.uniform(0.1, 0.85)
        else:
            q = sigmoid(model["timeout_logit"] + model["timeout_time_pressure"] * (1 - x["trip_seconds"]))
            if rng.random() < q:
                outcome, dur = "timeout", trip_s
            else:
                outcome, dur = "delivered", trip_s * rng.uniform(0.55, 0.95)

        if first_start is None:
            first_start = start
        phase = "train" if (
            start < first_start + timedelta(seconds=training_s)
            and (max_train is None or attempt <= int(max_train))
        ) else "test"
        counted = outcome != "timeout"
        test_index = None
        if phase == "test" and counted and counted_test < test_rounds:
            counted_test += 1
            test_index = counted_test
        earned = REWARD if outcome == "delivered" else 0
        lost = CRASH_COST.get(outcome, 0)
        balance += earned - lost
        end = start + timedelta(seconds=float(dur))
        rnd.update({
            "ended_at": end, "phase": phase, "counted": counted, "test_index": test_index,
            "outcome": outcome, "time_ms": int(round(dur * 1000)), "scene": scene,
            "money_earned": earned, "money_lost": lost, "money_balance": balance,
            "applied": dict(cond), "p_true": p if counted else None,
        })
        # The result screen and NEXT DELIVERY.
        t = end + timedelta(seconds=float(min(30, 2.5 + rng.exponential(3.0))))


def simulate(seed: int, n_players: int, params: dict, model: dict, start: datetime) -> list[Player]:
    rng = np.random.default_rng(seed)
    players = make_players(rng, n_players, start, model)
    for pl in players:
        play(rng, pl, params, model)
    return players


def counted_share(players: list[Player]) -> float:
    ys = [r["outcome"].startswith("crash") for pl in players for r in pl.rounds if r["counted"]]
    return sum(ys) / len(ys) if ys else float("nan")


def calibrate_intercept(params: dict, model: dict, target: float, start: datetime) -> float:
    """Bisection on the intercept: the accident share over counted rounds of a large class."""
    lo, hi = -6.0, 4.0
    for _ in range(18):
        mid = (lo + hi) / 2
        share = counted_share(simulate(12345, 400, params, {**model, "intercept": mid}, start))
        lo, hi = (mid, hi) if share < target else (lo, mid)
    return round((lo + hi) / 2, 3)


# --- the files (data contract section 4.4, as mlgame.export_rows) ----------------------------

TRAIN_COLUMNS = ["round_id", "player", "sex", "age", "device", "country", "attempt",
                 "trip_seconds", "car_rate", "obstacle_rate", "pedestrian_rate", "scene", "accident"]
TEST_COLUMNS = [c for c in TRAIN_COLUMNS if c != "accident"]
LABEL_COLUMNS = ["round_id", "accident"]
RAW_COLUMNS = [
    "study_code", "player", "sex", "age", "device", "country", "viewport_width", "viewport_height",
    "joined_at", "attempt", "phase", "test_index", "counted", "round_started_at", "round_ended_at",
    "trip_seconds", "car_rate", "obstacle_rate", "pedestrian_rate", "scene", "outcome", "time_ms",
    "money_earned", "money_lost", "money_balance", "applied",
]


def build_files(players: list[Player], code: str, test_rounds: int, rng: np.random.Generator):
    raw, train, test, truth = [], [], [], []
    counts = {"dropped_timeout_or_breakdown": 0, "dropped_interrupted": 0,
              "dropped_no_training_round": 0, "dropped_after_done": 0}
    used_ids: set[str] = set()

    def new_id() -> str:
        while True:
            rid = "".join(ROUND_ID_ALPHABET[i] for i in rng.integers(0, 32, 8))
            if rid not in used_ids:
                used_ids.add(rid)
                return rid

    for pl in sorted(players, key=lambda p: (p.nick.lower(), p.nick)):
        counted_train = sum(1 for r in pl.rounds if r["phase"] == "train" and r["counted"])
        complete = sum(1 for r in pl.rounds if r["test_index"] is not None) >= test_rounds
        for r in sorted(pl.rounds, key=lambda r: r["attempt"]):
            rid = new_id()
            base = {"player": pl.nick, "sex": pl.sex, "age": pl.age, "device": pl.device,
                    "country": pl.country}
            raw.append({
                **base, "study_code": code, "viewport_width": pl.viewport[0],
                "viewport_height": pl.viewport[1], "joined_at": iso(pl.joined_at),
                "attempt": r["attempt"], "phase": r["phase"], "test_index": r["test_index"],
                "counted": r["counted"], "round_started_at": iso(r["started_at"]),
                "round_ended_at": iso(r["ended_at"]) if r["ended_at"] else None,
                **r["stored"], "scene": r["scene"], "outcome": r["outcome"], "time_ms": r["time_ms"],
                "money_earned": r["money_earned"], "money_lost": r["money_lost"],
                "money_balance": r["money_balance"], "applied": r["applied"],
            })
            if r["ended_at"] is None:
                counts["dropped_interrupted"] += 1
                continue
            if not r["counted"]:
                counts["dropped_timeout_or_breakdown"] += 1
                continue
            if counted_train == 0:
                counts["dropped_no_training_round"] += 1
                continue
            row = {"round_id": rid, **base, "attempt": r["attempt"], **r["stored"],
                   "scene": r["scene"], "accident": int(r["outcome"].startswith("crash"))}
            if complete and r["phase"] == "test":
                if r["test_index"] is None:
                    counts["dropped_after_done"] += 1
                    continue
                test.append(row)
            else:
                train.append(row)
            truth.append({"round_id": rid, "p_true": round(r["p_true"], 6)})
    return raw, train, test, truth, counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=Path("synth"), help="output folder (created)")
    ap.add_argument("--players", type=int, default=30)
    ap.add_argument("--seed", type=int,
                    help="default: a random seed, recorded in synth_model_<CODE>.json. The repo is "
                         "public, so a class's data must not come from a seed anyone can guess")
    ap.add_argument("--code", default="SYNTH1", help="study code in the raw file and file names")
    ap.add_argument("--params", type=Path, help="study parameters as JSON (default: contract v06)")
    ap.add_argument("--target-share", type=float, default=0.4,
                    help="accident share over counted rounds the intercept is calibrated to")
    ap.add_argument("--intercept", type=float, help="use this intercept, no calibration")
    ap.add_argument("--start", default="2026-11-19T09:15:00+00:00", help="when the class starts playing")
    a = ap.parse_args()

    if a.seed is None:
        a.seed = int(np.random.SeedSequence().entropy % 2**31)
    params = {**DEFAULT_PARAMS, **(json.loads(a.params.read_text()) if a.params else {})}
    start = datetime.fromisoformat(a.start).astimezone(timezone.utc)
    model = dict(MODEL)
    model["intercept"] = a.intercept if a.intercept is not None else calibrate_intercept(params, model, a.target_share, start)

    players = simulate(a.seed, a.players, params, model, start)
    raw, train, test, truth, counts = build_files(
        players, a.code, int(params.get("test_rounds") or 5), np.random.default_rng(a.seed + 1))

    a.out.mkdir(parents=True, exist_ok=True)
    write_csv(a.out / "game_train.csv", TRAIN_COLUMNS, train)
    write_csv(a.out / "game_test.csv", TEST_COLUMNS, test)
    write_csv(a.out / "game_labels.csv", LABEL_COLUMNS, test)
    write_csv(a.out / f"game_raw_{a.code}.csv", RAW_COLUMNS, raw)
    write_csv(a.out / f"game_truth_{a.code}.csv", ["round_id", "p_true"], truth)
    (a.out / f"synth_model_{a.code}.json").write_text(json.dumps(
        {"seed": a.seed, "players": a.players, "code": a.code, "start": a.start,
         "params": params, "model": model}, indent=2) + "\n", encoding="utf-8")

    complete = len({r["player"] for r in test})
    share_train = sum(r["accident"] for r in train) / max(1, len(train))
    share_test = sum(r["accident"] for r in test) / max(1, len(test))
    print(f"seed {a.seed}, intercept {model['intercept']}; players {a.players}, complete {complete}")
    print(f"game_train.csv {len(train)} rows, accident share {share_train:.3f}")
    print(f"game_test.csv  {len(test)} rows, accident share {share_test:.3f}")
    print("dropped: " + ", ".join(f"{k.removeprefix('dropped_')} {v}" for k, v in counts.items()))
    print(f"written to {a.out}/")


if __name__ == "__main__":
    main()
