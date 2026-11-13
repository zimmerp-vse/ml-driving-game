-- ml-driving-game: free play, the split at release, numbered releases (data contract v07).
--
-- Before: the server decided while playing which rounds were training and which were the 5 test
-- rounds (a training time, then 5 counted test rounds, then "done").
-- Now:
--   * Players play as long as they like and say "I'm done" (mlg_finish), or the teacher closes
--     the study. Nothing is decided while playing; rounds only record what happened.
--   * The split is made when the teacher releases the data (mlg_admin_create_release): for each
--     player, the last `test_rounds` counted rounds are the test, the rest is training; a player
--     with fewer than `min_rounds` counted rounds goes entirely into the training file. Only
--     rounds that ended up to the release's cutoff count. The teacher first sees a preview
--     (mlg_admin_release_preview).
--   * Releases are numbered and stored with their settings and their round ids, so each one can
--     be recreated; the students always get the latest. The raw data never changes.
--   * Submissions belong to the release they were checked against; reports score the uploads of
--     one release (the latest by default).
--   * Device `mouse` is now `keyboard` (a computer, played with the arrow keys).
--
-- Safe to run once in the SQL editor of the shared project; touches only mlgame / mlg_* objects.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table mlgame.respondents add column finished_at timestamptz;

alter table mlgame.respondents drop constraint respondents_device_check;
update mlgame.respondents set device = 'keyboard' where device = 'mouse';
alter table mlgame.respondents add constraint respondents_device_check check (device in ('touch', 'keyboard'));

create table mlgame.releases (
  id bigint generated always as identity primary key,
  study_id uuid not null references mlgame.studies (id) on delete cascade,
  number integer not null,
  created_at timestamptz not null default now(),
  cutoff timestamptz not null,
  test_rounds integer not null,
  min_rounds integer not null,
  train_ids text[] not null,
  test_ids text[] not null,
  counts jsonb not null,
  unique (study_id, number)
);
alter table mlgame.releases enable row level security;
revoke all on table mlgame.releases from public, anon, authenticated, service_role;

alter table mlgame.submissions add column release_id bigint references mlgame.releases (id) on delete cascade;

-- New studies: no training time; the split settings the release dialog starts from.
create or replace function mlgame.default_params() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'test_rounds', 5,
    'min_rounds', 10,
    'scene_count', 10,
    'ranges', jsonb_build_object(
      'trip_seconds',    jsonb_build_object('min', 13,    'max', 33,    'scale', 'linear'),
      'car_rate',        jsonb_build_object('min', 0.01,  'max', 0.09,  'scale', 'linear'),
      'obstacle_rate',   jsonb_build_object('min', 0.002, 'max', 0.015, 'scale', 'linear'),
      'pedestrian_rate', jsonb_build_object('min', 0.001, 'max', 0.010, 'scale', 'linear')
    ),
    'fixed', jsonb_build_object('malfunctionProbability', 0, 'deliveryDistance', 200)
  );
$$;

-- ---------------------------------------------------------------------------
-- Playing
-- ---------------------------------------------------------------------------

