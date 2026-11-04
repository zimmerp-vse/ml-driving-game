# `ml-driving-game`: app spec, v03 (4.11.2026)

*Master copy (since 4.11.2026). The ML2 project keeps a pointer.*

A small web app that runs a driving study in class: students join by link or QR code, play the Charming Ride delivery game in an iframe, and later submit predictions. **Meant for a variety of ML classes** (Pavel), so nothing course-specific is hard-coded: titles, the consent line and the parameters belong to a study. ML2 block 6 (19.11.2026) is the first user. Data formats are in `data_contract.md` (the contract).

## 1. Scope

**In:** studies with parameters; anonymous join with nick, sex, age (country and device recorded automatically); the game embedded with per-round conditions; the training and test phases; live progress; the three class files and the raw export; team submissions accepted or rejected on upload, with no score shown; running and final reports with the leaderboard.

**Out (for now):** pricing, a money leaderboard, more than one admin, translations (English only), accounts for students.

## 2. Stack and repo

* **Repo `ml-driving-game`** (Pavel), next to speedy-deliveries (for example `zimmerp-vse/ml-driving-game`).
* Same stack as Charming Ride, so one way of working: Vite, React, TypeScript, Tailwind, Supabase, Vercel. One small Vercel function for the country lookup (section 4).
* **Database: Charming Ride's Supabase project, shared** (decided 4.11.2026; the free tier allows two projects and both are in use). Everything of this app is in its own schema `mlgame`, which the Data API does not expose; the browser reaches it only through `mlg_`-prefixed functions in `public`. Charming Ride's tables are never touched.
* The game is not copied: it is embedded from `https://speedy-deliveries-theta.vercel.app/game`.
* Supabase needs **explicit GRANTs** for anything the Data API exposes (Supabase removed the implicit grants; Charming Ride hit this on 3.11., migration `20260524120000_explicit_table_grants.sql`). Here the tables get no grants at all, and each `mlg_` function gets `EXECUTE` only for the roles that need it (section 7). Supabase grants `EXECUTE` on new functions in `public` to everyone by default, so each function first revokes it.

## 3. Pages

| route | who | what |
|---|---|---|
| `/admin` | the admin, signed in (email and password of the existing Charming Ride account) | list of studies, create, open, close |
| `/admin/study/:id` | admin | parameters, live progress, exports, submissions, reports |
| `/admin/study/:id/report` | admin | the running report or, once the study is closed, the final report; a presentation view for the projector and a download as one self-contained HTML file |
| `/screen/:code` | projector | big QR code, the join address, the number of players joined and playing; no personal data |
| `/s/:code` | students | join form, then the game, then "done" |
| `/s/:code/submit` | teams | data download (once released) and upload of predictions |

## 4. Student flow

1. Opens `/s/:code` from the QR code. If the study is not open: "This study is not open."
2. **Form:** nick (2 to 20 characters, unique within the study), sex (F, M, I'd rather not say), age (a number from 15 to 99, or I'd rather not say). Under the form, the study's consent line (default: what is stored, including the country derived from the connection, that it is used for teaching in this course, that classmates see it under the nick only, and that the study is deleted at the end of the semester).
3. On submit, the browser calls the Vercel function `/api/join`, which reads the country from the `x-vercel-ip-country` header and forwards the join to Supabase. The country is taken from the platform, not from the browser; the IP address is not stored or logged by the app. The device type (`pointer: coarse`) and viewport come from the browser. **Phones and laptops are both allowed.**
4. The server returns a respondent token, kept in `localStorage` with the study code, so that a reload resumes the same player instead of creating a new one.
5. **The game** fills the screen. No timer and no phase is shown by the app ("just drive"). The game's own HUD stays.
6. When the player has 5 counted test rounds, the app sends `QUIT` and shows "Done, thank you. Keep this tab open until the teacher says otherwise."
7. Reload in the middle: the app asks the server where the player is (attempt, phase, counted test rounds), gets a fresh schedule for the remaining rounds, and starts the game again from there. The interrupted round is lost (logged as started, never ended, and not used).

## 5. Game integration

### 5.1 The change needed in the game (speedy-deliveries repo)

Backwards compatible; Charming Ride sends no schedule and sees no change.

