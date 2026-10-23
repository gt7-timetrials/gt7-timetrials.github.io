# GT7 website API findings (2026-10-23)

Unofficial, undocumented API behind gran-turismo.com. It can change without notice.
Host: `https://web-api.gt7.game.gran-turismo.com`. All calls are `POST` with a JSON body.

| Endpoint | Body | Login needed | Returns |
|---|---|---|---|
| `/event/get_parameter` | `{"event_id": 15000}` | no | event window, track, regulation, `online.ranking_id` (board id) |
| `/ranking/get_top_list` | `{"board_id": "p_rt_1015000_001"}` | no | top 100 entries + `total` (entrant count) |
| `/ranking/get_list_by_page` | `{"board_id": ..., "page": 0}` | **yes** (PSN bearer token) | any page of the full board |

- Board id pattern: `p_rt_10<event_id>_001`.
- `score` is the lap time in milliseconds.
- Each entry has `display_rank`, `score`, `update_time`, `ranking_stats.car_code`, and
  `user` with a stable `user_id` (UUID), `np_online_id` (PSN name), `nick_name`,
  `country_code`, `driver_rating`, `sportsmanship_rating`.
- There is no platform field: one board covers PS4 and PS5.
- Past events still serve their top 100 and total (checked: event 11908 from April 2025),
  so driver history can be backfilled.
- Unknown event ids return HTTP 404. Event 15000 is live 2026-10-22 to 2026-11-05.
- The list of current events comes from `static.gt7.game.gran-turismo.com/championship/seasons/{region}/active.json`
  (host not yet allowed in this environment).

## Consequence for the gold percentile

The gold time (WR x 1.03) usually sits thousands of places down, well outside the
public top 100. Its exact rank needs `get_list_by_page`, which needs a signed-in token.
