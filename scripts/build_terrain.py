#!/usr/bin/env python3
"""Work out what you can see from each summit: the skyline all the way round, and the named hills on it.

Mountains don't move, so this only needs running once (and again if you add peaks).
It writes data/terrain/<id>.json, which the peak page uses for:
  - first light: when the sun actually clears the hills, not just the flat-horizon sunrise
  - the 360° skyline, with the morning's cloud top drawn on it
  - how open the view is, and which hills stand above the cloud

Terrain: Copernicus DEM GLO-90 (about 90 m grid), read from the free public copy on AWS.
Hill names: OpenStreetMap (natural=peak), via the Overpass API.

  python scripts/build_terrain.py           # real terrain (needs numpy and rasterio)
  python scripts/build_terrain.py --demo    # made-up terrain, numpy only, for local previews
"""
import argparse
import json
import math
import os
import sys
import tempfile
import time
import urllib.parse
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "terrain")
R_EARTH = 6371000.0
REFRACTION = 0.13          # standard terrestrial refraction coefficient
EYE = 1.7                  # metres above the summit
MAX_DIST = 40000           # how far out to look, in metres
NAME_RADIUS = 30000        # named hills listed within this distance
USER_AGENT = "InversionWatch/1.0 (terrain build; GitHub Actions)"
DEM_URL = "https://copernicus-dem-90m.s3.amazonaws.com/{n}/{n}.tif"
OVERPASS = "https://overpass-api.de/api/interpreter"


def distances():
    d = list(range(50, 2000, 50)) + list(range(2000, 10000, 100)) + list(range(10000, MAX_DIST + 1, 250))
    return np.array(d, dtype=float)


def destination(lat, lon, az_deg, d):
    """Points d metres from (lat, lon) along bearings az_deg. Arrays in, arrays out."""
    la1, lo1, az = math.radians(lat), math.radians(lon), np.radians(az_deg)
    dr = d / R_EARTH
    la2 = np.arcsin(np.sin(la1) * np.cos(dr) + np.cos(la1) * np.sin(dr) * np.cos(az))
    lo2 = lo1 + np.arctan2(np.sin(az) * np.sin(dr) * np.cos(la1), np.cos(dr) - np.sin(la1) * np.sin(la2))
    return np.degrees(la2), np.degrees(lo2)


def bearing(lat1, lon1, lat2, lon2):
    la1, la2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def haversine(lat1, lon1, lat2, lon2):
    la1, la2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


# --------------------------------------------------------------------------- terrain sources

