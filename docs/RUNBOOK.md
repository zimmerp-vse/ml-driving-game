# Running the block: step by step

Manual for the teacher and the teaching assistants. Everything is done in the app at
`https://ml-driving-game.vercel.app`, and you need an admin account (`SETUP.md`, step 5).

## Never give these to students

| file | why |
|---|---|
| **`game_labels.csv`** | **the answers.** It is the outcome of every test round. A team holding it scores perfectly and the exercise is over. |
| `game_raw_<CODE>.csv` | every round of every player, with the outcome, the timings and the money |
| `submissions_<CODE>.csv` | every other team's predictions |
| the teacher's notebook | the worked solution |

**You never hand students any data file at all.** They download `game_train.csv` and
`game_test.csv` themselves, from the team page, and the app only ever serves those two. The labels
exist only in the admin's browser, in the report, and in whatever you download onto your own
laptop. If a student asks for a file, the answer is always "it is on the team page".

Anything you download from the Reports box is for you alone. Do not put it in a shared folder, in
Teams, or on the projector.

## What students get, and when

| when | what they get | how |
|---|---|---|
| start of the block | the join address | the QR code on the projector |
| after the release | the team page address, ending in `/submit` | on the projector |
| after the release | the task | the brief (`docs/student_brief.md`, or the Word version) |
| after the release | `game_train.csv` and `game_test.csv` | they download them from the team page |
| at the end | the leaderboard and the charts | the report on the projector |

## Who does what

* **The teacher** drives the study page: opens the study, makes the release, opens submissions,
  makes the report, closes the study. One person on one laptop, so that two people never release
  at the same time.
* **The TAs** work the room: help people join, answer the questions at the end of this file, watch
  for anyone stuck, and chase the quiet ones to keep playing until they have 10 rounds.

## Shape of a 90 minute block

| when | what |
|---|---|
| 0:00 to 0:10 | students join and start driving |
| 0:10 to 0:25 | everyone plays |
| 0:25 to 0:30 | release the data, open submissions, hand out the brief |
| 0:30 to 1:20 | teams build their models and upload |
| 1:20 to 1:30 | report on the projector, debrief |

---

## A. The day before

1. **Admin accounts for the TAs.** `SETUP.md`, step 5. Each TA signs in once at `/admin`
   beforehand, so nobody discovers a password problem in front of the class.
2. **Create the study.** `/admin`, fill in the title (for example "ML2 block 6, 19.11.2026"),
   leave the consent line as it is, **Create study**. Leave **Replay** off for a real class.
3. **Test it.** Click **Open**, open the join link on your phone, join with a throwaway nick, play
   two rounds, press **Menu** then **I'm done**. Check that your rounds appear in **Live
   progress**. Then create a **separate study for the class**: each study keeps its own players,
   rounds and files, so nothing done in a test study can reach the class data. Close or delete the
   test study all the same, so that nobody scans yesterday's QR code and you never have two
   similar studies open at once.
4. **Check the room.** The projector shows `/screen/<CODE>`, and the QR code has to be readable
   from the back row. Wi-fi for 30 phones.
5. **Have the brief ready to send**, but do not send it yet. Students do not need it until the
   data is released, and reading it beforehand tells them what the data will be used for. Not
   knowing is what keeps anyone from driving strategically, and it is one of the points of the
   debrief.

## B. Setup, 5 minutes before

1. `/admin`, open the study, click **Open** if it is not open yet.
2. Projector: the **QR screen** link on the study page, full screen (F11, or Ctrl+Cmd+F on a Mac).
3. Keep the **study page** open on the teacher's laptop. It refreshes every 5 seconds.
4. Remember the one thing you must say out loud: **the horn**. Nothing in the app tells laptop
   players it exists, so if you forget, only the phone users will use it and the device column in
   the data will carry the difference.

## C. Students join and play (about 25 minutes)

**What to say, in this order:**

> Scan the code. Pick a nick that is not your real name, your classmates will see it. Then just
> drive: deliver the package in time and try not to crash. There is no score to chase.
>
> Two things worth knowing. The **horn** (space bar, or the HONK button on a phone) scares
> pedestrians out of the way while you hold it. And every round is different: the time limit, the
> traffic, the obstacles and the pedestrians change every single time.
>
> Play as long as you like. After every round you can press **Menu** to see how you are doing and
> to stop. Please play **at least 10 rounds** if you can, otherwise your rounds are less useful.
> When you have had enough, press **I'm done**.

**Do not say yet what the data will be used for.** Once people know they are producing a
prediction task, some of them drive differently, and that is exactly the bias this exercise is
free of.

**While they play**, watch the four counters on the study page:

* **Joined** should match the room within a minute or two.
* **Playing** is who has done something in the last 3 minutes.
* **10+ counted rounds** is who will be in the test file. This is the one that matters, and it is
  what the TAs should chase.
* **Done** is who pressed the button. It will never reach everybody, which is fine.

**When to stop:** when **10+ counted rounds** stops rising, usually after 12 to 15 minutes. Then
say: "last round, then press Menu and I'm done."

## D. Release the data (about 5 minutes)

1. Study page, **Data releases**, **Prepare a release**.
2. Leave the settings as they are: the test is each player's **last 5 counted rounds**, for
   players with at least **10**. Read the preview out loud, it is a good moment to explain the
   split: so many players in the test file, so many rows in each file, the accident share, and the
   learning curve.
3. **Release to students.** This also turns on the switch that lets them download the files.
4. Tick **Submissions open**.
5. Put the team page address on the projector: `<site>/s/<CODE>/submit`.
6. **Now** send the brief.

**What to say:**

> The training file has your rounds with the outcome. The test file is the last five rounds of
> everyone who played enough, without the outcome. Predict the probability of an accident for each
> of those rounds. You are scored by log loss, so a confident mistake is expensive: never predict
> exactly 0 or 1.
>
> Upload on the team page with a team name and a four digit PIN. You can upload as often as you
> like, the last accepted file counts, and you will not see a score. Besides the predictions, be
> ready to say how your model works and anything interesting you found.

## E. While the teams work

* Nothing to do in the app. **Do not release again** unless you mean to: a new release replaces
  the files, and every team then has to download and upload again.
* TAs: the questions at the end of this file cover almost everything that comes up.
* About 10 minutes before the end, make a **running report** so the leaderboard is ready, and say
  "last uploads now".

## F. Results and debrief (about 10 minutes)

1. Study page, **Reports**, **Make running report**, then **Show**. Full screen on the projector.
2. Walk through it: participation, the learning curve, accidents by device, the uploads, and the
   leaderboard with its intervals. The two reference rows matter: beating "one p for everybody" is
   easy, beating "each player's own individual rate" is the real test.
3. If the intervals overlap, say so. "We cannot tell these teams apart" is a better lesson than a
   winner picked out of noise.
4. When the last upload is in: **Close** the study. That closes submissions and makes the
   **final report**.
5. **Download** the final report. It stays readable after the study is deleted.

## G. Afterwards (teacher only)

On the study page, download and keep:

* the release files: **train ↓**, **test ↓**, **labels ↓**
* **Raw file (all rounds) ↓**
* **Submissions (all teams) ↓**

Three of those are teacher only: the labels, the raw file and the submissions. They feed the
teacher's notebook, which holds the analysis for the debrief and the checks on the submissions.

Delete the study when you no longer need it.

---

## Questions you will be asked

**"Can you send us the data?"** No. It is on the team page, and that is the only place it comes
from. The answers are never given out at all.

**"It says the nick is taken."** Somebody used it. Pick another one.

**"I joined twice by accident."** Harmless. The second nick is a separate player with few rounds,
and the release leaves players with too few rounds out of the test file.

**"Nothing happens when I press the arrows."** Click once on the game first, the keyboard has to
be in it. On a laptop the game needs the browser window focused.

**"There is no sound."** Tap or press a key once inside the game. Browsers do not let a page play
sound before that.

**"The screen is just sky"** or the game looks stretched. Reload the page. The round in progress
is lost, the rest is kept.

**"I closed the tab."** Open the join link again. The same browser resumes the same player, so
nothing is lost. A different browser or a private window starts a new player.

**"Can I play again after I'm done?"** Not in a real class. (That is what **Replay** is for in
test studies.)

**"What do we actually upload?"** A new file with two columns, `round_id` and `p`, one row per
test round. Not `game_test.csv` with a column added. The brief shows it.

**"Our file was rejected."** The page says why. The usual causes are a decimal comma, a missing
header `round_id,p`, missing rounds, or predicting every row as 0 or 1.

**"We cannot upload any more."** 20 uploads per team per hour, wrong PINs included. Wait, or use a
different team name and tell your TA.

**"We forgot our PIN."** Use a new team name. The old uploads stay but will not be the team's last
accepted file.

**The team page says "Submissions are closed" although you ticked the switch.** The study itself
is closed, which is a different thing: click **Open** on the study page first, then tick
**Submissions open** again, because closing a study clears it.

**A student has no phone or laptop.** Let them pair with somebody, or play a few rounds on your
machine under their own nick. Fewer players costs more than a shared device.

**You released too early.** Let them play on and release again. The latest release is the one that
counts; teams download and upload again.

**The projector shows "Unknown study code".** The code is wrong, or the study was deleted. Check
the address on the study page.