* `INIT.payload.difficulty.schedule?: Array<{ tripDurationMs?, carSpawnRate?, obstacleSpawnRate?, pedestrianSpawnRate?, sceneIndex? }>`.
* At the start of round i the game applies `schedule[i - 1]` on top of the base difficulty, including the scene (today `createInitialState(currentRound - 1)` picks the scene by round number).
* `ROUND_START` and `ROUND_END` carry `applied: {...}`: the values actually in force.
* With a schedule, `totalRounds` defaults to the schedule's length.
* Check while doing it: that `QUIT` ends the game cleanly between rounds and in the middle of one, and what the screen shows between rounds (the time between rounds counts against the training time).

Estimated size: one function in the engine, the protocol types, `applyConfig.ts`, `docs/EMBEDDING.md`. Committed and deployed before the dry run.

### 5.2 What the app sends

On `READY`: `INIT` with `difficulty = { ...fixed, totalRounds: 80, schedule }`, `ui = { showQuitButton: false, autoStart: true }`, `player = { nickname }`, `session = { sessionId: respondent id }`. 80 rounds is more than anyone plays in 10 minutes plus the test; the app ends the game with `QUIT`.

### 5.3 The schedule and the phases (server side)

* The server draws the schedule (contract section 2) when the player starts or resumes, stores it, and returns it.
* `ROUND_START` → `round_start(token, attempt)`: the server stores its own time.
* `ROUND_END` → `round_end(token, attempt, outcome, time_ms, scene, money..., applied)`. The server:
  * sets `phase = train` if the round started before `first_round_started_at + training_seconds` and the round cap is not reached, otherwise `test`;
  * marks the round counted if the outcome is a delivery or a crash;
  * numbers counted test rounds 1 to 5;
  * returns `{ done }`, true after the fifth counted test round. The app then sends `QUIT`.
* A timeout in the test phase is simply not counted; the game goes on to the next round, which is the replacement.

## 6. Admin

### 6.1 Study setup

Title; join code (6 characters, generated, editable); consent line; the parameters of contract section 2 with their defaults; status `draft`, `open`, `closed`. Opening shows the link to `/screen/:code`.

### 6.2 Live progress

A table refreshed every 5 seconds: player, device, country, rounds played, accidents so far, phase, counted test rounds, last activity. Totals at the top: joined, playing, in test, done. Polling, no realtime channel.

### 6.3 Exports

Buttons for the four files of the contract (`game_train.csv`, `game_test.csv`, `game_labels.csv`, the raw export), with the counts of the rules in contract section 4.4 shown before download. **Release data to students**: a switch that makes `game_train.csv` and `game_test.csv` downloadable on the submission page (the split is announced then). Switch **submissions open**.

### 6.4 Reports (Pavel)

No score is ever shown to a team. The admin generates reports:

* **Running report**, any time: participation (joined, complete, rounds, timeouts dropped, by device and country), the accident share overall and by attempt (the learning curve) and by device, the list of uploads (team, time, accepted or rejected), and **the leaderboard of the last accepted files so far**.
* **Final report**, created when the admin **closes the study** (closing also closes submissions): the same, with the final leaderboard.
* **The leaderboard** (contract section 6): log loss of each team's last accepted file and of the two reference rows; the dot plot with bootstrap intervals over players; a table. Computed in the admin's browser from the labels and the submitted p.
* Shown on the projector from the presentation view, and downloadable as one self-contained HTML file (charts inline), so that a report can be kept or shared after the study is deleted.

## 7. Security

Students are anonymous, so the database must protect itself.

* **RLS on every table, no table grants to `anon`.** Anonymous clients call only `SECURITY DEFINER` functions, each checking the study code or the respondent token:
  * `join_study(code, nick, sex, age, device, viewport, country)` → `{ respondent_id, token }`; refuses if the study is not open or the nick is taken. Called only by the Vercel function `/api/join` (with a server-side secret), so that the country cannot be set from the browser;
  * `resume(token)` → the player's position;
  * `start_schedule(token)` → the schedule;
  * `round_start(token, attempt)`, `round_end(token, ...)` → `{ done }`;
  * `get_public_files(code)` → the two student files, only when released;
  * `submit(code, team, pin, rows)` → `{ accepted, messages }`, never a score.
