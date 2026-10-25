# Telemetry test (Windows)

This checks two things before any coaching feature is built:

1. Does your PS5 send GT7's telemetry to your computer?
2. Does it keep sending while you **watch a downloaded replay** of a top driver? If so, we can record the top drivers' laps.

The script only listens on your home network. It sends the PS5 the small "start sending" message GT7 expects,
and saves what comes back to a file. It doesn't touch your PSN account or change anything on the console.

## One-off setup

1. **Install Python.** Go to <https://www.python.org/downloads/>, click the yellow *Download Python* button and run it.
   On the first installer screen, tick **"Add python.exe to PATH"**, then click *Install Now*.
2. **Download the script.** Open
   <https://github.com/gt7-timetrials/gt7-timetrials.github.io/blob/main/tools/telemetry_test.py>
   and click the **download icon** ("Download raw file") at the top right of the code. It goes to your Downloads folder
   as `telemetry_test.py`.
3. **Find your PS5's IP address.** On the PS5: *Settings → Network → Connection Status → View Connection Status*.
   Note the **IPv4 address**, for example `192.168.1.23`.

## Run the test

1. Start GT7 on the PS5.
2. On the computer, press the Windows key, type `cmd` and open **Command Prompt**. Type these two lines (use your PS5's
   address), pressing Enter after each:

   ```
   cd %USERPROFILE%\Downloads
   py telemetry_test.py 192.168.1.23
   ```

3. If Windows Firewall asks whether to allow Python, tick **Private networks** and click **Allow**.
   (If you missed it, close the window with Ctrl+C and run the second line again.)
4. **Test 1, your own lap.** Drive a lap in the current time trial. The Command Prompt window should show a line every
   second with your speed, throttle, brake and gear changing. Then press **Ctrl+C** to stop. It prints a summary and
   saves a file named like `telemetry_20261025_191500.csv` in Downloads.
5. **Test 2, a top driver's replay.** Run `py telemetry_test.py 192.168.1.23` again. In GT7, open the time trial's
   leaderboard, pick a top driver, download their replay and **watch it**. Do the numbers in the window change with
   their car? Press **Ctrl+C** when the lap is done.

## Send the results back

Send the two CSV files (or, if that's awkward, copy the summaries from the window) back to Claude. Attach them in the
chat if the app allows it. Otherwise, on GitHub open the `docs` folder, click *Add file → Upload files*, drop them in and
click *Commit changes*.

## If it doesn't work

- **"waiting for data..." forever:** check the IP address, that GT7 is running (not just the PS5 home screen), and that
  the firewall allowed Python. The computer and the PS5 must be on the same router; cable or Wi-Fi doesn't matter.
- **"Could not listen on port 33740":** another telemetry app is running. Close it and try again.
- **`py` is not recognised:** Python isn't installed, or the PATH box wasn't ticked. Run the installer again and choose
  *Modify*, or reinstall with the box ticked.
