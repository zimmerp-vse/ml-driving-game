# `ml-driving-game`: app spec, v04 (13.11.2026)

*Master copy (since 4.11.2026). The ML2 project keeps a pointer.*

A small web app that runs a driving study in class: students join by link or QR code, play the Charming Ride delivery game in an iframe, and later submit predictions. **Meant for a variety of ML classes** (Pavel), so nothing course-specific is hard-coded: titles, the consent line and the parameters belong to a study. ML2 block 6 (19.11.2026) is the first user. Data formats are in `data_contract.md` (the contract).

## 1. Scope

**In:** studies with parameters; anonymous join with nick, sex, age (country and device recorded automatically); the game embedded with per-round conditions; free play with the player's own numbers and "I'm done"; live progress; numbered data releases that split the rounds into training and test, with a preview; the three class files and the raw export; team submissions accepted or rejected on upload, with no score shown; running and final reports with the leaderboard.

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
| `/admin/study/:id` | admin | parameters, live progress, data releases (preview, files), the students' switches, reports |
| `/admin/study/:id/report` | admin | the running report or, once the study is closed, the final report; a presentation view for the projector and a download as one self-contained HTML file |
| `/screen/:code` | projector | big QR code, the join address, the numbers of players joined, playing, with enough rounds, and done; no personal data |
| `/s/:code` | students | join form, then the game, then "done" |
| `/s/:code/submit` | teams | data download (once released) and upload of predictions |

## 4. Student flow

