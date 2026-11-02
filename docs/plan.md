# Plan

What's next for the site and the Android app, in order. A free hobby project for GT7 time trials and Super License
tests: keep it simple, and only take on what one person can look after.

## Next up

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
   - [ ] Keep 12+ opted in for 14 days in a row, to about **14 November 2026** (aim for a few more as a buffer). Google
         tracks this by itself: progress is on the Play Console Dashboard; nothing to trigger.
   - [ ] Keep a note of tester feedback and what changed because of it: Google asks for this when applying for
         production. So far: a Reddit tester (2 November) found it detailed but hard to get into, thought each lap
         needed a restart, and asked for translation and GT7-style telemetry graphs: answered by item 3 (guide, How
         to use tab, many-laps wording, translation note); graphs are planned. The same tester, later: drove four sessions at
         Barcelona checking the corner descriptions against GT7's own telemetry and found them accurate (braking
         and full-throttle distances, track width at the apex); set 1:51.539. Asked to compare their best and worst
         laps together with the WR's (now each lap is compared with the WR, and ‹ › steps through laps on a corner).
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
     (0.0–1.0 s, default 0), gas beep adjustment (±0.20 s in 0.05 s steps), one row per audio output with its delay, ± and Reset, and
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
   - [x] Owner: emailed the testers' group about the update (with the Reddit link for feedback), and updated the
         Play listing text ("Across your laps").
   - [ ] Post about it with the next time trial for momentum.

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
   - Later: graphs of speed, throttle and brake along the lap, like GT7's own (the tester asked for them).
   - Later, maybe: show two of your laps against the reference at once, for example your best and worst (the same
     tester asked for it).

4. **"Start here" summary**: built, then dropped in favour of "Across your laps": two summaries were too much,
   and the map with its corner times already shows where a single lap loses time.

5. **Across your laps** (merged 2 November 2026): with 3 or more clean laps in a recording, the sections with the most time to gain on
   average and the least consistent ones, and the "ideal lap" from each section's best time. The selected corner stays
   selected when you switch laps, and the corner's panel has ‹ › to step through the laps.

6. **Skill progression pattern.** Compare laps at several levels (WR, top 100, gold, silver) across events, to find
   which differences shrink first as drivers improve. Use that to order the tips ("at your level, drivers usually
   gain most from…"). Needs laps at several levels on several tracks, so it builds up over months.

7. **Next-level reference laps.** Compare against a gold-pace lap rather than the WR. Possibly not needed once 4 and 5
   are done. Depends on how far down the leaderboard GT7 lets you download replays.

## Later, maybe

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
  car and lap time). The event appears after the next morning's daily update; to show it the same evening, run
  `python -m gt7tt daily` by hand.
- **Better WR during an event:** the owner sends the new replay CSV. Replace the event's old reference lap with it.
- **Event ends:** automatic. It leaves Current at the next site build, and the next morning's update adds it to Past
  events with its final top 100. Delete its reference lap from `data/reference_laps`.
- **Daily update:** a scheduled Claude Code session runs `python -m gt7tt daily` every morning (Melbourne) and
  pushes to main, which republishes the site.