class CopernicusDEM:
    """Downloads 1°x1° GLO-90 tiles as needed and samples them with bilinear interpolation."""

    def __init__(self):
        import rasterio  # only needed for real terrain
        self.rasterio = rasterio
        self.tiles = {}
        self.tmp = tempfile.mkdtemp(prefix="dem-")

    @staticmethod
    def name(lat0, lon0):
        ns = f"N{lat0:02d}" if lat0 >= 0 else f"S{-lat0:02d}"
        ew = f"E{lon0:03d}" if lon0 >= 0 else f"W{-lon0:03d}"
        return f"Copernicus_DSM_COG_30_{ns}_00_{ew}_00_DEM"

    def tile(self, lat0, lon0):
        key = (lat0, lon0)
        if key in self.tiles:
            return self.tiles[key]
        n = self.name(lat0, lon0)
        path = os.path.join(self.tmp, n + ".tif")
        tile = None
        for attempt in range(4):
            try:
                req = urllib.request.Request(DEM_URL.format(n=n), headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
                    f.write(r.read())
                with self.rasterio.open(path) as src:
                    arr = src.read(1).astype(np.float32)
                    nodata = src.nodata
                    t = src.transform
                if nodata is not None:
                    arr[arr == nodata] = 0
                arr[~np.isfinite(arr)] = 0
                tile = (arr, t.c, t.a, t.f, t.e)  # array, west, x step, north, y step (negative)
                print(f"  tile {n}: {arr.shape[1]}x{arr.shape[0]}", flush=True)
                break
            except urllib.error.HTTPError as e:
                if e.code in (403, 404):  # no tile: all sea
                    print(f"  tile {n}: none (sea)", flush=True)
                    break
                time.sleep(10 * (attempt + 1))
            except Exception as e:
                print(f"  tile {n}: retrying after {e}", flush=True)
                time.sleep(10 * (attempt + 1))
        self.tiles[key] = tile
        return tile

    def sample(self, lat, lon):
        out = np.zeros(lat.shape, dtype=np.float32)
        lat0s, lon0s = np.floor(lat).astype(int), np.floor(lon).astype(int)
        for la0, lo0 in set(zip(lat0s.ravel().tolist(), lon0s.ravel().tolist())):
            t = self.tile(la0, lo0)
            if t is None:
                continue
            arr, west, dx, north, dy = t
            m = (lat0s == la0) & (lon0s == lo0)
            col = (lon[m] - west) / dx - 0.5
            row = (lat[m] - north) / dy - 0.5
            out[m] = bilinear(arr, row, col)
        return np.maximum(out, 0)


def bilinear(arr, row, col):
    h, w = arr.shape
    row = np.clip(row, 0, h - 1.001)
    col = np.clip(col, 0, w - 1.001)
    r0, c0 = np.floor(row).astype(int), np.floor(col).astype(int)
    fr, fc = row - r0, col - c0
    a = arr[r0, c0] * (1 - fc) + arr[r0, c0 + 1] * fc
    b = arr[r0 + 1, c0] * (1 - fc) + arr[r0 + 1, c0 + 1] * fc
    return a * (1 - fr) + b * fr


# Made-up but plausible Lake District terrain for previews. Positions are approximate.
DEMO_HILLS = [
    ("Helvellyn", 54.5270, -3.0160, 950, 1300), ("Catstye Cam", 54.5340, -3.0020, 890, 600),
    ("Raise", 54.5470, -3.0120, 883, 900), ("Nethermost Pike", 54.5190, -3.0190, 891, 700),
    ("Dollywaggon Pike", 54.5080, -3.0120, 858, 800), ("Fairfield", 54.4970, -2.9990, 873, 1400),
    ("St Sunday Crag", 54.5120, -2.9770, 841, 1000), ("High Street", 54.4920, -2.8650, 828, 1800),
    ("Skiddaw", 54.6510, -3.1480, 931, 2200), ("Blencathra", 54.6400, -3.0500, 868, 1800),
    ("Scafell Pike", 54.4540, -3.2120, 978, 1800), ("Great Gable", 54.4820, -3.2190, 899, 1100),
    ("Grasmoor", 54.5710, -3.2790, 852, 1500), ("Cross Fell", 54.7030, -2.4870, 893, 4000),
    ("Coniston Old Man", 54.3700, -3.1212, 803, 1500), ("Pillar", 54.4970, -3.2810, 892, 1200),
]


class DemoDEM:
    def sample(self, lat, lon):
        z = np.full(lat.shape, 120.0)
        ky = 111320.0
        for _, hl, hn, he, sig in DEMO_HILLS:
            kx = 111320.0 * math.cos(math.radians(hl))
            d2 = ((lat - hl) * ky) ** 2 + ((lon - hn) * kx) ** 2
            z = np.maximum(z, 120 + (he - 120) * np.exp(-d2 / (2 * sig * sig)))
        # gentle rolling ground
        z += 25 * np.sin(lat * 900) * np.cos(lon * 700)
        return np.maximum(z, 0)


# --------------------------------------------------------------------------- hill names

def osm_peaks(peaks):
    """Named summits from OpenStreetMap across the area the peaks can see."""
    pad = NAME_RADIUS / 111000 + 0.05
    s = min(p["lat"] for p in peaks) - pad
    n = max(p["lat"] for p in peaks) + pad
    w = min(p["lon"] for p in peaks) - pad * 1.8
    e = max(p["lon"] for p in peaks) + pad * 1.8
    q = f'[out:json][timeout:180];node["natural"="peak"]["name"]({s:.3f},{w:.3f},{n:.3f},{e:.3f});out body;'
    body = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=240) as r:
                els = json.load(r)["elements"]
            out = []
            for el in els:
                ele = el.get("tags", {}).get("ele", "")
                try:
                    ele = float(str(ele).replace("m", "").replace(",", ".").strip())
                except ValueError:
                    ele = None
                out.append({"name": el["tags"]["name"], "lat": el["lat"], "lon": el["lon"], "ele": ele})
            print(f"OpenStreetMap: {len(out)} named hills", flush=True)
            return out
        except Exception as e:
            print(f"Overpass: retrying after {e}", flush=True)
            time.sleep(30 * (attempt + 1))
    print("Overpass: giving up; skylines will have no hill names", flush=True)
    return []


