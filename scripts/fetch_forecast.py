#!/usr/bin/env python3
"""Fetch mountain forecasts from Open-Meteo and score the chance of a cloud inversion.

Writes:
  data/forecast.json        summary for every peak (used by the overview page)
  data/peaks/<id>.json      hourly atmospheric profiles for one peak (used by the peak page)

Standard library only, so it runs on a bare GitHub Actions runner.

  python scripts/fetch_forecast.py           # live data from Open-Meteo
  python scripts/fetch_forecast.py --demo    # made-up but realistic data, for local previews
"""
import argparse
import datetime as dt
import json
import math
import os
import random
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
API = "https://api.open-meteo.com/v1/forecast"
LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700]  # hPa, roughly 100 m to 3 km
DAYS = 6
PROFILE_HOURS = list(range(3, 13))  # 03:00 to 12:00 local, for the slider
BATCH = 8  # locations per request
LAPSE = 6.5 / 1000  # normal cooling, °C per metre

# Score weights, out of 100. Keep in sync with the "How the score works" text.
WEIGHTS = {"diff": 30, "moist": 20, "wind": 15, "pressure": 15, "below": 10, "clear": 10}


# --------------------------------------------------------------------------- fetching

def hourly_fields():
    f = ["temperature_2m", "relative_humidity_2m", "pressure_msl", "cloud_cover_low", "cloud_cover_high"]
    for lv in LEVELS:
        f += [f"temperature_{lv}hPa", f"relative_humidity_{lv}hPa", f"geopotential_height_{lv}hPa", f"wind_speed_{lv}hPa"]
    return f


