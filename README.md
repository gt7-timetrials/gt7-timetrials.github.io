# Gt7
Time trial times and predictions for Gran Turismo 7 online time trials.

Every morning (Melbourne time) a scheduled job fetches the running time trials and saves a snapshot
of each leaderboard. It then predicts where the gold time (world record + 3%) will end up and writes
the results to [REPORT.md](REPORT.md), `report.json` and the website.

For each running time trial the report shows:

- **Entrants:** the total number of drivers so far, compared with how many past events finished with.
  Once a few events have daily snapshots it also shows a projected final count.
- **World record:** the current WR and gold time.
- **Predicted gold:** the predicted final gold time, with a likely range covering 80% of past events.
- **Top-100 spread:** how far P100 is behind P1, a measure of how hard the course is.
- **Top drivers posted:** how many of the 25 historically fastest drivers have set a time.

## Running it yourself

Needs Python 3.10+ and numpy (`pip install -r requirements.txt`).

```
python -m gt7tt daily      # fetch, save snapshots, write REPORT.md / report.json, print report
python -m gt7tt report     # print the report from the latest saved snapshot (no network)
python -m gt7tt backtest   # how accurate each prediction method was on past events
python -m gt7tt site       # build the website into _site/ (open _site/index.html via a local web server)
python -m unittest discover tests
```

## How the prediction works

- History: final top 100 and entrant counts of every regular time trial since March 2023 (202 events),
  plus daily snapshots collected from 24 Oct 2026.
- The model predicts how much faster the final WR will be than today's, from:
  - how far through the event we are; most WRs are set by day 8;
  - how many of the top-rated drivers have already posted a time;
  - the top-100 spread, once 3 events have daily snapshots to calibrate it.
- Driver ratings are each driver's median gap to the WR across events, shrunk towards average for
  drivers with few appearances.
- After 15 events with daily snapshots the model is fitted on those snapshots directly.

Backtest accuracy is the median error in the predicted final WR (and so the gold time), with
each event held out:

| Day | Error | 90% of events within |
|---|---|---|
| 1 | 0.16% | 0.36% |
| 3 | 0.12% | 0.28% |
| 7 | 0.08% | 0.20% |
| 10 | 0.06% | 0.14% |

On a 1:50 lap, 0.12% is about 0.13 s. With the true top-100 spread known, early errors were about
25% lower, which is why the spread is switched on once it can be calibrated.

## Data source

This uses the unofficial API behind gran-turismo.com, which may change without notice and is
rate limited. See [docs/api_findings.md](docs/api_findings.md).

Car and track names come from gran-turismo.com's own English strings (`python tools/update_names.py`
refreshes them when new tracks or cars appear). [ddm999/gt7info](https://github.com/ddm999/gt7info)
provides the track categories and is the fallback for names.

## Daily job and website

- Sony's API answers HTTP 403 to GitHub Actions servers, so the daily fetch runs as a scheduled
  Claude Code cloud session. It runs `python -m gt7tt daily` and pushes the new data to `main`.
- Every push to `main` runs `.github/workflows/pages.yml`, which builds the site
  (`python -m gt7tt site`) and publishes it on GitHub Pages.
- The site's source is in `site/`; `data.json` and `events/<event_id>.json` (one page per finished event, opened at `#past/<event_id>`) are generated.
