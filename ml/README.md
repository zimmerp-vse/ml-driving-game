# ml/: synthetic data and file checks

Tools for the data side of a class (data contract sections 4 and 7). Python 3.9+ with numpy.

## `synth.py`: a synthetic class

Writes the four class files for an invented class, with the same columns, rules and number
formats as a release in the app (a test, `tests/synth-export.test.ts`, loads a synthetic class
into the app's database code, makes a release with the same settings and checks that the app
exports exactly the same four files):

```bash
python3 ml/synth.py --out synth/ --players 30
python3 ml/synth.py --out synth/ --params study_params.json --target-share 0.35
python3 ml/synth.py --out synth/ --class-minutes 12
```

Free play (contract v07): each invented player has their own patience (median 6 minutes), some
stop at the check-in after 10 or 20 rounds, a few leave early or never press "I'm done", and the
teacher closes the study after `--class-minutes` (default 15). Then the data is released with the
study's `test_rounds` and `min_rounds` (defaults 5 and 10): each player's last 5 counted rounds
are the test, for players with at least 10. The release's cutoff and settings are in
`synth_model_<CODE>.json`.

| file | for |
|---|---|
| `game_train.csv`, `game_test.csv` | students |
| `game_labels.csv`, `game_raw_<CODE>.csv` | teacher |
| `game_truth_<CODE>.csv` | teacher: the true accident probability of each counted round (the best possible prediction) |
| `synth_model_<CODE>.json` | teacher: seed, parameters and model, to regenerate the class |

The invented model (all in `MODEL` at the top of the file, not measured): a skill per player, a
learning curve over attempts at each player's own pace, conditions through a logistic model (more
traffic and a shorter time limit mean more accidents), a few harder scenes, a touch-screen effect,
a small sex effect; age and country carry nothing. Rounds take time, so crash-prone players fit
more training rounds into the training time. Some rounds time out, a few are interrupted by a
reload, a few players leave early. The intercept is calibrated so the accident share over counted
rounds is about `--target-share` (default 0.4).

**This repo is public.** The default seed is random and is written only into the teacher's
`synth_model_<CODE>.json`. Never use a guessable seed for data a class will be scored on, and
never commit class data (`.gitignore` keeps `synth/` and `game_*.csv` out).

## `check_files.py`: check files and summarise

```bash
python3 ml/check_files.py <folder>                        # train, test, labels
python3 ml/check_files.py <folder> --raw game_raw_ABC123.csv --min-rounds 10 --cutoff 2026-11-19T10:00:00+00:00
```

Checks columns, values, sorting, unique round ids, 5 test rows per test player after all their
training rows, labels matching the test rows, and (with `--raw`) that the files follow from the
raw file by the release rule of contract section 4.4 (with the release's `--min-rounds` and
`--cutoff`; without a cutoff, all ended rounds). Then prints what calibrating the game needs:
accident shares overall, by device, by sex and over attempts, rounds per player, players who never
or always crashed, a logistic fit of accident on the conditions, and the spread of the fitted
probabilities. Exit code 1 if a check failed.

After the dry run: run it on the downloaded files with `--raw`.

## `notebooks/`: the students' notebook

`notebooks/driving_task.ipynb` (built by `notebooks/build_student_notebook.py`): the task, the
data and the release rule, a template that writes and checks `predictions.csv` (the same checks as
the team page), how to submit, and an open "explain and share" question. No modelling help, on
purpose. Runs in Colab (file upload) or locally next to the two files.

The teacher's notebook and the solution are **not** in this public repo.