* The token is a random 32-byte secret, stored hashed. Nothing a student calls returns another player's rows, the labels, or any score.
* **Submissions:** the browser parses the CSV into `[{ round_id, p }]` (friendly messages for the separator, the header, the decimal comma); the server checks the ids against the test rounds, the range of p, duplicates and missing rows, and stores the rows. A team sets a 4-digit PIN with its first upload; later uploads under the same team name need it.
* **Admin:** Supabase Auth (the existing Charming Ride account, email and password); an `mlgame.admins` table. Admins read and change data only through `mlg_admin_` functions, each checking `mlgame.admins`; the tables have RLS on and no policies. Exports and reports run under the admin's session.
* Limits: 1 MB per upload, 20 uploads per team per hour, 200 respondents per study.

## 8. Data model (Supabase, schema `mlgame`)

| table | key columns |
|---|---|
| `studies` | id, code (unique), title, consent_text, status, params jsonb, seed, submissions_open, data_released, closed_at, created_at |
| `respondents` | id, study_id, nick, nick_lower (unique per study), sex, age, device, country, viewport_width, viewport_height, token_hash, joined_at, first_round_started_at |
| `schedules` | respondent_id, from_attempt, rounds jsonb, created_at |
| `rounds` | id, study_id, respondent_id, round_id (8 characters, unique per study), attempt, phase, counted, test_index, conditions jsonb (from the schedule), applied jsonb, scene, outcome, time_ms, money columns, started_at, ended_at |
| `submissions` | id, study_id, team, pin_hash, uploaded_at, accepted, messages jsonb, rows jsonb |
| `reports` | id, study_id, kind (`running` or `final`), created_at, html (the self-contained file) |
| `admins` | user_id |

Condition draws are deterministic: each value is a hash of (study seed, respondent id, attempt, condition), so a resume or a re-export reproduces the same conditions for the same attempt.

Unique (respondent_id, attempt) on `rounds`, so a repeated message cannot create a second row.

## 9. Privacy

Stored: nick, sex, age, device type, viewport size, country, the rounds. Not stored: email (students), user agent, IP address (the country is derived on the fly; Supabase's and Vercel's own request logs are outside the app). The join form says what is stored and why. A **delete study** button removes everything of a study except the reports the admin downloaded; to be pressed at the end of the semester.

## 10. Testing and the day

* Unit tests for the phase logic and the file rules (contract section 4.4), run against the synthetic generator's output (the generator is built on the ML2 side to the same contract).
* An end-to-end test with Playwright: two simulated players with short training times, so that both phases, a timeout in the test phase and a resume are covered.
* **Dry run with a few colleagues** a few days before 19.11., on phones and laptops: checks the ranges (accident share), the time per round, the country lookup, and the export.
* On the day: the synthetic files are ready as the fallback.

## 11. Milestones (to confirm)

| by | what |
|---|---|
| 6.11. | repo, Supabase project, schema and functions, join (with country) and play with a fixed schedule |
| 9.11. | game change deployed (Charming Ride), schedules and phases, live progress, exports |
| 11.11. | submissions, reports, screen pages |
| 13.11. | dry run; ranges fixed |
| 16.11. | notebook and solution on real dry-run data (ML2 side) |
| 19.11. | the class |

## 12. Open

* Whether `VITE_EMBED_ALLOWED_ORIGINS` is set in the speedy-deliveries Vercel project (then the new app's origin goes into it).
* The final condition ranges (after the dry run).

## Versions

* v01, 3.11.2026: first draft.
* v03, 4.11.2026 (Pavel): Charming Ride's Supabase project shared, schema `mlgame`, access only through `mlg_` functions (admin too); admin signs in with the existing Charming Ride account (password) instead of a magic link; deterministic condition draws.
* v02, 3.11.2026 (Pavel): repo `ml-driving-game`, for a variety of ML classes (study title and consent line per study); both devices allowed, device a feature; country from the IP at join through a Vercel function, IP not stored; no score ever shown to teams; running report any time and final report on closing, with the leaderboard, instead of a "reveal leaderboard" switch.
