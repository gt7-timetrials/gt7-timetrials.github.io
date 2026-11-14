# Plan

What's next for the site and the Android app, in order. A free hobby project for GT7 time trials, daily races and
Super License tests: keep it simple, and only take on what one person can look after.

## Next up

1. **Daily races** (live since 3 November 2026): each week's three races (A, B, C) with a reference lap each, to
   record or upload against; free car choice races are flagged, so a different car gets no warning.
   - [ ] Each week: the owner sends the new races and laps (straight to main, like reference laps).
   - [x] Recording from the home laptop works (10 November): a Claude Code session on the laptop, driven remotely
         while the owner plays the replays from the PS Portal, recorded the week's races and pushed them, with last
         week's laps moved to the archive. The steps are in `CLAUDE.md`, for when the owner is away.
   - [ ] **The new name in the app** with the next app update or at the production launch: under the icon it's
         **"Laps for GT7"** (the owner, 5 November: the full name is too long for a phone's home screen; the beta app
         is "Laps beta"), while the Play listing and the website use the full name, **"Lap Companion for GT7"** (the
         owner, 4 November: "coach" claims too much). The app's own name (`app_name`, in the `.aab` on the
         android-test release already), the Play listing and the About page, all together. Superficial, so it waits
         for an update with other changes.

