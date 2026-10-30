# Google Play listing

Everything to paste into the Play Console, and how to answer its forms. Images are in `docs/play/`.

## Store listing (Grow users → Store presence → Main store listing)

**App name** (30 max): `Time Trials for GT7` (the "for GT7" form, so it reads as a companion app, not an official one)

**Short description** (80 max):

> Record GT7 laps on your phone and see where you lose time, corner by corner.

**Full description** (4000 max):

> A free hobby helper for Gran Turismo 7 time trials and Super License tests.
>
> Record your lap on your phone while you drive, then compare it with the top lap of the current time trial,
> corner by corner:
>
> • Start here: the two or three biggest, easiest gains in your lap.
> • A track map coloured by how much time you lose in each section.
> • For each corner: where you brake, your slowest speed, when you get back on the throttle, and how fast you leave
>   the corner, compared with the reference lap.
> • Close-ups of both racing lines, and a brake and throttle chart.
> • Pick any lap you recorded. Laps that look like a cut are flagged.
>
> The app also shows the predicted gold, silver and bronze times for the current time trials, past events and their
> top 100, and the Super License tests with a gold-medal run to compare with.
>
> How recording works: GT7 sends live telemetry over your home network. Keep the phone and the PlayStation on the
> same Wi-Fi network, start GT7, and tap Record on this phone. The app finds the PlayStation by itself, or you can
> type its address in.
>
> Private by design: no account, no ads, no tracking. Your recording stays on your phone and is gone when you close
> the app, unless you save it to Downloads.
>
> Reference laps are recorded from top replays each week. Thanks to the drivers whose laps make this possible, and to
> the people who decoded GT7's telemetry.
>
> Not affiliated with or endorsed by Sony Interactive Entertainment or Polyphony Digital. Gran Turismo is a trademark
> of Sony Interactive Entertainment Inc.

**Graphics:**
- App icon: `docs/play/icon-512.png` (512 × 512).
- Feature graphic: `docs/play/feature-1024x500.png`.
- Phone screenshots, in this order: `docs/play/phone-1.png` to `phone-7.png` (1080 × 2160).
  1. Current time trials and gold predictions; 2. recording; 3. result and Start here; 4. track map;
  5. corner tips; 6. racing line close-up; 7. brake and throttle chart.
- Tablet screenshots: not needed for a phone app (leave empty).

**Category:** App · Tools. **Tags:** pick the closest to "racing" / "games tools" offered.
**Contact details:** the app's email address (shown publicly). Website: `https://gt7-timetrials.github.io/`.

## App content (Policy → App content)

| Form | Answer |
| --- | --- |
| Privacy policy | `https://gt7-timetrials.github.io/privacy.html` |
| App access | All functionality is available without special access. (Optional note: "Recording needs a PlayStation running GT7 on the same Wi-Fi; uploading a recording and everything else works without one.") |
| Ads | No, the app has no ads. |
| Content rating | Category: Utility, Productivity, Communication or Other. Answer No to every question (violence, user interaction, sharing location, purchases, gambling, etc.). Expect "Everyone" / PEGI 3. |
| Target audience | 18 and over (simplest: younger age groups bring the Families policy into play). |
| Data safety | Does the app collect or share user data? **No.** (Then "no data collected" is shown.) |
| Advertising ID | No, the app doesn't use an advertising ID. |
| Government apps | No. |
| Financial features | None. |
| Health | None. |
| News app | No. |

## Releases

- **Closed testing** first (Testing → Closed testing): testers = a Google Group, so testers join themselves.
  Google needs 12+ testers opted in for 14 days in a row before production access.
- The release needs an app bundle (`.aab`) signed with the upload key, not the public test key. Google re-signs it
  for users (Play App Signing).
