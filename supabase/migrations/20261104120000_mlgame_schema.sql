-- ml-driving-game, milestone 1: schema, tables and functions.
--
-- Runs in the SHARED Charming Ride Supabase project. Everything of this app lives
-- in its own schema `mlgame`, which the Data API does not expose. Browsers reach it
-- only through the `mlg_` functions in `public` (SECURITY DEFINER), each checking the
-- study code, a hashed respondent token, or `mlgame.admins`. Charming Ride's tables
-- are not touched.
--
-- Security model (app_spec section 7):
--   * RLS on every table, no policies, no table grants to anyone: the tables are
--     reachable only through the functions below (which run as their owner).
--   * Supabase grants EXECUTE on new functions in `public` to anon, authenticated and
--     service_role by default, so every function first revokes that, then grants
--     EXECUTE only to the roles that need it.
--   * mlg_join_study is for service_role only: it is called by the Vercel function
--     /api/join, which adds the country from the platform header, so the browser
--     cannot set the country.
--
-- Safe to run once in the SQL editor. It creates objects only in schema `mlgame` and
-- functions named `public.mlg_*`.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists mlgame;
revoke all on schema mlgame from public;
revoke all on schema mlgame from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table mlgame.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table mlgame.studies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  title text not null check (char_length(title) between 1 and 200),
  consent_text text not null check (char_length(consent_text) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  params jsonb not null,
  seed text not null default encode(extensions.gen_random_bytes(8), 'hex'),
  submissions_open boolean not null default false,
  data_released boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table mlgame.respondents (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references mlgame.studies (id) on delete cascade,
  nick text not null,
  nick_lower text not null,
  sex text check (sex in ('F', 'M')),
  age integer check (age between 15 and 99),
  device text not null check (device in ('touch', 'mouse')),
  country text check (country ~ '^[A-Z]{2}$'),
  viewport_width integer,
  viewport_height integer,
  token_hash text not null unique,
  joined_at timestamptz not null default now(),
  first_round_started_at timestamptz,
  last_activity_at timestamptz not null default now(),
  unique (study_id, nick_lower)
);

create table mlgame.schedules (
  id bigint generated always as identity primary key,
  respondent_id uuid not null references mlgame.respondents (id) on delete cascade,
  from_attempt integer not null,
  rounds jsonb not null,
  created_at timestamptz not null default now()
);

create table mlgame.rounds (
  id bigint generated always as identity primary key,
  study_id uuid not null references mlgame.studies (id) on delete cascade,
  respondent_id uuid not null references mlgame.respondents (id) on delete cascade,
  round_id text not null,
  attempt integer not null check (attempt >= 1),
  phase text check (phase in ('train', 'test')),
  counted boolean,
  test_index integer,
  conditions jsonb not null,
  applied jsonb,
  scene text,
  outcome text check (outcome in ('delivered', 'crash_car', 'crash_obstacle', 'crash_pedestrian', 'malfunction', 'timeout')),
  time_ms integer,
  money_earned integer,
  money_lost integer,
  money_balance integer,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (respondent_id, attempt),
  unique (study_id, round_id)
);
create index rounds_study_idx on mlgame.rounds (study_id);

create table mlgame.submissions (
  id bigint generated always as identity primary key,
  study_id uuid not null references mlgame.studies (id) on delete cascade,
  team text not null,
  pin_hash text not null,
  uploaded_at timestamptz not null default now(),
  accepted boolean not null,
  messages jsonb not null default '[]'::jsonb,
  rows jsonb
);
create index submissions_study_idx on mlgame.submissions (study_id, team);

create table mlgame.reports (
  id bigint generated always as identity primary key,
  study_id uuid not null references mlgame.studies (id) on delete cascade,
  kind text not null check (kind in ('running', 'final')),
  created_at timestamptz not null default now(),
  html text not null
);

alter table mlgame.admins enable row level security;
alter table mlgame.studies enable row level security;
alter table mlgame.respondents enable row level security;
alter table mlgame.schedules enable row level security;
alter table mlgame.rounds enable row level security;
alter table mlgame.submissions enable row level security;
alter table mlgame.reports enable row level security;

revoke all on all tables in schema mlgame from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (schema mlgame, not callable by clients)
-- ---------------------------------------------------------------------------

create function mlgame.default_params() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'training_seconds', 600,
    'max_training_rounds', null,
    'test_rounds', 5,
    'scene_count', 10,
    'ranges', jsonb_build_object(
      'trip_seconds',    jsonb_build_object('min', 20,    'max', 50,    'scale', 'linear'),
      'car_rate',        jsonb_build_object('min', 0.01,  'max', 0.09,  'scale', 'linear'),
      'obstacle_rate',   jsonb_build_object('min', 0.002, 'max', 0.015, 'scale', 'linear'),
      'pedestrian_rate', jsonb_build_object('min', 0.001, 'max', 0.010, 'scale', 'linear')
    ),
    'fixed', jsonb_build_object('malfunctionProbability', 0)
  );
