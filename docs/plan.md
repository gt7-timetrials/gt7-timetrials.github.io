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
   - [x] How to join on the website (How it works → Android app (test)), and a Reddit post asking for testers
         (https://www.reddit.com/r/granturismo/s/WTRsxSB3m2) and on GTPlanet
         (https://www.gtplanet.net/forum/threads/free-time-trial-lap-comparison-android-app.440044/), which is also
         where feedback goes, besides Play's private feedback.
   - [x] Second release (test build 16), approved and published on 31 October: keeps recording when the phone is locked or
         the player switches apps (`RecorderService`, a foreground service of type `connectedDevice`; foreground
         service form filled in with a video). Tested by the owner with the phone locked and the app in the
         background, both from the test APK and from the Play update. The "no data" messages (website and computer recorder) now also mention other telemetry apps
         such as SimHub and Sim Racing Telemetry.
   - [ ] 12+ testers opted in for 14 days in a row (aim for about 20, as some drop out).
   - [ ] Keep a note of tester feedback and what changed because of it: Google asks for this when applying for
         production.
   - [ ] Apply for production (Dashboard), then release to everyone.

   Website changes (including reference laps) reach the app straight away. Only changes to the app's own code
   (`android/`) need a new `.aab` uploaded to the Play Console; each build's version number goes up by itself.

2. **Audio cues** (app), as an update to the Play test. Agreed design (1 November 2026):
   - **Switching on:** an "Audio cues" checkbox next to Record on this phone (remembered). While it's ticked, cues
     play during recording. Nothing on screen: the player is driving.
   - **Cue points**, from the reference lap: **brake** wherever the reference starts braking (pedal over 5%, dabs
     included); **lift** where it comes off the throttle without braking (from 90%+ to below 50%, no brake, for at
     least 0.1 s; a lift followed straight away by braking is a brake cue only); **gas** where it gets back on the
     throttle after braking. Super License tests the same, against the gold run. Cues play whatever the car (time
     trials can allow a choice of car).
   - **Sounds:** brake: tick, tick, low BEEP; lift: tick, tick, mid BEEP; gas: one high beep 0.5 s before. Timed from
     the player's distance to the point, speed and acceleration, updated every packet; the gas beep also allows for
     how fast the acceleration is changing (jerk), since it comes while braking and turning in.
   - **Overlaps:** a brake or lift point inside the previous one's countdown (1 s by default) gets no sound, or one
     short pip if "chicane beep" is on. A gas beep within 0.3 s of a brake or lift sound is skipped.
   - **Paused** when the car is more than about 20 m off the reference line, going backwards, or on another track;
     back on automatically.
   - **Auto-calibration** per audio output (phone speaker, wired headphones, each Bluetooth device by name): on the
     first brake cues, compare each BEEP with when the player actually pressed the brake (firm presses over 20%
     only; presses more than 0.6 s off, or none, are ignored), and set the delay to the average. Calibrated once the
     last 3 presses are within 0.1 s of the BEEP; then saved. It aims at the brake point with the offset applied. The
     gas beep uses the same delay. Starting values per type of output (speaker, wired, Bluetooth) come from the
     owner's own calibrations.
   - **Audio cues tab** (app only, before How it works): beeps before brake (0–3, default 2), beep timing (0.3–1.0 s,
     default 0.5), lift beeps (on), gas beep (on), chicane beep (off), brake cue earlier than the reference
     (0.0–1.0 s, default 0), gas beep adjustment (±0.5 s), one row per audio output with its delay, ± and Reset, and
     Test sound. Saved on the phone: these settings, the calibrations and the checkbox. Nothing else.
   - Built in the app's own code (works with the screen locked), tested here by replaying recorded laps as if live,
     then tuned in the game by the owner.

3. **"Start here" summary** (done) at the top of a comparison: the 2–3 biggest easy wins. Differences are ranked by time lost
   and by how hard they are to fix:
   - easy: coasting or lifting, braking far too early, late on the gas;
   - medium: minimum speed, line;
   - hard: trail braking, fine brake release.

4. **Skill progression pattern.** Compare laps at several levels (WR, top 100, gold, silver) across events, to find
   which differences shrink first as drivers improve. Use that to order the tips ("at your level, drivers usually
   gain most from…"). Needs laps at several levels on several tracks, so it builds up over months.

5. **Next-level reference laps.** Compare against a gold-pace lap rather than the WR. Possibly not needed once 3 and 4
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

- **New time trial:** the owner sends a CSV of the WR replay. Add it to `data/reference_laps` (it matches the event by
  car and lap time). The event appears after the next morning's daily update; to show it the same evening, run
  `python -m gt7tt daily` by hand.
- **Better WR during an event:** the owner sends the new replay CSV. Replace the event's old reference lap with it.
- **Event ends:** automatic. It leaves Current at the next site build, and the next morning's update adds it to Past
  events with its final top 100. Delete its reference lap from `data/reference_laps`.
- **Daily update:** a scheduled Claude Code session runs `python -m gt7tt daily` every morning (Melbourne) and
  pushes to main, which republishes the site.
