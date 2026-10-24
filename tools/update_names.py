"""Refresh data/ref/official_names.json with English course and car names.

The gran-turismo.com Sport page loads its English strings from
/common/dist/gt7/companion/localize16.js (one webpack chunk per language).
Run when new tracks or cars appear: python tools/update_names.py
"""
import json
import os
import re
import urllib.request

URL = "https://www.gran-turismo.com/common/dist/gt7/companion/localize16.js"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "ref", "official_names.json")


def main():
    with urllib.request.urlopen(URL, timeout=30) as resp:
        js = resp.read().decode("utf-8")
    if 'SPR_LABEL_ARCHIVE:"Event Archive"' not in js:
        raise SystemExit("localize16.js is no longer the English chunk; find the new one by its strings")
    courses = {int(k): name for k, _base, name in re.findall(r'"#CRS(\d+)":\{base_name:"([^"]*)",name:"([^"]*)"', js)}
    cars = {int(k): name for k, name in re.findall(r'"#CAR(\d+)":\{[^}]*?name:"([^"]*)"', js)}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"courses": courses, "cars": cars}, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"{len(courses)} courses, {len(cars)} cars -> {OUT}")


if __name__ == "__main__":
    main()
