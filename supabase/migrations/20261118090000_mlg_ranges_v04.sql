-- ml-driving-game: ranges v04, drawn on a log scale (data contract v08).
--
-- Two problems from the dry run (study 5LN8YG, 205 rounds, 176 counted):
--
--   1. Too hard. The accident share was 0.64 overall and 0.53 after the fairer hitboxes, against
--      a target of 0.3 to 0.5.
--   2. The conditions barely mattered. A model that knew them perfectly could explain only about
--      3 % of whether a round ended in a crash, so the main feature of the task was weak.
--
-- Both come from the same place. The spawner refuses to place a hazard within 10 segments of
-- another, so it saturates: over the whole of ranges v03 a trip held between 2 and 5.5 hazards,
-- and no uniform range could stretch that much further, because with a uniform draw the average
-- is the midpoint, and holding the average down holds the top down with it.
--
-- v04 therefore draws the three spawn rates on a LOG scale. The band runs lower AND much higher
-- than v03 (cars 0.005 to 0.19 against 0.01 to 0.09) while the average rate stays about where it
-- was, because a log draw puts most rounds below its mean. Simulated against the dry run:
--
--                       accident share   risk of a round   conditions explain
--   v03 as played            0.42           0.28 to 0.51          2.7 %
--   v04 (this file)          0.36           0.14 to 0.59          9.4 %
--
-- The time limit narrows to 18 to 28 s. At 13 s a good driver timed out one round in three, and
-- those rounds are dropped from the class files; at 33 s a player could crawl and still deliver,
-- which is dull and teaches the wrong habit. A delivered round takes about 13 s, so 18 s is
-- brisk-but-fair and 28 s is comfortable without allowing a crawl.
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
      'trip_seconds',    jsonb_build_object('min', 18,     'max', 28,    'scale', 'linear'),
      'car_rate',        jsonb_build_object('min', 0.005,  'max', 0.19,  'scale', 'log'),
      'obstacle_rate',   jsonb_build_object('min', 0.0009, 'max', 0.032, 'scale', 'log'),
      'pedestrian_rate', jsonb_build_object('min', 0.0006, 'max', 0.020, 'scale', 'log')
    ),
    'fixed', jsonb_build_object('malfunctionProbability', 0, 'deliveryDistance', 200)
  );
$$;
