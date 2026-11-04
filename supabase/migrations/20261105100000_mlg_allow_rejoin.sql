-- ml-driving-game: per-study setting "let players join again" (for test studies).
--
-- When on, a player who is done sees a "Play again as a new player" button, which
-- starts a fresh join with a new nick. Off by default; meant for testing, not for class.
-- Safe to run once in the SQL editor of the shared project; touches only mlgame / mlg_* objects.

alter table mlgame.studies add column allow_rejoin boolean not null default false;

-- The join page also learns whether joining again is allowed.
create or replace function public.mlg_study_info(p_code text) returns jsonb
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
  return jsonb_build_object('status', st.status, 'title', st.title, 'consent_text', st.consent_text,
                            'allow_rejoin', st.allow_rejoin);
end;
$$;

create or replace function public.mlg_admin_list_studies() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'title', s.title, 'status', s.status,
      'allow_rejoin', s.allow_rejoin,
      'created_at', s.created_at, 'closed_at', s.closed_at,
      'joined', (select count(*) from mlgame.respondents r where r.study_id = s.id)
    ) order by s.created_at desc)
    from mlgame.studies s
  ), '[]'::jsonb);
end;
$$;

create function public.mlg_admin_set_allow_rejoin(p_id uuid, p_allow boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st mlgame.studies;
begin
  if not mlgame.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update mlgame.studies set allow_rejoin = coalesce(p_allow, false) where id = p_id returning * into st;
  if not found then
    raise exception 'study not found';
  end if;
  return to_jsonb(st) - 'seed';
end;
$$;

-- CREATE OR REPLACE keeps the existing grants of the two replaced functions.
revoke all on function public.mlg_admin_set_allow_rejoin(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.mlg_admin_set_allow_rejoin(uuid, boolean) to authenticated;
