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
-- The time limit narrows to 17 to 24 s. Across both studies on the finished game, 41 deliveries
-- by 4 players took a median of 13.2 s and never more than 14.5 s, and the slowest delivery ever
-- recorded on a phone (older build) was 16.4 s. So 17 s fails nobody who drives, while a crawl at
-- half pace (about 26 s) now fails at every limit in the range. This is also the first setting in
-- which the limit binds at all: until now it had no measurable effect on crashes because a
-- delivered round used only about 57 % of it.
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
      'trip_seconds',    jsonb_build_object('min', 17,     'max', 24,    'scale', 'linear'),
      'car_rate',        jsonb_build_object('min', 0.005,  'max', 0.19,  'scale', 'log'),
      'obstacle_rate',   jsonb_build_object('min', 0.0009, 'max', 0.032, 'scale', 'log'),
      'pedestrian_rate', jsonb_build_object('min', 0.0006, 'max', 0.020, 'scale', 'log')
    ),
    'fixed', jsonb_build_object('malfunctionProbability', 0, 'deliveryDistance', 200)
  );
$$;