1. Opens `/s/:code` from the QR code. If the study is not open: "This study is not open."
2. **Form:** nick (2 to 20 characters, unique within the study), sex (F, M, I'd rather not say), age (a number from 15 to 99, or I'd rather not say). The nick hint says not to use one's real name, because classmates will see it. Under the form, the study's consent line (default: what is stored, including the country derived from the connection, and that classmates see it under the nick only; no promise about use or deletion, by Pavel's decision of 13.11.2026).
3. On submit, the browser calls the Vercel function `/api/join`, which reads the country from the `x-vercel-ip-country` header and forwards the join to Supabase. The country is taken from the platform, not from the browser; the IP address is not stored or logged by the app. The device type (`pointer: coarse`) and viewport come from the browser. **Phones and laptops are both allowed.**
4. The server returns a respondent token, kept in `localStorage` with the study code, so that a reload resumes the same player instead of creating a new one.
5. **The game** fills the screen; its own HUD stays, with a ring on the watch for the share of time left. Players **play as long as they like** (v04): nothing tells them about training or test, because the split is made later, at release.
6. **Between rounds** a small bar shows the rounds played and the time played, with a **Menu** button. The menu shows the player's numbers (rounds, delivered, crashes, out of time, time played, cash) and two buttons: **Keep driving** and **I'm done**. Every 10 rounds the menu opens by itself: "Thank you for playing 10 rounds!". With fewer counted rounds than the study's `min_rounds`, the menu adds: "If you can, please play at least 10 rounds."
7. **I'm done** stores the time, sends `QUIT` and shows "Done, thank you! You can close this page now. Please wait for the teacher." with the player's numbers. With Replay on (test studies) a button lets them play again as a new player.
8. Reload in the middle: the app asks the server where the player is, gets a fresh schedule from the next attempt, and starts the game again from there. The interrupted round is lost (logged as started, never ended, and not used).

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

On `READY`: `INIT` with `difficulty = { ...fixed, totalRounds: 100, schedule, safeFinish: true }`, `ui = { showQuitButton: false, autoStart: true, showRoundTotal: false, timeRing: true }`, `player = { nickname }`, `session = { sessionId: respondent id }`. If a player ever plays all 100 rounds, the app fetches a new schedule. `safeFinish`: the striped finish zone is shorter and has no hazards; `timeRing`: a ring on the watch shows the share of time left (both game options of 13.11.2026, off by default for other embedders).

### 5.3 The schedule and the rounds (server side)

* The server draws the schedule (contract section 2) when the player starts or resumes, stores it, and returns it.
* `ROUND_START` → `round_start(token, attempt)`: the server stores its own time.
* `ROUND_END` → `round_end(token, attempt, outcome, time_ms, scene, money..., applied)`: the server stores the round, marks it counted if the outcome is a delivery or a crash, and returns the player's position and numbers.
* `finish(token)` ("I'm done") stores `finished_at`. Nothing is decided while playing: the split into training and test is made at release (6.3).

## 6. Admin

### 6.1 Study setup

Title; join code (6 characters, generated, editable); consent line; the parameters of contract section 2 with their defaults (no training time since v04); status `draft`, `open`, `closed`. Opening shows the link to `/screen/:code`.

### 6.2 Live progress

A table refreshed every 5 seconds: player, device, country, rounds played, counted rounds (highlighted from `min_rounds` on), accidents so far, time played, status (playing, away, done), last activity. Totals at the top: joined, playing, with at least `min_rounds` counted rounds, done. Polling, no realtime channel.

### 6.3 Data releases (v04)

* **Prepare a release** opens the settings with the study's defaults: test rounds per player (5), the minimum counted rounds for the test (10), and the cutoff (rounds up to now, or up to a chosen time). The rule is in contract section 4.4.
* **The preview** (nothing stored yet): players in the test file and only in the training file, rows per file, the accident share in each, counted rounds per player (minimum, median, maximum), what is dropped (timeouts, unfinished, after the cutoff), and the learning curve. The teacher decides on that.
* **Release to students** stores the release with the next number, its settings, its cutoff and the round ids of both files, and turns on "Students can download the latest release". Students and teams always get the latest release.
* **Releasing again** (after more play, or with other settings) makes release 2, 3, ...; each stays downloadable. Teams then download again and upload new predictions. The raw data never changes, and the raw file can be downloaded at any time.
* Each release's three class files can be downloaded (`game_labels.csv` for the teacher only).
* Switches: **Students can download the latest release** (on with a release; can be turned off), **Submissions open**.

### 6.4 Reports (Pavel)

No score is ever shown to a team. The admin generates reports:

* **Running report**, any time, for the latest release: participation (joined, in the test file, rounds, timeouts, by device and country), the accident share overall and by attempt (the learning curve) and by device, the list of uploads (team, time, release, accepted or rejected), and **the leaderboard of the last accepted files for that release**.
* **Final report**, created when the admin **closes the study** (closing also closes submissions): the same, with the final leaderboard.
* **The leaderboard** (contract section 6): log loss of each team's last accepted file and of the two reference rows; the dot plot with bootstrap intervals over players; a table. Computed in the admin's browser from the labels and the submitted p.
* Shown on the projector from the presentation view, and downloadable as one self-contained HTML file (charts inline), so that a report can be kept or shared after the study is deleted.

## 7. Security

Students are anonymous, so the database must protect itself.

* **RLS on every table, no table grants to `anon`.** Anonymous clients call only `SECURITY DEFINER` functions, each checking the study code or the respondent token:
  * `join_study(code, nick, sex, age, device, viewport, country)` → `{ respondent_id, token }`; refuses if the study is not open or the nick is taken. Called only by the Vercel function `/api/join` (with a server-side secret), so that the country cannot be set from the browser;
  * `resume(token)` → the player's position;
  * `start_schedule(token)` → the schedule;
  * `round_start(token, attempt)`, `round_end(token, ...)` → the player's position and own numbers;
  * `finish(token)` → "I'm done";
  * `submit_page(code)` → the two student files of the latest release, only when released;
  * `submit(code, team, pin, rows)` → `{ accepted, messages }`, never a score.
* The token is a random 32-byte secret, stored hashed. Nothing a student calls returns another player's rows, the labels, or any score.
* **Submissions:** the browser parses the CSV into `[{ round_id, p }]` (friendly messages for the separator, the header, the decimal comma); the server checks the ids against the test rounds of the latest release, the range of p, duplicates and missing rows, and stores the rows with the release. A team sets a 4-digit PIN with its first upload; later uploads under the same team name need it.
* **Admin:** Supabase Auth (the existing Charming Ride account, email and password); an `mlgame.admins` table. Admins read and change data only through `mlg_admin_` functions, each checking `mlgame.admins`; the tables have RLS on and no policies. Exports and reports run under the admin's session.
* Limits: 1 MB per upload, 20 uploads per team per hour, 200 respondents per study.

## 8. Data model (Supabase, schema `mlgame`)

| table | key columns |
|---|---|
| `studies` | id, code (unique), title, consent_text, status, params jsonb, seed, submissions_open, data_released, closed_at, created_at |
| `respondents` | id, study_id, nick, nick_lower (unique per study), sex, age, device (`touch` or `keyboard`), country, viewport_width, viewport_height, token_hash, joined_at, first_round_started_at, finished_at |
| `schedules` | respondent_id, from_attempt, rounds jsonb, created_at |
| `rounds` | id, study_id, respondent_id, round_id (8 characters, unique per study), attempt, counted, conditions jsonb (from the schedule), applied jsonb, scene, outcome, time_ms, money columns, started_at, ended_at (`phase` and `test_index` are no longer set since v04) |
| `releases` | id, study_id, number (1, 2, ... per study), created_at, cutoff, test_rounds, min_rounds, train_ids, test_ids, counts |
| `submissions` | id, study_id, release_id, team, pin_hash, uploaded_at, accepted, messages jsonb, rows jsonb |
| `reports` | id, study_id, kind (`running` or `final`), created_at, html (the self-contained file) |
| `admins` | user_id |

Condition draws are deterministic: each value is a hash of (study seed, respondent id, attempt, condition), so a resume or a re-export reproduces the same conditions for the same attempt.

Unique (respondent_id, attempt) on `rounds`, so a repeated message cannot create a second row.

## 9. Privacy

Stored: nick, sex, age, device type, viewport size, country, the rounds. Not stored: email (students), user agent, IP address (the country is derived on the fly; Supabase's and Vercel's own request logs are outside the app). The join form says what is stored. A **delete study** button removes everything of a study except the reports the admin downloaded.

## 10. Testing and the day

* Unit tests for the release rule (contract section 4.4), and a release of a synthetic class (`ml/synth.py`) that must give exactly the generator's files.
* An end-to-end test with Playwright: two simulated players play freely (the bar, the menu, the check-in after 10 rounds, "I'm done", a timeout, a resume), then the admin's progress, a release with its preview, the team page and the projector.
* **Dry run with a few colleagues** a few days before 19.11., on phones and laptops: checks the ranges (accident share), the time per round, the country lookup, and the export.
* On the day: the synthetic files are ready as the fallback.

## 11. Milestones (to confirm)

| by | what |
|---|---|
| 6.11. | repo, Supabase project, schema and functions, join (with country) and play with a fixed schedule |
| 9.11. | game change deployed (Charming Ride), schedules and phases, live progress, exports |
| 11.11. | submissions, reports, screen pages |
| 13.11. | free play and releases (v04); then the dry run; ranges fixed |
| 16.11. | notebook and solution on real dry-run data (ML2 side) |
| 19.11. | the class |

## 12. Open

* Whether `VITE_EMBED_ALLOWED_ORIGINS` is set in the speedy-deliveries Vercel project (then the new app's origin goes into it).
* The final condition ranges (after the dry run).

## Versions

* v04, 13.11.2026 (Pavel): free play instead of a training time and 5 counted test rounds: players stop with "I'm done" (the menu between rounds, a check-in every 10 rounds, their own numbers); the split is made at release with a preview (the last 5 counted rounds of players with at least 10), releases are numbered and can be repeated, submissions and reports belong to a release; device `mouse` renamed `keyboard`; consent default without promises about use or deletion; game options `safeFinish` and `timeRing`.
* v01, 3.11.2026: first draft.
* v03, 4.11.2026 (Pavel): Charming Ride's Supabase project shared, schema `mlgame`, access only through `mlg_` functions (admin too); admin signs in with the existing Charming Ride account (password) instead of a magic link; deterministic condition draws.
* v02, 3.11.2026 (Pavel): repo `ml-driving-game`, for a variety of ML classes (study title and consent line per study); both devices allowed, device a feature; country from the IP at join through a Vercel function, IP not stored; no score ever shown to teams; running report any time and final report on closing, with the leaderboard, instead of a "reveal leaderboard" switch.
