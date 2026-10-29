# Plan

What's next for the site and the Android app, in order. A free hobby project for GT7 time trials and Super License
tests: keep it simple, and only take on what one person can look after.

## Next up

1. **Google Play closed test**, aiming for Sunday 1 November.
   - [ ] Owner: Play developer account approved, phone verified (waiting on Google).
   - [ ] Privacy policy page on the website: the app collects nothing.
   - [ ] Store listing: name, short and full description (the "free hobby helper" wording), screenshots, 512 px icon.
   - [ ] Play build: an app bundle (.aab) signed with a private upload key kept as a GitHub secret. The current test
         key in `android/app/test.keystore` is public, so it's only for the GitHub test downloads.
   - [ ] Crib sheet for the Play Console forms: content rating, data safety ("no data collected"), target audience.
   - [ ] Closed test with a Google Group, so testers join themselves and no email addresses are collected. Post the
         group link and the test link on GTPlanet and Reddit. Google needs 12+ testers opted in for 14 days in a row
         before the app can go to everyone, so aim for 20 or so.

2. **Audio cues** (app), as an update to the Play test.
   - An "Audio cues" button on each event and Super License test; brake cues and/or gas cues.
   - A countdown before each of the reference's cue points: tick… tick… BEEP, timed from the current speed. Low pitch
     for brake, high pitch for gas. It records at the same time.
   - "Later by __ m" setting, since the best drivers' points are hard to match.
   - Calibration: on a straight, the app beeps about 6 times and the player taps the brake on each BEEP. The average
     delay (audio, data and the player) is saved per audio output (phone speaker, each Bluetooth device), with a
     manual adjustment and Recalibrate.
   - Tested here by playing recordings back as if live, then tuned in the game by the owner.

3. **"Start here" summary** (done) at the top of a comparison: the 2–3 biggest easy wins. Differences are ranked by time lost
   and by how hard they are to fix:
   - easy: coasting or lifting, braking far too early, late on the gas;
   - medium: minimum speed, line;
   - hard: trail braking, fine brake release.

4. **Your best lap over the time trial** (done). The phone remembers the best lap time of each recording or upload, per
   event, on the device only. A small chart shows it falling over the event, with no list of what improved: the time
   coming down is enough.

5. **Skill progression pattern.** Compare laps at several levels (WR, top 100, gold, silver) across events, to find
   which differences shrink first as drivers improve. Use that to order the tips ("at your level, drivers usually
   gain most from…"). Needs laps at several levels on several tracks, so it builds up over months.

6. **Next-level reference laps.** Compare against a gold-pace lap rather than the WR. Possibly not needed once 3 and 5
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