-- Where a player is, and their own statistics (shown to them between rounds and when done).
create or replace function mlgame.position(p_respondent_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  resp mlgame.respondents;
  st mlgame.studies;
  s record;
begin
  select * into resp from mlgame.respondents where id = p_respondent_id;
  select * into st from mlgame.studies where id = resp.study_id;
  select coalesce(max(r.attempt), 0) + 1 as next_attempt,
         count(*) filter (where r.ended_at is not null) as rounds,
         count(*) filter (where r.outcome = 'delivered') as delivered,
         count(*) filter (where r.outcome in ('crash_car', 'crash_obstacle', 'crash_pedestrian')) as crashes,
         count(*) filter (where r.outcome in ('timeout', 'malfunction')) as timeouts,
         coalesce(round(extract(epoch from max(r.ended_at) - min(r.started_at)))::integer, 0) as seconds,
         (array_agg(r.money_balance order by r.attempt desc) filter (where r.ended_at is not null))[1] as cash
    into s
    from mlgame.rounds r where r.respondent_id = p_respondent_id;
  return jsonb_build_object(
    'respondent_id', resp.id,
    'nick', resp.nick,
    'study_status', st.status,
    'next_attempt', s.next_attempt,
    'done', resp.finished_at is not null,
    'min_rounds', coalesce((st.params ->> 'min_rounds')::integer, 10),
    'stats', jsonb_build_object('rounds', s.rounds, 'delivered', s.delivered, 'crashes', s.crashes,
                                'timeouts', s.timeouts, 'seconds', s.seconds, 'cash', s.cash)
  );
end;
$$;
revoke all on function mlgame.position(uuid) from public, anon, authenticated, service_role;

-- A round ended: records what happened. `counted` = delivered or crashed. No phases any more.
create or replace function public.mlg_round_end(
  p_token text, p_attempt integer, p_outcome text, p_time_ms integer, p_scene text,
  p_money_earned integer, p_money_lost integer, p_money_balance integer, p_applied jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  resp mlgame.respondents;
  st mlgame.studies;
  rnd mlgame.rounds;
begin
  if p_attempt is null or p_attempt < 1 or p_attempt > 10000
     or p_outcome is null
     or p_outcome not in ('delivered', 'crash_car', 'crash_obstacle', 'crash_pedestrian', 'malfunction', 'timeout')
     or p_time_ms is null or p_time_ms < 0 or p_time_ms > 3600000
     or char_length(coalesce(p_scene, '')) > 60
     or (p_applied is not null and (jsonb_typeof(p_applied) <> 'object' or char_length(p_applied::text) > 1000)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select * into resp from mlgame.respondents
    where token_hash = mlgame.hash_token(coalesce(p_token, '')) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_token');
  end if;
  select * into st from mlgame.studies where id = resp.study_id;

  -- If ROUND_START never reached us, estimate the start from the round's duration.
  rnd := mlgame.ensure_round(st, resp, p_attempt, now() - make_interval(secs => p_time_ms / 1000.0));
  if rnd.ended_at is null then
    update mlgame.rounds set
      counted = p_outcome in ('delivered', 'crash_car', 'crash_obstacle', 'crash_pedestrian'),
      outcome = p_outcome, time_ms = p_time_ms, scene = p_scene,
      money_earned = p_money_earned, money_lost = p_money_lost, money_balance = p_money_balance,
      applied = p_applied, ended_at = now()
    where id = rnd.id;
    update mlgame.respondents
       set first_round_started_at = coalesce(first_round_started_at, rnd.started_at), last_activity_at = now()
     where id = resp.id;
  end if;
  return jsonb_build_object('ok', true) || mlgame.position(resp.id);
end;
$$;

-- "I'm done": the player stops; their rounds stay. Repeated calls change nothing.
create function public.mlg_finish(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  rid uuid;
begin
  update mlgame.respondents
     set finished_at = coalesce(finished_at, now()), last_activity_at = now()
   where token_hash = mlgame.hash_token(coalesce(p_token, ''))
  returning id into rid;
  if rid is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_token');
  end if;
  return jsonb_build_object('ok', true) || mlgame.position(rid);
end;
$$;

-- Join: device `keyboard` (old clients may still send `mouse`, which means the same).
create or replace function public.mlg_join_study(
  p_code text, p_nick text, p_sex text, p_age integer, p_device text,
  p_viewport_width integer, p_viewport_height integer, p_country text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
  nick text := regexp_replace(trim(coalesce(p_nick, '')), '\s+', ' ', 'g');
  ctry text := upper(trim(coalesce(p_country, '')));
  dev text := case when p_device = 'mouse' then 'keyboard' else p_device end;
  n integer;
  token text;
  rid uuid;
  base text;
  cand text;
begin
  select * into st from mlgame.studies where code = upper(trim(p_code)) for update;
  if not found or st.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'not_open');
  end if;
  if char_length(nick) < 2 or char_length(nick) > 20 or nick ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'error', 'invalid_nick');
  end if;
  if p_sex is not null and p_sex not in ('F', 'M') then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if p_age is not null and (p_age < 15 or p_age > 99) then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if dev is null or dev not in ('touch', 'keyboard') then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  -- XX = unknown, T1 = Tor (Vercel / Cloudflare conventions): store as missing.
  if ctry !~ '^[A-Z]{2}$' or ctry in ('XX', 'T1') then
    ctry := null;
  end if;

  select count(*) into n from mlgame.respondents where study_id = st.id;
  if n >= 200 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  -- Replay on (test studies): a taken nick gets a suffix, _2, _3, ..., cut to fit 20 characters.
  -- Replay off (class): a taken nick is refused.
  cand := lower(nick);
  if exists (select 1 from mlgame.respondents r where r.study_id = st.id and r.nick_lower = cand) then
    if not st.allow_rejoin then
      return jsonb_build_object('ok', false, 'error', 'nick_taken');
    end if;
    base := nick;
    for i in 2..999 loop
      cand := rtrim(left(base, 20 - char_length('_' || i))) || '_' || i;
      if not exists (select 1 from mlgame.respondents r where r.study_id = st.id and r.nick_lower = lower(cand)) then
        nick := cand;
        exit;
      end if;
    end loop;
  end if;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  begin
    insert into mlgame.respondents
      (study_id, nick, nick_lower, sex, age, device, country, viewport_width, viewport_height, token_hash)
    values
      (st.id, nick, lower(nick), p_sex, p_age, dev, ctry,
       least(greatest(p_viewport_width, 0), 10000), least(greatest(p_viewport_height, 0), 10000),
       mlgame.hash_token(token))
    returning id into rid;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'nick_taken');
  end;

  return jsonb_build_object('ok', true, 'respondent_id', rid, 'token', token, 'nick', nick);
end;
$$;

-- ---------------------------------------------------------------------------
-- The split (data contract section 4.4, v07)
-- ---------------------------------------------------------------------------

-- Every round of a study with the file it would go to under the given settings, or the reason
-- it goes to none:
--   after_cutoff          started after the cutoff;
--   unfinished            not ended by the cutoff (a reload, or still being played);
--   timeout_or_breakdown  ended, but neither delivered nor crashed.
-- Of a player's counted rounds, the last `test_rounds` are 'test' if the player has at least
-- `min_rounds` counted rounds; all other counted rounds are 'train'.
create function mlgame.split_rows(p_study_id uuid, p_cutoff timestamptz, p_test_rounds integer, p_min_rounds integer)
returns table (round_id text, respondent_id uuid, attempt integer, file text, reason text)
language sql stable set search_path = '' as $$
  with c as (
    select r.round_id, r.respondent_id, r.attempt,
           case when r.started_at > p_cutoff then 'after_cutoff'
                when r.ended_at is null or r.ended_at > p_cutoff then 'unfinished'
                when not coalesce(r.counted, false) then 'timeout_or_breakdown'
           end as reason
      from mlgame.rounds r
     where r.study_id = p_study_id
  ),
  k as (
    select c.*,
           count(*) filter (where c.reason is null) over (partition by c.respondent_id) as n_counted,
           row_number() over (partition by c.respondent_id, c.reason is null order by c.attempt desc) as from_end
      from c
  )
  select k.round_id, k.respondent_id, k.attempt,
         case when k.reason is not null then null
              when k.n_counted >= p_min_rounds and k.from_end <= p_test_rounds then 'test'
              else 'train' end,
         k.reason
    from k;
$$;

-- The student-file columns of a set of rounds, with their file. Sorted as the files are.
create function mlgame.file_rows(p_study_id uuid, p_assign jsonb)
returns table (
  file text, round_id text, player text, sex text, age integer, device text, country text,
  attempt integer, trip_seconds numeric, car_rate numeric, obstacle_rate numeric,
  pedestrian_rate numeric, scene text, accident integer, respondent_id uuid
)
language sql stable set search_path = '' as $$
  select a.value #>> '{}', r.round_id, p.nick, p.sex, p.age, p.device, p.country, r.attempt,
         round((r.conditions ->> 'tripDurationMs')::numeric / 1000, 1),
         (r.conditions ->> 'carSpawnRate')::numeric,
         (r.conditions ->> 'obstacleSpawnRate')::numeric,
         (r.conditions ->> 'pedestrianSpawnRate')::numeric,
         r.scene,
         case when r.outcome = 'delivered' then 0 else 1 end,
         p.id
    from jsonb_each(p_assign) a
    join mlgame.rounds r on r.study_id = p_study_id and r.round_id = a.key
    join mlgame.respondents p on p.id = r.respondent_id
   order by lower(p.nick), p.nick, r.attempt;
$$;

-- {round_id: file} for a split.
create function mlgame.split_assign(p_study_id uuid, p_cutoff timestamptz, p_test_rounds integer, p_min_rounds integer)
returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.round_id, s.file), '{}'::jsonb)
    from mlgame.split_rows(p_study_id, p_cutoff, p_test_rounds, p_min_rounds) s
   where s.file is not null;
