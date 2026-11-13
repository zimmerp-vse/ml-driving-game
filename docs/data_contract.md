# Driving game: data contract, v07 (13.11.2026)

*Master copy (since 4.11.2026). The ML2 project keeps a pointer. Changes to it affect the ML2 notebooks and scorer, so they are agreed with Pavel and noted under Versions.*

The contract between the app **`ml-driving-game`** (see `app_spec.md`; usable in a variety of ML classes) and everything a class builds on its data: the notebook, the scorer, the synthetic generator. ML2 block 6 (19.11.2026) is the first user. Anything not written here is not promised.

## 1. Terms

| term | meaning |
|---|---|
| study | one class session, created by the admin; has a short join code and its parameters (section 2) |
| player | one respondent in one study, identified by the nick they typed; nick unique within a study, case-insensitive |
| round | one trip in the game; ends in a delivery, a crash, a timeout, or (if ever switched on) a breakdown |
| attempt | the round's position in the player's sequence, 1, 2, 3, ..., counting **every** round the player started, timeouts included |
| free play | players play as long as they like and stop with "I'm done", or when the study is closed; nothing about training or test is decided while playing |
| counted round | a round that ended in a delivery or a crash; timeouts and breakdowns are not counted |
| accident | 1 if the round ended in `crash_car`, `crash_obstacle` or `crash_pedestrian`, 0 if `delivered` |
| release | a numbered split of the rounds played up to a cutoff into the training and the test file (section 4.4), made by the admin; the latest release is the one students and teams get |
| test player | in a release, a player with at least `min_rounds` counted rounds up to the cutoff; their last `test_rounds` counted rounds are the test |

## 2. Study parameters (set by the admin, stored with the study)

| parameter | default | meaning |
|---|---|---|
| `test_rounds` | 5 | the default for a release: counted test rounds per test player |
| `min_rounds` | 10 | the default for a release: counted rounds a player needs to be a test player |
| `ranges` | see below | for each varied condition: min, max, scale (`linear` or `log`) |
| `fixed` | `malfunctionProbability: 0`, `deliveryDistance: 200` | conditions sent to the game unchanged for every round; `deliveryDistance` is the road length of one delivery (the game's own default is 300) |
| `seed` | random | seed of the condition draws, stored, so the draws can be reproduced |

Varied conditions, drawn **independently for every round**, uniform on the given scale. v01 were Charming Ride's T3 ranges. v02 made rounds about a third shorter: the road a third shorter (`deliveryDistance` 200), the time limit a third shorter, and the spawn rates 1.5 times higher. That proved too hard (more crashes than deliveries), so v03 keeps the shorter road and time limit but returns to the v01 spawn rates: hazards are as far apart as in the original game, and a round meets about a third fewer of them. The dry run decides the final ones (aim: an accident share between about 0.3 and 0.5).

| condition (game name) | column in the files | range v03 (default) | range v02 | range v01 |
|---|---|---|---|---|
| `tripDurationMs` | `trip_seconds` | 13 to 33 s | 13 to 33 s | 20 to 50 s |
| `carSpawnRate` | `car_rate` | 0.01 to 0.09 | 0.015 to 0.135 | 0.01 to 0.09 |
| `obstacleSpawnRate` | `obstacle_rate` | 0.002 to 0.015 | 0.003 to 0.0225 | 0.002 to 0.015 |
| `pedestrianSpawnRate` | `pedestrian_rate` | 0.001 to 0.010 | 0.0015 to 0.015 | 0.001 to 0.010 |
| scene index | `scene` | one of the game's 10 scenes, uniform (today the game rotates them by round number, which ties the scene to the attempt; the schedule overrides that) | same | same |

## 3. What the app logs per round (raw, admin only)

`study_code, player, sex, age, device, country, viewport_width, viewport_height, joined_at, finished_at, attempt, counted, round_started_at, round_ended_at, trip_seconds, car_rate, obstacle_rate, pedestrian_rate, scene, outcome, time_ms, money_earned, money_lost, money_balance, applied`

* The raw file has **every** round of every player and never changes with a release.
* `finished_at`: when the player said "I'm done"; empty if they did not (closed the tab, or the study was closed).
* `counted`: `true` for a delivery or a crash, `false` for a timeout or breakdown, empty for a round that never ended.
* `applied`: the conditions the game reports it applied (JSON), for checking against the schedule.
* `device`: `touch` (a phone or tablet, played with the on-screen buttons) or `keyboard` (a computer, played with the arrow keys), from the browser's `pointer: coarse` at join time. A touchpad or a mouse cannot be told apart and does not matter: the car is driven with the keys. **Both kinds of device are allowed**; the device is a feature. No user agent is stored.
* `country`: the country the player connects from, two-letter ISO 3166-1 code, from the IP address at join time (section 3.1); empty if unknown.
* `sex`: `F`, `M`, or empty for "I'd rather not say". `age`: integer, or empty for "I'd rather not say".

### 3.1 Country

Looked up once, at join time, by the hosting platform from the request's IP address (Vercel's `x-vercel-ip-country` header); **the IP address itself is never stored**. A VPN shows the VPN's country. Nearly the whole class is expected in one country: **a feature with no variance is part of the lesson**.

