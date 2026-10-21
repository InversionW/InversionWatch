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
PROFILE_HOURS = list(range(3, 13))  # 03:00 to 12:00 local, for the profile and skyline sliders
LAPSE = 6.5 / 1000  # normal cooling, °C per metre

# Score weights, out of 100. Keep in sync with the "How the score works" text.
# "diff" is the strength of the warm layer above the valley (the inversion itself).
WEIGHTS = {"diff": 30, "moist": 20, "wind": 15, "pressure": 15, "below": 10, "clear": 10}
FULL_INVERSION = 5.0   # °C warmer than the valley floor for full marks
MIN_INVERSION = 0.5    # °C: below this there is no lid to hold the cloud down
NO_INVERSION_CAP = 20  # highest score allowed without an inversion


# --------------------------------------------------------------------------- fetching

WIND_LEVELS = [925, 900, 850, 800]  # roughly 750 m to 2 km: summit heights


def hourly_fields(demo=False):
    f = ["temperature_2m", "relative_humidity_2m", "pressure_msl", "cloud_cover_low", "cloud_cover_high"]
    for lv in LEVELS:
        f += [f"temperature_{lv}hPa", f"relative_humidity_{lv}hPa", f"geopotential_height_{lv}hPa"]
        if demo or lv in WIND_LEVELS:
            f.append(f"wind_speed_{lv}hPa")
    return f


USER_AGENT = "InversionWatch/1.0 (cloud inversion forecasts for UK peaks; GitHub Actions)"


def fetch_one(peak, attempts=5):
    """One peak per request: small, quick responses that are less likely to time out."""
    params = {
        "latitude": f"{peak['lat']:.4f}",
        "longitude": f"{peak['lon']:.4f}",
        "hourly": ",".join(hourly_fields()),
        "daily": "sunrise",
        "timezone": "Europe/London",
        "wind_speed_unit": "mph",
        "forecast_days": DAYS,
    }
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except Exception as e:  # network blip, slow server or rate limit: back off and retry
            if attempt == attempts - 1:
                raise
            wait = 10 * (attempt + 1)
            print(f"  {peak['name']}: retry in {wait}s after error: {e}", flush=True)
            time.sleep(wait)


# --------------------------------------------------------------------------- demo data

def demo_response(peak, start):
    """A fake Open-Meteo response with a plausible inversion pattern, for previews."""
    rnd = random.Random(peak["id"] + start.isoformat())
    hours, h = [], {k: [] for k in hourly_fields(demo=True)}
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
    # Fog at 2 m only counts as valley cloud if the model's ground is near the valley floor.
    # In the fells the model grid can sit high on the hillside, where 2 m fog means the hill is in cloud.
    if rh_2m is not None and rh_2m >= 97 and grid_elev is not None and grid_elev <= valley + 200:
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
            if top <= base or base >= summit:
                return None
            return (round(base), round(top))
    if base is not None and base < summit:
        return (round(base), round(pts[-1][0]))
    return None


def inversion(profile, valley, summit):
    """The warm lid: the warmest point between the valley and a little above the summit.

    Returns (height, strength). Strength is how much warmer the lid is than the valley floor, in °C.
    Height is None when nothing above the valley is warmer than it, i.e. there is no inversion.
    """
    vt = interp(profile, valley)
    best, best_t = None, vt
    z = valley
    while z <= summit + 400:
        t = interp(profile, z)
        if t > best_t + 0.3:
            best, best_t = z, t
        z += 25
    return best, max(0.0, best_t - vt)


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
    f = {
        "diff": clamp01(c["inv"] / FULL_INVERSION),
        "moist": clamp01((c["rh_valley"] - 70) / 25),
        "wind": clamp01(1 - (c["wind"] - 5) / 20),
        "pressure": clamp01((c["pressure"] - 1010) / 20),
        "below": clamp01((peak["elev"] - c["cloud"][1]) / 250) if c["cloud"] else 0.0,
        "clear": clamp01(1 - c["high_cloud"] / 100),
    }
    total = sum(f[k] * WEIGHTS[k] for k in WEIGHTS)
    if c["inv"] < MIN_INVERSION:
        # No warm lid means no cloud sea, however good the other signals look.
        total = min(total, NO_INVERSION_CAP)
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
    if c["inv"] < MIN_INVERSION:
        return "Unlikely. No warm layer above the valley to hold the cloud down."
    return "Unlikely this morning."


