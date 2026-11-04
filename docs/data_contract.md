# Driving game: data contract, v04 (4.11.2026)

*Master copy (since 4.11.2026). The ML2 project keeps a pointer. Changes to it affect the ML2 notebooks and scorer, so they are agreed with Pavel and noted under Versions.*

The contract between the app **`ml-driving-game`** (see `app_spec.md`; usable in a variety of ML classes) and everything a class builds on its data: the notebook, the scorer, the synthetic generator. ML2 block 6 (19.11.2026) is the first user. Anything not written here is not promised.

## 1. Terms

| term | meaning |
|---|---|
| study | one class session, created by the admin; has a short join code and its parameters (section 2) |
| player | one respondent in one study, identified by the nick they typed; nick unique within a study, case-insensitive |
| round | one trip in the game; ends in a delivery, a crash, a timeout, or (if ever switched on) a breakdown |
| attempt | the round's position in the player's sequence, 1, 2, 3, ..., counting **every** round the player started, timeouts included |
| training phase | rounds that **started** before the study's training time ran out (and within the optional round cap) |
| test phase | the rounds after it, until the player has `test_rounds` (5) **counted** test rounds |
| counted round | a round that ended in a delivery or a crash; timeouts and breakdowns are not counted |
| accident | 1 if the round ended in `crash_car`, `crash_obstacle` or `crash_pedestrian`, 0 if `delivered` |
| complete player | a player with all 5 counted test rounds |

## 2. Study parameters (set by the admin, stored with the study)

| parameter | default | meaning |
|---|---|---|
| `training_seconds` | 600 | training time, measured from the start of the player's first round; the round in progress when it runs out is finished and is still a training round |
| `max_training_rounds` | none | optional cap; the training phase ends at whichever comes first |
| `test_rounds` | 5 | counted test rounds per player |
| `ranges` | see below | for each varied condition: min, max, scale (`linear` or `log`) |
| `fixed` | `malfunctionProbability: 0`, `deliveryDistance: 200` | conditions sent to the game unchanged for every round; `deliveryDistance` is the road length of one delivery (the game's own default is 300) |
| `seed` | random | seed of the condition draws, stored, so the draws can be reproduced |

Varied conditions, drawn **independently for every round**, uniform on the given scale. v01 were Charming Ride's T3 ranges. v02 makes rounds about a third shorter: the road is a third shorter (`deliveryDistance` 200), the time limit a third shorter, and the spawn rates 1.5 times higher, so a round meets about as many hazards as before. The dry run decides the final ones (aim: an accident share between about 0.3 and 0.5).

| condition (game name) | column in the files | range v02 (default) | range v01 |
|---|---|---|---|
| `tripDurationMs` | `trip_seconds` | 13 to 33 s | 20 to 50 s |
| `carSpawnRate` | `car_rate` | 0.015 to 0.135 | 0.01 to 0.09 |
| `obstacleSpawnRate` | `obstacle_rate` | 0.003 to 0.0225 | 0.002 to 0.015 |
| `pedestrianSpawnRate` | `pedestrian_rate` | 0.0015 to 0.015 | 0.001 to 0.010 |
| scene index | `scene` | one of the game's 10 scenes, uniform (today the game rotates them by round number, which ties the scene to the attempt; the schedule overrides that) | same |

## 3. What the app logs per round (raw, admin only)

`study_code, player, sex, age, device, country, viewport_width, viewport_height, joined_at, attempt, phase, test_index, counted, round_started_at, round_ended_at, trip_seconds, car_rate, obstacle_rate, pedestrian_rate, scene, outcome, time_ms, money_earned, money_lost, money_balance, applied`

* `phase`: `train` or `test`, assigned by the server at the end of the round from the server time of the round's start.
* `test_index`: 1 to 5 for counted test rounds, empty otherwise.
* `applied`: the conditions the game reports it applied (JSON), for checking against the schedule.
* `device`: `touch` or `mouse`, from the browser's `pointer: coarse` at join time. **Both kinds of device are allowed** (phones and laptops); the device is a feature. No user agent is stored.
* `country`: the country the player connects from, two-letter ISO 3166-1 code, from the IP address at join time (section 3.1); empty if unknown.
* `sex`: `F`, `M`, or empty for "I'd rather not say". `age`: integer, or empty for "I'd rather not say".

### 3.1 Country

Looked up once, at join time, by the hosting platform from the request's IP address (Vercel's `x-vercel-ip-country` header); **the IP address itself is never stored**. A VPN shows the VPN's country. Nearly the whole class is expected in one country: **a feature with no variance is part of the lesson**.

