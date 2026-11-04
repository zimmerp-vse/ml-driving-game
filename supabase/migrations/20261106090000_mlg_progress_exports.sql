-- ml-driving-game, milestone 2: live progress, exports, release and submission switches.
--
-- The file rules of the data contract (section 4.4) live here, in one place, so the admin's
-- exports and (later) the students' download use the same rows:
--   1. timeouts and breakdowns are dropped; attempt keeps its gaps;
--   2. an incomplete player's counted rounds (training and test) go to game_train.csv;
--   3. a player with no counted training round is left out of both files;
--   4. student files carry no time_ms, money, timestamps, phase, test_index, crash type, viewport;
--   5. rows are sorted by player, then attempt.
-- Rounds started but never ended (a reload) are dropped too.
--
-- Safe to run once in the SQL editor of the shared project; touches only mlgame / mlg_* objects.

-- One row per round of a study, with the file it belongs to ('train', 'test' or null) and,
-- when it is in no file, the reason. Sorted as the files are.
create function mlgame.export_rows(p_study_id uuid)
returns table (
  round_id text, player text, sex text, age integer, device text, country text,
  attempt integer, trip_seconds numeric, car_rate numeric, obstacle_rate numeric,
  pedestrian_rate numeric, scene text, accident integer, file text, reason text,
  respondent_id uuid
)
language sql stable set search_path = '' as $$
  with st as (
    select coalesce((params ->> 'test_rounds')::integer, 5) as test_rounds
      from mlgame.studies where id = p_study_id
  ),
  pl as (
    select p.id,
           count(r.id) filter (where r.phase = 'test' and r.test_index is not null) as counted_test,
           count(r.id) filter (where r.phase = 'train' and r.counted) as counted_train
      from mlgame.respondents p
      left join mlgame.rounds r on r.respondent_id = p.id
     where p.study_id = p_study_id
     group by p.id
  ),
  x as (
    select r.*, p.nick, p.sex, p.age, p.device, p.country,
           (pl.counted_test >= st.test_rounds) as complete,
           pl.counted_train
      from mlgame.rounds r
      join mlgame.respondents p on p.id = r.respondent_id
      join pl on pl.id = p.id
     cross join st
     where r.study_id = p_study_id
  )
  select x.round_id, x.nick, x.sex, x.age, x.device, x.country, x.attempt,
         round((x.conditions ->> 'tripDurationMs')::numeric / 1000, 1),
         (x.conditions ->> 'carSpawnRate')::numeric,
         (x.conditions ->> 'obstacleSpawnRate')::numeric,
         (x.conditions ->> 'pedestrianSpawnRate')::numeric,
         x.scene,
         case when x.outcome = 'delivered' then 0
              when x.outcome in ('crash_car', 'crash_obstacle', 'crash_pedestrian') then 1 end,
         case
           when x.ended_at is null or not x.counted or x.counted_train = 0 then null
           when x.complete and x.phase = 'test' and x.test_index is not null then 'test'
           when x.complete and x.phase = 'test' then null
           else 'train'
         end,
         case
           when x.ended_at is null then 'interrupted'
           when not x.counted then 'timeout_or_breakdown'
           when x.counted_train = 0 then 'no_training_round'
           when x.complete and x.phase = 'test' and x.test_index is null then 'after_done'
         end,
         x.respondent_id
    from x
   order by lower(x.nick), x.nick, x.attempt;
$$;
revoke all on function mlgame.export_rows(uuid) from public, anon, authenticated, service_role;

