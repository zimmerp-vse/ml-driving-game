-- ml-driving-game, milestone 3: the students' files, team submissions, reports.
--
-- Students (anon):
--   mlg_submit_page(code)  -> status, title, the two switches, and once data is released the
--                             rows of game_train.csv and game_test.csv (never the labels).
--   mlg_submit(code, team, pin, rows) -> {accepted, messages}. Never a score.
-- Admin:
--   mlg_admin_report_data(id) -> everything a report needs (computed in the admin's browser).
--   mlg_admin_save_report / mlg_admin_list_reports / mlg_admin_get_report.
--
-- Submission checks (data contract section 5; app_spec section 7):
--   * team name 1 to 40 characters, case-insensitive; a 4-digit PIN set with the team's first
--     upload, needed for later ones; a wrong PIN is recorded (for the rate limit) but not shown
--     as an upload;
--   * at most 20 uploads (wrong PINs included) per team per hour; 1 MB per upload;
--   * every round of game_test.csv exactly once, no other rows, p a number from 0 to 1;
--   * exactly 0 or 1 is accepted with a warning; if every p is 0 or 1 the file is rejected.
--
-- Safe to run once in the SQL editor of the shared project; touches only mlgame / mlg_* objects.

alter table mlgame.submissions add column team_lower text;
alter table mlgame.submissions add column wrong_pin boolean not null default false;
create index submissions_team_idx on mlgame.submissions (study_id, team_lower, uploaded_at);

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------

create function public.mlg_submit_page(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  result jsonb;
begin
  select * into st from mlgame.studies where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  result := jsonb_build_object(
    'status', st.status, 'title', st.title,
    'data_released', st.data_released, 'submissions_open', st.submissions_open
  );
  if st.data_released then
    result := result || jsonb_build_object(
      'train', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'round_id', e.round_id, 'player', e.player, 'sex', e.sex, 'age', e.age,
                 'device', e.device, 'country', e.country, 'attempt', e.attempt,
                 'trip_seconds', e.trip_seconds, 'car_rate', e.car_rate, 'obstacle_rate', e.obstacle_rate,
                 'pedestrian_rate', e.pedestrian_rate, 'scene', e.scene, 'accident', e.accident))
          from mlgame.export_rows(st.id) e where e.file = 'train'), '[]'::jsonb),
      -- The test rows WITHOUT the target.
      'test', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'round_id', e.round_id, 'player', e.player, 'sex', e.sex, 'age', e.age,
                 'device', e.device, 'country', e.country, 'attempt', e.attempt,
                 'trip_seconds', e.trip_seconds, 'car_rate', e.car_rate, 'obstacle_rate', e.obstacle_rate,
                 'pedestrian_rate', e.pedestrian_rate, 'scene', e.scene))
          from mlgame.export_rows(st.id) e where e.file = 'test'), '[]'::jsonb)
    );
  end if;
  return result;
end;
$$;

-- Messages are codes with numbers and a few examples; the page words them.
create function public.mlg_submit(p_code text, p_team text, p_pin text, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
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
    insert into mlgame.submissions (study_id, team, team_lower, pin_hash, accepted, messages, wrong_pin)
    values (st.id, v_team, v_team_lower, v_pin_hash, false, '[{"level":"error","code":"wrong_pin"}]', true);
    return jsonb_build_object('accepted', false, 'messages', jsonb_build_array(jsonb_build_object('level', 'error', 'code', 'wrong_pin')));
  end if;

  -- The file itself (work tables exist for the whole call, also when the file is rejected early).
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
    insert into pg_temp.test_ids select e.round_id from mlgame.export_rows(st.id) e where e.file = 'test';

    select count(*) into n_rows from pg_temp.sub_rows;
    if (select count(*) from pg_temp.test_ids) = 0 then
      errors := errors || jsonb_build_object('level', 'error', 'code', 'no_test_rounds');
    end if;
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
  insert into mlgame.submissions (study_id, team, team_lower, pin_hash, accepted, messages, rows)
  values (st.id, v_team, v_team_lower, coalesce(team_pin, v_pin_hash), accepted, errors || warnings,
          case when accepted then (select jsonb_agg(jsonb_build_object('round_id', round_id, 'p', p)) from pg_temp.sub_rows) end);

  return jsonb_build_object(
    'accepted', accepted,
    'messages', errors || warnings || case when team_pin is null then
      jsonb_build_array(jsonb_build_object('level', 'info', 'code', 'pin_set')) else '[]'::jsonb end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: reports
-- ---------------------------------------------------------------------------

-- Everything a report needs: the export (files, raw rows, counts), the uploads, and the rows
-- of each team's last accepted file.
create function public.mlg_admin_report_data(p_id uuid) returns jsonb
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
  return public.mlg_admin_export(p_id) || jsonb_build_object(
    'study_full', jsonb_build_object('title', st.title, 'code', st.code, 'status', st.status,
                                     'created_at', st.created_at, 'closed_at', st.closed_at, 'params', st.params),
    -- Every player who joined (also those with no round), for participation by device and country.
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('nick', p.nick, 'device', p.device, 'country', p.country))
        from mlgame.respondents p where p.study_id = p_id), '[]'::jsonb),
    'uploads', coalesce((
      select jsonb_agg(jsonb_build_object('team', s.team, 'uploaded_at', s.uploaded_at,
                                          'accepted', s.accepted, 'messages', s.messages)
                       order by s.uploaded_at)
        from mlgame.submissions s where s.study_id = p_id and not s.wrong_pin), '[]'::jsonb),
    'last_accepted', coalesce((
      select jsonb_agg(jsonb_build_object('team', x.team, 'uploaded_at', x.uploaded_at, 'rows', x.rows))
        from (select distinct on (s.team_lower) s.team, s.uploaded_at, s.rows
                from mlgame.submissions s
               where s.study_id = p_id and s.accepted
               order by s.team_lower, s.uploaded_at desc) x), '[]'::jsonb)
  );
end;
$$;

create function public.mlg_admin_save_report(p_id uuid, p_kind text, p_html text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  rid bigint;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_kind not in ('running', 'final') then
    raise exception 'invalid kind';
  end if;
  if char_length(coalesce(p_html, '')) > 5000000 then
    raise exception 'report too large';
  end if;
  insert into mlgame.reports (study_id, kind, html) values (p_id, p_kind, p_html) returning id into rid;
  return jsonb_build_object('id', rid);
end;
$$;

create function public.mlg_admin_list_reports(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'created_at', r.created_at,
                                        'size', char_length(r.html)) order by r.created_at desc)
      from mlgame.reports r where r.study_id = p_id), '[]'::jsonb);
end;
$$;

create function public.mlg_admin_get_report(p_report_id bigint) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (select html from mlgame.reports where id = p_report_id);
end;
$$;

revoke all on function public.mlg_submit_page(text) from public, anon, authenticated, service_role;
revoke all on function public.mlg_submit(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_report_data(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_save_report(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_list_reports(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mlg_admin_get_report(bigint) from public, anon, authenticated, service_role;

grant execute on function public.mlg_submit_page(text) to anon, authenticated;
grant execute on function public.mlg_submit(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.mlg_admin_report_data(uuid) to authenticated;
grant execute on function public.mlg_admin_save_report(uuid, text, text) to authenticated;
grant execute on function public.mlg_admin_list_reports(uuid) to authenticated;
grant execute on function public.mlg_admin_get_report(bigint) to authenticated;
