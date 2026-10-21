#!/usr/bin/env python3
"""Find the best 360° photo taken on or right by each summit, from Mapillary.

Writes data/panos.json: one entry per peak that has a photo within 150 m of the top.
The peak page shows that photo, with the sun's path and the hill names placed on it.

Needs a Mapillary client access token (free): set MAPILLARY_TOKEN, or put it in
assets/js/config.js as mapillaryToken. Standard library only.

  python scripts/find_panos.py
"""
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
API = "https://graph.mapillary.com/images"
RADIUS = 150  # metres from the summit
USER_AGENT = "InversionWatch/1.0 (360 photo search; GitHub Actions)"
FIELDS = "id,is_pano,computed_compass_angle,compass_angle,captured_at,computed_geometry,geometry,creator"


def token():
    t = os.environ.get("MAPILLARY_TOKEN", "").strip()
    if t:
        return t
    try:
        cfg = open(os.path.join(ROOT, "assets", "js", "config.js")).read()
        m = re.search(r"mapillaryToken\s*:\s*['\"]([^'\"]+)['\"]", cfg)
        return m.group(1).strip() if m else ""
    except OSError:
        return ""


def dist_m(lat1, lon1, lat2, lon2):
    la1, la2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))


def search(lat, lon, tok):
    dlat = RADIUS / 111320
    dlon = RADIUS / (111320 * math.cos(math.radians(lat)))
    params = {"access_token": tok, "fields": FIELDS, "is_pano": "true", "limit": 100,
              "bbox": f"{lon - dlon:.6f},{lat - dlat:.6f},{lon + dlon:.6f},{lat + dlat:.6f}"}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": USER_AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r).get("data", [])
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit("Mapillary refused the token (HTTP %d). Check the token in config.js or the MAPILLARY_TOKEN secret." % e.code)
            time.sleep(5 * (attempt + 1))
        except Exception:
            time.sleep(5 * (attempt + 1))
    return []


def best(photos, lat, lon):
    """Closest to the top wins; photos with a computed (corrected) compass and newer photos get a small bonus."""
    scored = []
    for p in photos:
        if not p.get("is_pano", True):
            continue
        g = (p.get("computed_geometry") or p.get("geometry") or {}).get("coordinates")
        heading = p.get("computed_compass_angle", p.get("compass_angle"))
        if not g or heading is None:
            continue
        d = dist_m(lat, lon, g[1], g[0])
        if d > RADIUS:
            continue
        years = (time.time() * 1000 - (p.get("captured_at") or 0)) / 3.15e10
        score = d + (0 if "computed_compass_angle" in p else 40) + 4 * max(0, years)
        scored.append((score, d, p, g, heading))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0])
    _, d, p, g, heading = scored[0]
    return {
        "id": str(p["id"]),
        "heading": round(float(heading), 1),       # compass bearing of the middle of the photo
        "lat": round(g[1], 6), "lon": round(g[0], 6), "dist": round(d),
        "captured": time.strftime("%Y-%m-%d", time.gmtime((p.get("captured_at") or 0) / 1000)),
        "by": (p.get("creator") or {}).get("username", ""),
    }


def main():
    tok = token()
    if not tok:
        print("No Mapillary token yet (MAPILLARY_TOKEN or mapillaryToken in config.js), so no 360° photos. Skipping.")
        return
    peaks = json.load(open(os.path.join(DATA, "peaks.json")))["peaks"]
    out = {}
    for pk in peaks:
        lat, lon = pk["lat"], pk["lon"]
        tpath = os.path.join(DATA, "terrain", pk["id"] + ".json")
        if os.path.exists(tpath):  # the snapped summit is a better centre than the listed one
            try:
                t = json.load(open(tpath))
                lat, lon = t.get("lat", lat), t.get("lon", lon)
            except Exception:
                pass
        pick = best(search(lat, lon, tok), lat, lon)
        if pick:
            out[pk["id"]] = pick
            print(f"{pk['name']}: photo {pick['id']}, {pick['dist']} m from the top, {pick['captured']}", flush=True)
        else:
            print(f"{pk['name']}: no 360° photo within {RADIUS} m", flush=True)
        time.sleep(0.3)
    with open(os.path.join(DATA, "panos.json"), "w") as f:
        json.dump({"source": "mapillary", "peaks": out}, f, separators=(",", ":"))
    print(f"Found 360° photos for {len(out)} of {len(peaks)} peaks")


if __name__ == "__main__":
    main()
