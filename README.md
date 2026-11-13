# ml-driving-game

A small web app that runs a driving study in an ML class. Students join by link or
QR code, play the Charming Ride delivery game (embedded from
[speedy-deliveries](https://github.com/zimmerp-vse/speedy-deliveries)) and later submit
predictions. The admin exports the class files and makes reports with the
leaderboard. Meant for any ML class: titles, the consent line and the parameters
belong to a study. First use: ML2, block 6, 19.11.2026.

* What to build: [`docs/app_spec.md`](docs/app_spec.md)
* Data formats (the ML2 notebooks and scorer depend on it; changes are agreed and
  versioned): [`docs/data_contract.md`](docs/data_contract.md)
* One-time setup of Supabase and Vercel: [`docs/SETUP.md`](docs/SETUP.md)

## Status

Milestones 1 to 3 of the spec (section 11):

* join with the country lookup, play with a server-drawn schedule; **free play** (contract v07):
  between rounds a bar with rounds and time and a Menu (the player's numbers, Keep driving,
  I'm done), a check-in every 10 rounds, the numbers on the Done screen;
* admin: studies (create, open, close, delete, Replay for test studies: a finished player
  may play again, and a taken nick gets _2, _3), and per study
  (`/admin/study/:id`) live progress every 5 s, **data releases** (settings, a preview with the
  numbers and the learning curve, then numbered releases; the latest goes to students and teams;
  each release's files and the raw file downloadable), and the switches for the students;
* projector page `/screen/:code` with QR code and counts;
* team page `/s/:code/submit`: the two files of the latest release, upload of predictions with a
  team PIN, checked against that release, accepted or rejected with reasons, never a score;
* reports (study page), for the latest release: a running report any time, the final report when
  the study is closed;
  participation, the learning curve, accidents by device, the uploads, and the leaderboard (log
  loss, bootstrap intervals over players, two reference rows); one self-contained HTML file.

Data side (`ml/`, see [`ml/README.md`](ml/README.md)): a synthetic class generator and a checker
for class files. A test checks that the app exports a synthetic class exactly as the generator
wrote it.

Next: the dry run (13.11.).

## Stack

Vite, React 18, TypeScript, Tailwind, Supabase (Charming Ride's project, schema
`mlgame`), Vercel (static site plus one function, `/api/join`).

## How it works

```
student browser ──/api/join──▶ Vercel function ──mlg_join_study (secret key)──▶ Supabase
      │   (country from x-vercel-ip-country; IP never stored)
      ├──mlg_start_schedule / mlg_round_start / mlg_round_end (publishable key + token)──▶ Supabase
      └──iframe──▶ speedy-deliveries /game  (INIT with schedule, ROUND_START/END, QUIT)
```

* The server draws each round's conditions deterministically from the study seed,
  the player and the attempt, stores them, and marks a round `counted` (delivered or
  crashed) when it ends. The app only relays.
* Players play as long as they like and stop with "I'm done" (the app sends `QUIT`).
  The split into training and test is made when the teacher releases the data
  (`mlgame.split_rows`): each player's last 5 counted rounds, for players with at least 10.
* A reload resumes: the token is in `localStorage` per study code; the interrupted
  round stays started and never ended.

## Security

* All tables are in schema `mlgame`, which the Data API does not expose, with RLS
  on, no policies and no grants. Clients only call `public.mlg_*` functions
  (`SECURITY DEFINER`, `search_path = ''`).
* Students (anon) can call the study info, resume, schedule and round functions,
  each keyed by the study code or a 32-byte token stored as a SHA-256 hash.
* Only the server (`service_role`, via `/api/join`) can join, so the country cannot
  be set from the browser.
* Admin functions require a signed-in user listed in `mlgame.admins`.
* Secrets: `SUPABASE_SECRET_KEY` lives only in Vercel. Nothing secret is in the repo.

## Repository layout

```
api/join.ts                 Vercel function: country lookup, forwards the join
src/pages/StudentPage.tsx   /s/:code: join form, game, done
src/components/GameFrame.tsx  the iframe, the game protocol, the bar and Menu between rounds
src/pages/AdminPage.tsx     /admin (studies) and the sign-in gate
src/pages/StudyPage.tsx     /admin/study/:id (progress, files, switches)
src/pages/ScreenPage.tsx    /screen/:code (projector)
src/lib/exports.ts          the four CSV files (rows chosen in SQL at release: mlgame.split_rows)
src/pages/SubmitPage.tsx    /s/:code/submit (teams)
src/lib/submission.ts       reading a predictions file; wording the server's answers
src/lib/report.ts           report numbers: log loss, reference rows, bootstrap, shares
src/lib/reportHtml.ts       the report as one HTML file with inline SVG charts
supabase/migrations/        SQL, applied in the Supabase SQL editor in order
ml/synth.py                 a synthetic class: the four files, as the app exports them
ml/check_files.py           checks class files against the contract; numbers for calibration
tests/                      database tests (PGlite), /api/join tests, local mock
docs/                       spec, data contract, setup
```

## Local development

Needs Node 20+.

```bash
npm install
npm test            # unit and database tests (the migrations run in an in-process Postgres)
npx playwright install chromium   # once
npm run test:e2e    # end-to-end: two players play freely, Menu, I'm done, a resume, a release
```

The end-to-end test (`tests/e2e/study.spec.ts`, spec section 10) runs the real app in a real
browser against the local stand-in database and a stand-in game (`tests/e2e/fake-game`), which
speaks the game's messages and lets the test decide how each round ends. It starts its own
servers on ports 54329, 8090 and 5179. The real game is checked by playing it.

Without any Supabase project, using a local stand-in database and a local game:

```bash
npm run mock-db     # http://localhost:54321, open study code TEST01
npm run dev:local   # http://localhost:5173/s/TEST01
```

`dev:local` embeds the game from `http://localhost:8080/game`; run speedy-deliveries
locally (`npx vite --port 8080` in that repo, with any `VITE_SUPABASE_*` values).
`http://localhost:54321/debug/rounds` shows what the mock stored. The mock also has a
local-only admin sign-in (credentials in `tests/mock-supabase.ts`), so `/admin` works locally.

Against the real project: copy `.env.example` to `.env.local`, fill in the values,
`npm run dev`. The dev server serves `/api/join` itself and simulates the country
header with `DEV_COUNTRY` (default `CZ`).

## Writing rules

English for code and docs. Text a student sees: plain English for non-native
readers, and no en dashes, em dashes or Unicode minus signs.
