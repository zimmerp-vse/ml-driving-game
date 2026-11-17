# Running the block: step by step

For the teacher and the teaching assistants. Everything here is done in the app at
`https://ml-driving-game.vercel.app`. You need an admin account (see `SETUP.md`, step 5).

Shape of a 90 minute block. Adjust the middle part to the time you have.

| when | what |
|---|---|
| 0:00 to 0:10 | students join and start driving |
| 0:10 to 0:25 | everyone plays |
| 0:25 to 0:30 | release the data, open submissions |
| 0:30 to 1:20 | teams build their models and upload |
| 1:20 to 1:30 | report on the projector, debrief |

---

## A. The day before

1. **Admin accounts for the TAs.** `SETUP.md`, step 5. Each TA signs in once at
   `/admin` beforehand, so nobody discovers a password problem in front of the class.
2. **Create the study.** `/admin`, fill in the title (for example "ML2 block 6, 19.11.2026"),
   leave the consent line as it is, **Create study**. Leave **Replay** off for a real class.
3. **Test it yourself.** Click **Open**, open the join link on your phone, join with a throwaway
   nick, play two rounds, press **Menu** then **I'm done**. Check that your rounds appear in
   **Live progress**. Then **delete that study** and create a fresh one for the class, so the
   class data has no test players in it.
4. **Check the room.** The projector shows `/screen/<CODE>`, and the QR code has to be readable
   from the back row. Wi-fi for 30 phones.

## B. Setup, 5 minutes before

1. `/admin`, open the study you made, click **Open** if it is not open yet.
2. Projector: the **QR screen** link on the study page, full screen (F11, or Ctrl+Cmd+F on a Mac).
3. Keep the **study page** open on your own laptop. It refreshes every 5 seconds.

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

Say the bit about the horn to everybody. Phone players see a HONK button, laptop players see
nothing, so without a word from you only half the room knows the horn exists.

**While they play**, watch the four counters on the study page:

* **Joined** should match the room within a minute or two.
* **Playing** is who has done something in the last 3 minutes.
* **10+ counted rounds** is who will be in the test file. Wait for most of the room to reach this.
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

* Nothing to do in the app. Do not release again unless you mean to: a new release replaces the
  files, and every team has to download and upload again.
* Common questions are at the end of this file.
* About 10 minutes before the end, make a **running report** so the leaderboard is ready, and say
  "last uploads now".

## F. Results and debrief (about 10 minutes)

1. Study page, **Reports**, **Make running report**, then **Show**. Full screen on the projector.
2. Walk through it: participation, the learning curve, accidents by device, the uploads, and the
   leaderboard with its intervals. The two reference rows matter: beating "one p for everybody" is
   easy, beating "the player's own rate" is the real test.
3. When the last upload is in: **Close** the study. That closes submissions and makes the
   **final report**.
4. **Download** the final report. It stays readable after the study is deleted.

## G. Afterwards

On the study page, download and keep:

* **Files ↓** of the release: `game_train.csv`, `game_test.csv`, `game_labels.csv`
* **Raw file (all rounds) ↓**
* **Submissions (all teams) ↓**

Those three feed the teacher's notebook, which has the analysis for the debrief and the
submission checks. Delete the study when you no longer need it.

---

## Questions you will be asked

**"It says the nick is taken."** Somebody used it. Pick another one.

**"I joined twice by accident."** Harmless. The second nick is a separate player with few rounds,
and the release leaves players with too few rounds out of the test file.

**"Nothing happens when I press the arrows."** Click once on the game first, the keyboard has to
be in it. On the laptop the game needs the browser window focused.

**"There is no sound."** Tap or press a key once inside the game. Browsers do not let a page play
sound before that.

**"The screen is just sky"** or the game looks stretched. Reload the page. The round in progress
is lost, the rest is kept.

**"I closed the tab."** Open the join link again. The same browser resumes the same player, so
nothing is lost. A different browser or a private window starts a new player.

**"Can I play again after I'm done?"** Not in a real class. (That is what **Replay** is for in test
studies.)

**"Our file was rejected."** The page says why. The usual causes are a decimal comma, a missing
header `round_id,p`, missing rounds, or predicting every row as 0 or 1.

**"We cannot upload any more."** 20 uploads per team per hour, wrong PINs included. Wait, or use a
different team name and tell your TA.

**"We forgot our PIN."** Use a new team name. The old uploads stay but will not be the team's last
accepted file.

**A student has no phone or laptop.** Let them pair with somebody, or play a few rounds on your
machine under their own nick. Fewer players costs more than a shared device.

**You released too early.** Let them play on and release again. The latest release is the one that
counts; teams download and upload again.

**The projector shows "Unknown study code".** The code is wrong, or the study was deleted. Check
the address on the study page.