## 4. The three class files (one set per release)

All files: UTF-8 without BOM, comma separated, decimal point, header row, one row per round, sorted by `player` then `attempt`. Missing values are empty fields.

### 4.1 `game_train.csv` (to students)

All counted rounds up to the release's cutoff that are not in `game_test.csv`.

| column | type | meaning |
|---|---|---|
| `round_id` | string, 8 characters | random id of the round, unique within the study |
| `player` | string | the nick |
| `sex` | `F`, `M` or empty | |
| `age` | integer or empty | |
| `device` | `touch` or `keyboard` | |
| `country` | two letters or empty | |
| `attempt` | integer | as in section 1; gaps are the dropped timeouts and breakdowns, and rounds interrupted by a page reload (started, never ended) |
| `trip_seconds` | number | time limit of the trip |
| `car_rate`, `obstacle_rate`, `pedestrian_rate` | number | spawn rates of the round |
| `scene` | string | scene name |
| `accident` | 0 or 1 | the target |

### 4.2 `game_test.csv` (to students)

The **last `test_rounds` (5) counted rounds of every test player**: the same columns without `accident`.

### 4.3 `game_labels.csv` (teacher only, never to students)

`round_id, accident` for the rows of `game_test.csv`.

### 4.4 The release rule (v07)

A release has three settings, chosen by the admin after a preview: `test_rounds` (default 5), `min_rounds` (default 10, more than `test_rounds`), and a **cutoff** time (default: the moment of the release).

1. Only rounds that started and ended by the cutoff are used. Timeouts and breakdowns are in neither file; `attempt` keeps its gaps (also from rounds interrupted by a reload, and from rounds still being played at the cutoff).
2. A player with at least `min_rounds` counted rounds is a test player: their last `test_rounds` counted rounds go to `game_test.csv`, all their earlier counted rounds to `game_train.csv`. So a test player's test rounds always come after all their training rounds.
3. A player with fewer counted rounds: all their counted rounds go to `game_train.csv`; nothing of theirs is in `game_test.csv`. Nobody who has a counted round is left out.
4. Not in any student file: `time_ms`, the money columns, timestamps, `finished_at`, the crash type, the viewport. They are known only after the round or say nothing a model may use.
5. Rows are sorted, so the order says nothing more than `player` and `attempt` already do.
6. A release is stored with its number, settings, cutoff and the round ids of both files, so it can be recreated exactly. A later release (more play, other settings) replaces it for students and teams; the earlier one stays available to the admin. The numbers of each release (rows, players, what was dropped) are shown in the admin's preview.

## 5. Submission format

