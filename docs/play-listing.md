# Google Play listing

Everything to paste into the Play Console, and how to answer its forms. Images are in `docs/play/`.

## Store listing (Grow users → Store presence → Main store listing)

**App name** (30 max): `Lap Companion for GT7` (renamed from "Time Trials for GT7" in November 2026; under the icon
on the phone it's the shorter "Laps for GT7"; the "for GT7" form, so it reads as a companion app, not an official one)

**Short description** (80 max; updated for production, November 2026):

> The easy way to get faster at GT7 time trials, daily races and licenses.

**Full description** (4000 max; updated for production, November 2026):

> The easy way to get faster at Gran Turismo 7 time trials, daily races and Super License tests. Just your phone: a
> reference lap ready every week, tips in plain words, and audio cues for the braking points. Free, with no account
> and no ads.
>
> Record your laps on your phone while you drive, as many as you like, then compare them with the reference lap
> corner by corner:
>
> • A track map coloured by where you lose time, section by section.
> • For each corner, in plain words: where you brake, your slowest speed, when you get back on the throttle, and how
>   fast you leave the corner, compared with the reference lap. Where you're already faster, it says so.
> • Brake, throttle and speed charts for each corner, and close-ups of both racing lines.
> • Across your laps: where you lose most time on average, where you're least consistent, and your ideal lap from
>   your best sections.
> • Audio cues: a countdown to each point where the reference lap brakes or lifts, and a beep before it gets back on
>   the throttle, to learn the braking points. Works with the phone locked, through the speaker or headphones, and
>   can be calibrated for your Bluetooth device.
> • A short guide on your first comparison, and a How to use page.
>
> Reference laps for every current time trial and each week's three daily races, recorded from the top replays, and
> a gold-medal run for the Super License tests. The app also shows predicted gold, silver and bronze times for the
> current time trials, and past events with their top 100.
>
> How recording works: GT7 sends live telemetry over your home network. Keep the phone and the PlayStation on the
> same Wi-Fi network, start GT7, and tap Record on this phone. The app finds the PlayStation by itself, or you can
> type its address in. No Android phone at the PlayStation? The website has a recorder for Windows and Mac.
>
> Private by design: no account, no ads, no tracking. Your recording stays on your phone and is gone when you close
> the app, unless you save it to Downloads. Audio cue settings are kept on the phone only.
>
> Thanks to the drivers whose laps make this possible, to the testers whose feedback shaped it, and to the people who
> decoded GT7's telemetry.
>
> Not affiliated with or endorsed by Sony Interactive Entertainment or Polyphony Digital. Gran Turismo is a trademark
> of Sony Interactive Entertainment Inc.

**Graphics:**
- App icon: `docs/play/icon-512.png` (512 × 512).
- Feature graphic: `docs/play/feature-1024x500.png`.
- Phone screenshots, in this order: `docs/play/phone-1.png` to `phone-7.png` (1080 × 2160).
  1. Current time trials and gold predictions; 2. recording; 3. result; 4. track map;
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

## Applying for production (Dashboard → Apply for production, November 2026)

Answers for the questionnaire, from the closed test (30 October to 14 November 2026). The release afterwards: test
build 34 (`gt7-timetrials-play.aab` on the android-test release), the first with the name "Laps for GT7" under the
icon; update the listing (name, short and full description above) at the same time.

**How easy was it to recruit testers?** Easy.

**Describe the engagement you received from testers during your closed test.**

> Testers joined through a Google Group linked from a post on r/granturismo and a thread on GTPlanet, so they
> signed up themselves; 24 had opted in by 4 November. By 2 November, 15 testers had used the app in the past month
> and 6 used it on the day the audio cues update came out. Testers recorded laps in the current time trials and
> Super License tests and compared them with the reference laps, and several came back with detailed feedback in
> the Reddit thread: one drove four sessions at Barcelona checking the app's corner descriptions against the game's
> own telemetry and found them accurate. Two updates were published during the test (recording with the phone
> locked, then audio cues), and testers updated and kept using it.

**Provide a summary of the feedback you received from testers, and how you collected it.**

> Feedback came through comments on the Reddit post and its update post, the GTPlanet thread and Play's private
> feedback, plus my own use of the app in every event. Testers liked that it shows where they lose time corner by
> corner and why, and found the advice accurate. The main points: the comparison was very detailed and could be
> hard to get into at first; one tester thought each lap needed a restart; testers asked for graphs like the game's
> own telemetry, for comparing their best and worst laps, for Super License tests and for daily races; and one asked
> what some marks on the track map meant. Testing the audio cues myself showed unwanted beeps on gear changes and
> that Bluetooth headphones need a delay setting.

**What changes did you make based on what you learned during testing?** (if asked)

> I added a short "How to read this" guide on the first comparison and a How to use page, and made it clear that you
> can drive as many laps as you like without restarting. A speed chart now sits with each corner's brake and
> throttle charts. The Super License tab (gold-medal runs for S-1 to S-9) and a Daily races tab with a reference lap
> for each week's races were added after testers asked for them; daily races went live the same day. Audio cues now
> ignore gear-change lifts, have different sounds for braking and lifting, a calibration for each speaker or
> Bluetooth device, and settings to bring the braking cue earlier or move the throttle beep. Sections where you're
> already faster than the reference no longer get advice. Comparing several laps at once is planned next.

**Who is the intended audience, and how does your app provide value to them?** (if asked)

> Gran Turismo 7 players who want to get faster in the weekly time trials, daily races and Super License tests,
> whatever their level. Other telemetry tools mostly need a PC and setup; this needs only a phone on the same Wi-Fi
> as the PlayStation. It gives a reference lap ready every week, explains in plain words where and why you lose
> time, and plays audio cues for the braking points while you drive. It is free, with no account, no ads and no
> data collected.

**How many installs do you expect in your first year?** The smallest range offered (it's a free hobby app for one
game's players).

**How did you decide the app is ready for production?** (if asked)

> It has run for over two weeks with testers on several phones and has been updated twice without problems.
> Recording, saving, uploading and the audio cues work with the phone locked and with Bluetooth. Every change is
> tried on a separate beta version first and checked by automated tests (the app's recorder and audio cues, the
> website's screens in each released version of the app, and the lap advice) before it reaches users. I use it
> myself every week and it helped me reach gold pace.

