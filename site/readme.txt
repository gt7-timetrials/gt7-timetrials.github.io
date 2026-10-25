GT7 Time Trial Tracker - recording your lap
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
- Python 3.8 or newer (free). Nothing else to install.

One-off setup (Windows)
-----------------------
1. Install Python from https://www.python.org/downloads/
   On the first installer screen tick "Add python.exe to PATH", then click Install Now.
2. Save telemetry.py (the website's "Download recorder" link) in your Downloads folder.
3. Find your PlayStation's IP address:
   Settings > Network > Connection Status > View Connection Status > IPv4 Address
   (for example 192.168.1.23).

Recording a lap
---------------
1. Start GT7 and go to the time trial.
2. Open Command Prompt (Windows key, type cmd, Enter) and type, using your console's
   address:

       cd %USERPROFILE%\Downloads
       py telemetry.py 192.168.1.23

   (On a Mac or Linux open Terminal, go to the folder and run:
    python3 telemetry.py 192.168.1.23)

3. If Windows Firewall asks, allow Python on Private networks.
4. Drive. Start before you cross the start line and keep going until you have crossed
   it again: at least one full lap. More laps are fine; the fastest complete lap
   in the file is used.
5. Press Ctrl+C to stop. The file is saved next to telemetry.py, named like
   telemetry_20261025_214804.csv.
6. On the website, open Current, find the event and click "Upload your lap".

If it doesn't work
------------------
- "waiting for data..." keeps showing: check the IP address, that GT7 is running (not
  just the PS5 home screen), and that the firewall allowed Python.
- "Could not listen on port 33740": another telemetry app is running. Close it.
- "py is not recognised": Python isn't installed, or "Add python.exe to PATH" wasn't
  ticked. Run the installer again.
