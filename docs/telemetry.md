# Lap comparison (telemetry)

On the **Current** page each event has *Compare your lap with the world record*:

- **Download recorder (telemetry.py)** and **How to record (readme.txt)**: players record their own lap
  from their PS4/PS5 on their home network (`tools/telemetry.py`, `site/readme.txt`).
- **Upload your lap**: the browser finds the fastest complete lap in the CSV, compares it with the reference lap
  and shows a track map coloured by time lost per corner (green under 0.2 s, amber 0.2–0.4 s, red 0.4 s or more),
  with figures and tips for each corner. All of it runs in the browser (`site/coach.js`); the file isn't uploaded.

## Adding a world record lap (site owner)

1. In GT7, open the time trial's leaderboard and download the world record's replay.
2. Run the recorder (`py telemetry.py`), watch the replay to the end of the lap, then press Ctrl+C.
3. On GitHub, open the `data/reference_laps` folder, click **Add file → Upload files**, drop the CSV in and click
   **Commit changes**. The file name doesn't matter.

The website rebuilds in a minute or two. The build (`gt7tt/telemetry.py`) takes the fastest complete lap in each file
and gives it to the running event with the same car whose world record is closest to the lap time. The driver's name
is shown if the lap time matches a time on the saved leaderboard. If a better replay comes along, upload it too: the
fastest lap wins. When an event ends, delete its reference lap: it only ever matches running events, so it's dead
weight. (The tests use their own copies in `tests/fixtures`.)

A new time trial appears on the site after the next morning's daily update. To show it sooner (for example to
record against it the evening it starts), run `python -m gt7tt daily` by hand: it fetches the new event and its
top 100, and the morning run still happens as usual. The Current tab lists the newest event first.

## Super License tab

`data/license/super.json` lists the tests (id, track, car, gold/silver/bronze in milliseconds). Each test's reference
run (a replay beating gold, recorded with telemetry.py) goes in `data/license/laps/<id>.csv`, e.g. `S-1.csv`; the build
takes the fastest complete lap in it. License tests count laps like time trials (0 → 1 at the start line, 1 → 2 at the
finish), so the same comparison works. In some tests the game's time includes up to about 0.9 s more than the recorded
lap (the timer starting before the car reaches the line), so corner losses add up to the recorded gap and the page
notes the difference.

## How the comparison works

- **Lap:** the game's lap counter going up twice. The lap is timed by packet number (60 a second), which matches the
  game's lap time to within a hundredth.
- **Alignment:** every point of the player's lap is matched to the nearest point of the reference lap, so both are
  measured by distance along the reference line, every metre.
- **Start here:** the 2–3 differences most worth working on first. Each candidate gets the time it costs, from the
  time gap over its stretch of track, and a difficulty:
  - easy: lifts or braking the reference doesn't do, braking 10 m or more early, full throttle 15 m or more late;
  - medium: a slowest speed 5 km/h or more lower, track use, a slower exit before a straight of 150 m or more;
  - harder: brake pressure and trail braking.

  The score is the time × 1 (easy), 0.6 (medium) or 0.35 (harder), and only items costing 0.05 s or more count. A
  corner's "through the corner" item gets the corner's loss minus its early-braking and late-throttle items, and
  the exit item leaves out lifts on the straight, which are listed on their own.
- **Your best lap:** the best lap of each recording compared is kept in the browser (localStorage, per event or
  license test) and shown as a line falling over the event. It's never sent anywhere, and "Forget them" clears it.
- **Which lap:** every complete lap in the recording is listed, and the fastest is compared by default; the player
  can tap another. GT7's telemetry doesn't say whether a lap was valid, so a lap noticeably shorter than the reference
  (by more than 1%, and at least 30 m) is marked as a likely cut corner and skipped when choosing the default, unless
  every lap is. A clean lap's line is within about 0.5% of the reference's.
- **Corners:** the reference's slowest points (at least 10 km/h slower than either side). Bends the reference takes
  flat out aren't corners of their own; they're part of the straight after the corner before them.
- **Sections:** each section is a corner plus the straight after it, since the exit speed decides the straight. It
  starts 10 m before the reference starts braking or lifting for the corner (or before the player does, if that's up
  to 150 m earlier); where neither brakes nor lifts, where the bend starts turning. The first section starts at the line and the
  last one ends at the finish, so the sections add up to the whole lap gap. The corner part ends 20 m after the
  reference's full throttle (or, if it's flat out by the apex, where the bend stops turning). When the straight after it is 150 m or longer,
  a "Where the time goes" tip splits the section's loss between the corner and the
  straight, with the exit speed difference and any lifts on the straight. The first section's run from the start
  line to the braking zone is split off in the tip the same way when it's 150 m or longer. The map has one colour per
  section, matching its corner number. Three or more lifts in a section are
  summed up in one tip.
- **Per corner:** braking point (first braking after top speed), peak brake, time above 90% brake, brake when
  turning in (trail braking; averaged over the first 15 m of turning, since the brake is often being released fast there), slowest speed, back on the throttle (20%), full throttle (95%), throttle reversals,
  steering lock, rear wheelspin and exit speed. Throttle while braking (downshift blips) is ignored.
- **Extra lifts and braking:** anywhere outside the reference's own braking-to-full-throttle part of each corner, a
  stretch of 10 m or more where the player brakes, or is below 90% throttle and 20 points under the reference, while
  the reference isn't braking. Stretches within 10 m of that part are early braking or a late exit, which the corner's
  own tips cover. Kept if it costs 0.03 s or more (time gap from its start until back on full throttle). Shown as a tip
  in its corner, a dark band on the map, and shading on the corner's chart.
- **Track use:** both laps carry the cars' real positions, so at each metre the player's distance to the side of the
  reference's line is known. The corner's direction of turn makes that "wider" (towards the outside) or "tighter".
  It is measured at the reference's turn-in, apex and exit (20 m after full throttle), averaged over ±5 m. A tip
  appears for differences of 1.5 m or more, except in kinks under 15° of turn. The corner close-up draws both lines
  to scale, the same way round as the lap map, from just before the earlier braking point to just after the exit.
  The reference's line is thin and plain. The player's line is dots every 3 m (wider apart on long corners, so they
  stay at least 9 px apart). Each dot compares the pedals with the reference's at the same point:
  - the brake (red) wherever either driver is braking, the throttle (blue) everywhere else;
  - filled = more than the reference, ring = less;
  - size = how much: 10–30, 30–60 or 60+ points;
  - a tiny grey dot = within 10 points.

  Letter badges mark first brake (B), back on the gas (G, 20%) and full throttle (F, 95%): dark for the player, grey
  for the reference, set off to either side of the line. A button hides the reference's line. The data has no track
  edges.
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
