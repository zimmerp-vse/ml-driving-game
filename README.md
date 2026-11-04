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

Milestone 1 of the spec (section 11): schema and functions, join with the country
lookup, play with a server-drawn schedule, phases decided by the server, a minimal
admin (sign in, create, open, close). Next: live progress and exports (milestone 2),
submissions, reports and the projector page (milestone 3).

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
  the player and the attempt, stores them, and decides phase (`train`/`test`),
  `counted` and `test_index` at the end of each round. The app only relays.
* The game is told nothing about phases; the HUD shows the round number without a
  total. After the fifth counted test round the app sends `QUIT` and shows "Done".
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
src/components/GameFrame.tsx  the iframe and the game protocol
src/pages/AdminPage.tsx     /admin
supabase/migrations/        SQL, applied in the Supabase SQL editor in order
tests/                      database tests (PGlite), /api/join tests, local mock
docs/                       spec, data contract, setup
```

## Local development

Needs Node 20+.

```bash
npm install
npm test            # database tests run the migrations in an in-process Postgres
```

Without any Supabase project, using a local stand-in database and a local game:

```bash
npm run mock-db     # http://localhost:54321, open study code TEST01
npm run dev:local   # http://localhost:5173/s/TEST01
```

`dev:local` embeds the game from `http://localhost:8080/game`; run speedy-deliveries
locally (`npx vite --port 8080` in that repo, with any `VITE_SUPABASE_*` values).
`http://localhost:54321/debug/rounds` shows what the mock stored.

Against the real project: copy `.env.example` to `.env.local`, fill in the values,
`npm run dev`. The dev server serves `/api/join` itself and simulates the country
header with `DEV_COUNTRY` (default `CZ`).

## Writing rules

English for code and docs. Text a student sees: plain English for non-native
readers, and no en dashes, em dashes or Unicode minus signs.
