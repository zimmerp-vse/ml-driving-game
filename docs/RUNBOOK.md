# Running the block

## Never give these to students

| file | why |
|---|---|
| **`game_labels.csv`** | **the answers.** The outcome of every test round. A team holding it scores perfectly. |
| `game_raw_<CODE>.csv` | every round of every player, with the outcome and the timings |
| `submissions_<CODE>.csv` | every other team's predictions |
| the teacher's notebook | the worked solution |

Students download `game_train.csv` and `game_test.csv` themselves, from the team page. You hand
out no data file at all. If a student asks for one, the answer is "it is on the team page".

## The links

`<CODE>` is the six-character study code, shown on the study page.

| what | address |
|---|---|
| admin | https://ml-driving-game.vercel.app/admin |
| join page, for students | https://ml-driving-game.vercel.app/s/`<CODE>` |
| QR screen, to project or print | https://ml-driving-game.vercel.app/screen/`<CODE>` |
| team page, for uploads | https://ml-driving-game.vercel.app/s/`<CODE>`/submit |

---

## Step 1. Intro deck (10 minutes)

Slides, nothing in the app. **Still to prepare.**

Do not say yet what the data will be used for. If students know they are producing a prediction
task, some will drive differently.

## Step 2. Open the study (3 minutes)

1. Go to https://ml-driving-game.vercel.app/admin and sign in.
2. **Create study**: a title, leave the consent line as it is. Leave **Replay** off.
3. Click **Open** in the list.
4. Note the six-character **code** and put it into the four links above.
5. Project or print the **QR screen**, and give students the **join page** link.

## Step 3. Students play (15 minutes)

Tell them: pick a nick that is not your real name, drive, play at least **10 rounds**, then
**Menu** and **I'm done**.

Watch the four counters on the study page. **10+ counted rounds** is the one that matters: it is
who will be in the test file.

Stop when that counter stops rising. Say "last round, then Menu and I'm done".

## Step 4. Release the data (5 minutes)

On the study page:

1. **Data releases**, **Prepare a release**.
2. Leave the settings as they are. Read the preview out loud: how many players, how many rows,
   the accident share, the learning curve.
3. **Release to students.**
4. Tick **Submissions open**.

## Step 5. Give out the task (2 minutes)

1. Send the brief (`driving_study_task.docx`).
2. Put the **team page** link on the projector.

They download `game_train.csv` and `game_test.csv` from that page themselves.

## Step 6. Teams work (50 minutes)

Nothing to do in the app. **Do not release again** unless you mean to: a new release replaces the
files and every team has to download and upload again.

Ten minutes before the end, say "last uploads now".

## Step 7. Show the results (10 minutes)

1. Study page, **Reports**, **Make running report**, then **Show**.
2. Walk through it: participation, the learning curve, accidents by device, the uploads, the
   leaderboard.
3. If the intervals overlap, say so. "We cannot tell these teams apart" beats a winner picked out
   of noise.

## Step 8. Close the study (2 minutes)

1. **Close** on the study page. This closes submissions and makes the **final report**.
2. **Download** the final report. It stays readable after the study is deleted.

## Step 9. Keep the files (teacher only)

On the study page download: **train ↓**, **test ↓**, **labels ↓**, **Raw file (all rounds) ↓**,
**Submissions (all teams) ↓**.

The labels, the raw file and the submissions never leave your laptop. They feed the teacher's
notebook.

---

## Questions you will be asked

**"Can you send us the data?"** No. It is on the team page. The answers are never given out.

**"It says the nick is taken."** Somebody used it. Pick another one.

**"I joined twice by accident."** Harmless. A player with too few rounds is left out of the test
file.

**"Nothing happens when I press the arrows."** Click once on the game first.

**"There is no sound."** Tap or press a key once inside the game.

**"The screen is just sky."** Reload the page. The round in progress is lost, the rest is kept.

**"I closed the tab."** Open the join link again in the same browser and it resumes. A different
browser starts a new player.

**"Can I play again after I'm done?"** Not in a real class.

**"What do we actually upload?"** A new file with two columns, `round_id` and `p`, one row per
test round. Not `game_test.csv` with a column added.

**"Our file was rejected."** The page says why: usually a decimal comma, a wrong header, missing
rounds, or every row predicted 0 or 1.

**"We cannot upload any more."** 20 uploads per team per hour. Wait, or use a different team name.

**"We forgot our PIN."** Use a new team name.

**The team page says "Submissions are closed" although you ticked the switch.** The study itself
is closed. Click **Open** first, then tick **Submissions open** again.

**A student has no device.** Let them pair with somebody.

**You released too early.** Let them play on and release again. The latest release counts.

**The projector shows "Unknown study code".** Wrong code, or the study was deleted.