def explain(c, peak, f, score):
    """Plain-English reasons for the score: what's helping, what's holding it back, and what would change it.

    Each signal is judged the same way the score judges it (its 0-1 factor), so the words always match the numbers.
    """
    elev = peak["elev"]
    items = []  # (key, state, short label, sentence, points lost)

    def add(key, state, short, text):
        items.append({"key": key, "state": state, "short": short, "text": text, "lost": round(WEIGHTS[key] * (1 - f[key]), 1)})

    def grade(key):
        v = f[key]
        return "good" if v >= 0.67 else "bad" if v < 0.34 else "mixed"

    # 1. The warm layer (the inversion itself)
    inv, top = c["inv"], c["inv_top"]
    if inv < MIN_INVERSION:
        add("diff", "bad", "no warm layer",
            f"No warm layer: the air cools steadily with height ({fmt_t(c['vt'])} in the valley, {fmt_t(c['st'])} on top), so there's nothing to trap cloud below you.")
    elif grade("diff") == "good":
        add("diff", "good", "strong warm layer",
            f"Strong warm layer: around {top} m the air is {inv:.1f}°C warmer than the valley floor, a firm lid to hold the cloud down.")
    else:
        add("diff", "mixed", "weak warm layer",
            f"Weak warm layer: only {inv:.1f}°C warmer than the valley, around {top} m. It may not hold the cloud for long after sunrise.")

    # 2. Moisture
    rh = c["rh_valley"]
    g = grade("moist")
    add("moist", g, {"good": "damp valleys", "mixed": "fairly damp valleys", "bad": "dry valleys"}[g],
        {"good": f"Damp valley air ({rh}% humidity), so there's moisture to form cloud or fog.",
         "mixed": f"Valley air is only fairly damp ({rh}% humidity), so any cloud may be thin or patchy.",
         "bad": f"Dry valley air ({rh}% humidity): even under a lid there may be no cloud to look down on, just a clear or hazy view."}[g])

    # 3. Wind
    w = c["wind"]
    g = grade("wind")
    add("wind", g, {"good": "light winds", "mixed": "breezy on top", "bad": "strong winds"}[g],
        {"good": f"Light winds on top ({w} mph), so the layers can settle undisturbed.",
         "mixed": f"Breezy on top ({w} mph), which can stir the layers and thin the cloud.",
         "bad": f"Strong winds on top ({w} mph) will mix the air and break up any inversion."}[g])

    # 4. Pressure
    pr = c["pressure"]
    g = grade("pressure")
    add("pressure", g, {"good": "high pressure", "mixed": "middling pressure", "bad": "low pressure"}[g],
        {"good": f"High pressure ({pr} hPa): sinking air keeps a lid on the cloud.",
         "mixed": f"Middling pressure ({pr} hPa), not the settled high that inversions like best.",
         "bad": f"Low pressure ({pr} hPa) usually means unsettled, well-mixed air."}[g])

    # 5. Where the cloud top sits
    cl = c["cloud"]
    if not cl:
        add("below", "bad", "no valley cloud",
            "No cloud layer is forecast below the summit, so even with a warm layer the valleys may stay clear.")
    elif c["inv"] < MIN_INVERSION:
        add("below", "mixed", "ordinary low cloud",
            f"There's low cloud around {cl[0]}–{cl[1]} m, below the summit, but with no warm layer on top it's likely to be broken and drifting, not a flat sea.")
    elif cl[1] >= elev:
        add("below", "bad", "cloud up to the summit",
            f"Cloud reaches about {cl[1]} m, above the {elev} m summit, so you'd probably be inside it.")
    elif grade("below") == "good":
        add("below", "good", "cloud well below the top",
            f"Cloud tops out around {cl[1]} m, {elev - cl[1]} m below the summit, so you'd stand well clear of it.")
    else:
        add("below", "mixed", "cloud close to the top",
            f"Cloud tops out around {cl[1]} m, only {elev - cl[1]} m below the summit. A small rise could put you in it.")

    # 6. The sky above
    hc = c["high_cloud"]
    g = grade("clear")
    add("clear", g, {"good": "clear sky above", "mixed": "some high cloud", "bad": "thick high cloud"}[g],
        {"good": f"Clear sky above ({hc}% high cloud), good for sunrise light on the cloud.",
         "mixed": f"Some high cloud ({hc}%) may dull the sunrise colours.",
         "bad": f"Thick high cloud ({hc}%) will likely hide the sunrise, even if the cloud sea forms."}[g])

    good = [i for i in items if i["state"] == "good"]
    held = sorted([i for i in items if i["state"] != "good"], key=lambda i: -i["lost"])

    # What would change it: the signal costing the most points.
    NEED = {
        "diff": ("a warm layer to form above the valley. That usually takes a calm, clear night under high pressure" if inv < MIN_INVERSION
                 else "a stronger warm layer, a few degrees warmer than the valley. A calm, clear night would help"),
        "moist": "damper valley air, for example the morning after rain",
        "wind": f"the wind on top to drop to about 10 mph or less",
        "pressure": "high pressure to build in",
        "below": ("fog or low cloud to form in the valleys" if not cl else f"the cloud top to sit lower, below about {elev - 150} m"),
        "clear": "the high cloud to clear for the best of the sunrise",
    }
    need = "What could spoil it: very little on this forecast, but it can still shift. Check MWIS the evening before."
    if held:
        top_miss = held[0]
        if c["inv"] < MIN_INVERSION:
            top_miss = next(i for i in held if i["key"] == "diff")
        lead = "What could spoil it" if score >= 65 else "What would change it"
        if lead == "What could spoil it":
            need = f"{lead}: {top_miss['short']}. Check MWIS the evening before."
        else:
            need = f"{lead}: it would need {NEED[top_miss['key']]}."

    # One line for lists: the main reason, in a few words.
    sc = score
    if sc >= 65:
        order = ["diff", "below", "wind", "moist", "pressure", "clear"]
        best = sorted(good, key=lambda i: order.index(i["key"]))[:2]
        short = " and ".join(i["short"] for i in best).capitalize() or "Signals line up"
    elif sc >= 40:
        pos = sorted(good, key=lambda i: -WEIGHTS[i["key"]])
        short = (pos[0]["short"].capitalize() + ", but " if pos else "") + (held[0]["short"] if held else "mixed signals")
        if not pos:
            short = short.capitalize()
    else:
        miss = next((i for i in held if i["key"] == "diff"), held[0]) if c["inv"] < MIN_INVERSION else held[0]
        short = miss["short"].capitalize()
    return {
        "good": [i["text"] for i in good],
        "held": [{"text": i["text"], "state": i["state"]} for i in held],
        "need": need,
        "short": short,
    }


