Lap Companion for GT7 - recording your lap
===========================================

telemetry.py records Gran Turismo 7's telemetry (speed, throttle, brake, steering and
position, 60 times a second) from your PS5 or PS4 on your home network and saves it
to a CSV file. Upload that file on https://gt7-timetrials.github.io/ to compare your
lap with the world record, corner by corner. The comparison runs in your browser;
your file isn't uploaded anywhere.

The recorder only talks to your console on your home network. It doesn't touch your
PSN account and doesn't change anything on the console.

What you need
-------------
- A Windows PC, Mac or Linux computer on the same home network (same router) as the
  PlayStation. Cable or Wi-Fi doesn't matter.
- The recorder. Two ways to get it:
  - Ready to run, nothing to install (Windows, and Macs with Apple silicon):
      Windows: https://github.com/gt7-timetrials/gt7-timetrials.github.io/releases/download/recorder/gt7-recorder-windows.exe
      Mac:     https://github.com/gt7-timetrials/gt7-timetrials.github.io/releases/download/recorder/gt7-recorder-mac.zip
  - Or the Python script, telemetry.py (the website's "Python script" link), for any
    computer with Python 3.8 or newer (Intel Macs and Linux too).

One-off setup: the ready-made recorder
--------------------------------------
Windows: save gt7-recorder-windows.exe in your Downloads folder. The first time you open
  it, Windows may warn "Windows protected your PC", because the program isn't signed (it's
  a free hobby project): click "More info", then "Run anyway". If Windows Firewall asks,
  allow it on Private networks.
Mac: unzip gt7-recorder-mac.zip. The first time, right-click gt7-recorder and choose
  Open (macOS won't open an unsigned program with a double-click the first time; if it
  still refuses, go to System Settings > Privacy & Security and click "Open Anyway").

One-off setup: the Python script (Windows)
------------------------------------------
1. Install Python from https://www.python.org/downloads/
   On the first installer screen tick "Add python.exe to PATH", then click Install Now.
2. Save telemetry.py in your Downloads folder.

Recording a lap
---------------
1. Start GT7 and go to the time trial, daily race or license test. (The PlayStation only
   answers while GT7 is running.)
2. Start the recorder:
   - Ready-made: double-click gt7-recorder (it opens a window).
   - Python script: open Command Prompt (Windows key, type cmd, Enter) and type:

       cd %USERPROFILE%\Downloads
       py telemetry.py

     (On a Mac or Linux open Terminal, go to the folder and run: python3 telemetry.py)

   It finds your PlayStation by itself.
3. If Windows Firewall asks, allow it on Private networks.
4. Drive. Start before you cross the start line and keep going until you have crossed
   it again: at least one full lap. Each completed lap is shown with its time.
   Drive as many laps as you like; you can pick any of them on the website.
5. Press Ctrl+C to stop. The file is saved next to the recorder, named like
   telemetry_20261025_214804.csv, and the window tells you where.
6. On the website, find the event, race or test and click "Upload your lap".

If it doesn't work
------------------
- "Still no answer": check that GT7 is running (not just the PS5 home screen), that the
  computer and the PlayStation use the same router, and that the firewall allowed the
  recorder (or Python). You can also give the address yourself, from Command Prompt or
  Terminal in the recorder's folder: gt7-recorder-windows.exe 192.168.1.23 (Windows),
  ./gt7-recorder 192.168.1.23 (Mac) or py telemetry.py 192.168.1.23
  (PS5: Settings > Network > Connection Status > View Connection Status > IPv4 Address).
- "The connection dropped": Wi-Fi hiccup. The recorder reconnects by itself; record
  another lap if the one with the dropout matters.
- "Could not listen on port 33740": another telemetry app is running. Close it.
- Windows Defender or another antivirus flags the ready-made recorder: programs packaged
  this way are sometimes mistaken for threats. Use the Python script instead, which
  is the same recorder as plain text you can read.
- "py is not recognised": Python isn't installed, or "Add python.exe to PATH" wasn't
  ticked. Run the installer again.