2. **Google Play closed test**: live since 30 October 2026 ("Time Trials for GT7", `io.github.gt7timetrials`).
   - [x] Owner: Play developer account approved.
   - [x] Privacy policy page on the website (`site/privacy.html`): the app collects nothing.
   - [x] Store listing: text, icon, feature graphic and screenshots in `docs/play-listing.md` and `docs/play/`.
   - [x] Crib sheet for the Play Console forms: in `docs/play-listing.md`.
   - [x] Play build: targets Android 16 (API 36), as Play requires for new apps. `gt7-timetrials-play.aab` is signed
         with the private upload key (GitHub secrets `UPLOAD_KEYSTORE_BASE64` and `UPLOAD_KEYSTORE_PASSWORD`) and
         published next to the test APK on the android-test release. Google re-signs it (Play App Signing).
   - [x] Closed test with the Google Group `time-trails-gt7-testers`, so testers join themselves and no email
         addresses are collected. First release approved and published on 30 October; the owner installed it from
         Play and checked recording, saving, uploading and Back.
   - [x] How to join on the website (About this app → Android app (test); the tab was called How it works), and a Reddit post asking for testers
         (https://www.reddit.com/r/granturismo/s/WTRsxSB3m2) and on GTPlanet
         (https://www.gtplanet.net/forum/threads/free-time-trial-lap-comparison-android-app.440044/), which is also
         where feedback goes, besides Play's private feedback.
   - [x] Second release (test build 16), approved and published on 31 October: keeps recording when the phone is locked or
         the player switches apps (`RecorderService`, a foreground service of type `connectedDevice`; foreground
         service form filled in with a video). Tested by the owner with the phone locked and the app in the
         background, both from the test APK and from the Play update. The "no data" messages (website and computer recorder) now also mention other telemetry apps
         such as SimHub and Sim Racing Telemetry.
   - [x] 12 testers opted in on 31 October 2026 (one joined the group but hadn't opted in at first). Countries: all.
   - [x] 18 testers opted in by 3 November 2026, 22 later that day, 24 by 4 November, while the Reddit post's new
         views had slowed to a trickle (its upvote ratio rose from about 50% to 62%).
   - [x] Keep 12+ opted in for 14 days in a row, to about **14 November 2026** (aim for a few more as a buffer). Google
         tracks this by itself: progress is on the Play Console Dashboard; nothing to trigger.
   - [x] Keep a note of tester feedback and what changed because of it: Google asks for this when applying for
         production. So far, all on the Reddit thread:
         - **likasumboooowdy (about 26 October, the first Reddit post, before the Play test):** asked whether it could
           be used for license tests ("would have helped a ton on the super licenses… I've got some tricky ones
           left"). The owner added the Super License tab with a gold-medal run for S-1 to S-9 within the week (S-10
           once unlocked); the tester: "Wow thank you!!"
         - **Worried_Bug_538, first post (2 November), after the Barcelona (Elantra) time trial:**
           - What they liked: it separates what you do from what the other driver does well, and the many sectors
             give detail; reading the parameters and section times showed where they lose time; "a really good app",
             "loved the idea".
           - What they found hard: "very advanced… people might get lost", could be more intuitive.
           - Thought each lap needed a restart ("reset the lap for it to count again").
           - Asked for automatic translation, and graphs like GT7's own telemetry.
           - What changed (owner replied, then merged 2 November): a "How to read this" guide and a How to use tab;
             the recording wording says to drive as many laps as you like with no restart; a translation note on
             About (in-app translation is planned); graphs: a speed chart (yours and the reference's) was added to
             each corner's brake and throttle charts on 5 November (#73), more to follow.
         - **Worried_Bug_538, second post:** drove four sessions at Barcelona checking the corner descriptions against
           GT7's own telemetry, and found them accurate ("slowed down 11 m before and accelerated 7 m after to the max",
           the track width at the apex); set 1:51.539. "Absolutely loved the experience." So the detail stays: the
           guide makes it easier to get into instead of cutting it.
           - Asked to compare their best and worst laps together with the WR's: each lap is compared with the WR
             today, with ‹ › to step through laps on a corner; showing several laps at once is planned (item 6).
           - Assumed the app wouldn't update during the test, then asked how to update: the owner told them about the
             new version and linked the Play page with its Update button.
         - **Worried_Bug_538, third post (8 November), after the update post, using the audio cues:** asked what the
           black line that appears from time to time means, what the colours from more to less intense mean, and what
           the two sounds before the "whistle" are ("the whistle is the peak of the curves, right?").
           - The owner replied with screenshots: the brake cue is tock, tock, BEEP, the BEEP where the reference
             brakes and the tocks to give time to react; the "whistle" is the gas chirp, 0.5 s before the reference
             gets back on the throttle (near the apex, not at it); the lift cue is for no gas and no brake; each can
             be heard on the Audio cues tab. The map's colours: green within 3% of the reference's time through a
             section, yellow 3–5%, red more than 5%. The close-ups: the line width is how much brake or throttle,
             yours and the reference's; the dots are your line against the reference's grey line, filled red for
             more brake than the reference and hollow for less, blue the same for the gas.
           - Their answer: the black line at the start of section 3, and a lighter green next to more intense ones
             when everything is green. These are the map's short dark bands, drawn where you lift off the throttle or
             brake while the reference stays flat out (that section's "Lift" tip says how much), and the map fading
             the other sections to about half while one corner is selected. Neither is in the map's legend: worth
             adding both, and on the Audio cues tab when each sound plays (the gas chirp read as the apex).
         - **HomeworkBoth9844 (3 November):** "looks really great", and asked whether daily races could be added. The
           owner first thought reference laps were hard to get for races; the tester pointed out that each daily race
           quickly gets a world's best time whose replay can be downloaded, like a time trial's. The owner agreed, and
           the Daily races tab went live the same day with all three races (A one car, B and C free choice of Gr.3 and
           Gr.4, using the new free car choice flag); the tester said they'd try the app soon.
   - [x] Before production: lead the Play listing and posts with what the app does: **easy and convenient**,
         for time trials, daily races and licenses. Keep it neutral about who it's for (no "for beginners" or "for
         experts"): people can decide for themselves. The others: GT7's own Data Logger (since November
         2025: laps compared as graphs), Coach Dave Delta (paid, needs a PC), GT Coach (voice coaching with a braking
         countdown, needs a PC or Mac), Backmarker (braking drills with audio cues), Pit Crew Hub, Traces,
         GoTelemetry and dashboards: mostly graphs, and most need a PC or more setup. Audio braking cues aren't unique, so
         don't claim they are. This app's case: just your phone, no setup; a reference lap ready every week for the
         time trials, daily races and license tests; tips in plain words; braking cues calibrated to your speaker or
         headphones; free and private. A line to start from: "The easy way to get faster at GT7 time trials, daily
         races and licenses. Just your phone: a reference lap ready every week, tips in plain words, and audio cues
         for the braking points." For new features: keep the main view simple; more detailed features (graphs,
         comparing several laps) are welcome as long as they don't crowd it. Update `docs/play-listing.md` (short and full
         description) and the production questionnaire's answers. Done 14 November: the new short and full
         description are in `docs/play-listing.md`, to go on the listing with the release.
   - [x] **Applied for production on 14 November 2026**, after the 14 days with 12+ testers. The answers (each at
         most 300 characters) are in `docs/play-listing.md`. Google's review takes up to about a week.
   - [ ] When approved: create a production release with test build 34 (`gt7-timetrials-play.aab` on the
         android-test release: the name "Laps for GT7" under the icon), and at the same time rename the listing
         **Lap Companion for GT7** and paste the new short and full description.
   - [ ] Then the launch post on r/granturismo (and GTPlanet), and after that about one post a month.

   Website changes (including reference laps) reach the app straight away. Only changes to the app's own code
   (`android/`) need a new `.aab` uploaded to the Play Console; each build's version number goes up by itself.

3. **More graphs like GT7's own telemetry** (a tester asked for them): the owner is looking at what GT7 shows to decide
   what else is worth adding. Owner, 5 November: wait for feedback; no whole-lap view (a lap trace means watching it
   through and is easily forgotten), the corner-by-corner view stays the way in: an overall picture you can click
   through and take in. Candidates if asked for: gear or revs under the speed chart, steering.

4. **Line feedback** (going wide, missing the apex, not using the track at the exit). The close-ups already draw both
   lines; the tips say little about the line itself.
   - Thresholds: how far from the reference line counts as a real difference, given the telemetry's accuracy (the
     position is the car's centre, and the track edges aren't in the data), and the line's effect on time, so only
     differences that cost time are mentioned.
   - Why the line differs: understeer (running wide on entry or mid-corner with the steering wound on, speed too high
     for the grip) or oversteer (the rear stepping out on exit, corrections, throttle lifted), which make the
     reference's line hard to follow. Advice on the cause rather than the line: for example brake earlier or turn in
     slower for understeer, smoother throttle on exit for oversteer. Needs steering and yaw (or speed against
     steering) from the telemetry, compared with the reference's at the same point.

