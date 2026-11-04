# Setup: Supabase, Vercel, game (one time)

Everything here is done by Pavel on his own accounts. No secret ever goes into the
repo or into a chat. Takes about 15 minutes.

The app shares **Charming Ride's Supabase project** (decision of 4.11.2026). It adds
its own schema `mlgame` and functions named `mlg_*`; Charming Ride is not changed.

## 1. Supabase: run the migration

1. Open <https://supabase.com/dashboard> and the **Charming Ride** project.
2. Left menu: **SQL Editor**, then **New query**.
3. Open `supabase/migrations/20261104120000_mlgame_schema.sql` from this repo, copy
   all of it, paste it into the editor, click **Run**.
   Expected: "Success. No rows returned".
4. Still in the SQL Editor, new query, make yourself the admin of this app
   (the same account you use as Charming Ride admin):

   ```sql
   insert into mlgame.admins (user_id)
   select id from auth.users where lower(email) = 'zimmerp@vse.cz';
   ```

   Expected: "Success. 1 row affected" (or "INSERT 0 1").

5. Optional check that students cannot read the tables (should fail with
   "permission denied for schema mlgame"):

   ```sql
   set role anon; select count(*) from mlgame.studies; reset role;
   ```

Later migrations (new files in `supabase/migrations/`) are applied the same way, in
file-name order. Each file is run once; running one again only fails with "already
exists" and changes nothing. If the app then reports a function as missing, run
`notify pgrst, 'reload schema';` once, so the API picks it up.

Applied so far (keep this list current):

| file | what |
|---|---|
| `20261104120000_mlgame_schema.sql` | schema, join, rounds, phases, admin basics |
| `20261105090000_mlg_screen_info.sql` | counts for the projector page |
| `20261105100000_mlg_allow_rejoin.sql` | Replay for test studies |
| `20261105110000_mlg_shorter_rounds_delete_study.sql` | shorter-round defaults, delete study |
| `20261106090000_mlg_progress_exports.sql` | live progress, exports, release and submission switches |
| `20261107090000_mlg_submissions_reports.sql` | students' files, team submissions, reports |

## 2. Supabase: the keys

**Project Settings** (gear icon) then **API Keys**:

* **Project URL** and the **publishable key** (`sb_publishable_...`, or the legacy
  `anon` key). They are public; they are the same values the speedy-deliveries
  Vercel project already uses.
* The **secret key** (`sb_secret_...`, or the legacy `service_role` key). Secret.
  It goes only into Vercel (step 3), never into the repo, a chat or an email.
  If you have no secret key yet, click **Create new secret key**, name it
  `ml-driving-game`. A separate key can be revoked without touching Charming Ride.

## 3. Vercel: the project

1. <https://vercel.com/new>, **Import** the GitHub repo `zimmerp-vse/ml-driving-game`.
2. Framework preset: **Vite** (detected). Build command `npm run build`, output
   `dist` (defaults). The folder `api/` becomes the function `/api/join` by itself.
3. **Environment Variables** (before the first deploy; all environments):

   | name | value |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key |
   | `SUPABASE_URL` | Project URL (same as above) |
   | `SUPABASE_SECRET_KEY` | secret key (mark it **Sensitive**) |

   `VITE_GAME_URL` is not needed: the default is
   `https://speedy-deliveries-theta.vercel.app/game`.
4. **Deploy**. Note the production address (for example
   `https://ml-driving-game.vercel.app`).

## 4. The game (speedy-deliveries on Vercel)

In the **speedy-deliveries** Vercel project: **Settings**, **Environment Variables**.

* If `VITE_EMBED_ALLOWED_ORIGINS` is **not** there: nothing to do (any site may embed
  the game).
* If it **is** there: add the new app's address, comma separated, for example
  `https://charming-ride.example,https://ml-driving-game.vercel.app`, then
  **Redeploy** speedy-deliveries.

The game change (per-round schedule) must be deployed on speedy-deliveries before
the dry run. Until then the app works, but every round uses the same base
conditions (the old game ignores the schedule; the app still logs what it asked for).

## 5. Smoke test

1. Open `https://<app>/admin`, sign in with the Charming Ride admin account.
2. Create a study (title, training time 60 for a test), click **Open**.
3. Open the join link `/s/<code>` on a phone, join, play two rounds.
4. In Supabase, SQL Editor:

   ```sql
   select p.nick, p.device, p.country, r.attempt, r.phase, r.outcome, r.conditions, r.applied
   from mlgame.rounds r join mlgame.respondents p on p.id = r.respondent_id
   order by r.started_at desc limit 10;
   ```

   Expect your nick, `touch`, your country, and `applied` equal to `conditions`
   (once the game change is deployed).
5. Close the test study in `/admin`.
