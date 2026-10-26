# Android app

`android/` is a small Android app (plain Java, no extra libraries): the website in a WebView, plus recording on the
phone. When the site runs inside the app, `window.GT7App` exists and the lap comparison shows **Record on this
phone** instead of the computer recorder's download links.

- `Recorder.java` / `Telemetry.java` do what `tools/telemetry.py` does: find the PlayStation by sending the heartbeat
  to every address on the phone's Wi-Fi network (last time's address first), decrypt the packets, and keep them as a
  CSV with the same columns. Progress goes to the page as JSON events (`searching`, `slow`, `connected`, `state`,
  `lap`, `silent`, `dropout`, `error`, `stopped`) through `window.GT7AppEvent`.
- When the player taps **Stop and compare**, the page takes the CSV from `GT7App.csv()` and runs the same
  comparison as for an uploaded file. **Save the recording** writes it to Downloads.
- The screen stays on while recording. Links to other sites open in the browser.

**Builds:** every push that changes `android/` runs `.github/workflows/android.yml`, which builds the APK and puts it on
the `android-test` release:
https://github.com/gt7-timetrials/gt7-timetrials.github.io/releases/download/android-test/gt7-timetrials.apk
Test builds are signed with `android/app/test.keystore` (password in `app/build.gradle`), so each one installs over
the last. A Google Play release will need a private upload key instead.

**Tests:** `tests/test_gt7tt.py` (`AndroidRecorderTest`) compiles the recorder with plain `javac`, checks it decodes
packets like the Python recorder, and records a lap from a fake PlayStation on the same computer.
