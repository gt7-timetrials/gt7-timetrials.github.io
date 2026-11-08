# Working on this project

GT7 time trial tracker: the website (`site/`, built by `gt7tt/` into GitHub Pages) and the Android app (`android/`,
"Lap Companion for GT7", shown as "Laps for GT7" under the icon, on Google Play; a WebView of the website plus
recording). The plan is in `docs/plan.md`; the
app, builds and keys are in `docs/android.md`.

## How changes are made

- **Work on the `beta` branch, never directly on `main`.** Pushing to beta publishes the beta website
  (https://gt7-timetrials.github.io/beta/) and the beta app (the `android-beta` release), so the owner can try changes
  without affecting testers. Before starting, bring beta up to date with main (`git merge origin/main`).
- **Merge beta into main only when the owner says "merge"**, through a pull request, and only with the Tests workflow
  green on beta. Afterwards, bring beta up to date with main again.
- **Run the tests before pushing:** `python -m unittest tests.test_gt7tt` (includes the Java and browser tests) and
  `node tests/test_coach.js`. GitHub runs them on every push; red means don't merge.
- **Changing the lap advice** (the tips' wording or the rules for when they're given, in `site/coach.js`): the test
  checks the advice for two real laps word for word, so it fails until `tests/fixtures/expected_advice.json` is
  rewritten (`UPDATE_ADVICE=1 node tests/test_coach.js`). Read its diff and show the owner what changed.
- **The Google Play app must keep working with the website.** Testers' installed app loads the live site, and app
  updates reach them only after the owner uploads the `.aab` and Google approves it. New app features are detected in
  `site/app.js` (for example `CUES`); the browser test in `tests/test_ui.js` checks this against the app on main (read
  from its code, so it is the app testers have, if main's last `.aab` was uploaded) and the first Play release. If a
  change can't work with the Play app, say so before merging.
- **Main's daily snapshot job commits data** (`data/`); the beta website uses main's data.
- **Exception: new reference laps go straight to main**, like the daily data: adding the owner's recording to
  `data/reference_laps/` (with its driver in `data/reference_laps/drivers.json`; and removing an ended event's), flagging a free car choice event in
  `data/free_choice.json`, the week's daily races (`data/daily/races.json` and their laps in `data/daily/laps/`), and
  running `python -m gt7tt daily` by hand so a new event
  shows the same day. The beta website can't show them anyway. Only data: any code change still goes through beta.
  Check first that the lap matches the event (car, and the world record time) and run the tests.
- **Exception: the plan and notes go straight to main** (`docs/plan.md`, and other notes that change nothing on the
  website or app, such as `docs/play-listing.md`), the owner's choice to keep them out of the beta and merge process:
  no pull request, and no need to copy them to beta, which picks them up when the next beta work starts (`git merge
  origin/main`). `CLAUDE.md` itself counts as notes. Anything that
  changes the website, the app, the tests or the builds still goes through beta.
- **The website is published only after the tests pass:** "Publish website" starts when the Tests workflow finishes
  on main or beta (a few minutes after the push) and builds each from its last commit that passed. A red run leaves the
  site as it was, data included, until it's fixed.
- **After pushing to beta, check the beta website has the change** (fetch a changed file from
  https://gt7-timetrials.github.io/beta/) before telling the owner it's ready: several rebuilds close together can
  report success without updating the site; start the "Publish website" workflow again if so.
- Never put model names or IDs in commits, pull requests or files.