$$;

-- Random code from an alphabet without look-alike characters (no 0, O, 1, I).
create function mlgame.random_code(len integer) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(len);
  result text := '';
begin
  for i in 0 .. len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

create function mlgame.hash_token(token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(token, 'sha256'), 'hex');
$$;

-- Deterministic uniform number in [0, 1) from a seed and a key (52 bits of SHA-256).
create function mlgame.u01(seed text, key text) returns double precision
language sql immutable set search_path = '' as $$
  select (('x' || substr(encode(extensions.digest(seed || '|' || key, 'sha256'), 'hex'), 1, 13))::bit(52)::bigint)::double precision
         / 4503599627370496.0;
$$;

-- One value from a range {min, max, scale: linear | log}.
create function mlgame.draw_value(r jsonb, u double precision) returns double precision
language sql immutable set search_path = '' as $$
  select case
    when r ->> 'scale' = 'log' then
      exp(ln((r ->> 'min')::double precision)
          + u * (ln((r ->> 'max')::double precision) - ln((r ->> 'min')::double precision)))
    else
      (r ->> 'min')::double precision
        + u * ((r ->> 'max')::double precision - (r ->> 'min')::double precision)
  end;
$$;

-- The conditions of one attempt, in the game's names. Deterministic in
-- (study seed, respondent id, attempt), so a resume reproduces them.
create function mlgame.draw_conditions(p_seed text, p_params jsonb, p_respondent_id uuid, p_attempt integer)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text := p_respondent_id::text || '|' || p_attempt::text || '|';
  r jsonb := p_params -> 'ranges';
  scenes integer := coalesce((p_params ->> 'scene_count')::integer, 10);
begin
  return jsonb_build_object(
    'tripDurationMs',      (round(mlgame.draw_value(r -> 'trip_seconds', mlgame.u01(p_seed, k || 'trip')) * 10) * 100)::integer,
    'carSpawnRate',        round(mlgame.draw_value(r -> 'car_rate', mlgame.u01(p_seed, k || 'car'))::numeric, 6),
    'obstacleSpawnRate',   round(mlgame.draw_value(r -> 'obstacle_rate', mlgame.u01(p_seed, k || 'obstacle'))::numeric, 6),
    'pedestrianSpawnRate', round(mlgame.draw_value(r -> 'pedestrian_rate', mlgame.u01(p_seed, k || 'pedestrian'))::numeric, 6),
    'sceneIndex',          least(scenes - 1, floor(mlgame.u01(p_seed, k || 'scene') * scenes)::integer)
  );
end;
$$;

create function mlgame.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from mlgame.admins a where a.user_id = auth.uid());
$$;

