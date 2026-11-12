-- ml-driving-game: Replay studies give a taken nick a suffix.
--
-- With Replay on (test studies), joining with a nick that is already taken in the study no
-- longer fails: the player gets the nick with _2, _3, ... added (cut so it fits 20 characters),
-- and the start screen shows the name they play as. With Replay off (class), a taken nick is
-- refused as before. The join answer also returns the nick that was stored.
--
-- Safe to run once in the SQL editor of the shared project; touches only mlgame / mlg_* objects.
-- CREATE OR REPLACE keeps the function's grants (service_role only).

create or replace function public.mlg_join_study(
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

  -- Replay on (test studies): a taken nick gets a suffix, _2, _3, ..., cut to fit 20 characters.
  -- Replay off (class): a taken nick is refused, as before.
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
      (st.id, nick, lower(nick), p_sex, p_age, p_device, ctry,
       least(greatest(p_viewport_width, 0), 10000), least(greatest(p_viewport_height, 0), 10000),
       mlgame.hash_token(token))
    returning id into rid;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'nick_taken');
  end;

  return jsonb_build_object('ok', true, 'respondent_id', rid, 'token', token, 'nick', nick);
end;
$$;
