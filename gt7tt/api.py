"""Client for the unofficial GT7 website API (web-api.gt7.game.gran-turismo.com).

No login is needed for the calls used here. The API sits behind an AWS rate
limit that answers HTTP 403 for a few minutes once exceeded, so requests are
sequential, throttled, and back off on 403.
"""
import json
import time
import urllib.error
import urllib.request

API = "https://web-api.gt7.game.gran-turismo.com"
TIME_TRIAL_FOLDER = 249
REGION_OCEANIA = 5


class Client:
    def __init__(self, delay=2.0, log=print):
        self.delay = delay  # seconds between requests; grows after each rate-limit hit
        self.log = log

    def post(self, path, body):
        """POST and return parsed JSON, or None for 404. Waits out rate limits."""
        req = urllib.request.Request(
            API + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
        )
        for attempt in range(6):
            time.sleep(self.delay)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code == 403:
                    self.delay *= 1.5
                    self.log(f"rate limited at {path} {body}; waiting 6 min")
                    time.sleep(360)
                else:
                    self.log(f"HTTP {e.code} on {path} {body}")
                    time.sleep(10 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError) as e:
                self.log(f"{e} on {path} {body}")
                time.sleep(10 * (attempt + 1))
        raise RuntimeError(f"{path} {body} failed repeatedly")

    def time_trials(self):
        """Every time trial since March 2023 (current ones included): {event_id: parameters}."""
        d = self.post("/event/get_folder", {"region_id": REGION_OCEANIA, "folder_id": TIME_TRIAL_FOLDER})
        return {item["event_id"]: item["parameters"] for item in d["result"]}

    def event(self, event_id):
        d = self.post("/event/get_parameter", {"event_id": event_id})
        return (d or {}).get("result")

    def top100(self, board_id):
        """Public top 100 plus `total` entrant count."""
        d = self.post("/ranking/get_top_list", {"board_id": board_id})
        return (d or {}).get("result")