-- Where a player is: next attempt, counted test rounds, done.
create function mlgame.position(p_respondent_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  resp mlgame.respondents;
  st mlgame.studies;
  next_attempt integer;
  counted_test integer;
  test_rounds integer;
begin
  select * into resp from mlgame.respondents where id = p_respondent_id;
  select * into st from mlgame.studies where id = resp.study_id;
  select coalesce(max(attempt), 0) + 1,
         count(*) filter (where phase = 'test' and test_index is not null)
    into next_attempt, counted_test
    from mlgame.rounds where respondent_id = p_respondent_id;
  test_rounds := coalesce((st.params ->> 'test_rounds')::integer, 5);
  return jsonb_build_object(
    'respondent_id', resp.id,
    'nick', resp.nick,
    'study_status', st.status,
    'next_attempt', next_attempt,
    'counted_test_rounds', counted_test,
    'done', counted_test >= test_rounds
  );
end;
$$;

revoke all on all functions in schema mlgame from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Student functions (anon)
-- ---------------------------------------------------------------------------

-- What the join page needs. Title and consent line only while the study is open.
create function public.mlg_study_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  select * into st from mlgame.studies where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if st.status <> 'open' then
    return jsonb_build_object('status', st.status);
  end if;
  return jsonb_build_object('status', st.status, 'title', st.title, 'consent_text', st.consent_text);
end;
$$;

-- Join a study. Called only by /api/join (service_role), which supplies the country.
-- Returns {ok: true, respondent_id, token} or {ok: false, error}.
create function public.mlg_join_study(
  p_code text, p_nick text, p_sex text, p_age integer, p_device text,
  p_viewport_width integer, p_viewport_height integer, p_country text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
  nick text := regexp_replace(trim(coalesce(p_nick, '')), '\s+', ' ', 'g');
  ctry text := upper(trim(coalesce(p_country, '')));
  n integer;
  token text;
  rid uuid;
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
  if p_device is null or p_device not in ('touch', 'mouse') then
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

  token := encode(extensions.gen_random_bytes(32), 'hex');
  begin
    insert into mlgame.respondents
      (study_id, nick, nick_lower, sex, age, device, country, viewport_width, viewport_height, token_hash)
    values
      (st.id, nick, lower(nick), p_sex, p_age, p_device, ctry,
       least(greatest(p_viewport_width, 0), 10000), least(greatest(p_viewport_height, 0), 10000),
       mlgame.hash_token(token))
    returning id into rid;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'nick_taken');
  end;

  return jsonb_build_object('ok', true, 'respondent_id', rid, 'token', token);
end;
$$;

-- Where the player is. {ok: false, error: 'unknown_token'} if the token is not known.
create function public.mlg_resume(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rid uuid;
begin
  select id into rid from mlgame.respondents where token_hash = mlgame.hash_token(coalesce(p_token, ''));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_token');
  end if;
  return jsonb_build_object('ok', true) || mlgame.position(rid);
end;
$$;

-- Position plus the schedule for the next p_count attempts, and the fixed conditions.
create function public.mlg_start_schedule(p_token text, p_count integer default 80) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  resp mlgame.respondents;
  st mlgame.studies;
  pos jsonb;
  from_attempt integer;
  cnt integer := least(greatest(coalesce(p_count, 80), 1), 100);
  rounds jsonb;
begin
  select * into resp from mlgame.respondents where token_hash = mlgame.hash_token(coalesce(p_token, ''));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_token');
  end if;
  select * into st from mlgame.studies where id = resp.study_id;
  pos := mlgame.position(resp.id);
  if st.status <> 'open' or (pos ->> 'done')::boolean then
    return jsonb_build_object('ok', true) || pos;
  end if;

  from_attempt := (pos ->> 'next_attempt')::integer;
  select jsonb_agg(mlgame.draw_conditions(st.seed, st.params, resp.id, a) order by a)
    into rounds
    from generate_series(from_attempt, from_attempt + cnt - 1) as a;

  insert into mlgame.schedules (respondent_id, from_attempt, rounds) values (resp.id, from_attempt, rounds);
  update mlgame.respondents set last_activity_at = now() where id = resp.id;

  return jsonb_build_object('ok', true) || pos || jsonb_build_object(
    'from_attempt', from_attempt,
    'rounds', rounds,
    'fixed', coalesce(st.params -> 'fixed', '{}'::jsonb)
  );
end;
$$;

-- A round started. Stores the server's time; repeated calls change nothing.
create function public.mlg_round_start(p_token text, p_attempt integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  resp mlgame.respondents;
  st mlgame.studies;
begin
  if p_attempt is null or p_attempt < 1 or p_attempt > 10000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  select * into resp from mlgame.respondents
    where token_hash = mlgame.hash_token(coalesce(p_token, '')) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_token');
  end if;
  select * into st from mlgame.studies where id = resp.study_id;
  if st.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'not_open');
  end if;

  perform mlgame.ensure_round(st, resp, p_attempt, now());
  update mlgame.respondents
     set first_round_started_at = coalesce(first_round_started_at, now()),
         last_activity_at = now()
   where id = resp.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- A round ended. Decides phase, counted and test_index on the server.
-- Returns {ok, done, counted_test_rounds}. Repeated calls change nothing.
create function public.mlg_round_end(
  p_token text, p_attempt integer, p_outcome text, p_time_ms integer, p_scene text,
  p_money_earned integer, p_money_lost integer, p_money_balance integer, p_applied jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  resp mlgame.respondents;
  st mlgame.studies;
  rnd mlgame.rounds;
  training_seconds integer;
  max_training_rounds integer;
  test_rounds integer;
  counted_test integer;
  v_phase text;
  v_counted boolean;
  v_test_index integer;
  first_start timestamptz;
begin
  if p_attempt is null or p_attempt < 1 or p_attempt > 10000
     or p_outcome is null
     or p_outcome not in ('delivered', 'crash_car', 'crash_obstacle', 'crash_pedestrian', 'malfunction', 'timeout')
     or p_time_ms is null or p_time_ms < 0 or p_time_ms > 3600000
     or char_length(coalesce(p_scene, '')) > 60
     or (p_applied is not null and (jsonb_typeof(p_applied) <> 'object' or char_length(p_applied::text) > 1000)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  -- Lock the player so concurrent calls number the test rounds correctly.
  select * into resp from mlgame.respondents
    where token_hash = mlgame.hash_token(coalesce(p_token, '')) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_token');
  end if;
  select * into st from mlgame.studies where id = resp.study_id;

  -- If ROUND_START never reached us, estimate the start from the round's duration.
  rnd := mlgame.ensure_round(st, resp, p_attempt, now() - make_interval(secs => p_time_ms / 1000.0));
  if rnd.ended_at is not null then
    return jsonb_build_object('ok', true) || mlgame.position(resp.id);
  end if;

  first_start := coalesce(resp.first_round_started_at, rnd.started_at);
  training_seconds := coalesce((st.params ->> 'training_seconds')::integer, 600);
  max_training_rounds := (st.params ->> 'max_training_rounds')::integer;
  test_rounds := coalesce((st.params ->> 'test_rounds')::integer, 5);

  if rnd.started_at < first_start + make_interval(secs => training_seconds)
     and (max_training_rounds is null or p_attempt <= max_training_rounds) then
    v_phase := 'train';
  else
    v_phase := 'test';
  end if;
  v_counted := p_outcome in ('delivered', 'crash_car', 'crash_obstacle', 'crash_pedestrian');

  select count(*) into counted_test from mlgame.rounds
    where respondent_id = resp.id and phase = 'test' and test_index is not null;
  if v_phase = 'test' and v_counted and counted_test < test_rounds then
    v_test_index := counted_test + 1;
  end if;

  update mlgame.rounds set
    phase = v_phase, counted = v_counted, test_index = v_test_index,
    outcome = p_outcome, time_ms = p_time_ms, scene = p_scene,
    money_earned = p_money_earned, money_lost = p_money_lost, money_balance = p_money_balance,
    applied = p_applied, ended_at = now()
  where id = rnd.id;

  update mlgame.respondents
     set first_round_started_at = first_start, last_activity_at = now()
   where id = resp.id;

  return jsonb_build_object('ok', true) || mlgame.position(resp.id);
end;
$$;

-- The round row for (player, attempt), created if missing. Used by round_start and round_end.
-- Defined after its callers' bodies reference it; plpgsql resolves names at run time.
create function mlgame.ensure_round(
  st mlgame.studies, resp mlgame.respondents, p_attempt integer, p_started_at timestamptz
) returns mlgame.rounds
language plpgsql volatile set search_path = '' as $$
declare
  rnd mlgame.rounds;
begin
  select * into rnd from mlgame.rounds where respondent_id = resp.id and attempt = p_attempt;
  if found then
    return rnd;
  end if;
  for i in 1 .. 5 loop
    begin
      insert into mlgame.rounds (study_id, respondent_id, round_id, attempt, conditions, started_at)
      values (st.id, resp.id, mlgame.random_code(8), p_attempt,
              mlgame.draw_conditions(st.seed, st.params, resp.id, p_attempt), p_started_at)
      returning * into rnd;
      return rnd;
    exception when unique_violation then
      -- Either the round_id collided (try a new one) or the row now exists.
      select * into rnd from mlgame.rounds where respondent_id = resp.id and attempt = p_attempt;
      if found then
        return rnd;
      end if;
    end;
  end loop;
  raise exception 'could not create round';
end;
$$;
revoke all on function mlgame.ensure_round(mlgame.studies, mlgame.respondents, integer, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin functions (authenticated, checked against mlgame.admins)
-- ---------------------------------------------------------------------------

create function public.mlg_admin_whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('is_admin', mlgame.is_admin());
$$;

create function public.mlg_admin_list_studies() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'title', s.title, 'status', s.status,
      'created_at', s.created_at, 'closed_at', s.closed_at,
      'joined', (select count(*) from mlgame.respondents r where r.study_id = s.id)
    ) order by s.created_at desc)
    from mlgame.studies s
  ), '[]'::jsonb);
end;
$$;

create function public.mlg_admin_get_study(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id;
  if not found then
    return null;
  end if;
  return to_jsonb(st) - 'seed' || jsonb_build_object(
    'joined', (select count(*) from mlgame.respondents r where r.study_id = st.id),
    'rounds', (select count(*) from mlgame.rounds r where r.study_id = st.id)
  );
end;
$$;

-- Create a study in status draft. Params default to mlgame.default_params(), with
-- any keys given in p_params replacing the defaults (top level).
create function public.mlg_admin_create_study(
  p_title text, p_consent_text text, p_params jsonb default null, p_code text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_code = '' then
    loop
      v_code := mlgame.random_code(6);
      exit when not exists (select 1 from mlgame.studies where code = v_code);
    end loop;
  end if;
  insert into mlgame.studies (code, title, consent_text, params)
  values (v_code, trim(p_title), trim(p_consent_text),
          mlgame.default_params() || coalesce(p_params, '{}'::jsonb))
  returning * into st;
  return to_jsonb(st) - 'seed';
end;
$$;

-- Edit a study's text and parameters (while it is a draft) or its code.
create function public.mlg_admin_update_study(
  p_id uuid, p_title text, p_consent_text text, p_code text, p_params jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id for update;
  if not found then
    raise exception 'study not found';
  end if;
  update mlgame.studies set
    title = coalesce(nullif(trim(p_title), ''), title),
    consent_text = coalesce(nullif(trim(p_consent_text), ''), consent_text),
    code = coalesce(nullif(upper(trim(p_code)), ''), code),
    -- Parameters are frozen once anyone has joined.
    params = case
      when p_params is not null and not exists (select 1 from mlgame.respondents r where r.study_id = p_id)
        then mlgame.default_params() || p_params
      else params end
  where id = p_id
  returning * into st;
  return to_jsonb(st) - 'seed';
end;
$$;

-- draft -> open -> closed (closed also closes submissions). Reopening a closed study is allowed.
create function public.mlg_admin_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'open', 'closed') then
    raise exception 'invalid status';
  end if;
  update mlgame.studies set
    status = p_status,
    closed_at = case when p_status = 'closed' then now() else null end,
    submissions_open = case when p_status = 'closed' then false else submissions_open end
  where id = p_id
  returning * into st;
  if not found then
    raise exception 'study not found';
  end if;
  return to_jsonb(st) - 'seed';
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants: revoke Supabase's defaults, then grant only what is needed.
-- ---------------------------------------------------------------------------

revoke all on function public.mlg_study_info(text) from public, anon, authenticated, service_role;
revoke all on function public.mlg_join_study(text, text, text, integer, text, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.mlg_resume(text) from public, anon, authenticated, service_role;
revoke all on function public.mlg_start_schedule(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.mlg_round_start(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.mlg_round_end(text, integer, text, integer, text, integer, integer, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_whoami() from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_list_studies() from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_get_study(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_create_study(text, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_update_study(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_set_status(uuid, text) from public, anon, authenticated, service_role;

-- Students (a student's browser may also hold a Charming Ride session, hence authenticated too).
grant execute on function public.mlg_study_info(text) to anon, authenticated;
grant execute on function public.mlg_resume(text) to anon, authenticated;
grant execute on function public.mlg_start_schedule(text, integer) to anon, authenticated;
grant execute on function public.mlg_round_start(text, integer) to anon, authenticated;
grant execute on function public.mlg_round_end(text, integer, text, integer, text, integer, integer, integer, jsonb) to anon, authenticated;

-- Join: only the server (/api/join), so the country comes from the platform.
grant execute on function public.mlg_join_study(text, text, text, integer, text, integer, integer, text) to service_role;

-- Admin: signed-in users; each function checks mlgame.admins.
grant execute on function public.mlg_admin_whoami() to authenticated;
grant execute on function public.mlg_admin_list_studies() to authenticated;
grant execute on function public.mlg_admin_get_study(uuid) to authenticated;
grant execute on function public.mlg_admin_create_study(text, text, jsonb, text) to authenticated;
grant execute on function public.mlg_admin_update_study(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.mlg_admin_set_status(uuid, text) to authenticated;
