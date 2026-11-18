# Where your time goes: the rules

How a lap's gap to the reference is split into **braking, exit, straight and line**, and how the tips are chosen and
ordered (`site/coach.js`: `themeSplit`, and the end of `analyse`). Everything is measured from the two laps and the
reference lap's own physics: no fitted numbers. Written 18 November 2026, from the code as it is (tips within a theme ranked on beta, 18 November).

## 1. Lining the laps up

- Your lap is laid onto the reference's line and compared **metre by metre** along it.
- At each metre: the time difference so far (the gap), your speed and the reference's.
- A metre costs `1/speed` seconds, so the **speed part** of each metre's loss is `1/your speed − 1/reference speed`.
  Whatever else the gap grows by in that metre is the **line**: the extra (or shorter) distance of a different line.
- The last metres are timed from the recorded lap times (like the corners' times), so everything adds up to the gap
  shown at the top.

## 2. Corners, braking points, stretches

- **Apex:** each of the reference's slowest points, at least 10 km/h slower than the fastest speed within 400 m on
  either side, and at least 80 m from the last one.
- **Corner (section):** what each corner's time, colour and bar are for. It starts 10 m before the reference starts
  braking or lifting for that corner (or before you do, if that's up to 150 m earlier), and runs to the next corner's
  start: the corner plus the straight after it. The first starts at the line; the last runs to the finish.
- **Reference braking point:** the first metre after the corner's top speed where the reference's brake is over 5%.
- **Corner exit:** 20 m after the reference is back to full throttle (95%+) after the apex. If it's already flat out
  at the apex, where the bend stops turning (half the apex's turning). At least 20 m after the apex.
- **Stretch:** from one reference braking point to the next. The physics works stretch by stretch. A corner the
  reference takes without braking is part of the stretch before it. The last stretch runs over the line to the first
  braking point.

## 3. "The reference's way" from another speed

Used for the carry-over: what would happen to your speed if, from a given point, you drove exactly like the reference.

- Each metre, your speed squared changes by the same amount as the reference's (same grip, same braking).
- Where the reference is **flat out** (95%+ throttle, no brake), the engine matters instead: you get the car's flat-out
  acceleration **at your speed**, read from the reference lap itself (its flat-out stretches, in 5 km/h bands). A slower
  car accelerates harder, so a deficit shrinks.
- Your speed never crosses the reference's: a slower start catches up at most to the reference, a faster one falls back
  at most to it.

## 4. Splitting each metre (per stretch)

**a. Braking point → apex: no carry-over allowance.** Each metre's speed loss is **braking**, except:
- **Arriving slower:** if you reach the braking point slower than the reference, the time that costs until the
  reference has slowed to your speed (you'd simply brake less) is **carried**: it goes back to the stretch before (5).

**b. Apex → corner exit.**
- The loss that your apex speed alone would cause, driving the reference's way from it, is **braking** (your apex
  deficit came from the braking).
- The rest is **exit**.

**c. Corner exit → next braking point (the straight).**
- The loss that your exit speed alone would cause, the reference's way from it, is shared between **braking** and
  **exit**, linearly, by their parts of your exit speed deficit: braking's part is what the reference's physics carries
  from your apex deficit to the exit; exit's part is the rest. (If the two pull in opposite directions, or the deficit
  is tiny, they share by size.)
- Anything beyond that is **straight**: lifting, braking, or a slower car (in free-choice races).

**d. Over the line (the last stretch).** Past the line your speed comes from the lap before's last exit, so the
reference's way from your crossing speed is shared like (c) by the last corner's braking and exit. Not exact (it was the
lap before's last corner), but closer than calling it straight. Real lifts there are still straight.

**e. Line, everywhere:** the part of each metre's loss that speed doesn't explain (1).

## 5. Carried time

The carried time of a stretch (arriving slower at its braking point) goes to the **stretch before**: spread over its
themes in proportion to their sizes.

## 6. A corner's split

- Add up every metre of the corner's section, by theme: the corner's **signed** parts (some can be gains). They add up
  exactly to the corner's time.
- **Shared by size, all with the corner's sign:** each theme gets `net × |its part| / (sum of |parts|)`. So in a corner
  slower overall, a quicker part (easing off the brakes, then a slow exit) counts as time lost, not as a gain; and the
  mirror in a corner quicker overall.
- **Within 0.5% of the reference's time** for that section: not split ("Within 0.5% of …'s time in this section").

## 7. The lap, and across laps

- **The lap:** the corners' parts added up: exactly the lap's gap.
- **Across your laps:** the average per lap over the recording's clean laps (no cut corner, no spin or crash), with 2
  or more of them.

## 8. Spins and crashes

- A corner where your speed falls **under half the reference's at the same point** (after the first 100 m) is a spin
  or crash: its only tip is "You spin out or crash on this corner.", with no bar.
- That lap isn't compared first, is marked in the lap picker, and is left out of Across your laps.
- Every clean lap recorded so far stays above 60% of the reference's speed; the spins and crashes went to 0-36%.

## 9. Tips

- **What each tip measures** is independent of the split: e.g. "you brake 9 m earlier", "you're at 77% brake when
  starting to turn", each against the reference at the same point.
- **Each tip has a theme:** braking point, brake pressure, trail braking, brake release, lock-up, minimum speed,
  steering → braking; throttle, full throttle, throttle control, wheelspin, traction control, exit speed → exit; track
  use → line; lifts and extra braking → the theme their own metres' time went to; the start of the lap → straight.
- **Shown** only if its theme is at least **15%** of the corner's split (by size) and at least **0.03 s**. If none is,
  "No single big difference: small losses through the whole section."
- **Ordered** by the size of their theme in that corner, biggest first; within a theme, the habits that usually cost
  most first, from the analysis of the owner's and top drivers' laps (gt7laps `analysis/`; `TIP_RANK` in coach.js):
  - braking: brake release (brake held after the braking point, the biggest cost), braking where the reference
    doesn't, braking point, lock-up, then the results (minimum speed, steering), a lift, and last the tips about less
    brake than the reference (brake pressure, trail braking, braking where it only lifts), which save braking time;
  - exit: throttle (back on later), throttle control, lifts, then the exit speed they cause, full throttle and
    wheelspin, which add little once the throttle shortfall is known.
- **Within 0.5%** of the reference: only "Close to … here". **Faster** by 0.05 s or more: "You're … s faster than …
  here."

## Not yet

- The straight theme can pick up some of a hesitant exit that carries on as part throttle past the corner exit.