-- Live progress: one row per player plus totals. "Playing" = not done and active in the last
-- 3 minutes (as on the projector page).
create function public.mlg_admin_progress(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  test_rounds integer;
  training_seconds integer;
  max_training_rounds integer;
  players jsonb;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id;
  if not found then
    raise exception 'study not found';
  end if;
  test_rounds := coalesce((st.params ->> 'test_rounds')::integer, 5);
  training_seconds := coalesce((st.params ->> 'training_seconds')::integer, 600);
  max_training_rounds := (st.params ->> 'max_training_rounds')::integer;

  with per as (
    select p.nick, p.device, p.country, p.joined_at, p.last_activity_at, p.first_round_started_at,
           count(r.id) filter (where r.ended_at is not null) as rounds_played,
           count(r.id) filter (where r.outcome in ('crash_car', 'crash_obstacle', 'crash_pedestrian')) as accidents,
           count(r.id) filter (where r.phase = 'test' and r.test_index is not null) as counted_test,
           coalesce(max(r.attempt), 0) as last_attempt
      from mlgame.respondents p
      left join mlgame.rounds r on r.respondent_id = p.id
     where p.study_id = p_id
     group by p.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nick', nick, 'device', device, 'country', country,
           'rounds_played', rounds_played, 'accidents', accidents,
           'counted_test_rounds', counted_test,
           'phase', case
              when counted_test >= test_rounds then 'done'
              when first_round_started_at is null then 'not started'
              when now() < first_round_started_at + make_interval(secs => training_seconds)
                   and (max_training_rounds is null or last_attempt < max_training_rounds) then 'train'
              else 'test' end,
           'playing', counted_test < test_rounds and last_activity_at > now() - interval '3 minutes',
           'joined_at', joined_at, 'last_activity_at', last_activity_at
         ) order by lower(nick)), '[]'::jsonb)
    into players
    from per;

  return jsonb_build_object(
    'test_rounds', test_rounds,
    'players', players,
    'totals', jsonb_build_object(
      'joined', jsonb_array_length(players),
      'playing', (select count(*) from jsonb_array_elements(players) e where (e ->> 'playing')::boolean),
      'in_test', (select count(*) from jsonb_array_elements(players) e where e ->> 'phase' = 'test'),
      'done', (select count(*) from jsonb_array_elements(players) e where e ->> 'phase' = 'done')
    )
  );
end;
$$;

-- Everything the admin needs to build the four files: the rows of the two student files
-- (with file = 'train' or 'test'), the raw rows (contract section 3), and the counts of the
-- rules, shown before download.
create function public.mlg_admin_export(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id;
  if not found then
    raise exception 'study not found';
  end if;

  return jsonb_build_object(
    'study', jsonb_build_object('code', st.code, 'title', st.title,
                                'test_rounds', coalesce((st.params ->> 'test_rounds')::integer, 5)),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'file', e.file, 'round_id', e.round_id, 'player', e.player, 'sex', e.sex, 'age', e.age,
               'device', e.device, 'country', e.country, 'attempt', e.attempt,
               'trip_seconds', e.trip_seconds, 'car_rate', e.car_rate, 'obstacle_rate', e.obstacle_rate,
               'pedestrian_rate', e.pedestrian_rate, 'scene', e.scene, 'accident', e.accident))
        from mlgame.export_rows(p_id) e where e.file is not null), '[]'::jsonb),
    'raw', coalesce((
      select jsonb_agg(jsonb_build_object(
               'study_code', st.code, 'player', p.nick, 'sex', p.sex, 'age', p.age,
               'device', p.device, 'country', p.country,
               'viewport_width', p.viewport_width, 'viewport_height', p.viewport_height,
               'joined_at', p.joined_at, 'attempt', r.attempt, 'phase', r.phase,
               'test_index', r.test_index, 'counted', r.counted,
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
    'counts', (
      select jsonb_build_object(
        'rounds_total', count(*),
        'train_rows', count(*) filter (where file = 'train'),
        'test_rows', count(*) filter (where file = 'test'),
        'dropped_timeout_or_breakdown', count(*) filter (where reason = 'timeout_or_breakdown'),
        'dropped_interrupted', count(*) filter (where reason = 'interrupted'),
        'dropped_no_training_round', count(*) filter (where reason = 'no_training_round'),
        'dropped_after_done', count(*) filter (where reason = 'after_done'),
        'players_total', (select count(*) from mlgame.respondents where study_id = p_id),
        'players_complete', count(distinct respondent_id) filter (where file = 'test'),
        'players_in_train', count(distinct respondent_id) filter (where file = 'train'),
        'players_left_out', (select count(*) from mlgame.respondents p where p.study_id = p_id
                               and not exists (select 1 from mlgame.export_rows(p_id) e
                                               where e.respondent_id = p.id and e.file is not null))
      )
      from mlgame.export_rows(p_id)
    )
  );
end;
$$;

-- Release the student files and open submissions (null = leave unchanged).
create function public.mlg_admin_set_flags(p_id uuid, p_data_released boolean, p_submissions_open boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
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

revoke all on function public.mlg_admin_progress(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_export(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_set_flags(uuid, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.mlg_admin_progress(uuid) to authenticated;
grant execute on function public.mlg_admin_export(uuid) to authenticated;
grant execute on function public.mlg_admin_set_flags(uuid, boolean, boolean) to authenticated;
