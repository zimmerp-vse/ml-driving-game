-- ml-driving-game: fewer hazards by default (data contract v08, ranges v04).
--
-- The dry run (study 5LN8YG, 205 rounds, 176 counted) came out at an accident share of 0.64
-- overall and 0.53 after the fairer hitboxes went live, against a target of 0.3 to 0.5. Cars
-- caused 83 % of the crashes after the fix, so all three spawn rates drop to 80 % of ranges v03.
--
-- The spawner refuses to place a hazard within 10 segments of another, so it saturates: at
-- ranges v03 a trip holds about 4.3 hazards, and at v04 about 3.8. Two estimates of the new
-- accident share: 0.48 (counting hazards) and 0.43 (a logistic fit on the dry run).
--
-- The time limit is unchanged. A delivered round uses a median of 57 % of it, so it rarely
-- binds; shortening it would not make rounds shorter, it would only turn slow rounds into
-- timeouts, which are dropped from the class files.
--
-- NEW studies only; existing studies keep their stored parameters.
-- Safe to run once in the SQL editor of the shared project; touches only mlgame objects.

create or replace function mlgame.default_params() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'test_rounds', 5,
    'min_rounds', 10,
    'scene_count', 10,
    'ranges', jsonb_build_object(
      'trip_seconds',    jsonb_build_object('min', 13,     'max', 33,    'scale', 'linear'),
      'car_rate',        jsonb_build_object('min', 0.008,  'max', 0.072, 'scale', 'linear'),
      'obstacle_rate',   jsonb_build_object('min', 0.0016, 'max', 0.012, 'scale', 'linear'),
      'pedestrian_rate', jsonb_build_object('min', 0.0008, 'max', 0.008, 'scale', 'linear')
    ),
    'fixed', jsonb_build_object('malfunctionProbability', 0, 'deliveryDistance', 200)
  );
$$;