## 4. The three class files (exported by the admin)

All files: UTF-8 without BOM, comma separated, decimal point, header row, one row per round, sorted by `player` then `attempt`. Missing values are empty fields.

### 4.1 `game_train.csv` (to students)

All **counted training rounds**.

| column | type | meaning |
|---|---|---|
| `round_id` | string, 8 characters | random id of the round, unique within the study |
| `player` | string | the nick |
| `sex` | `F`, `M` or empty | |
| `age` | integer or empty | |
| `device` | `touch` or `mouse` | |
| `country` | two letters or empty | |
| `attempt` | integer | as in section 1; gaps are the dropped timeouts and breakdowns, and rounds interrupted by a page reload (started, never ended) |
| `trip_seconds` | number | time limit of the trip |
| `car_rate`, `obstacle_rate`, `pedestrian_rate` | number | spawn rates of the round |
| `scene` | string | scene name |
| `accident` | 0 or 1 | the target |

### 4.2 `game_test.csv` (to students)

The **5 counted test rounds of every complete player**: the same columns without `accident`.

### 4.3 `game_labels.csv` (teacher only, never to students)

`round_id, accident` for the rows of `game_test.csv`.

### 4.4 Rules applied when the files are built

1. Timeouts and breakdowns are dropped from both files; `attempt` keeps its gaps. The number dropped is shown in the admin export dialog.
2. A player who is not complete: their counted training rounds go to `game_train.csv`; any counted test rounds they played go to `game_train.csv` too (they are later than the training rounds and leak nothing); nothing of theirs is in `game_test.csv`.
3. A player with no counted training round is left out of both files.
4. Not in any student file: `time_ms`, the money columns, timestamps, `phase`, `test_index`, the crash type, the viewport. They are known only after the round or say nothing a model may use.
5. Rows are sorted, so the order says nothing more than `player` and `attempt` already do.

## 5. Submission format

* CSV with the header `round_id,p`, one row per round of `game_test.csv`, each round exactly once, no other rows.
* `p`: the probability of an accident, a number between 0 and 1 with a decimal point.
* The app also accepts a semicolon separator; a decimal comma is rejected with a message saying so.
* Exactly 0 or exactly 1 is accepted with a warning; for scoring, p is clipped to [0.001, 0.999] (rule to be confirmed by Pavel and announced in advance).
* If every p is 0 or 1, the file is rejected: "these look like labels, not probabilities".
* The last accepted file of a team counts.
* **No score is ever shown to a team**, on upload or later in the app; the result reaches the class through the admin's report.

## 6. Scoring and reports

* **Log loss** over the rounds of `game_test.csv`: the mean of -(y log p + (1 - y) log(1 - p)), p clipped as in section 5.
* Reference rows on the leaderboard:
  * **base rate**: one p for everybody, the accident share in `game_train.csv`;
  * **player's own rate**: each player's accident share in `game_train.csv`, (accidents + 1) / (rounds + 2) so that it is never 0 or 1.
* The picture: teams and the two reference rows as dots on one horizontal axis of log loss, with an interval from a bootstrap that resamples **players** (their rounds are not independent).
* **Reports, generated by the admin:** a **running report** at any time (participation, the data so far, and the leaderboard of the submissions so far), and the **final report** when the admin closes the study, with the final leaderboard. Contents in the app spec, section 6.4.

## 7. The synthetic generator (built on the ML2 side)

Writes the four files of sections 3 and 4 for an invented class, from the same parameters as section 2: players with a skill drawn per player, a learning curve over attempts, a device effect, a small sex effect, nearly everyone in one country, and accident probabilities driven by the conditions through a logistic model. Rounds last longer when delivered than when crashed, so crash-prone players get more training rounds, as in the real game. It is used to build and test the notebook and the scorer before the app exists, and as the fallback on the day. The app's tests may use its output.

## Versions

* v01, 3.11.2026: first draft.
* v02, 3.11.2026 (Pavel): repo `ml-driving-game`; both devices allowed, device a feature; `country` added (from the IP at join, IP not stored; no-variance feature as part of the lesson); no score ever shown to teams; leaderboard through admin reports, running and final.
* v04, 4.11.2026 (agreed with Pavel): section 2, shorter rounds by default: `fixed` adds `deliveryDistance: 200`; ranges v02 (time limit 13 to 33 s, spawn rates 1.5 times v01). No change to columns or formats; the synthetic generator's defaults should follow.
* v03, 4.11.2026 (agreed with Pavel): master copy moved to the `ml-driving-game` repo; section 4.1, `attempt`: gaps also come from rounds interrupted by a page reload. No change to columns or formats.
