# Plan

What's next for the site and the Android app, in order. A free hobby project for GT7 time trials, daily races and
Super License tests: keep it simple, and only take on what one person can look after.

## Next up

0. **Daily races** (live since 3 November 2026): a Daily races tab after Time trials, like the Super License tab: the
   week's races (A, B, C) with track, car (or the rule, such as Gr.3) and a fast reference lap for each, recorded by
   the owner from a replay, to record or upload against. Free car choice races are flagged, so a different car gets no
   warning (the first real use of the flag). The owner expects time trials and daily races to be the most used parts.
   - [x] The tab, `data/daily/races.json` and `data/daily/laps/<id>.csv`, tests; merged 3 November (#58).
   - [x] This week's races: A Dragon Trail - Gardens (one car, holl01), B Grand Valley - Highway 1 (Gr.3, Miumiu),
         C Watkins Glen - Long Course (Gr.4, RTR_STOKIEBEN777). Race B checked with the owner's lap in another Gr.3
         car: no warning.
   - [ ] Each week: the owner sends the new races and laps (straight to main, like reference laps).
   - [x] The Past events tab renamed **Past trials** (#60).
   - [x] The Current tab renamed **Time trials**, next to Daily races (the link stays `#current`).
   - [x] The website renamed **Lap Companion for GT7** with a new description (5 November), and time trial
         references named by their driver rather than "the world record".
   - [x] The first free car choice time trial: Fuji International Speedway (Gr.3, from 5 November; Calster_25's
         1:39.935). Its card says "Your choice of car · record in the <car>" (#71).
   - [x] Every reference lap's driver noted in `data/reference_laps/drivers.json`, so the name stays after the record
         falls (the Nürburgring's Turismo__22 lap had lost its name).
   - [ ] **The new name in the app** (the only app change since build 31; the `.aab` on the android-test release
         has it) with the next app update or at the production launch: under the icon it's **"Laps for GT7"** (the owner, 5
         November: the full name is too long for a phone's home screen; the beta app is "Laps beta"), while the Play
         listing and the website use the full name: "Time Trials for GT7" no longer covers it (the owner chose
         **"Lap Companion for GT7"** on 4 November: "coach" claims too much for a simpler offering). The app's own name (`app_name`, needs a new `.aab`), the Play listing, the
         website title and the About page, all together. Superficial, so it waits for an update with other changes.

1. **Google Play closed test**: live since 30 October 2026 ("Time Trials for GT7", `io.github.gt7timetrials`).
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
   - [ ] Keep 12+ opted in for 14 days in a row, to about **14 November 2026** (aim for a few more as a buffer). Google
         tracks this by itself: progress is on the Play Console Dashboard; nothing to trigger.
   - [ ] Keep a note of tester feedback and what changed because of it: Google asks for this when applying for
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
             today, with ‹ › to step through laps on a corner; showing several laps at once is planned (item 9).
           - Assumed the app wouldn't update during the test, then asked how to update: the owner told them about the
             new version and linked the Play page with its Update button.
         - **HomeworkBoth9844 (3 November):** "looks really great", and asked whether daily races could be added. The
           owner first thought reference laps were hard to get for races; the tester pointed out that each daily race
           quickly gets a world's best time whose replay can be downloaded, like a time trial's. The owner agreed, and
           the Daily races tab went live the same day with all three races (A one car, B and C free choice of Gr.3 and
           Gr.4, using the new free car choice flag); the tester said they'd try the app soon.
   - [ ] Before production: lead the Play listing and posts with what the app does: **easy and convenient**,
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
         description) and the production questionnaire's answers.
   - [ ] From about 14 November: Apply for production (Dashboard; a short questionnaire on how testers were found,
         how they used the app, their feedback and what changed; review up to about a week), then release to everyone.

   Website changes (including reference laps) reach the app straight away. Only changes to the app's own code
   (`android/`) need a new `.aab` uploaded to the Play Console; each build's version number goes up by itself.

2. **Audio cues** (app), as an update to the Play test. Agreed design (1 November 2026):
   - **Switching on:** an "Audio cues" checkbox next to Record on this phone (remembered). While it's ticked, cues
     play during recording. Nothing on screen: the player is driving.
   - **Cue points**, from the reference lap: **brake** wherever the reference starts braking (pedal over 5%, dabs
     included); **lift** where it comes off the throttle without braking (from 90%+ to below 50%, no brake, for at
     least 0.1 s; a lift followed straight away by braking is a brake cue only; a short lift while changing up a gear
     is a gear change, not a lift); **gas** where it gets back on the throttle after braking and stays on (not a blip
     on a downshift). Super License tests the same, against the gold run. Cues play whatever the car (time
     trials can allow a choice of car).
   - **Sounds:** brake: low tocks and a low BEEP; lift: high ticks and a middle BEEP; gas: a rising chirp 0.5 s
     before; chicane: a short high pip. The tab has a button to hear each one. Timed from
     the player's distance to the point, speed and acceleration, updated every packet; the gas beep also allows for
     how fast the acceleration is changing (jerk), since it comes while braking and turning in.
   - **Overlaps:** a brake or lift point inside the previous one's countdown (1 s by default) gets no sound, or one
     short pip if "chicane beep" is on. A gas beep within 0.3 s of a brake or lift sound is skipped.
   - **Paused** when the car is more than about 20 m off the reference line, going backwards, or on another track;
     back on automatically.
   - **Calibration** per audio output (phone speaker, wired headphones, each Bluetooth device by name), as its own
     run from the Audio cues tab, not while driving (first-time users don't know what's happening, and corners take
     over): sitting in the car (standing still is fine), six brake countdowns 3 s apart; the player presses the brake
     on each BEEP. The delay is the average gap between the BEEP and the firm press (over 20%), leaving out presses
     well off the others; it needs 4 of 6 that agree. Until then each output uses the starting value for its type
     (speaker and wired 0 s, Bluetooth 0.33 s, from the owner's own calibrations).
   - **Audio cues tab** (app only, before How to use): beeps before brake (0–3, default 2), beep timing (0.3–1.0 s,
     default 0.5), lift beeps (on), gas beep (on), chicane beep (off), brake cue earlier than the reference
     (0–0.20 s in 0.05 s steps, default 0), gas beep adjustment (±0.20 s in 0.05 s steps), one row per audio output with its delay, ± and Reset, and
     Test sound. Saved on the phone: these settings, the calibrations and the checkbox. Nothing else.
   - Built in the app's own code (works with the screen locked), tested here by replaying recorded laps as if live,
     then tuned in the game by the owner.
   - [x] Built and merged (test build 19 on the android-test release). Replayed laps: brake and lift BEEPs within
         0.016 s of the point, gas beeps within 0.03 s (with jerk); calibration settles in about 4 presses.
   - [x] Owner's first drive (Blue Moon Bay): unexpected beeps were the WR's upshift lifts and a downshift blip,
         now filtered out; lift sounds now differ from brake sounds; calibration moved to its own run; test buttons
         for each sound.
   - [x] Owner's second drive: calibration works on the phone speaker; Bluetooth sounded distorted and uneven. The
         cues are best for learning braking points, not for driving a whole lap (distracting); braking where the WR
         does is only part of a corner, so the earlier-cue setting matters.
   - [x] On beta: brake cue earlier by 0–0.20 s in 0.05 s steps; quieter, softer tones and silence playing in the
         background (keeps Bluetooth awake); calibration shows how much the presses varied, and warns when an output
         is too uneven; the tab says the cues are for learning braking points.
   - [x] Owner: works really well on the beta app. Starting delays from the owner's calibrations: phone speaker 0 s,
         wired headphones 0 s, Bluetooth 0.33 s.
   - [x] Owner: S-4 and S-6 on the phone speaker and Bluetooth: recording and cues work well; the cues really help
         find the braking points in an unfamiliar car.
   - [x] Owner: gas beep adjustment ±0.20 s in 0.05 s steps (±0.5 s was far too much).
   - [x] Merged beta into main on 2 November 2026 (#46); `gt7-timetrials-play.aab` is test build 31.
   - [x] Owner: the Play app (release 16) works with the new website; build 31 uploaded to the Alpha track and sent
         for review (2 November).
   - [x] Build 31 approved and published (2 November); the owner updated from Play, and the Audio cues option and
         recording work.
   - [x] Owner: emailed the testers' group about the update (with the Reddit link for feedback).
   - [x] Owner: updated the Play listing text from `docs/play-listing.md` (short and full description: audio cues,
         many laps, Across your laps, the guide), 2 November.
   - [ ] Post about it with the next time trial for momentum: an update post on r/granturismo on Friday after the
         new time trial (its rule 9: self-promotion at most once every 96 hours; repetitive or low-quality posts, and
         images that look AI-made, may be removed, so use real phone screenshots). Link the first post, thank testers
         for what they changed (license tests, daily races), say what's new, and give the join steps.

3. **Clarity** (merged 2 November 2026), from a Reddit tester ("very advanced… people might get lost", "you always have to reset the
   lap") and the owner's review:
   - [x] "How to read this" guide above the first comparisons, until Got it; the same steps on a new **How to use**
         tab (what's here, recording one or many laps with the app or a computer, reading the comparison, audio cues).
   - [x] Recording wording: drive as many laps as you like, no restart needed (the tester thought each lap needed a
         restart).
   - [x] "How it works" renamed **About this app**, without the lap comparison part; a line on translating the page
         (the app can't translate; open the website in Chrome for now; in-app translation is for later).
   - [x] Removed Check my time and the past events' entrants range; course difficulty rated Easy / Medium / Hard /
         V.hard against all past events (25th, 70th and 90th percentiles of the top-100 spread).
   - [x] Audio cues tab: Hear the sounds, Cue settings and Sound delay sections; less explanation.
   - [x] Dark mode: the corner close-up's "dark = you" legend shows the colours instead. The Super License tab only
         links the computer recorder on the website.
   - [x] Owner: happy with the guide and the rest on the beta app.
   - [x] Graphs, part one (5 November, #73): a speed chart under each corner's brake and throttle charts, yours
         and the reference's, on the same distance axis.
   - [ ] More graphs like GT7's own telemetry (the tester asked for them): the owner is looking at what GT7 shows to
         decide what else is worth adding (for example gear, steering, the whole lap rather than a corner).
   - Comparing several laps, the best composite lap and the tester's best-against-worst idea: see 9.

4. **"Start here" summary**: built, then dropped in favour of "Across your laps": two summaries were too much,
   and the map with its corner times already shows where a single lap loses time.

5. **Across your laps** (merged 2 November 2026): with 3 or more clean laps in a recording, the sections with the most time to gain on
   average and the least consistent ones, and the "ideal lap" from each section's best time. The selected corner stays
   selected when you switch laps, and the corner's panel has ‹ › to step through the laps.

6. **Skill progression pattern, and feedback for the driver's level.** Compare laps at several levels (WR, top 100,
   gold, silver) across events, to find which differences shrink first as drivers improve. Use that to order the tips
   ("at your level, drivers usually gain most from…"). Needs laps at several levels on several tracks, so it builds
   up over months.
   - The tips are already partly tailored (they come from where this lap loses time), but how useful each idea is
     for a given level isn't: for example, a driver braking 30 m early gains more from braking points than from the
     line, and a driver within 1% of the WR the other way round. Review which tips help at which level, and lead
     with those.

7. **Next-level reference laps.** Compare against a gold-pace lap rather than the WR. Possibly not needed once 4 and 5
   are done. Depends on how far down the leaderboard GT7 lets you download replays.

8. **Line feedback** (going wide, missing the apex, not using the track at the exit). The close-ups already draw both
   lines; the tips say little about the line itself.
   - Thresholds: how far from the reference line counts as a real difference, given the telemetry's accuracy (the
     position is the car's centre, and the track edges aren't in the data), and the line's effect on time, so only
     differences that cost time are mentioned.
   - Why the line differs: understeer (running wide on entry or mid-corner with the steering wound on, speed too high
     for the grip) or oversteer (the rear stepping out on exit, corrections, throttle lifted), which make the
     reference's line hard to follow. Advice on the cause rather than the line: for example brake earlier or turn in
     slower for understeer, smoother throttle on exit for oversteer. Needs steering and yaw (or speed against
     steering) from the telemetry, compared with the reference's at the same point.

9. **Comparing several laps, and your own best lap as a reference.**
   - Show two or more laps against the reference at once, for example your best and worst (asked for by a tester).
   - With several laps recorded, your **best composite lap** (your best section from each lap, put together) as a
     lap of its own, to compare corner by corner. Today Across your laps only gives its time.
   - Set **your own best lap** (or composite) as the reference, kept on the phone, to compare later laps with.
   - **Audio cues between your best and the WR:** cue points moved part of the way from your own braking points
     towards the WR's (for example 25%, then 50%), so the cues stretch you a step at a time rather than asking for the
     WR's points straight away.

10. **Valid laps.** Extend the cut-corner check (today: a lap more than 1% and 30 m shorter than the reference is marked
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

## Later, maybe

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
- **Changes:** built on the `beta` branch first and tried on the beta app and https://gt7-timetrials.github.io/beta/
  (see `docs/android.md`); merged into `main` only when the owner says so. Play releases are the owner's call.
  `CLAUDE.md` (added 2 November) tells every Claude Code session to work this way.
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
  a reference lap for each. Replace `data/daily/races.json` and `data/daily/laps/`. Data only, so straight to main.
- **Better WR during an event:** the owner sends the new replay CSV. Replace the event's old reference lap with it.
- **Event ends:** automatic. It leaves Current at the next site build, and the next morning's update adds it to Past
  events with its final top 100. Delete its reference lap from `data/reference_laps`.
- **Daily update:** a scheduled Claude Code session runs `python -m gt7tt daily` every morning (Melbourne) and
  pushes to main, which republishes the site.