5. **Turn-in inputs and wheel spin (pushing too hard)** (owner, 10 November). Two things the tips don't cover yet:
   - **Turn-in:** how you steer into the corner compared with the reference: how quickly the steering winds on, how
     much lock at turn-in and at the apex, and how the brake comes off as the steering goes on (trail braking).
     Turning in too sharply or with too much lock scrubs speed and pushes the car wide (understeer). The recordings
     already have the steering angle and the yaw rate (how fast the car turns). The angle depends on each player's
     controller or wheel settings (the site already says so), so compare its shape and timing rather than its size,
     or the car's response (yaw rate for the steering), and against the player's own laps where that's fairer.
   - **Agreed for turn-in (owner, 14 November):** a **T** badge for turn-in on the line close-up, in each lap's colour
     like the B (first brake) badge; turn-in is where the steering reaches about 10% of the corner's peak (today's
     tips use 30%, well into the turn); and a **steering chart** after throttle and before speed (brake, throttle,
     steering, speed, time gap), in degrees of steering wheel turn, clockwise (right) up, yours and the reference's,
     with the T marks. Free choice events in another car: shown with a note (each car has its own steering lock).
   - **Recordings without steering** (Blue Moon Bay's and Fuji's references, both Calster_25's): not the controller.
     Steering is only in GT7's newer packet format ("B"); the recorders ask for it first, but if nothing answers
     within 3 s they fall back to the older format ("A") and keep it for the whole recording. So a slow start loses
     the steering. Fix (computer recorder and app): after "A" answers, try "B" again before settling.
   - **Wheel spin:** the driven wheels turning faster than the car is moving on the exit (the recordings have each
     wheel's speed), and traction control cutting in (also recorded): on the throttle too early or too hard. The
     same data shows front wheels locking under braking (the lock-up idea in Later, maybe).
   - Only mention them where they cost time (for example a slower exit than the reference after spinning the
     wheels), and tie them to the understeer and oversteer causes in 4.
   - First, a recording to check the signals: the owner drives a few laps turning in too sharply and spinning the
     wheels on purpose, plus a clean lap, to see how clearly each shows.

6. **Comparing several laps, and your own best lap as a reference.**
   - Show two or more laps against the reference at once, for example your best and worst (asked for by a tester).
   - With several laps recorded, your **best composite lap** (your best section from each lap, put together) as a
     lap of its own, to compare corner by corner. Today Across your laps only gives its time.
   - **Next, a simple step (owner, 6 November):** compare the selected lap with your best composite lap, with the
     same corner-by-corner view and tips ("on your best pass through corner 5 you braked 8 m later"). It shows what
     you already do on your good passes, next to the reference's comparison. Stint Lab (a paid GT7 app) builds its
     exercises on this idea; here it needs no account or history, only the laps in the recording. The engine should
     mostly support it: the composite is stitched from each section's best lap on the reference's distance grid,
     then compared like any lap.
   - Set **your own best lap** (or composite) as the reference, kept on the phone, to compare later laps with.
   - **Audio cues between your best and the WR:** cue points moved part of the way from your own braking points
     towards the WR's (for example 25%, then 50%), so the cues stretch you a step at a time rather than asking for the
     WR's points straight away.

7. **Valid laps.** Extend the cut-corner check (today: a lap more than 1% and 30 m shorter than the reference is marked
   as a likely cut) to collisions with walls or other cars, and to running off the track, so such laps are flagged
   and left out of Across your laps and the best composite lap.
   - Ground truth first: as far as the community's decoding of GT7's telemetry goes, there's no flag for an invalid
     lap, a penalty or a collision (the flags are things like on track, paused, in gear, rev limiter, ASM and TCS
     active). Check with a recording where the owner deliberately cuts a corner, touches a wall and runs wide,
     looking at every field, including the newer packet formats (sway, heave and surge; wheel speeds), and whether
     the game's own lap time or lap counter behaves differently on an invalidated lap.
   - Without a flag, detect it: a sudden change in speed or direction that braking and steering don't explain (a
     collision); wheel speeds or suspension travel unlike the reference's at the same point (grass, gravel, kerbs);
     the car well off the reference's line where the reference uses the full width.
   - Daily races add their own: the first lap from the grid (a standing start), pit laps (a required tyre change or
     refuel: the pit lane, a stop at zero speed), and laps in traffic. Flag the first two, and leave all three out of
     Across your laps and the best composite lap; traffic is harder (lifting or braking where the reference doesn't,
     with no other explanation) and may only be worth a hint.

8. **Skills that matter most for you**: in **Later, maybe**, as a significant build to specify first.

## Done

Kept short; the details are in the pull requests and the git history.

- **Daily races tab** (3 November, #58), with the first week's races: A Dragon Trail - Gardens (one car, holl01),
  B Grand Valley - Highway 1 (Gr.3, Miumiu), C Watkins Glen - Long Course (Gr.4, RTR_STOKIEBEN777); race B checked
  with the owner's lap in another Gr.3 car (no warning). Tabs renamed **Time trials** and **Past trials** (#60); the
  website renamed **Lap Companion for GT7** (5 November), references named by their driver, every driver noted in
  `data/reference_laps/drivers.json`; the first free car choice time trial, Fuji (Gr.3, #71).
- **Audio cues** (app; merged 2 November, #46; in Play build 31, published 2 November): brake, lift and gas cues from
  the reference lap, a checkbox next to Record on this phone, an Audio cues tab (beeps before brake, timing, lift, gas
  and chicane beeps, brake cue up to 0.20 s earlier, gas beep ±0.20 s, both in 0.05 s steps), calibration per audio
  output (starting delays: speaker and wired 0 s, Bluetooth 0.33 s), paused off the reference line. Tested by
  replaying laps and by the owner on track (S-4, S-6, Blue Moon Bay): best for learning braking points.
- **Clarity** (2 November), from a Reddit tester: the "How to read this" guide and the How to use tab; drive as many
  laps as you like; About this app; Check my time removed; difficulty Easy / Medium / Hard / V.hard (TBD before day
  2); the Audio cues tab simplified. A **speed chart** under each corner's brake and throttle charts (5 November,
  #73). **No advice where you're faster** than the reference or within 0.05 s of it, just how much faster or "Close
  to <driver> here" (7 November, #81).
- **"Start here" summary**: built, then dropped in favour of Across your laps (two summaries were too much).
- **Across your laps** (2 November): with 3 or more clean laps, the sections with the most to gain and the least
  consistent ones, the ideal lap's time; the selected corner stays selected when you switch laps.
- **Ready-made recorder for computers** (6 November, #79 and #80): a program for Windows and Apple silicon Macs,
  built by GitHub with PyInstaller onto the `recorder` release (beta's onto `recorder-beta`), besides the Python
  script; unsigned, so the readme explains the first-run warnings. The owner tried it on a real computer (8 November):
  it works.
- **Test review and publishing after green** (8 November, #82): see Regular jobs.

## Later, maybe

- **Skills that matter most for you** (owner, 6 November; a significant build, to specify properly before starting).
  Which skills, out of the things the comparison measures, would gain a driver the most time, ranked from most to
  least important, and whether they're improving over time.
  - **The laps kept for it** (since 8 November): every reference lap stays in `data/archive/` with an index
    (`index.json`: track, car, driver, lap time, the event's dates) instead of being deleted, including the three
    recovered from git history (Barcelona's SFE_Asteria and tropicalarea laps, SUGO's AMS__Andrew). The model also
    needs the owner's own laps against them: the owner keeps their recordings until then.
  - **Where the owner's own laps go** (owner, 10 November; set up when collecting starts): a separate, **private**
    repository (for example `gt7-laps`), not this one. This repository is public, and every test run and session
    downloads all of it: a lap is about 1.2 MB (about 0.3 MB once git compresses it), so a thousand practice laps
    would add over a gigabyte, past GitHub's suggested size of about 1 GB. The reference laps stay in
    `data/archive/` here (about 5 MB a week); the model reads from both.
  - **First, a model from the owner's own laps:** the owner records many laps across tracks and cars; fit a
    statistical model of the time lost in each corner against the corner's and car's characteristics (corner type,
    speed, braking zone length, car class and so on) and the differences from the reference lap (braking point,
    peak brake, minimum speed, back on the throttle, line, consistency between laps). Its output: which differences
    explain the most lost time, as themes (for example "braking too early into slow corners", "late on the
    throttle out of fast ones").
  - **Then, per driver over time:** as people drive and record, their own laps update their themes, so they see
    where to focus overall (not just in this lap) and whether each theme is shrinking.
  - **To work out:** what to collect and how to analyse it (how many laps, which measures, how to keep the model
    simple and honest about its uncertainty); and how each person's history is kept on their own device only, with
    nothing uploaded. Both the app and the website can keep data in the phone's or browser's own storage (the
    website through the browser's local storage, kept per browser and lost if the browser's data is cleared; the app
    more dependably in its own files), so this needn't be app-only; deciding which, and how much, is part of the
    specification.
  - Overlaps with "Progress between sessions" below, which it would replace or build on.
- **Circuit Experiences**, like the Super License tab: medal times and a gold reference run for the full lap only (not
  each segment), recorded by the owner, so it grows track by track.
- **Try it with a sample lap**: a ready-made comparison for new users and Play's reviewers, before they set up
  recording.
- **Progress between sessions**: with recordings kept on the phone, what changed since last time ("gained 0.3 s in
  corner 3").
- **Automating the weekly recordings** (a separate project, later): today the owner downloads each new time trial's WR
  replay and each daily race's best-time replay, plays it with the recorder running, and sends the CSV. Automating
  it means driving GT7 from a computer through PlayStation Remote Play (for example with an open-source Remote Play
  client), navigating the menus to download and play each replay while recording, and checking the result. Fragile
  (menus change with game updates) and needs an always-on computer and PlayStation; check Sony's terms first.
  Smaller steps that could come sooner: the daily job reminding the owner when a new time trial has no reference
  lap yet, and removing ended events' reference laps and last week's daily races by itself.
- **A shareable result card**: one image (track, lap against the reference, the corners to work on) for Reddit or
  Discord.

- Audio cues: spoken feedback after each corner ("braked 12 m early, gas 5 m late"), and track position compared with
  the reference.
- Front tyre lock-up detection, and lap consistency across several laps.
- Compare any two recordings (for example your own laps against each other).
- Super License S-10 (Spa, partly wet): medal times and a gold reference run, once the owner has unlocked it.
- Drivers page: country flags and search. Link previews (Open Graph) for posts.
- Snapshot file names use the UTC date, not Melbourne's.

## Regular jobs

- **Tests** run on GitHub on every push to `main` and `beta` (the Tests workflow); a red one means don't merge.
  Reviewed with the owner on 8 November (#82), and filled in where they were thin: Record on this phone on every kind
  of card (time trial, daily race, Super License) in the apps testers have; the audio cues checkboxes turning on and
  off together; a changed cue offset showing in the recording's status line; and the advice for two real laps
  (Barcelona against the WR, the S-1 bronze attempt against the gold run) checked word for word against
  `tests/fixtures/expected_advice.json`. Changing the tips' wording or rules means rewriting that file
  (`UPDATE_ADVICE=1 node tests/test_coach.js`) and showing the owner its diff.
- **Publishing waits for the tests** (since 8 November, #82): the website is published only when the Tests workflow
  passes, from each branch's last commit that passed, so a red push (code or data) never reaches the site; it stays as
  it was until fixed. The site changes a few minutes after a push.
- **Changes:** built on the `beta` branch first and tried on the beta app and https://gt7-timetrials.github.io/beta/
  (see `docs/android.md`); merged into `main` only when the owner says so. Play releases are the owner's call.
  `CLAUDE.md` (added 2 November) tells every Claude Code session to work this way. Exceptions, straight to main:
  data (reference laps, free choice, daily races) and the plan and notes (this file, `docs/play-listing.md`,
  `CLAUDE.md`), which beta picks up when the next beta work starts.
- **Signing keys:** the test and beta APKs use a private test key from the secrets `TEST_KEYSTORE_BASE64` and
  `TEST_KEYSTORE_PASSWORD` (2 November 2026; the old key in the repository is no longer used), the Play bundle the
  upload key. The owner keeps copies of both.

- **New time trial:** the owner sends a CSV of the WR replay. Add it to `data/reference_laps` (it matches the event by
  car and lap time), and note whose lap it is in `data/reference_laps/drivers.json`, so it keeps its driver's name
  after they beat it. The event appears after the next morning's daily update; to show it the same evening, run
  `python -m gt7tt daily` by hand.
- **Free car choice:** when the owner says a time trial lets players choose their car, add its event id (in
  `report.json`) to `data/free_choice.json`. Its comparison then doesn't warn about a different car, and its reference
  lap is matched to it whatever its car (otherwise it must be the record's car), so a reference in an unusual car, or
  a record that moves to another car, doesn't lose it. Data only, so
  straight to main like a reference lap.
- **Daily races:** each week the owner sends the three races (track, car or rule, free choice or not, whose lap) and
  a reference lap for each. First move last week's laps to `data/archive/daily/` (named by week, race and track) and
  add them to `data/archive/index.json`; then replace `data/daily/races.json` and `data/daily/laps/`. Data only, so
  straight to main.
- **Better WR during an event:** the owner sends the new replay CSV. Replace the event's old reference lap with it, moving the old one to the archive.
- **Event ends:** automatic. It leaves Current at the next site build, and the next morning's update adds it to Past
  events with its final top 100. Move its reference lap from `data/reference_laps` to `data/archive/time_trials/`, and add
  it to `data/archive/index.json`.
- **Daily update:** a scheduled Claude Code session runs `python -m gt7tt daily` every morning (Melbourne) and
  pushes to main, which republishes the site once the tests pass.