def fetch_batch(peaks):
    params = {
        "latitude": ",".join(f"{p['lat']:.4f}" for p in peaks),
        "longitude": ",".join(f"{p['lon']:.4f}" for p in peaks),
        "hourly": ",".join(hourly_fields()),
        "daily": "sunrise",
        "timezone": "Europe/London",
        "wind_speed_unit": "mph",
        "forecast_days": DAYS,
    }
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                body = json.load(r)
            return body if isinstance(body, list) else [body]
        except Exception as e:  # network blip or rate limit: back off and retry
            if attempt == 3:
                raise
            print(f"  retry after error: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))


# --------------------------------------------------------------------------- demo data

def demo_response(peak, start):
    """A fake Open-Meteo response with a plausible inversion pattern, for previews."""
    rnd = random.Random(peak["id"] + start.isoformat())
    hours, h = [], {k: [] for k in hourly_fields()}
    strength = [rnd.uniform(3, 9), rnd.uniform(1, 7), rnd.uniform(-2, 5), rnd.uniform(-6, 1), rnd.uniform(-3, 4), rnd.uniform(0, 7)]
    sunrise = []
    for d in range(DAYS):
        day = start + dt.timedelta(days=d)
        sunrise.append(f"{day.isoformat()}T07:{30 + d:02d}")
        inv = strength[d]
        top = rnd.uniform(450, 900) if inv > 0 else rnd.uniform(900, 1400)
        p = 1012 + inv * 2.5 + rnd.uniform(-2, 2)
        wind = max(3, 20 - inv * 2 + rnd.uniform(-3, 3))
        for hr in range(24):
            hours.append(f"{day.isoformat()}T{hr:02d}:00")
            warm = max(0, hr - 8) * 1.3  # valley warms after sunrise
            fade = max(0.0, 1 - max(0, hr - 8) * 0.3)
            vt = 3 - inv * 0.4 + warm
            h["temperature_2m"].append(round(vt, 1))
            h["relative_humidity_2m"].append(round(min(100, 85 + inv * 2 * fade), 0))
            h["pressure_msl"].append(round(p, 1))
            h["cloud_cover_low"].append(round(min(100, 60 + inv * 5 * fade), 0))
            h["cloud_cover_high"].append(round(max(0, 50 - inv * 6 + rnd.uniform(-10, 10)), 0))
            for i, lv in enumerate(LEVELS):
                z = [110, 320, 540, 770, 1000, 1480, 1990, 3050][i]
                if inv > 0 and z <= top + 120:
                    t = vt - LAPSE * (z - 150) if z < top * 0.6 else vt + inv * (z - top * 0.6) / (top * 0.4 + 120)
                elif inv > 0:
                    t = vt + inv - LAPSE * (z - top - 120)
                else:
                    t = vt - LAPSE * (z - 150) - 1
                rh = 99 if (inv > 0 and fade > 0.1 and z <= top * fade + 150 and z >= 150) else (55 if inv > 0 else 92 if z < top else 70)
                h[f"temperature_{lv}hPa"].append(round(t, 1))
                h[f"relative_humidity_{lv}hPa"].append(rh)
                h[f"geopotential_height_{lv}hPa"].append(z)
                h[f"wind_speed_{lv}hPa"].append(round(wind * (0.4 + 0.6 * min(1, z / 1000)), 1))
    h["time"] = hours
    return {"elevation": peak["valley_m"] + 120, "hourly": h, "daily": {"time": [(start + dt.timedelta(days=d)).isoformat() for d in range(DAYS)], "sunrise": sunrise}}


# --------------------------------------------------------------------------- physics helpers

def interp(profile, z, key=1):
    """Linear interpolation of a [(height, temp, rh), ...] profile at height z."""
    pts = sorted(profile)
    if z <= pts[0][0]:
        a, b = pts[0], pts[1]
    elif z >= pts[-1][0]:
        a, b = pts[-2], pts[-1]
    else:
        for a, b in zip(pts, pts[1:]):
            if a[0] <= z <= b[0]:
                break
    if b[0] == a[0]:
        return a[key]
    return a[key] + (b[key] - a[key]) * (z - a[0]) / (b[0] - a[0])


def cloud_layer(profile, valley, summit, rh_2m, grid_elev):
    """Lowest saturated layer (RH >= 95%) that starts below the summit. Returns (base, top) or None."""
    pts = sorted(p for p in profile if p[0] >= valley - 150)
    if not pts:
        return None
    sat = [p[2] >= 95 for p in pts]
    base = None
    if rh_2m is not None and rh_2m >= 97 and grid_elev is not None:
        base = max(valley, grid_elev)
    for i, s in enumerate(sat):
        if s and base is None:
            if i == 0:
                base = max(valley, pts[0][0])
            else:
                a, b = pts[i - 1], pts[i]
                base = a[0] + (b[0] - a[0]) * (95 - a[2]) / max(1, b[2] - a[2])
        if base is not None and not s and i > 0 and pts[i][0] > base:
            a, b = pts[i - 1], pts[i]
            if a[2] >= 95:
                top = a[0] + (b[0] - a[0]) * (a[2] - 95) / max(1, a[2] - b[2])
            else:
                top = a[0]
            return (round(base), round(top)) if base < summit else None
    if base is not None and base < summit:
        return (round(base), round(pts[-1][0]))
    return None


def inversion_top(profile, valley, summit):
    """Height of the warmest point between the valley and a little above the summit, if it is warmer than the valley."""
    lo, hi = valley, summit + 400
    best, best_t = None, interp(profile, valley)
    z = lo
    while z <= hi:
        t = interp(profile, z)
        if t > best_t + 0.3:
            best, best_t = z, t
        z += 25
    return best


def freezing_level(profile):
    pts = sorted(profile)
    for a, b in reversed(list(zip(pts, pts[1:]))):
        if (a[1] > 0) != (b[1] > 0):
            return round(a[0] + (b[0] - a[0]) * a[1] / (a[1] - b[1]))
    return None if pts[-1][1] <= 0 else 99999


def dewpoint(t, rh):
    rh = max(1.0, min(100.0, rh))
    a, b = 17.62, 243.12
    g = math.log(rh / 100) + a * t / (b + t)
    return b * g / (a - g)


def clamp01(v):
    return max(0.0, min(1.0, v))


# --------------------------------------------------------------------------- scoring

def score_conditions(c, peak):
    diff = c["st"] - c["vt"]
    f = {
        "diff": clamp01((diff + 3) / 10),
        "moist": clamp01((c["rh_valley"] - 70) / 25),
        "wind": clamp01(1 - (c["wind"] - 5) / 20),
        "pressure": clamp01((c["pressure"] - 1010) / 20),
        "below": clamp01((peak["elev"] - c["cloud"][1]) / 250) if c["cloud"] else 0.0,
        "clear": clamp01(1 - c["high_cloud"] / 100),
    }
    total = sum(f[k] * WEIGHTS[k] for k in WEIGHTS)
    return max(3, min(95, round(total))), {k: round(v, 3) for k, v in f.items()}


def verdict(score, c, peak):
    if score >= 65:
        return "Strong chance of a cloud sea at dawn." if c["cloud"] and peak["elev"] - c["cloud"][1] > 150 else "Good chance of an inversion at dawn."
    if score >= 40:
        if c["cloud"] and c["cloud"][1] >= peak["elev"] - 100:
            return "Possible, but the cloud top may reach the summit."
        if not c["cloud"]:
            return "Possible. The air is inverted but the valleys may stay clear of cloud."
        return "Possible, though the signals are mixed."
    if c["wind"] > 25:
        return "Unlikely. Strong winds will mix the air."
    if c["st"] <= c["vt"]:
        return "Unlikely. The air cools normally with height."
    return "Unlikely this morning."


def conditions_at(resp, idx, peak):
    h = resp["hourly"]
    profile = []
    for lv in LEVELS:
        z, t, rh = h[f"geopotential_height_{lv}hPa"][idx], h[f"temperature_{lv}hPa"][idx], h[f"relative_humidity_{lv}hPa"][idx]
        if None not in (z, t, rh):
            profile.append((float(z), float(t), float(rh)))
    if len(profile) < 3:
        return None, None
    valley, summit = peak["valley_m"], peak["elev"]
    rh2 = h["relative_humidity_2m"][idx]
    grid = resp.get("elevation")
    winds = [(float(h[f"geopotential_height_{lv}hPa"][idx]), float(h[f"wind_speed_{lv}hPa"][idx] or 0)) for lv in LEVELS if h[f"geopotential_height_{lv}hPa"][idx] is not None]
    wind = interp([(z, w, 0) for z, w in winds], summit)
    c = {
        "st": round(interp(profile, summit), 1),
        "vt": round(interp(profile, valley), 1),
        "rh_valley": round(max(interp(profile, valley, 2), rh2 or 0)),
        "wind": round(max(0, wind)),
        "pressure": round(h["pressure_msl"][idx] or 1013),
        "high_cloud": round(h["cloud_cover_high"][idx] or 0),
        "cloud": cloud_layer(profile, valley, summit, rh2, grid),
        "inv_top": inversion_top(profile, valley, summit),
        "fz": freezing_level(profile),
    }
    return c, profile


def process(peak, resp, generated):
    h = resp["hourly"]
    index = {t: i for i, t in enumerate(h["time"])}
    summary_days, detail_days = [], []
    for d, date in enumerate(resp["daily"]["time"][:DAYS]):
        sunrise = resp["daily"]["sunrise"][d]
        sr_h, sr_m = int(sunrise[11:13]), int(sunrise[14:16])
        dawn_hour = sr_h + (1 if sr_m >= 30 else 0)
        idx = index.get(f"{date}T{dawn_hour:02d}:00")
        if idx is None:
            continue
        c, _ = conditions_at(resp, idx, peak)
        if c is None:
            continue
        score, factors = score_conditions(c, peak)

        hours = []
        last_good = None
        for hr in PROFILE_HOURS:
            j = index.get(f"{date}T{hr:02d}:00")
            if j is None:
                continue
            ch, prof = conditions_at(resp, j, peak)
            if ch is None:
                continue
            if hr >= sr_h and ch["cloud"] and ch["cloud"][1] < peak["elev"] and ch["st"] > ch["vt"]:
                last_good = hr
            hours.append({
                "t": f"{hr:02d}:00",
                "levels": [[round(z), round(t, 1), round(dewpoint(t, rh), 1)] for z, t, rh in sorted(prof)],
                "st": ch["st"], "vt": ch["vt"], "cloud": ch["cloud"], "inv_top": ch["inv_top"], "fz": ch["fz"],
                "wind": ch["wind"],
            })

        window = None
        if score >= 40 and c["cloud"] and c["cloud"][1] < peak["elev"]:
            start_min = sr_h * 60 + sr_m - 45
            end_min = min(sr_h * 60 + sr_m + 180, ((last_good or sr_h) + 1) * 60)
            if end_min > start_min:
                window = [f"{start_min // 60:02d}:{start_min % 60:02d}", f"{end_min // 60:02d}:{end_min % 60:02d}"]

        conf = "High" if d < 2 else "Medium" if d == 2 else "Low"
        day = {
            "date": date, "sunrise": sunrise[11:16], "score": score, "conf": conf,
            "verdict": verdict(score, c, peak), "window": window,
            "st": c["st"], "vt": c["vt"], "wind": c["wind"], "pressure": c["pressure"],
            "rh_valley": c["rh_valley"], "high_cloud": c["high_cloud"],
            "cloud": c["cloud"], "inv_top": c["inv_top"], "fz": c["fz"], "factors": factors,
        }
        summary_days.append({k: day[k] for k in ("date", "sunrise", "score", "conf", "window", "st", "vt", "wind", "cloud")})
        detail_days.append(dict(day, hours=hours))
    return summary_days, {"id": peak["id"], "generated_at": generated, "days": detail_days}


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="write made-up data instead of calling Open-Meteo")
    args = ap.parse_args()

    with open(os.path.join(DATA, "peaks.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    peaks = cfg["peaks"]
    now = dt.datetime.now(dt.timezone.utc)
    generated = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    today = (now + dt.timedelta(hours=1)).date()

    responses = []
    if args.demo:
        responses = [demo_response(p, today) for p in peaks]
    else:
        for i in range(0, len(peaks), BATCH):
            batch = peaks[i:i + BATCH]
            print(f"Fetching {', '.join(p['name'] for p in batch)}")
            responses += fetch_batch(batch)
            time.sleep(1)

    os.makedirs(os.path.join(DATA, "peaks"), exist_ok=True)
    out = []
    for peak, resp in zip(peaks, responses):
        days, detail = process(peak, resp, generated)
        out.append({k: peak[k] for k in ("id", "name", "area", "lat", "lon", "elev", "valley_m", "valley_name")} | {"days": days})
        with open(os.path.join(DATA, "peaks", f"{peak['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))

    summary = {"generated_at": generated, "demo": args.demo, "source": "Open-Meteo", "areas": cfg["areas"], "peaks": out}
    with open(os.path.join(DATA, "forecast.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(out)} peaks at {generated}{' (demo)' if args.demo else ''}")


if __name__ == "__main__":
    main()
