# Inversion Watch

Six-day cloud inversion forecasts for UK peaks. A static site hosted on GitHub Pages, with a scheduled GitHub Action that fetches fresh model data from [Open-Meteo](https://open-meteo.com/) four times a day and scores each peak.

**A planning tool, not a safety measure.** Always read the full [MWIS](https://www.mwis.org.uk/) and [Met Office mountain](https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain) forecasts before going out.

## How it works

1. `scripts/fetch_forecast.py` asks Open-Meteo for temperature, humidity, wind and height at several pressure levels (roughly 100 m to 3 km) above every peak in `data/peaks.json`.
2. For each morning it reads the conditions at sunrise and scores six signals out of 100:

   | Signal | Weight |
   |---|---|
   | Summit warmer than valley | 30 |
   | Moist valley air | 20 |
   | Light winds at summit height | 15 |
   | High pressure | 15 |
   | Cloud top below the summit | 10 |
   | Clear sky above | 10 |

3. It writes `data/forecast.json` (summary for the overview) and `data/peaks/<id>.json` (hourly profiles from 03:00 to 12:00 for the peak page).
4. The pages in the repo root read those files in the browser. No build step.

## Set-up checklist

1. **Turn on Pages:** Settings › Pages › Build and deployment › Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)`.
2. **Let the Action push:** Settings › Actions › General › Workflow permissions › *Read and write permissions*.
3. **Run it once:** Actions › *Update forecast* › *Run workflow*. Until it runs, the site shows sample data with a banner.
4. **Map key:** get a free key from [Thunderforest](https://www.thunderforest.com/), paste it into `assets/js/config.js`, and restrict it to your site's address in your Thunderforest account. Without a key the map falls back to the standard OpenStreetMap style.
5. **Fill in your details:** replace `YOUR-USERNAME` in the `data-repo` attribute at the top of each `.html` file, and `[YOUR CONTACT EMAIL]` in `privacy.html` and `terms.html`.
6. **Custom domain (optional):** add it under Settings › Pages, then delete the `<script>` line marked in `404.html`.

## Local preview

```bash
python scripts/fetch_forecast.py --demo   # sample data, no network needed
python -m http.server 8000                # then open http://localhost:8000
```

## Adding peaks

Add an entry to `data/peaks.json` with the summit coordinates, height and a typical valley-floor height (`valley_m`). The area must match one of the `areas` ids. The coordinates in the starter list are approximate: check them before relying on them.

## Data, photos and fonts

- Weather data by [Open-Meteo.com](https://open-meteo.com/), CC BY 4.0. Open-Meteo's free API is for **non-commercial use only**. If this site ever carries ads or charges, it needs a paid Open-Meteo plan or another data source.
- GitHub Pages is not meant for running an online business, so a commercial version should move hosting too.
- Map style © [Thunderforest](https://www.thunderforest.com/) (Outdoors); map data © OpenStreetMap contributors; shown with [Leaflet](https://leafletjs.com/). Thunderforest's free tier has a monthly limit and is meant for non-commercial projects; check their terms if traffic grows.
- Homepage photos via [Pexels](https://www.pexels.com/) (Pexels licence). Steel Fell photo by Karl and Ali on [Geograph](https://www.geograph.org.uk/profile/37389), CC BY-SA 2.0.
- Fonts: Barlow Condensed and Source Sans 3, SIL Open Font License (see `assets/fonts`).

Code licensed under MIT (see `LICENSE`).
