# Driving study: the task

You played the delivery game. Every round had its own conditions, drawn at random by the server
before the round started: the time limit, how much traffic, how many obstacles and pedestrians,
and the scene. Some rounds ended with a delivery, some with an accident.

Download two files from the team page: `game_train.csv` and `game_test.csv`.

## What you hand in

**Predict the probability of an accident for every round in `game_test.csv`.** A number between 0
and 1 for each round. How you do it is up to you, including any features you build from the
columns you were given.

Upload a CSV file with the header `round_id,p` and one row per test round.

## How you are scored

**Log loss**, the mean of

$$-\big( y \log p + (1 - y) \log(1 - p) \big)$$

over the test rounds, where `y` is 1 for an accident and 0 for a delivery. Lower is better.

Log loss punishes a confident mistake very hard. A round you predict at 0.01 that ends in a crash
costs you as much as about thirteen rounds predicted at 0.3 that were right. **Never predict
exactly 0 or 1.** For scoring, p is kept between 0.001 and 0.999.

You will not see your score in the app. The results come later, in your teacher's report.

## The data

One row per round. `game_test.csv` has the same columns as `game_train.csv` except `accident`.

| column | meaning |
|---|---|
| `round_id` | id of the round, the key for your predictions |
| `player` | the nick of the player |
| `sex` | `F`, `M`, or empty |
| `age` | age in years, or empty |
| `device` | `touch` for a phone or tablet, `keyboard` for a computer |
| `country` | two-letter country code, or empty |
| `attempt` | the round's number in that player's game: 1, 2, 3, ... Gaps are rounds that ran out of time or were interrupted; they are in neither file. |
| `trip_seconds` | the time limit of the delivery |
| `car_rate`, `obstacle_rate`, `pedestrian_rate` | how much traffic, how many obstacles and pedestrians the round was set to produce |
| `scene` | the landscape |
| `accident` | **the target**: 1 for a crash, 0 for a delivery. Only in `game_train.csv`. |

**How the two files were split.** Everyone played as long as they liked. For each player with at
least 10 counted rounds, their **last 5 rounds** are in `game_test.csv` and all their earlier
rounds are in `game_train.csv`. Players with fewer rounds are only in `game_train.csv`. So you are
predicting the **later** rounds of players you already know from the training file.

## The file you upload

```python
import pandas as pd, numpy as np

test = pd.read_csv('game_test.csv')
p = ...                                    # your predictions, in the order of test

sub = pd.DataFrame({'round_id': test.round_id, 'p': np.clip(p, 0.001, 0.999)})
assert list(sub.columns) == ['round_id', 'p']
assert not sub.round_id.duplicated().any()
assert set(sub.round_id) == set(test.round_id)
assert sub.p.between(0, 1).all()
sub.to_csv('predictions.csv', index=False)
```

Then open the team page, the address ending in `/submit`:

1. Choose a **team name** and a **4-digit PIN**. The first upload sets the PIN; later uploads by
   your team need the same name and PIN.
2. Upload `predictions.csv`. The page tells you at once whether it was accepted, and if not, why.
3. Upload as often as you like. **Your last accepted file counts.**

A file is rejected for a decimal comma, a missing or wrong header, missing rounds, rounds that are
not in `game_test.csv`, or predictions that are all 0 and 1.

## Optional

Do these only when your predictions are in.

1. **Who crashes more?** Pick one thing about the players (sex, age, device, something about their
   nick) and work out whether it goes with crashing more. Say how sure you are, and why.
2. **To discuss.** Suppose you add the `player` column to your model as a feature. It will probably
   help. Now you are asked: *do men crash more than women?* Can your model answer that question?
   What would you need instead, and what does that tell you about the difference between predicting
   well and explaining something?

## What to say about your work

Besides the predictions, be ready to say briefly:

* what goes into your model, and why you trust it;
* anything interesting you found in the data.
