-- ml-driving-game: counts for the projector page /screen/:code.
--
-- Public (anon): returns only the study's title, status and three counts, never
-- personal data. "Playing" = joined, not done, and active in the last 3 minutes.
-- Safe to run once in the SQL editor of the shared project; touches only mlg_* objects.

create function public.mlg_screen_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st mlgame.studies;
  test_rounds integer;
  v_joined integer;
  v_done integer;
  v_playing integer;
begin
  select * into st from mlgame.studies where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  test_rounds := coalesce((st.params ->> 'test_rounds')::integer, 5);

  with per_player as (
    select p.id, p.last_activity_at,
           (select count(*) from mlgame.rounds r
             where r.respondent_id = p.id and r.phase = 'test' and r.test_index is not null) as counted_test
      from mlgame.respondents p
     where p.study_id = st.id
  )
  select count(*),
         count(*) filter (where counted_test >= test_rounds),
         count(*) filter (where counted_test < test_rounds and last_activity_at > now() - interval '3 minutes')
    into v_joined, v_done, v_playing
    from per_player;

  return jsonb_build_object(
    'status', st.status,
    'title', st.title,
    'joined', v_joined,
    'playing', v_playing,
    'done', v_done
  );
end;
$$;

revoke all on function public.mlg_screen_info(text) from public, anon, authenticated, service_role;
grant execute on function public.mlg_screen_info(text) to anon, authenticated;