def demo_names():
    return [{"name": n, "lat": la, "lon": lo, "ele": e} for n, la, lo, e, _ in DEMO_HILLS]


# --------------------------------------------------------------------------- the skyline

def snap_summit(peak, dem):
    """The listed coordinates can be a little off. Use the highest ground within 300 m as the viewpoint."""
    lat, lon = peak["lat"], peak["lon"]
    ky, kx = 111320.0, 111320.0 * math.cos(math.radians(lat))
    off = np.arange(-300, 301, 20, dtype=float)
    dy, dx = np.meshgrid(off, off, indexing="ij")
    m = dy * dy + dx * dx <= 300 * 300
    la, lo = lat + dy[m] / ky, lon + dx[m] / kx
    z = dem.sample(la, lo)
    k = int(np.argmax(z))
    return float(la[k]), float(lo[k]), float(z[k])


def skyline(peak, dem, names):
    lat, lon, ztop = snap_summit(peak, dem)
    if ztop < 0.5 * peak["elev"]:
        raise RuntimeError(f"terrain data looks wrong here (highest ground {ztop:.0f} m, listed {peak['elev']} m)")
    h0 = max(peak["elev"], ztop) + EYE
    az = np.arange(360, dtype=float)
    d = distances()
    AZ, D = np.meshgrid(az, d, indexing="ij")
    la, lo = destination(lat, lon, AZ, D)
    z = dem.sample(la, lo)
    drop = D * D / (2 * R_EARTH) * (1 - REFRACTION)
    ang = np.degrees(np.arctan2(z - h0 - drop, D))
    i = np.argmax(ang, axis=1)
    rows = np.arange(360)
    h_ang = ang[rows, i]
    h_dist = D[rows, i]
    h_z = z[rows, i]
    h_lat, h_lon = la[rows, i], lo[rows, i]

    # Named hills in range, with where they sit in the view.
    near = []
    for nm in names:
        dist = haversine(lat, lon, nm["lat"], nm["lon"])
        if dist < 400 or dist > NAME_RADIUS:
            continue
        ele = nm["ele"]
        if ele is None:
            ele = float(dem.sample(np.array([nm["lat"]]), np.array([nm["lon"]]))[0])
        b = bearing(lat, lon, nm["lat"], nm["lon"])
        a = math.degrees(math.atan2(ele - h0 - dist * dist / (2 * R_EARTH) * (1 - REFRACTION), dist))
        k = int(round(b)) % 360
        on_sky = a >= h_ang[k] - 0.25  # on (or very near) the skyline
        # In sight at all? Nothing closer along that line may stand higher in the view.
        dd = d[d < dist * 0.9]
        if len(dd):
            la1, lo1 = destination(lat, lon, np.full(len(dd), b), dd)
            zz = dem.sample(la1, lo1)
            block = np.degrees(np.arctan2(zz - h0 - dd * dd / (2 * R_EARTH) * (1 - REFRACTION), dd)).max()
        else:
            block = -90.0
        near.append({"name": nm["name"], "ele": round(ele), "b": round(b, 1), "d": round(dist), "a": round(a, 2),
                     "vis": bool(on_sky or a >= block - 0.3), "sky": bool(on_sky)})
    near.sort(key=lambda x: -x["ele"])
    near = near[:60]

    # Which named hill is on the skyline in each direction (if any is close to the highest point).
    who = []
    for k in range(360):
        best, best_d = -1, 1500.0
        for j, nm in enumerate(near):
            if not nm["sky"]:
                continue
            dd = haversine(h_lat[k], h_lon[k], *_latlon(lat, lon, nm))
            if dd < best_d:
                best, best_d = j, dd
        who.append(best)

    below = float(np.mean(h_z < peak["elev"] - 30))
    return {
        "id": peak["id"],
        "lat": round(lat, 5), "lon": round(lon, 5),
        "eye": round(h0, 1),
        "h": [round(float(x), 2) for x in h_ang],      # skyline angle, degrees (negative = below eye level)
        "d": [int(x) for x in h_dist],                 # distance to the skyline, metres
        "z": [int(round(float(x))) for x in h_z],      # height of the skyline, metres
        "who": who,                                    # index into "hills", or -1
        "hills": near,
        "open": round(below, 3),                       # share of directions where the skyline is below the summit
        "cloud": cloud_views(z, d, peak["elev"]),     # where a cloud sea at each height would be seen
    }