* CSV with the header `round_id,p`, one row per round of the latest release's `game_test.csv`, each round exactly once, no other rows. An upload belongs to the release it was checked against.
* `p`: the probability of an accident, a number between 0 and 1 with a decimal point.
* The app also accepts a semicolon separator; a decimal comma is rejected with a message saying so.
* Exactly 0 or exactly 1 is accepted with a warning; for scoring, p is clipped to [0.001, 0.999] (confirmed by Pavel on 4.11.2026; announced to the class with the task).
* If every p is 0 or 1, the file is rejected: "these look like labels, not probabilities".
* The last accepted file of a team for a release counts for that release. After a new release, teams upload again.
* **No score is ever shown to a team**, on upload or later in the app; the result reaches the class through the admin's report.

## 6. Scoring and reports

* **Log loss** over the rounds of a release's `game_test.csv`: the mean of -(y log p + (1 - y) log(1 - p)), p clipped as in section 5.
* Reference rows on the leaderboard:
  * **base rate**: one p for everybody, the accident share in `game_train.csv`;
  * **player's own rate**: each player's accident share in `game_train.csv`, (accidents + 1) / (rounds + 2) so that it is never 0 or 1.
* The picture: teams and the two reference rows as dots on one horizontal axis of log loss, with an interval from a bootstrap that resamples **players** (their rounds are not independent).
* **Reports, generated by the admin**, for the latest release: a **running report** at any time (participation, the data so far, and the leaderboard of the submissions so far), and the **final report** when the admin closes the study, with the final leaderboard. Contents in the app spec, section 6.4.

## 7. The synthetic generator (`ml/synth.py` in the app repo)

Writes the four files of sections 3 and 4 for an invented class, from the same parameters as section 2: players with a skill drawn per player, a learning curve over attempts, a device effect, a small sex effect, nearly everyone in one country, and accident probabilities driven by the conditions through a logistic model. Players play freely with their own patience, some stop at a check-in, a few leave early or never say they are done; then a release is made by rule 4.4. It also writes the true probability of every round (teacher only). It is used to build and test the notebook and the scorer, and as the fallback on the day. The app's tests check that a release of a synthetic class gives exactly the generator's files. Moved from the ML2 side into the app repo on 12.11.2026; the repo is public, so class data is never made from a guessable seed.

## Versions

* v07, 13.11.2026 (Pavel): free play: no training time; players stop with "I'm done" (`finished_at` in the raw file). The split is made at release (section 4.4): the last `test_rounds` counted rounds of players with at least `min_rounds` (defaults 5 and 10) are the test, everything else counted is training; rounds up to a cutoff; numbered releases, the latest goes to students and teams. Raw file: `phase` and `test_index` removed, `finished_at` added. Device `mouse` renamed `keyboard`. Section 7: the generator lives in the app repo. Student file columns unchanged.
* v01, 3.11.2026: first draft.
* v02, 3.11.2026 (Pavel): repo `ml-driving-game`; both devices allowed, device a feature; `country` added (from the IP at join, IP not stored; no-variance feature as part of the lesson); no score ever shown to teams; leaderboard through admin reports, running and final.
* v06, 4.11.2026 (Pavel): section 2, an easier game: ranges v03 (spawn rates back to v01; the shorter road and time limit of v02 stay). No change to columns or formats; the synthetic generator's defaults should follow.
* v05, 4.11.2026 (Pavel): section 5, the clipping rule is confirmed: p clipped to [0.001, 0.999] for scoring; exact 0 or 1 accepted with a warning; a file with only 0 and 1 rejected. No change to formats.
* v04, 4.11.2026 (agreed with Pavel): section 2, shorter rounds by default: `fixed` adds `deliveryDistance: 200`; ranges v02 (time limit 13 to 33 s, spawn rates 1.5 times v01). No change to columns or formats; the synthetic generator's defaults should follow.
* v03, 4.11.2026 (agreed with Pavel): master copy moved to the `ml-driving-game` repo; section 4.1, `attempt`: gaps also come from rounds interrupted by a page reload. No change to columns or formats.
