-- ml-driving-game: an easier game by default (data contract v06, ranges v03).
--
-- Pavel found the shorter rounds too hard (more crashes than deliveries). The shorter road
-- (deliveryDistance 200) and the shorter time limit (13 to 33 s) stay; the spawn rates go back
-- to v01, so hazards are as far apart as in the original game and a round meets about a third
-- fewer of them. NEW studies only; existing studies keep their stored parameters.
--
-- Safe to run once in the SQL editor of the shared project; touches only mlgame objects.

create or replace function mlgame.default_params() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'training_seconds', 600,
    'max_training_rounds', null,
    'test_rounds', 5,
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