def cloud_views(z, d, summit, step=50, az_step=2):
    """For a flat cloud top at each height (every 50 m below the summit), and every 2° of compass:
    how far out the cloud starts (where the ground first drops below it) and where it ends
    (where the ground rises above it again, or 0 for 'out to the horizon'). In tens of metres.
    The page turns these into the angles the cloud sea would fill, for the forecast cloud top."""
    levels = list(range(100, int(summit // step) * step, step))
    rows = z[::az_step]                      # (180, distances)
    near_all, far_all = [], []
    idx = np.arange(rows.shape[1])
    for lv in levels:
        below = rows < lv
        has = below.any(axis=1)
        near = np.where(has, np.argmax(below, axis=1), 0)
        above_after = (~below) & (idx[None, :] > near[:, None])
        has_far = above_after.any(axis=1) & has
        far = np.where(has_far, np.argmax(above_after, axis=1), 0)
        near_all.append([int(round(d[n] / 10)) if ok else 0 for n, ok in zip(near, has)])
        far_all.append([int(round(d[f] / 10)) if ok else 0 for f, ok in zip(far, has_far)])
    return {"levels": levels, "az_step": az_step, "near": near_all, "far": far_all}


def _latlon(lat, lon, nm):
    la, lo = destination(lat, lon, np.array([nm["b"]]), np.array([float(nm["d"])]))
    return float(la[0]), float(lo[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="made-up terrain, for local previews")
    ap.add_argument("--only", help="comma-separated peak ids")
    args = ap.parse_args()
    peaks = json.load(open(os.path.join(DATA, "peaks.json")))["peaks"]
    if args.only:
        keep = set(args.only.split(","))
        peaks = [p for p in peaks if p["id"] in keep]
    os.makedirs(OUT, exist_ok=True)
    if args.demo:
        dem, names, source = DemoDEM(), demo_names(), "demo"
    else:
        dem, names, source = CopernicusDEM(), osm_peaks(peaks), "copernicus-glo90"
    done = 0
    for p in peaks:
        try:
            t = skyline(p, dem, names)
            t["source"] = source
            with open(os.path.join(OUT, p["id"] + ".json"), "w") as f:
                json.dump(t, f, separators=(",", ":"))
            done += 1
            print(f"{p['name']}: open {round(t['open'] * 100)}%, {len(t['hills'])} named hills", flush=True)
        except Exception as e:
            print(f"{p['name']}: FAILED {e}", flush=True)
    print(f"Wrote {done} of {len(peaks)} skylines ({source})")
    if done < len(peaks) / 2:
        sys.exit(1)


if __name__ == "__main__":
    main()