$$;

create function mlgame.release_assign(p_release mlgame.releases) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((select jsonb_object_agg(t, 'train') from unnest(p_release.train_ids) t), '{}'::jsonb)
      || coalesce((select jsonb_object_agg(t, 'test') from unnest(p_release.test_ids) t), '{}'::jsonb);
$$;

-- The numbers a release (or its preview) is judged by.
create function mlgame.split_counts(p_study_id uuid, p_cutoff timestamptz, p_test_rounds integer, p_min_rounds integer)
returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'rounds_total', count(*),
    'train_rows', count(*) filter (where s.file = 'train'),
    'test_rows', count(*) filter (where s.file = 'test'),
    'dropped_timeout_or_breakdown', count(*) filter (where s.reason = 'timeout_or_breakdown'),
    'dropped_unfinished', count(*) filter (where s.reason = 'unfinished'),
    'dropped_after_cutoff', count(*) filter (where s.reason = 'after_cutoff'),
    'players_total', (select count(*) from mlgame.respondents p where p.study_id = p_study_id),
    'players_in_test', count(distinct s.respondent_id) filter (where s.file = 'test'),
    'players_in_train', count(distinct s.respondent_id) filter (where s.file = 'train'),
    'players_only_train', count(distinct s.respondent_id) filter (where s.file = 'train')
                        - count(distinct s.respondent_id) filter (where s.file = 'test'),
    'players_left_out', (select count(*) from mlgame.respondents p where p.study_id = p_study_id)
                        - count(distinct s.respondent_id) filter (where s.file is not null)
  )
  from mlgame.split_rows(p_study_id, p_cutoff, p_test_rounds, p_min_rounds) s;
