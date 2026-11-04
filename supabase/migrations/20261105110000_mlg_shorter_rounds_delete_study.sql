-- ml-driving-game: shorter rounds by default, and deleting a study.
--
-- 1. Default parameters for NEW studies (data contract v04, section 2): rounds about a
--    third shorter. Road length 200 instead of 300 (sent to the game as the fixed
--    condition deliveryDistance), time limit 13 to 33 s instead of 20 to 50 s, spawn
--    rates 1.5 times higher, so a round still meets about as many hazards. Existing
--    studies keep their stored parameters.
-- 2. mlg_admin_delete_study: removes a study and everything in it (players, rounds,
--    schedules, submissions, reports). A study with players needs its code to confirm.
--
-- Safe to run once in the SQL editor of the shared project; touches only mlgame / mlg_* objects.

create or replace function mlgame.default_params() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'training_seconds', 600,
    'max_training_rounds', null,
    'test_rounds', 5,
    'scene_count', 10,
    'ranges', jsonb_build_object(
      'trip_seconds',    jsonb_build_object('min', 13,     'max', 33,     'scale', 'linear'),
      'car_rate',        jsonb_build_object('min', 0.015,  'max', 0.135,  'scale', 'linear'),
      'obstacle_rate',   jsonb_build_object('min', 0.003,  'max', 0.0225, 'scale', 'linear'),
      'pedestrian_rate', jsonb_build_object('min', 0.0015, 'max', 0.015,  'scale', 'linear')
    ),
    'fixed', jsonb_build_object('malfunctionProbability', 0, 'deliveryDistance', 200)
  );
$$;

create function public.mlg_admin_delete_study(p_id uuid, p_confirm_code text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
  n integer;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into st from mlgame.studies where id = p_id for update;
  if not found then
    raise exception 'study not found';
  end if;
  select count(*) into n from mlgame.respondents where study_id = p_id;
  if n > 0 and upper(trim(coalesce(p_confirm_code, ''))) <> st.code then
    return jsonb_build_object('deleted', false, 'error', 'confirm_code', 'players', n);
  end if;
  delete from mlgame.studies where id = p_id; -- cascades to everything of the study
  return jsonb_build_object('deleted', true, 'players', n);
end;
$$;

revoke all on function public.mlg_admin_delete_study(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mlg_admin_delete_study(uuid, text) to authenticated;
