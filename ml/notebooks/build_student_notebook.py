"""Builds driving_task.ipynb: the students' notebook for the driving study.

Short on purpose (Pavel, 13.11.2026): the task, the data, a template for the predictions file,
how to submit, and an open question. No modelling help. Student-facing text: plain English for
non-native readers, no en dashes, em dashes or Unicode minus signs.

    python3 ml/notebooks/build_student_notebook.py
"""

from pathlib import Path

import nbformat as nbf

nb = nbf.v4.new_notebook()
nb.metadata.kernelspec = {"display_name": "Python 3", "language": "python", "name": "python3"}
cells = []


def md(text):
    cells.append(nbf.v4.new_markdown_cell(text.strip("\n")))


def code(text):
    cells.append(nbf.v4.new_code_cell(text.strip("\n")))


md("""
# Driving study: predict the accidents

You played the delivery game. Every round had its own conditions, chosen at random by the server:
the time limit, the amount of traffic, obstacles and pedestrians, and the scene. Some rounds ended
with a delivery, some with an accident.

## Your task

For every round in `game_test.csv`, predict **the probability of an accident** (a number between 0
and 1). Your teacher scores the predictions with **log loss**:

$$\\text{log loss} = -\\frac{1}{n} \\sum_i \\big( y_i \\log p_i + (1 - y_i) \\log(1 - p_i) \\big)$$

Lower is better. Log loss punishes confident mistakes very hard: a round you predict with
p = 0.01 that ends in an accident costs as much as about 13 rounds predicted with p = 0.3 that were
right. So be careful with probabilities close to 0 or 1.

You will not see your score in the app. The results come later, in the teacher's report.

## What you hand in

1. **Your predictions**: a file `round_id,p`, uploaded on the team page (see the end of this notebook).
2. **Explain and share**: how your model works, and anything interesting you found in the data.
""")

md("""
## The data

Download `game_train.csv` and `game_test.csv` from the team page. Every row is one round.

| column | meaning |
|---|---|
| `round_id` | id of the round |
| `player` | the nick of the player |
| `sex` | `F`, `M`, or empty ("I'd rather not say") |
| `age` | age in years, or empty |
| `device` | `touch` (phone or tablet) or `keyboard` (computer) |
| `country` | country the player connected from, or empty |
| `attempt` | the round's number in the player's game: 1, 2, 3, ... Gaps are rounds that ran out of time or were interrupted (they are not in the files). |
| `trip_seconds` | the time limit of the delivery |
| `car_rate`, `obstacle_rate`, `pedestrian_rate` | how much traffic, how many obstacles and pedestrians appeared |
| `scene` | the landscape of the round |
| `accident` | **the target**: 1 = crash, 0 = delivered. Only in `game_train.csv`. |

**How the files were split.** Every player played as long as they liked. For each player with at
least 10 counted rounds, their **last 5 rounds** are in `game_test.csv`; all their earlier rounds are
in `game_train.csv`. Players with fewer rounds are only in `game_train.csv`. So you predict the
**later** rounds of players you already know from the training file.
""")

code("""
import pandas as pd
import numpy as np

# In Google Colab: upload the two files with the file picker.
try:
    from google.colab import files
    uploaded = files.upload()
except ImportError:
    pass  # not in Colab: put the two files next to this notebook

train = pd.read_csv('game_train.csv')
test = pd.read_csv('game_test.csv')
print(f'game_train.csv: {len(train)} rounds of {train.player.nunique()} players')
print(f'game_test.csv:  {len(test)} rounds of {test.player.nunique()} players')
train.head()
""")

md("""
## Your work

Explore the data, build your model, and check it honestly before you trust it. Add as many cells
as you need here.
""")

code("""
# Your code here.
""")

md("""
## The predictions file

Put your predictions into `p` below. The template uses one probability for everybody (the share of
accidents in the training file), so it runs as it is; replace it with your model's predictions.
""")

code("""
# Replace this line with your model's predictions for the rows of `test`, in the same order.
p = np.full(len(test), train.accident.mean())

submission = pd.DataFrame({'round_id': test.round_id, 'p': p})


def check_submission(sub, test):
    \"\"\"The checks the team page makes, so you can fix problems before you upload.\"\"\"
    problems = []
    if list(sub.columns) != ['round_id', 'p']:
        problems.append('The columns must be exactly round_id, p.')
    if sub.round_id.duplicated().any():
        problems.append('Some round_id values appear more than once.')
    missing = set(test.round_id) - set(sub.round_id)
    extra = set(sub.round_id) - set(test.round_id)
    if missing:
        problems.append(f'{len(missing)} rounds of game_test.csv are missing.')
    if extra:
        problems.append(f'{len(extra)} round_id values are not in game_test.csv.')
    p = pd.to_numeric(sub.p, errors='coerce')
    if p.isna().any() or (p < 0).any() or (p > 1).any():
        problems.append('Every p must be a number from 0 to 1.')
    elif ((p == 0) | (p == 1)).all():
        problems.append('Every p is 0 or 1: these look like labels, not probabilities.')
    elif ((p == 0) | (p == 1)).any():
        print('Note: some p are exactly 0 or 1. They are accepted, but for scoring p is kept '
              'between 0.001 and 0.999. One wrong 0 or 1 costs a lot.')
    return problems


problems = check_submission(submission, test)
if problems:
    print('Please fix:')
    for x in problems:
        print(' *', x)
else:
    submission.to_csv('predictions.csv', index=False)
    print(f'OK: predictions.csv written, {len(submission)} rows.')
    try:
        files.download('predictions.csv')  # Colab: save the file to your computer
    except NameError:
        pass
""")

md("""
## How to submit

1. Open the **team page**: the address your teacher gives you, ending in `/submit`.
2. Choose a **team name** and a **4-digit PIN**. The first upload sets the PIN; later uploads of
   your team need the same name and PIN.
3. Upload `predictions.csv`. The page tells you at once if the file is accepted, and if not, why.
4. You can upload again as often as you like. **Your last accepted file counts.**
5. If the teacher releases new data, download both files again and upload new predictions:
   predictions for older data no longer count.

You will not see a score. The results come in the teacher's report.
""")

md("""
## Explain and share

Write a few sentences here (or as your teacher asks):

* **Your model**: what goes into it, and why you trust it.
* **Insights**: what makes accidents more likely, who drives better, anything that surprised you
  in the data.

*Your answer here.*
""")

nb.cells = cells
out = Path(__file__).with_name('driving_task.ipynb')
nbf.write(nb, out)
print(f'wrote {out}')