def fmt_t(t):
    r = round(t)
    return ("−" if r < 0 else "") + f"{abs(r)}°C"


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
    winds = [(float(h[f"geopotential_height_{lv}hPa"][idx]), float(h[f"wind_speed_{lv}hPa"][idx] or 0)) for lv in LEVELS
             if f"wind_speed_{lv}hPa" in h and h[f"geopotential_height_{lv}hPa"][idx] is not None]
    wind = interp([(z, w, 0) for z, w in winds], summit)
    inv_top, inv = inversion(profile, valley, summit)
    c = {
        "st": round(interp(profile, summit), 1),
        "vt": round(interp(profile, valley), 1),
        "rh_valley": round(max(interp(profile, valley, 2), rh2 or 0)),
        "wind": round(max(0, wind)),
        "pressure": round(h["pressure_msl"][idx] or 1013),
        "high_cloud": round(h["cloud_cover_high"][idx] or 0),
        "cloud": cloud_layer(profile, valley, summit, rh2, grid),
        "inv_top": inv_top,
        "inv": round(inv, 1),
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
            if hr >= sr_h and ch["cloud"] and ch["cloud"][1] < peak["elev"] and ch["inv"] >= MIN_INVERSION:
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
            "verdict": verdict(score, c, peak), "why": explain(c, peak, factors, score), "window": window,
            "st": c["st"], "vt": c["vt"], "wind": c["wind"], "pressure": c["pressure"],
            "rh_valley": c["rh_valley"], "high_cloud": c["high_cloud"],
            "cloud": c["cloud"], "inv_top": c["inv_top"], "inv": c["inv"], "fz": c["fz"], "factors": factors,
        }
        summary_days.append(dict({k: day[k] for k in ("date", "sunrise", "score", "conf", "window", "st", "vt", "wind", "cloud")}, why=day["why"]["short"]))
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

    # Previous output, reused for any peak that can't be fetched this time.
    old = {}
    try:
        with open(os.path.join(DATA, "forecast.json"), encoding="utf-8") as f:
            prev = json.load(f)
        if not prev.get("demo"):
            old = {p["id"]: p for p in prev.get("peaks", [])}
    except (OSError, ValueError):
        pass

    os.makedirs(os.path.join(DATA, "peaks"), exist_ok=True)
    out, failed = [], []
    for peak in peaks:
        try:
            if args.demo:
                resp = demo_response(peak, today)
            else:
                print(f"Fetching {peak['name']}", flush=True)
                resp = fetch_one(peak)
                time.sleep(0.5)
            days, detail = process(peak, resp, generated)
        except Exception as e:
            print(f"  {peak['name']}: giving up this run ({e})", flush=True)
            failed.append(peak["name"])
            if peak["id"] in old:
                out.append(old[peak["id"]])  # keep the last good forecast and its detail file
            continue
        out.append({k: peak[k] for k in ("id", "name", "area", "lat", "lon", "elev", "valley_m", "valley_name")} | {"days": days})
        with open(os.path.join(DATA, "peaks", f"{peak['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))

    if len(failed) > len(peaks) // 2:
        print(f"Too many peaks failed ({len(failed)} of {len(peaks)}); leaving the published forecast unchanged.", flush=True)
        sys.exit(1)

    summary = {"generated_at": generated, "demo": args.demo, "source": "Open-Meteo", "areas": cfg["areas"], "peaks": out}
    with open(os.path.join(DATA, "forecast.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, separators=(",", ":"))
    note = f"; kept previous forecast for {', '.join(failed)}" if failed else ""
    print(f"Wrote {len(out)} peaks at {generated}{' (demo)' if args.demo else ''}{note}", flush=True)


if __name__ == "__main__":
    main()
