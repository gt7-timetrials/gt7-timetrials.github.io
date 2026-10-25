# Lap comparison (telemetry)

On the **Current** page each event has *Compare your lap with the world record*:

- **Download recorder (telemetry.py)** and **How to record (readme.txt)**: players record their own lap
  from their PS4/PS5 on their home network (`tools/telemetry.py`, `site/readme.txt`).
- **Upload your lap**: the browser finds the fastest complete lap in the CSV, compares it with the reference lap
  and shows a track map coloured by time lost per corner (green under 0.2 s, amber 0.2–0.4 s, red 0.4 s or more),
  with figures and tips for each corner. All of it runs in the browser (`site/coach.js`); the file isn't uploaded.

## Adding a world record lap (site owner)

1. In GT7, open the time trial's leaderboard and download the world record's replay.
2. Run the recorder (`py telemetry.py <PS5 IP address>`), watch the replay to the end of the lap, then press Ctrl+C.
3. On GitHub, open the `data/reference_laps` folder, click **Add file → Upload files**, drop the CSV in and click
   **Commit changes**. The file name doesn't matter.

The website rebuilds in a minute or two. The build (`gt7tt/telemetry.py`) takes the fastest complete lap in each file
and gives it to the running event with the same car whose world record is closest to the lap time. The driver's name
is shown if the lap time matches a time on the saved leaderboard. If a better replay comes along, upload it too: the
fastest lap wins. Old files can stay; they only match running events.

## How the comparison works

- **Lap:** the game's lap counter going up twice. The lap is timed by packet number (60 a second), which matches the
  game's lap time to within a hundredth.
- **Alignment:** every point of the player's lap is matched to the nearest point of the reference lap, so both are
  measured by distance along the reference line, every metre.
- **Corners:** the reference's slowest points (at least 10 km/h slower than either side). Each corner's section runs
  from halfway after the previous corner to halfway before the next, so the sections add up to the whole lap gap.
- **Per corner:** braking point (first braking after top speed), peak brake, time above 90% brake, brake when
  turning in (trail braking; averaged over the first 15 m of turning, since the brake is often being released fast there), slowest speed, back on the throttle (20%), full throttle (95%), throttle reversals,
  steering lock, rear wheelspin and exit speed. Throttle while braking (downshift blips) is ignored.
- **Extra lifts and braking:** anywhere outside the reference's own braking-to-full-throttle part of each corner, a
  stretch of 10 m or more where the player brakes, or is below 90% throttle and 20 points under the reference, while
  the reference isn't braking. Stretches within 10 m of that part are early braking or a late exit, which the corner's
  own tips cover. Kept if it costs 0.03 s or more (time gap from its start until back on full throttle). Shown as a tip
  in its corner, a dark band on the map, and shading on the corner's chart.
- **Corner chart:** brake (when either driver brakes here) and throttle, the player's against the reference's, and the
  time gap building up, by metres from where the reference starts braking (or from the apex where it doesn't brake).
- **Tips:** fixed rules with thresholds, in `tips()` in `site/coach.js`. Steering is compared with the player's own
  typical ratio to the reference over the lap, because controllers and wheels use different steering angles.
- **First corner:** if the player crossed the start line slower than the reference, that loss is pointed out as coming
  from the previous lap's last corner.

## Notes on the data

- GT7's telemetry is sent only to the device that asks for it on the local network, about 60 packets a second,
  encrypted with Salsa20 using a key the community worked out. The recorder asks for the newer format that includes the
  steering angle and falls back to the basic one.
- The stream also runs while watching a replay, describing the replay's car. That's how reference laps are recorded.
- Tests: `python -m unittest discover tests` (includes `node tests/test_coach.js` when Node is installed).
