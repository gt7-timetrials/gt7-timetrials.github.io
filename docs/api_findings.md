# GT7 website API findings (October 2026)

Unofficial, undocumented API behind gran-turismo.com. It can change without notice.
Host: `https://web-api.gt7.game.gran-turismo.com`. All calls are `POST` with a JSON body.

| Endpoint | Body | Login needed | Returns |
|---|---|---|---|
| `/event/get_folder` | `{"region_id": 5, "folder_id": 249}` | no | every time trial since March 2023 with full parameters |
| `/event/get_parameter` | `{"event_id": 15000}` | no | one event: window, track, regulation, `online.ranking_id` (board id) |
| `/ranking/get_top_list` | `{"board_id": "p_rt_1015000_001"}` | no | top 100 entries + `total` (entrant count) |
| `/ranking/get_list_by_page` | `{"board_id": ..., "page": 0}` | **yes** (PSN bearer token) | any page of the full board |

- Folder 249 is the time trial list the website's Sport page uses. Region ids: 2 Europe,
  4 Asia, 5 Oceania, 6 North America, 7 Latin America.
- Board id pattern: `p_rt_10<event_id>_001`.
- `score` is the lap time in milliseconds.
- Each entry has `display_rank`, `score`, `update_time` (when that best lap was set),
  `ranking_stats.car_code`, and `user` with a stable `user_id` (UUID), `np_online_id` (PSN name),
  `nick_name`, `country_code`, `driver_rating` and `sportsmanship_rating`.
- There is no platform field: one board covers PS4 and PS5.
- Past events still serve their top 100 and total.
- Regular time trials have `event.event_title_key == "OnlineTA_General_Title"`. Sponsored
  one-offs (AMG, HRC, Polestar and so on) have their own title keys.

## Rate limit

The API is behind an AWS load balancer rate limit. A few hundred requests in quick succession
lead to HTTP 403 for every request for about 3–5 minutes. One request every 2 seconds was fine
for thousands of requests. The daily job makes about 5 requests.

## Gold percentile (dropped)

The gold time (WR x 1.03) usually sits thousands of places down, outside the public top 100.
Its exact rank needs `get_list_by_page`, which needs a signed-in token.