$$;

-- Rows of a split as JSON for the browser; `with_target` false leaves out `accident`.
create function mlgame.rows_json(p_study_id uuid, p_assign jsonb, p_file text, p_with_target boolean)
returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'file', f.file, 'round_id', f.round_id, 'player', f.player, 'sex', f.sex, 'age', f.age,
             'device', f.device, 'country', f.country, 'attempt', f.attempt,
             'trip_seconds', f.trip_seconds, 'car_rate', f.car_rate, 'obstacle_rate', f.obstacle_rate,
             'pedestrian_rate', f.pedestrian_rate, 'scene', f.scene)
           || case when p_with_target then jsonb_build_object('accident', f.accident) else '{}'::jsonb end
         ), '[]'::jsonb)
    from mlgame.file_rows(p_study_id, p_assign) f
   where p_file is null or f.file = p_file;
$$;

create function mlgame.latest_release(p_study_id uuid) returns mlgame.releases
language sql stable set search_path = '' as $$
  select * from mlgame.releases where study_id = p_study_id order by number desc limit 1;
$$;

create function mlgame.release_json(p_release mlgame.releases) returns jsonb
language sql stable set search_path = '' as $$
  select case when p_release.id is null then null else jsonb_build_object(
    'number', p_release.number, 'created_at', p_release.created_at, 'cutoff', p_release.cutoff,
    'test_rounds', p_release.test_rounds, 'min_rounds', p_release.min_rounds, 'counts', p_release.counts) end;
$$;

revoke all on all functions in schema mlgame from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin: progress, preview, releases, export
-- ---------------------------------------------------------------------------

-- Live progress: one row per player plus totals. Playing = not done and active in the last
-- 3 minutes; "enough rounds" = at least min_rounds counted rounds (in the test file at release).
create or replace function public.mlg_admin_progress(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  min_rounds integer;
  players jsonb;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id;
  if not found then
    raise exception 'study not found';
  end if;
  min_rounds := coalesce((st.params ->> 'min_rounds')::integer, 10);

  with per as (
    select p.nick, p.device, p.country, p.joined_at, p.last_activity_at, p.finished_at,
           count(r.id) filter (where r.ended_at is not null) as rounds_played,
           count(r.id) filter (where r.counted) as counted,
           count(r.id) filter (where r.outcome in ('crash_car', 'crash_obstacle', 'crash_pedestrian')) as accidents,
           coalesce(round(extract(epoch from max(r.ended_at) - min(r.started_at)))::integer, 0) as seconds
      from mlgame.respondents p
      left join mlgame.rounds r on r.respondent_id = p.id
     where p.study_id = p_id
     group by p.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nick', nick, 'device', device, 'country', country,
           'rounds_played', rounds_played, 'counted', counted, 'accidents', accidents, 'seconds', seconds,
           'done', finished_at is not null,
           'playing', finished_at is null and last_activity_at > now() - interval '3 minutes',
           'joined_at', joined_at, 'last_activity_at', last_activity_at
         ) order by lower(nick)), '[]'::jsonb)
    into players
    from per;

  return jsonb_build_object(
    'min_rounds', min_rounds,
    'players', players,
    'totals', jsonb_build_object(
      'joined', jsonb_array_length(players),
      'playing', (select count(*) from jsonb_array_elements(players) e where (e ->> 'playing')::boolean),
      'enough_rounds', (select count(*) from jsonb_array_elements(players) e where (e ->> 'counted')::integer >= min_rounds),
      'done', (select count(*) from jsonb_array_elements(players) e where (e ->> 'done')::boolean)
    )
  );
