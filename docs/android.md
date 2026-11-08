# Android app

`android/` is a small Android app (plain Java, no extra libraries): the website in a WebView, plus recording on the
phone. When the site runs inside the app, `window.GT7App` exists and the lap comparison shows **Record on this
phone** instead of the computer recorder's download links.

- `Recorder.java` / `Telemetry.java` do what `tools/telemetry.py` does: find the PlayStation, decrypt the packets, and
  keep them as a CSV with the same columns. It searches afresh every time (a PlayStation's address can change),
  trying these at the same time:
  - the Remote Play discovery broadcast ("SRCH * HTTP/1.1" to UDP 9302 for PS5 and 987 for PS4), which every
    PlayStation answers with its address;
  - a sweep sending the heartbeat to every address on the phone's Wi-Fi network, spread out because some routers and
    mesh systems drop a burst of 250 address lookups.

  The player can also type the address in. Sockets are bound to the Wi-Fi network, so mobile data or a VPN doesn't
  get in the way. Progress goes to the page as JSON events (`searching`, `slow`, `connected`, `state`,
  `lap`, `silent`, `dropout`, `error`, `stopped`) through `window.GT7AppEvent`.
- **Audio cues** (`Cues.java`, plain Java; `CueSounds.java`, `CueStore.java`): with the checkbox next to Record
  ticked, the page sends the reference's cue points (`Coach.cuePoints`: its line every 2 m, and where it brakes,
  lifts and gets back on the gas) with `GT7App.startWithCues(ip, json)`. Every packet, `Cues` finds the car on that
  line, predicts when it reaches each point from distance, speed and acceleration, and plays the countdown early by
  the output's delay. `Calibrator.java` measures that delay (`GT7App.calibrate(ip)` from the Audio cues tab): six brake
  countdowns, 3 s apart, while the player sits in the car (standing still is fine) and presses the brake on each
  BEEP; the typical gap between the BEEP and the press, from the telemetry, is the delay. Settings and delays are saved
  in SharedPreferences (`cueState()`, `saveCues()`, `testSound(kind)` for the Audio cues tab). `tests/android/CueCheck.java`
  replays recordings through the cues as if live, and simulates a calibration.
- When the player taps **Stop and compare**, the page takes the CSV from `GT7App.csv()` and runs the same
  comparison as for an uploaded file. **Save to Downloads**, on the result line, writes it to Downloads.
- The screen stays on while recording, and `RecorderService` (a foreground service, type `connectedDevice`, with a
  "Recording your laps" notification and a wake lock of at most 4 hours) keeps the app running if the player locks
  the phone or switches apps: otherwise Android pauses or freezes it and the lap is lost. It runs only while
  recording. Google Play asks about it under App content → Foreground service permissions. Links to other sites
  open in the browser.

**Builds:** every push that changes `android/` runs `.github/workflows/android.yml`, which builds the APK and puts it on
the `android-test` release:
https://github.com/gt7-timetrials/gt7-timetrials.github.io/releases/download/android-test/gt7-timetrials.apk
The test and beta APKs are signed with a private test key from the repository's secrets, `TEST_KEYSTORE_BASE64` (the
keystore, base64) and `TEST_KEYSTORE_PASSWORD` (its password, also used for the key, alias `test`), so each one
installs over the last and nobody else can make an APK that installs over them. (Until November 2026 the test key was
in the repository; APKs signed with it don't update to the current ones: uninstall and install once.) A build on a
computer without the key signs with that computer's debug key. Builds of other branches are only checked, not
published.

**Google Play:** the app targets Android 16 (API 36), as Play requires for new apps since 31 August 2026. Once the
repository has the secrets `UPLOAD_KEYSTORE_BASE64` (the upload keystore, base64) and `UPLOAD_KEYSTORE_PASSWORD`
(its password, also used for the key, alias `upload`), each main build also makes `gt7-timetrials-play.aab`
(`gradle bundlePlay`), signed with that key, and puts it on the same release page, for uploading to the Play
Console. Google re-signs it for users (Play App Signing); a lost upload key can be reset through the Play Console.

**Tests:** `tests/test_gt7tt.py` (`AndroidRecorderTest`) compiles the recorder with plain `javac`, checks it decodes
packets like the Python recorder, and records a lap from a fake PlayStation on the same computer. It also replays
recordings through the audio cues (on time, and with unusual driving: off the line, reversing, a restart, a pause, a
point-to-point track), simulates calibrations and checks the starting delays. `UiTest` runs `tests/test_ui.js`: the
website's screens in a phone-sized browser as a visitor, in the earlier apps and in the current app. The earlier apps
are stand-ins for `GT7App` with exactly the bridge methods (`@JavascriptInterface`) of **the app on main** (read with
`git show origin/main:…`, so before a merge it's the app testers have, provided main's last `.aab` was uploaded to
Play) and of **the first Play release** (up to release 16: recording only). Each must record, compare and save with
the new website, show audio cue controls only if it has them, and never be asked for anything it doesn't have.
`GT7_MAIN_REF=<commit>` checks against another commit's app instead (for example the one a Play release was built
from). GitHub runs all the tests
on every push to `main` and `beta` (`.github/workflows/tests.yml`).

**Beta:** new work goes to the `beta` branch first, so the owner can try it before testers get it.
- The **beta website** is built from `beta` (with main's data) at https://gt7-timetrials.github.io/beta/, hidden from
  search engines and marked "Beta" at the top. A push to `beta` republishes the site once its tests pass
  (`pages.yml` starts when the Tests workflow finishes, and builds each branch's last tested commit).
- The **beta app** ("Time Trials beta", orange icon, app ID `io.github.gt7timetrials.beta`, `gradle assembleBeta`)
  installs next to the Play app and shows the beta website. Pushes to `beta` that change `android/` put it on the
  `android-beta` release:
  https://github.com/gt7-timetrials/gt7-timetrials.github.io/releases/download/android-beta/gt7-timetrials-beta.apk
- When the owner is happy, `beta` is merged into `main`: the main website changes for everyone, and app changes are
  ready as the Play `.aab` on the android-test release, uploaded to Play when the owner chooses.
