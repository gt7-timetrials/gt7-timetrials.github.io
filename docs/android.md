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
- When the player taps **Stop and compare**, the page takes the CSV from `GT7App.csv()` and runs the same
  comparison as for an uploaded file. **Save to Downloads**, on the result line, writes it to Downloads.
- The screen stays on while recording. Links to other sites open in the browser.

**Builds:** every push that changes `android/` runs `.github/workflows/android.yml`, which builds the APK and puts it on
the `android-test` release:
https://github.com/gt7-timetrials/gt7-timetrials.github.io/releases/download/android-test/gt7-timetrials.apk
Test builds are signed with `android/app/test.keystore` (password in `app/build.gradle`), so each one installs over
the last. Builds of other branches are only checked, not published.

**Google Play:** the app targets Android 16 (API 36), as Play requires for new apps since 31 August 2026. Once the
repository has the secrets `UPLOAD_KEYSTORE_BASE64` (the upload keystore, base64) and `UPLOAD_KEYSTORE_PASSWORD`
(its password, also used for the key, alias `upload`), each main build also makes `gt7-timetrials-play.aab`
(`gradle bundlePlay`), signed with that key, and puts it on the same release page, for uploading to the Play
Console. Google re-signs it for users (Play App Signing); a lost upload key can be reset through the Play Console.

**Tests:** `tests/test_gt7tt.py` (`AndroidRecorderTest`) compiles the recorder with plain `javac`, checks it decodes
packets like the Python recorder, and records a lap from a fake PlayStation on the same computer.