end;
$$;

-- What a release with these settings would contain (nothing is stored).
create function public.mlg_admin_release_preview(
  p_id uuid, p_cutoff timestamptz default null, p_test_rounds integer default null, p_min_rounds integer default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  v_cutoff timestamptz := least(coalesce(p_cutoff, now()), now());
  v_test integer;
  v_min integer;
  assign jsonb;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id;
  if not found then
    raise exception 'study not found';
  end if;
  v_test := coalesce(p_test_rounds, (st.params ->> 'test_rounds')::integer, 5);
  v_min := coalesce(p_min_rounds, (st.params ->> 'min_rounds')::integer, 10);
  if v_test < 1 or v_test > 50 or v_min <= v_test or v_min > 1000 then
    raise exception 'invalid settings: test rounds 1 to 50, minimum rounds more than the test rounds';
  end if;
  assign := mlgame.split_assign(p_id, v_cutoff, v_test, v_min);
  return jsonb_build_object(
    'settings', jsonb_build_object('cutoff', v_cutoff, 'test_rounds', v_test, 'min_rounds', v_min),
    'files', mlgame.rows_json(p_id, assign, null, true),
    'counts', mlgame.split_counts(p_id, v_cutoff, v_test, v_min)
  );
end;
$$;

-- Store a release (the next number) and release it to the students.
create function public.mlg_admin_create_release(
  p_id uuid, p_cutoff timestamptz, p_test_rounds integer, p_min_rounds integer
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
  v_cutoff timestamptz := least(coalesce(p_cutoff, now()), now());
  rel mlgame.releases;
  counts jsonb;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id for update;
  if not found then
    raise exception 'study not found';
  end if;
  if p_test_rounds is null or p_min_rounds is null
     or p_test_rounds < 1 or p_test_rounds > 50 or p_min_rounds <= p_test_rounds or p_min_rounds > 1000 then
    raise exception 'invalid settings: test rounds 1 to 50, minimum rounds more than the test rounds';
  end if;
  counts := mlgame.split_counts(p_id, v_cutoff, p_test_rounds, p_min_rounds);
  if (counts ->> 'test_rows')::integer = 0 then
    raise exception 'no player has enough rounds for the test file yet';
  end if;
  insert into mlgame.releases (study_id, number, cutoff, test_rounds, min_rounds, train_ids, test_ids, counts)
  select p_id,
         coalesce((select max(number) from mlgame.releases where study_id = p_id), 0) + 1,
         v_cutoff, p_test_rounds, p_min_rounds,
         coalesce(array_agg(s.round_id order by s.round_id) filter (where s.file = 'train'), '{}'),
         coalesce(array_agg(s.round_id order by s.round_id) filter (where s.file = 'test'), '{}'),
         counts
    from mlgame.split_rows(p_id, v_cutoff, p_test_rounds, p_min_rounds) s
  returning * into rel;
  update mlgame.studies set data_released = true where id = p_id;
  return mlgame.release_json(rel);
end;
$$;

create function public.mlg_admin_list_releases(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(mlgame.release_json(r) order by r.number desc)
      from mlgame.releases r where r.study_id = p_id), '[]'::jsonb);
end;
$$;

-- The files of a release (the latest when p_release is null) and the complete raw data.
-- Before the first release, the files are a preview with the study's default settings now.
drop function public.mlg_admin_export(uuid);
create function public.mlg_admin_export(p_id uuid, p_release integer default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  rel mlgame.releases;
  assign jsonb;
  counts jsonb;
  v_test integer;
  v_min integer;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id;
  if not found then
    raise exception 'study not found';
  end if;
  if p_release is null then
    rel := mlgame.latest_release(p_id);
  else
    select * into rel from mlgame.releases where study_id = p_id and number = p_release;
    if not found then
      raise exception 'release not found';
    end if;
  end if;
  if rel.id is not null then
    assign := mlgame.release_assign(rel);
    counts := rel.counts;
  else
    v_test := coalesce((st.params ->> 'test_rounds')::integer, 5);
    v_min := coalesce((st.params ->> 'min_rounds')::integer, 10);
    assign := mlgame.split_assign(p_id, now(), v_test, v_min);
    counts := mlgame.split_counts(p_id, now(), v_test, v_min);
  end if;

  return jsonb_build_object(
    'study', jsonb_build_object('code', st.code, 'title', st.title),
    'release', mlgame.release_json(rel),
    'files', mlgame.rows_json(p_id, assign, null, true),
    'raw', coalesce((
      select jsonb_agg(jsonb_build_object(
               'study_code', st.code, 'player', p.nick, 'sex', p.sex, 'age', p.age,
               'device', p.device, 'country', p.country,
               'viewport_width', p.viewport_width, 'viewport_height', p.viewport_height,
               'joined_at', p.joined_at, 'finished_at', p.finished_at,
               'attempt', r.attempt, 'counted', r.counted,
               'round_started_at', r.started_at, 'round_ended_at', r.ended_at,
               'trip_seconds', round((r.conditions ->> 'tripDurationMs')::numeric / 1000, 1),
               'car_rate', (r.conditions ->> 'carSpawnRate')::numeric,
               'obstacle_rate', (r.conditions ->> 'obstacleSpawnRate')::numeric,
               'pedestrian_rate', (r.conditions ->> 'pedestrianSpawnRate')::numeric,
               'scene', r.scene, 'outcome', r.outcome, 'time_ms', r.time_ms,
               'money_earned', r.money_earned, 'money_lost', r.money_lost,
               'money_balance', r.money_balance, 'applied', r.applied
             ) order by lower(p.nick), p.nick, r.attempt)
        from mlgame.rounds r join mlgame.respondents p on p.id = r.respondent_id
       where r.study_id = p_id), '[]'::jsonb),
    'counts', counts
  );
end;
$$;

-- "Release data to students" can be turned off and on again; on needs a release.
create or replace function public.mlg_admin_set_flags(p_id uuid, p_data_released boolean, p_submissions_open boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_data_released and not exists (select 1 from mlgame.releases where study_id = p_id) then
    raise exception 'make a release first';
  end if;
  update mlgame.studies set
    data_released = coalesce(p_data_released, data_released),
    submissions_open = coalesce(p_submissions_open, submissions_open)
  where id = p_id
  returning * into st;
  if not found then
    raise exception 'study not found';
  end if;
  return to_jsonb(st) - 'seed';
end;
$$;

-- Projector counts: joined, playing, with enough rounds, done.
create or replace function public.mlg_screen_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  min_rounds integer;
  x record;
begin
  select * into st from mlgame.studies where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  min_rounds := coalesce((st.params ->> 'min_rounds')::integer, 10);
  with per as (
    select p.finished_at, p.last_activity_at,
           (select count(*) from mlgame.rounds r where r.respondent_id = p.id and r.counted) as counted
      from mlgame.respondents p where p.study_id = st.id
  )
  select count(*) as joined,
         count(*) filter (where finished_at is null and last_activity_at > now() - interval '3 minutes') as playing,
         count(*) filter (where counted >= min_rounds) as enough,
         count(*) filter (where finished_at is not null) as done
    into x from per;
  return jsonb_build_object('status', st.status, 'title', st.title, 'joined', x.joined,
                            'playing', x.playing, 'enough_rounds', x.enough, 'done', x.done,
                            'min_rounds', min_rounds);
end;
$$;

-- ---------------------------------------------------------------------------
-- Students: files and submissions of the latest release
-- ---------------------------------------------------------------------------

create or replace function public.mlg_submit_page(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  rel mlgame.releases;
  assign jsonb;
  result jsonb;
begin
  select * into st from mlgame.studies where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  rel := mlgame.latest_release(st.id);
  result := jsonb_build_object(
    'status', st.status, 'title', st.title,
    'data_released', st.data_released and rel.id is not null, 'submissions_open', st.submissions_open
  );
  if st.data_released and rel.id is not null then
    assign := mlgame.release_assign(rel);
    result := result || jsonb_build_object(
      'release', jsonb_build_object('number', rel.number, 'created_at', rel.created_at),
      'train', mlgame.rows_json(st.id, assign, 'train', true),
      -- The test rows WITHOUT the target.
      'test', mlgame.rows_json(st.id, assign, 'test', false)
    );
  end if;
  return result;
end;
$$;

-- As before (data contract section 5), checked against the latest release's test rounds; the
-- upload records which release it was for.
create or replace function public.mlg_submit(p_code text, p_team text, p_pin text, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
  rel mlgame.releases;
  v_team text := regexp_replace(trim(coalesce(p_team, '')), '\s+', ' ', 'g');
  v_team_lower text;
  v_pin_hash text;
  team_pin text;
  recent integer;
  errors jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  n_rows integer;
  n_bad_p integer;
  n_zero_one integer;
  accepted boolean;
begin
  select * into st from mlgame.studies where code = upper(trim(p_code)) for update;
  if not found or st.status <> 'open' or not st.submissions_open then
    return jsonb_build_object('accepted', false, 'messages', jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'closed')));
  end if;
  rel := mlgame.latest_release(st.id);
  if not st.data_released or rel.id is null then
    return jsonb_build_object('accepted', false, 'messages', jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'no_test_rounds')));
  end if;
  if char_length(v_team) < 1 or char_length(v_team) > 40 or v_team ~ '[[:cntrl:]]' then
    return jsonb_build_object('accepted', false, 'messages', jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'bad_team')));
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('accepted', false, 'messages', jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'bad_pin')));
  end if;
  v_team_lower := lower(v_team);
  v_pin_hash := mlgame.hash_token(st.id::text || '|' || v_team_lower || '|' || p_pin);

  select count(*) into recent from mlgame.submissions
   where study_id = st.id and team_lower = v_team_lower and uploaded_at > now() - interval '1 hour';
  if recent >= 20 then
    return jsonb_build_object('accepted', false, 'messages', jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'too_many')));
  end if;

  select s.pin_hash into team_pin from mlgame.submissions s
   where s.study_id = st.id and s.team_lower = v_team_lower and not s.wrong_pin
   order by s.uploaded_at limit 1;
  if team_pin is not null and team_pin <> v_pin_hash then
    insert into mlgame.submissions (study_id, team, team_lower, pin_hash, accepted, messages, wrong_pin, release_id)
    values (st.id, v_team, v_team_lower, v_pin_hash, false, '[{"level":"error","code":"wrong_pin"}]', true, rel.id);
    return jsonb_build_object('accepted', false, 'messages', jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'wrong_pin')));
  end if;

  create temp table if not exists pg_temp.sub_rows (round_id text, p double precision, p_ok boolean) on commit drop;
  truncate pg_temp.sub_rows;
  create temp table if not exists pg_temp.test_ids (round_id text) on commit drop;
  truncate pg_temp.test_ids;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or char_length(p_rows::text) > 1000000 then
    errors := errors || jsonb_build_object('level', 'error', 'code', 'bad_file');
  else
    insert into pg_temp.sub_rows
      select e ->> 'round_id',
             case when jsonb_typeof(e -> 'p') = 'number' then (e ->> 'p')::double precision end,
             jsonb_typeof(e -> 'p') = 'number'
               and (e ->> 'p')::double precision between 0 and 1
        from jsonb_array_elements(p_rows) e;
    insert into pg_temp.test_ids select unnest(rel.test_ids);

    select count(*) into n_rows from pg_temp.sub_rows;
    if n_rows = 0 then
      errors := errors || jsonb_build_object('level', 'error', 'code', 'empty');
    end if;

    select count(*) into n_bad_p from pg_temp.sub_rows where not p_ok;
    if n_bad_p > 0 then
      errors := errors || jsonb_build_object('level', 'error', 'code', 'p_out_of_range', 'n', n_bad_p,
        'examples', (select jsonb_agg(round_id) from (select round_id from pg_temp.sub_rows where not p_ok limit 3) x));
    end if;
    errors := errors || coalesce((
      select jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'duplicates', 'n', count(*),
               'examples', (jsonb_agg(round_id) filter (where rn <= 3))))
        from (select round_id, row_number() over () as rn from pg_temp.sub_rows
               group by round_id having count(*) > 1) d
      having count(*) > 0), '[]'::jsonb);
    errors := errors || coalesce((
      select jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'unknown_ids', 'n', count(*),
               'examples', (jsonb_agg(round_id) filter (where rn <= 3))))
        from (select distinct s.round_id, dense_rank() over (order by s.round_id) as rn
                from pg_temp.sub_rows s
               where s.round_id is null or s.round_id not in (select round_id from pg_temp.test_ids)) u
      having count(*) > 0), '[]'::jsonb);
    errors := errors || coalesce((
      select jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'missing_ids', 'n', count(*),
               'examples', (jsonb_agg(round_id) filter (where rn <= 3))))
        from (select t.round_id, row_number() over (order by t.round_id) as rn
                from pg_temp.test_ids t
               where t.round_id not in (select round_id from pg_temp.sub_rows where round_id is not null)) m
      having count(*) > 0), '[]'::jsonb);

    select count(*) into n_zero_one from pg_temp.sub_rows where p_ok and (p = 0 or p = 1);
    if n_rows > 0 and n_bad_p = 0 and n_zero_one = n_rows then
      errors := errors || jsonb_build_object('level', 'error', 'code', 'looks_like_labels');
    elsif n_zero_one > 0 then
      warnings := warnings || jsonb_build_object('level', 'warning', 'code', 'zero_or_one', 'n', n_zero_one);
    end if;
  end if;

  accepted := jsonb_array_length(errors) = 0;
  insert into mlgame.submissions (study_id, team, team_lower, pin_hash, accepted, messages, rows, release_id)
  values (st.id, v_team, v_team_lower, coalesce(team_pin, v_pin_hash), accepted, errors || warnings,
          case when accepted then (select jsonb_agg(jsonb_build_object('round_id', round_id, 'p', p)) from pg_temp.sub_rows) end,
          rel.id);

  return jsonb_build_object(
    'accepted', accepted,
    'release', rel.number,
    'messages', errors || warnings || case when team_pin is null then
      jsonb_build_array(jsonb_build_object('level', 'info', 'code', 'pin_set')) else '[]'::jsonb end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: report data for one release (the latest by default)
-- ---------------------------------------------------------------------------

drop function public.mlg_admin_report_data(uuid);
create function public.mlg_admin_report_data(p_id uuid, p_release integer default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  x jsonb;
  rel_id bigint;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id;
  if not found then
    raise exception 'study not found';
  end if;
  x := public.mlg_admin_export(p_id, p_release);
  select id into rel_id from mlgame.releases
   where study_id = p_id and number = (x -> 'release' ->> 'number')::integer;
  return x || jsonb_build_object(
    'study_full', jsonb_build_object('title', st.title, 'code', st.code, 'status', st.status,
                                     'created_at', st.created_at, 'closed_at', st.closed_at, 'params', st.params),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('nick', p.nick, 'device', p.device, 'country', p.country))
        from mlgame.respondents p where p.study_id = p_id), '[]'::jsonb),
    'uploads', coalesce((
      select jsonb_agg(jsonb_build_object('team', s.team, 'uploaded_at', s.uploaded_at,
                                          'accepted', s.accepted, 'messages', s.messages,
                                          'release', r.number)
                       order by s.uploaded_at)
        from mlgame.submissions s left join mlgame.releases r on r.id = s.release_id
       where s.study_id = p_id and not s.wrong_pin), '[]'::jsonb),
    -- Each team's last accepted file FOR THIS RELEASE.
    'last_accepted', coalesce((
      select jsonb_agg(jsonb_build_object('team', y.team, 'uploaded_at', y.uploaded_at, 'rows', y.rows))
        from (select distinct on (s.team_lower) s.team, s.uploaded_at, s.rows
                from mlgame.submissions s
               where s.study_id = p_id and s.accepted and s.release_id = rel_id
               order by s.team_lower, s.uploaded_at desc) y), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Old helpers no longer used
-- ---------------------------------------------------------------------------

drop function mlgame.export_rows(uuid);

-- ---------------------------------------------------------------------------
-- EXECUTE grants
-- ---------------------------------------------------------------------------

revoke all on function public.mlg_finish(text) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_release_preview(uuid, timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_create_release(uuid, timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_list_releases(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_export(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_report_data(uuid, integer) from public, anon, authenticated, service_role;

grant execute on function public.mlg_finish(text) to anon, authenticated;
grant execute on function public.mlg_admin_release_preview(uuid, timestamptz, integer, integer) to authenticated;
grant execute on function public.mlg_admin_create_release(uuid, timestamptz, integer, integer) to authenticated;
grant execute on function public.mlg_admin_list_releases(uuid) to authenticated;
grant execute on function public.mlg_admin_export(uuid, integer) to authenticated;
grant execute on function public.mlg_admin_report_data(uuid, integer) to authenticated;
