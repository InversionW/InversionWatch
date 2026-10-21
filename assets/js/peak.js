/* Peak page: summary, 6-day table, atmospheric profile, score breakdown, planner, conditions. */
(function () {
  'use strict';
  IW.chrome('peak');
  var id = IW.qs('id') || 'helvellyn';
  var state = {day: Math.max(0, Math.min(5, +(IW.qs('day') || 0))), hour: null, tab: 'forecast', pace: IW.get('pace', 1)};
  var PACES = [['Relaxed', 1.25], ['Steady', 1], ['Quick', 0.85]];
  var BUFFER = 20;
  var summary, peak, area, detail, stale = false, terrain = null;

  Promise.all([IW.load('data/forecast.json'), IW.load('data/peaks/' + id + '.json')]).then(function (r) {
    summary = r[0]; detail = r[1];
    peak = summary.peaks.filter(function (p) { return p.id === id; })[0];
    if (!peak || !detail.days.length) throw new Error('missing');
    area = summary.areas.filter(function (a) { return a.id === peak.area; })[0];
    stale = !summary.demo && IW.ageHours(summary.generated_at) > 12;
    document.getElementById('demo-banner').hidden = !summary.demo;
    setupStatic();
    render();
    if (IW.motion) try { IW.motion.refresh(); } catch (e) {}
  }).catch(function () {
    document.getElementById('peak-name').textContent = 'Peak not found';
    document.getElementById('main').innerHTML = '<p>We could not find a forecast for this peak. <a href="index.html">Back to the UK overview</a>.</p>';
  });

  // The summit skyline is optional: if it hasn't been built yet the page works without it.
  IW.load('data/terrain/' + id + '.json').then(function (t) {
    if (!t || !t.h || t.h.length !== 360) return;
    terrain = t;
    if (detail) { renderSkyline(); renderPlan(); renderCompass(); if (IW.motion) try { IW.motion.refresh(); } catch (e) {} }
  }).catch(function () {});

  function day() { return detail.days[state.day]; }

  /* ---------- one-off setup */
  function setupStatic() {
    document.title = peak.name + ' cloud inversion forecast – Inversion Watch';
    document.getElementById('peak-name').textContent = peak.name + ' cloud inversion forecast';
    document.getElementById('area-line').textContent = area.name + ' · ' + peak.elev + ' m · valley reference ' + peak.valley_name + ', ' + peak.valley_m + ' m';
    document.getElementById('maps-link').href = 'https://www.google.com/maps/@' + peak.lat + ',' + peak.lon + ',14z';
    document.getElementById('mwis-link').href = area.mwis;
    document.getElementById('valley-name').textContent = peak.valley_name;
    document.getElementById('warn-icon').innerHTML = IW.WARN;
    document.getElementById('updated').textContent = 'Updated ' + IW.updatedText(summary.generated_at) + (summary._offline ? ' (offline copy)' : '');
    if (stale) {
      var s = document.getElementById('stale');
      s.innerHTML = IW.WARN + '<span>This forecast is out of date (last updated ' + IW.updatedText(summary.generated_at) + '). Start times are hidden until it refreshes.</span>';
      s.hidden = false;
    }

    var fav = document.getElementById('fav-btn');
    var paintFav = function () {
      var on = IW.favs().indexOf(id) >= 0;
      fav.setAttribute('aria-pressed', on);
      fav.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (on ? '#F6B678' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>' + (on ? 'Saved' : 'Save peak');
    };
    paintFav();
    fav.addEventListener('click', function () { IW.toggleFav(id); paintFav(); });

    var share = document.getElementById('share-btn');
    share.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>Share this forecast';
    share.addEventListener('click', function () {
      var url = location.origin + location.pathname + '?id=' + id + '&day=' + state.day;
      var text = peak.name + ', ' + IW.dayLong(day().date) + ': ' + day().score + '% chance of a cloud inversion';
      if (navigator.share) { navigator.share({title: 'Inversion Watch', text: text, url: url}).catch(function () {}); return; }
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
        share.lastChild.textContent = 'Link copied';
        setTimeout(function () { share.lastChild.textContent = 'Share this forecast'; }, 2500);
      }).catch(function () { prompt('Copy this link', url); });
    });

    ['forecast', 'plan'].forEach(function (t) {
      document.getElementById('tab-' + t).addEventListener('click', function () { state.tab = t; paintTabs(); });
    });
    document.getElementById('hour').addEventListener('input', function (e) { state.hour = +e.target.value; renderProfile(); renderSkyline(); });

    var asc = IW.get('ascent:' + id, peak.elev - peak.valley_m);
    var dist = IW.get('dist:' + id, Math.round((3 + (peak.elev - peak.valley_m) / 250) * 10) / 10);
    document.getElementById('ascent').value = asc;
    document.getElementById('dist').value = dist;
    ['ascent', 'dist'].forEach(function (k) {
      document.getElementById(k).addEventListener('input', function (e) { IW.set(k + ':' + id, +e.target.value); renderPlan(); renderSummary(); });
    });
    document.addEventListener('iw:theme', function () { renderProfile(); renderCompass(); renderSkyline(); });
  }

  function paintTabs() {
    ['forecast', 'plan'].forEach(function (t) {
      document.getElementById('tab-' + t).setAttribute('aria-selected', state.tab === t);
      document.getElementById('panel-' + t).hidden = state.tab !== t;
    });
  }

  /* ---------- render everything for the selected day */
  function render() {
    var chips = document.getElementById('day-chips');
    chips.innerHTML = detail.days.map(function (d, i) {
      return '<button type="button" class="day-chip' + (i >= 3 ? ' outlook' : '') + '" aria-pressed="' + (i === state.day) + '" data-i="' + i + '"><b>' + IW.dayShort(d.date) + '</b><span>' + d.score + '%</span></button>';
    }).join('');
    chips.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { state.day = +b.dataset.i; state.hour = null; render(); }); });
    paintTabs();
    renderSummary(); renderTable(); renderProfile(); renderFactors(); renderPlan(); renderConditions(); renderCompass(); renderSkyline();
  }

  function walkMinutes() {
    var km = +document.getElementById('dist').value || 0, up = +document.getElementById('ascent').value || 0;
    var base = km / 5 * 60 + up / 100 * 10;
    return Math.round(base * PACES[state.pace][1] / 5) * 5;
  }
  function toMin(hm) { return +hm.slice(0, 2) * 60 + +hm.slice(3, 5); }
  function fromMin(m) { m = (m + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
  function leaveBy(d) { return (d.window && !stale) ? fromMin(toMin(d.window[0]) - walkMinutes() - BUFFER) : null; }
  function chill(t, mph) {
    var v = mph * 1.609; if (v <= 4.8) return t;
    var p = Math.pow(v, 0.16); return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
  }

  function renderSummary() {
    var d = day();
    var pill = document.getElementById('pill');
    pill.className = 'verdict-pill ' + IW.pill(d.score);
    pill.textContent = IW.label(d.score);
    document.getElementById('score').textContent = d.score + '%';
    document.getElementById('score-day').textContent = 'chance on ' + IW.dayLong(d.date) + ' · ' + d.conf.toLowerCase() + ' confidence';
    document.getElementById('verdict').textContent = d.verdict;
    renderWhy(d);
    document.getElementById('sum-leave').textContent = leaveBy(d) || '–';
    document.getElementById('sum-margin').textContent = d.cloud ? (peak.elev - d.cloud[1] >= 0 ? (peak.elev - d.cloud[1]) + ' m above' : 'In cloud') : 'No cloud layer';
    document.getElementById('sum-chill').textContent = IW.temp(chill(d.st, d.wind));
  }

  var ICON = {
    good: '<svg width="22" height="22" viewBox="0 0 24 24" aria-label="Helping"><circle cx="12" cy="12" r="11" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mixed: '<svg width="22" height="22" viewBox="0 0 24 24" aria-label="Mixed"><circle cx="12" cy="12" r="10" fill="none" stroke="#E0701F" stroke-width="2"/><path d="M12 2a10 10 0 0 1 0 20z" fill="#E0701F"/></svg>',
    bad: '<svg width="22" height="22" viewBox="0 0 24 24" aria-label="Against"><circle cx="12" cy="12" r="11" fill="var(--accent)"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/></svg>'
  };
  function renderWhy(d) {
    var box = document.getElementById('why');
    if (!d.why) { box.hidden = true; return; }
    box.hidden = false;
    var li = function (text, state) { return '<li>' + ICON[state] + '<span>' + IW.esc(text) + '</span></li>'; };
    document.getElementById('why-good').innerHTML = d.why.good.length ? d.why.good.map(function (t) { return li(t, 'good'); }).join('') : '<li class="none">Nothing much on this morning.</li>';
    document.getElementById('why-held').innerHTML = d.why.held.length ? d.why.held.map(function (h) { return li(h.text, h.state); }).join('') : '<li class="none">Nothing: every signal is in its favour.</li>';
    var need = d.why.need || '', i = need.indexOf(': ');
    document.getElementById('why-need').innerHTML = i > 0 ? '<b>' + IW.esc(need.slice(0, i)) + ':</b> <span style="font-weight: 400">' + IW.esc(need.slice(i + 2)) + (state.day >= 3 ? ' This day is four or more days out, so treat it as a heads-up.' : '') + '</span>' : IW.esc(need);
  }

  function renderTable() {
    var ds = detail.days;
    function row(label, note, fn, cls) {
      return '<tr><th scope="row">' + label + (note ? '<br><span class="muted small" style="font-weight: 400">' + note + '</span>' : '') + '</th>' +
        ds.map(function (d, i) { var v = fn(d); return '<td class="' + (cls ? cls(d) : '') + (i === state.day ? ' sel' : '') + '">' + v + '</td>'; }).join('') + '</tr>';
    }
    var html = '<table><thead><tr><th scope="row"><span class="visually-hidden">Day</span></th>' + ds.map(function (d, i) {
      return '<th scope="col" class="' + (i === state.day ? 'sel' : '') + '" style="font-family: var(--display); font-size: 18px">' + IW.dayShort(d.date) + '<br><span class="muted small" style="font-family: var(--body); font-weight: 400">' + (i < 3 ? 'MWIS window' : 'Outlook') + ' · sunrise ' + d.sunrise + '</span></th>';
    }).join('') + '</tr></thead><tbody>' +
      row('Inversion chance', '', function (d) { return '<b style="font-size: 20px">' + d.score + '%</b>'; }, function (d) { return IW.heat(d.score); }) +
      row('Summit', peak.elev + ' m', function (d) { return IW.temp(d.st); }) +
      row('Valley', peak.valley_m + ' m', function (d) { return IW.temp(d.vt); }) +
      row('Summit minus valley', 'positive = inversion', function (d) { var x = Math.round(d.st - d.vt); return '<b>' + (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x) + '°C</b>'; }) +
      row('Valley humidity', '', function (d) { return d.rh_valley + '%'; }) +
      row('Summit wind', 'mph', function (d) { return d.wind; }) +
      row('Pressure', 'hPa', function (d) { return d.pressure; }) +
      row('Cloud layer', 'base–top, m', function (d) { return d.cloud ? d.cloud[0] + '–' + d.cloud[1] : '–'; }) +
      '</tbody></table>';
    document.getElementById('daytable').innerHTML = html;
  }

  function renderFactors() {
    var d = day();
    var F = [
      ['diff', 'Warm layer above the valley', 30, d.inv == null ? 'Summit ' + IW.temp(d.st) + ', valley ' + IW.temp(d.vt) : d.inv >= 0.5 ? 'Up to ' + d.inv.toFixed(1) + '°C warmer than the valley' + (d.inv_top ? ', around ' + d.inv_top + ' m' : '') : 'None: the air cools with height, so the score is capped at 20%'],
      ['moist', 'Moist valley air', 20, d.rh_valley + '% humidity in the valley'],
      ['wind', 'Light winds', 15, d.wind + ' mph at summit height'],
      ['pressure', 'High pressure', 15, d.pressure + ' hPa'],
      ['below', 'Cloud top below summit', 10, d.cloud ? 'Cloud top around ' + d.cloud[1] + ' m' : 'No cloud layer expected'],
      ['clear', 'Clear sky above', 10, d.high_cloud + '% high cloud']
    ];
    document.getElementById('factors').innerHTML = F.map(function (f) {
      var v = d.factors[f[0]] || 0;
      return '<div class="factor"><b>' + f[1] + '</b><b>' + Math.round(v * f[2]) + ' / ' + f[2] + '</b><span class="muted small" style="grid-column: 1 / -1">' + f[3] + '</span><span class="bar"><i style="width:' + Math.round(v * 100) + '%"></i></span></div>';
    }).join('');
    document.getElementById('sources').innerHTML =
      '<li><a href="' + area.mwis + '">MWIS ' + IW.esc(area.short) + ' forecast</a> <span class="muted small">(days 1–3)</span></li>' +
      '<li><a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain">Met Office mountain forecasts</a></li>' +
      '<li><a href="https://www.mountain-forecast.com/">Mountain-Forecast</a> <span class="muted small">for comparison</span></li>';
  }

  /* ---------- atmospheric profile */
  function renderProfile() {
    var d = day(), hours = d.hours;
    if (!hours.length) { document.getElementById('profile-svg').innerHTML = '<p class="muted">No profile available.</p>'; return; }
    var slider = document.getElementById('hour');
    slider.max = hours.length - 1;
    if (state.hour === null) {
      var sr = +d.sunrise.slice(0, 2); state.hour = 0;
      hours.forEach(function (h, i) { if (+h.t.slice(0, 2) <= sr) state.hour = i; });
    }
    slider.value = state.hour;
    var h = hours[state.hour];
    slider.setAttribute('aria-valuetext', h.t);
    document.getElementById('hour-out').textContent = h.t;
    document.getElementById('sunrise-note').textContent = '· sunrise ' + d.sunrise;

    var topZ = Math.max(1500, Math.ceil((peak.elev + 600) / 500) * 500);
    var lv = h.levels.filter(function (l) { return l[0] <= topZ + 300; });
    var temps = [], dews = [];
    lv.forEach(function (l) { temps.push(l[1]); dews.push(l[2]); });
    var tmin = Math.floor(Math.min.apply(null, dews.concat(temps)) / 5) * 5 - 2, tmax = Math.ceil(Math.max.apply(null, temps) / 5) * 5 + 2;
    var W = 600, H = 400, x0 = 70, x1 = 520, y0 = 30, y1 = 360;
    var X = function (t) { return Math.round(x0 + (Math.max(tmin, Math.min(tmax, t)) - tmin) * (x1 - x0) / (tmax - tmin)); };
    var Y = function (z) { return Math.round(y1 - Math.max(0, Math.min(topZ, z)) * (y1 - y0) / topZ); };
    function interpT(z) {
      for (var i = 0; i < lv.length - 1; i++) if (z <= lv[i + 1][0] || i === lv.length - 2) {
        var a = lv[i], b = lv[i + 1]; return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]);
      }
      return lv[0][1];
    }
    var cs = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
    var acc = cs('--accent'), txt = cs('--text'), mut = cs('--muted'), bg = cs('--chart-bg'), grid = cs('--border-soft');
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Atmospheric profile at ' + h.t + ': valley ' + IW.temp(h.vt) + ', summit ' + IW.temp(h.st) + (h.cloud ? ', cloud from ' + h.cloud[0] + ' to ' + h.cloud[1] + ' metres' : ', no cloud layer') + '." style="font-family: Source Sans 3, sans-serif">';
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '" fill="' + bg + '"/>';
    for (var t = Math.ceil(tmin / 5) * 5; t <= tmax; t += 5) {
      s += '<line x1="' + X(t) + '" y1="' + y0 + '" x2="' + X(t) + '" y2="' + y1 + '" stroke="' + (t === 0 ? mut : grid) + '"/>';
      s += '<text x="' + X(t) + '" y="' + (y1 + 18) + '" text-anchor="middle" font-size="12" fill="' + (t === 0 ? txt : mut) + '" font-weight="' + (t === 0 ? 700 : 400) + '">' + (t < 0 ? '−' + (-t) : t) + '°</text>';
    }
    for (var z = 0; z <= topZ; z += 500) {
      s += '<line x1="' + x0 + '" y1="' + Y(z) + '" x2="' + x1 + '" y2="' + Y(z) + '" stroke="' + grid + '"/>';
      s += '<text x="' + (x0 - 8) + '" y="' + (Y(z) + 4) + '" text-anchor="end" font-size="12" fill="' + mut + '">' + (z ? z.toLocaleString('en-GB') : '0 m') + '</text>';
    }
    if (h.inv_top && h.cloud) s += '<rect x="' + x0 + '" y="' + Y(h.inv_top) + '" width="' + (x1 - x0) + '" height="' + Math.max(0, Y(h.cloud[1]) - Y(h.inv_top)) + '" fill="' + acc + '" opacity="0.16"/>';
    if (h.cloud) {
      s += '<rect x="' + x0 + '" y="' + Y(h.cloud[1]) + '" width="' + (x1 - x0) + '" height="' + Math.max(2, Y(h.cloud[0]) - Y(h.cloud[1])) + '" fill="' + cs('--cloud') + '" opacity="0.75"/>';
      s += '<text x="' + (x1 - 6) + '" y="' + (Y(h.cloud[1]) + 16) + '" text-anchor="end" font-size="12" font-weight="700" fill="' + txt + '" stroke="' + bg + '" stroke-width="4" paint-order="stroke">Cloud</text>';
    }
    if (h.fz && h.fz < topZ) {
      s += '<line x1="' + x0 + '" y1="' + Y(h.fz) + '" x2="' + x1 + '" y2="' + Y(h.fz) + '" stroke="' + cs('--freeze') + '" stroke-width="2" stroke-dasharray="2 4"/>';
      s += '<text x="' + (x1 - 6) + '" y="' + (Y(h.fz) - 6) + '" text-anchor="end" font-size="12" font-weight="700" fill="' + cs('--freeze') + '" stroke="' + bg + '" stroke-width="4" paint-order="stroke">Freezing level</text>';
    }
    [[peak.elev, 'Summit ' + peak.elev + ' m'], [peak.valley_m, 'Valley ' + peak.valley_m + ' m']].forEach(function (m) {
      s += '<line x1="' + x0 + '" y1="' + Y(m[0]) + '" x2="' + x1 + '" y2="' + Y(m[0]) + '" stroke="' + txt + '" stroke-width="1.2" stroke-dasharray="3 4"/>';
      s += '<text x="' + (x0 + 6) + '" y="' + (Y(m[0]) - 6) + '" font-size="13" font-weight="700" fill="' + txt + '" stroke="' + bg + '" stroke-width="4" paint-order="stroke">' + m[1] + '</text>';
    });
    var vt = interpT(peak.valley_m);
    s += '<polyline fill="none" stroke="' + cs('--normal') + '" stroke-width="1.8" stroke-dasharray="7 5" points="' + X(vt) + ',' + Y(peak.valley_m) + ' ' + X(vt - 0.0065 * (topZ - peak.valley_m)) + ',' + Y(topZ) + '"/>';
    s += '<polyline class="draw" fill="none" stroke="' + cs('--dew') + '" stroke-width="2.5" stroke-linejoin="round" points="' + lv.map(function (l) { return X(l[2]) + ',' + Y(l[0]); }).join(' ') + '"/>';
    s += '<polyline class="draw" fill="none" stroke="' + acc + '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" points="' + lv.map(function (l) { return X(l[1]) + ',' + Y(l[0]); }).join(' ') + '"/>';
    [[h.st, peak.elev, -12], [h.vt, peak.valley_m, 22]].forEach(function (p) {
      s += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="6" fill="' + acc + '" stroke="' + bg + '" stroke-width="2"/>';
      s += '<text x="' + X(p[0]) + '" y="' + (Y(p[1]) + p[2]) + '" text-anchor="middle" font-size="15" font-weight="700" fill="' + txt + '" stroke="' + bg + '" stroke-width="4" paint-order="stroke">' + IW.temp(p[0]) + '</text>';
    });
    s += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + y1 + '" stroke="' + mut + '"/><line x1="' + x0 + '" y1="' + y1 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="' + mut + '"/>';
    s += '<text x="' + ((x0 + x1) / 2) + '" y="' + (y1 + 38) + '" text-anchor="middle" font-size="13" font-weight="600" fill="' + mut + '">Temperature (°C)</text>';
    s += '<text x="560" y="22" text-anchor="middle" font-size="12" font-weight="700" fill="' + mut + '">Wind</text>';
    s += '<text x="560" y="' + (Y(peak.elev) + 4) + '" text-anchor="middle" font-size="14" font-weight="700" fill="' + txt + '">' + h.wind + '</text>';
    s += '<text x="560" y="' + (Y(peak.elev) + 20) + '" text-anchor="middle" font-size="11" fill="' + mut + '">mph</text>';
    s += '</svg>';
    document.getElementById('profile-svg').innerHTML = s;

    var head;
    if (!h.cloud) head = h.st > h.vt ? 'The air is inverted, but no cloud layer is expected.' : 'No cloud layer, and the air cools with height as normal.';
    else if (h.cloud[1] < peak.elev) head = 'Cloud sits at ' + h.cloud[0] + '–' + h.cloud[1] + ' m, ' + (peak.elev - h.cloud[1]) + ' m below the summit. You would be above it.';
    else head = 'Cloud reaches ' + h.cloud[1] + ' m, so the summit is likely inside it.';
    document.getElementById('profile-head').textContent = 'At ' + h.t + ', ' + head.charAt(0).toLowerCase() + head.slice(1);
    document.getElementById('pf-st').textContent = IW.temp(h.st);
    document.getElementById('pf-vt').textContent = IW.temp(h.vt);
    document.getElementById('pf-cloud').textContent = h.cloud ? h.cloud[0] + '–' + h.cloud[1] + ' m' : 'None';
    document.getElementById('pf-fz').textContent = !h.fz ? 'Below valley' : h.fz > 9000 ? 'Very high' : h.fz.toLocaleString('en-GB') + ' m';
  }


  /* ---------- sun position (NOAA approximation, good to a fraction of a degree) */
  function sunAt(ms, lat, lon) {
    var rad = Math.PI / 180, jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    var om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
    var eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
    var dec = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
    var y = Math.pow(Math.tan(eps * rad / 2), 2);
    var eot = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
    var mins = ((ms / 60000) % 1440 + 1440) % 1440;
    var ha = ((mins + eot + 4 * lon) / 4 - 180) * rad, la = lat * rad;
    var alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / rad;
    var az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / rad + 180) % 360;
    return {alt: alt, az: az};
  }
  function skyAt(az) {
    var a = ((az % 360) + 360) % 360, i = Math.floor(a), f = a - i;
    return terrain.h[i] * (1 - f) + terrain.h[(i + 1) % 360] * f;
  }
  // First moment the top of the sun clears the horizon function hz(az). -0.833° allows for refraction and the sun's radius.
  function riseTime(dateIso, hz) {
    var p = dateIso.split('-'), t = Date.UTC(+p[0], +p[1] - 1, +p[2], 3, 0), end = t + 9 * 3600000;
    var lat = terrain ? terrain.lat : peak.lat, lon = terrain ? terrain.lon : peak.lon;
    for (; t < end; t += 30000) {
      var s = sunAt(t, lat, lon);
      if (s.alt >= hz(s.az) - 0.833) return {t: t, az: s.az, alt: s.alt};
    }
    return null;
  }
  function hhmm(ms) { return new Date(ms).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'}); }
  var DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function dir16(b) { return DIR16[Math.round(b / 22.5) % 16]; }
  function km(m) { return m < 10000 ? (Math.round(m / 100) / 10) + ' km' : Math.round(m / 1000) + ' km'; }

  // Angle of the cloud sea's surface seen from the summit, at distance dd (metres).
  function cloudAngle(ct, dd) { return Math.atan2(ct - terrain.eye - dd * dd / (2 * 6371000) * 0.87, dd) * 180 / Math.PI; }

  // First light on the summit for the selected day, plus what (if anything) is in the way.
  // With a cloud sea below you, the sun has to rise out of the cloud as well as clear the hills.
  function firstLight(d) {
    if (!terrain) return null;
    var ct = d.cloud && d.cloud[1] < peak.elev - 20 ? d.cloud[1] : null;
    var sea = ct ? cloudAngle(ct, 40000) : -90;
    var hz = function (az) { return Math.max(skyAt(az), sea); };
    var flat = riseTime(d.date, function () { return 0; });
    var real = riseTime(d.date, hz);
    if (!flat || !real) return null;
    var k = Math.round(real.az) % 360, who = terrain.who[k], hill = who >= 0 ? terrain.hills[who] : null;
    var late = Math.round((real.t - flat.t) / 60000), hills = skyAt(real.az) >= sea;
    return {t: real.t, az: real.az, alt: hz(real.az), late: late, flat: flat.t, hill: hills ? hill : null, dist: terrain.d[k],
      blocked: late > 1 && hills && terrain.h[k] > -0.2, cloud: !!ct && !hills};
  }
  function sunNote(fl) {
    if (!fl) return '';
    var dir = dir16(fl.az);
    if (fl.blocked) {
      var what = fl.hill ? fl.hill.name + ' (' + fl.hill.ele + ' m, ' + km(fl.hill.d) + ' ' + dir + ')' : 'the hills to the ' + dir + ' (' + km(fl.dist) + ' away)';
      return fl.late + ' min after sunrise, once it clears ' + what + '.';
    }
    if (fl.cloud) return (fl.late > 1 ? fl.late + ' min after sunrise' : fl.late < -1 ? Math.abs(fl.late) + ' min before sunrise at sea level' : 'Right at sunrise') + ', lifting out of the cloud sea to the ' + dir + '.';
    if (fl.late < -1) return Math.abs(fl.late) + ' min before sunrise at sea level: from up here you see over the horizon.';
    return 'Right at sunrise, with a clear view to the ' + dir + '.';
  }

  /* ---------- 360° skyline */
  function renderSkyline() {
    var card = document.getElementById('skyline-card');
    if (!terrain || !detail) { card.hidden = true; return; }
    card.hidden = false;
    var d = day(), hrs = d.hours || [], h = hrs[state.hour] || null;
    var cloud = h ? h.cloud : d.cloud, ct = cloud ? cloud[1] : null, eye = terrain.eye;
    document.getElementById('sky-hour').textContent = '· ' + IW.dayLong(d.date) + (h ? ', ' + h.t : '');
    var fl = firstLight(d);

    // facts
    document.getElementById('sky-sun').textContent = fl ? hhmm(fl.t) : '–';
    document.getElementById('sky-sun-note').textContent = sunNote(fl);
    var open = terrain.open, rating = open >= 0.85 ? 'Wide open' : open >= 0.6 ? 'Mostly open' : 'Partly hemmed in';
    document.getElementById('sky-open').textContent = rating;
    document.getElementById('sky-open-note').textContent = Math.round(open * 100) + '% of the skyline is lower than the summit.';
    var higher = terrain.hills.filter(function (x) { return x.vis && x.ele > peak.elev + 5; });
    document.getElementById('sky-higher').textContent = higher.length ? higher.length : 'None';
    document.getElementById('sky-higher-note').textContent = higher.length ? higher.slice(0, 4).map(function (x) { return x.name + ' ' + dir16(x.b); }).join(', ') + (higher.length > 4 ? ' and more.' : '.') : 'This is the highest top in view.';

    // headline: where the cloud sea reaches, and what pokes through
    var head;
    if (!ct) head = 'No cloud layer forecast' + (h ? ' at ' + h.t : '') + ', so no cloud sea. This is the skyline you would see.';
    else if (ct >= peak.elev - 20) head = 'Cloud tops out around ' + ct + ' m, at or above the summit, so you would probably be in it.';
    else {
      var secs = [], names8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      for (var s8 = 0; s8 < 8; s8++) {
        var n = 0; for (var a = s8 * 45 - 22; a < s8 * 45 + 23; a++) if (terrain.z[(a + 360) % 360] < ct) n++;
        if (n / 45 >= 0.6) secs.push(names8[s8]);
      }
      var islands = terrain.hills.filter(function (x) { return x.vis && x.ele > ct + 20; }).slice(0, 4).map(function (x) { return x.name; });
      var where = secs.length === 8 ? 'all the way round' : secs.length ? 'to the ' + (secs.length > 1 ? secs.slice(0, -1).join(', ') + ' and ' + secs[secs.length - 1] : secs[0]) : 'in the valleys below, with hills breaking it up';
      var isl = islands.length > 1 ? islands.slice(0, -1).join(', ') + ' and ' + islands[islands.length - 1] : islands[0];
      head = 'Cloud sea up to ' + ct + ' m, stretching ' + where + '.' + (islands.length ? ' ' + isl + (islands.length > 1 ? ' rise' : ' rises') + ' above it.' : '');
    }
    document.getElementById('sky-head').textContent = head;

    // picture
    var cs = function (k) { return getComputedStyle(document.documentElement).getPropertyValue(k).trim(); };
    var dark = (document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    var az0 = Math.round(fl ? fl.az : 90), W = 1080, PX = W / 360, top = 26, H = 300, base = 262;
    var lo = Math.min.apply(null, terrain.h), hi = Math.max.apply(null, terrain.h);
    var ymin = Math.min(lo - 0.4, -1.5), ymax = Math.max(hi + 0.6, 0.6);
    var X = function (az) { return ((az - az0 + 540) % 360) * PX; };
    var Y = function (ang) { return top + (ymax - ang) * (base - top) / (ymax - ymin); };
    var col = function (i) { return (az0 - 180 + i + 360) % 360; }; // left-to-right azimuths
    var showCloud = ct && ct < peak.elev - 20;
    // Hills poking through the cloud (ignore one-degree specks).
    var poke = [], j;
    for (j = 0; j < 360; j++) poke.push(showCloud && terrain.z[j] >= ct);
    for (j = 0; j < 360; j++) if (poke[j] && !poke[(j + 359) % 360] && !poke[(j + 1) % 360]) poke[j] = false;
    var line = [], far = [], near = [];
    for (var i = 0; i <= 360; i++) {
      var az = col(i % 360), x = (i * PX).toFixed(1);
      line.push(x + ',' + Y(terrain.h[az]).toFixed(1));
      if (showCloud) {
        var seaTop = cloudAngle(ct, 40000);
        far.push(x + ',' + Y(seaTop).toFixed(1));
        near.push(x + ',' + Y(Math.max(poke[az] ? cloudAngle(ct, Math.max(terrain.d[az], 1500)) : seaTop, ymin)).toFixed(1));
      }
    }
    var brand = cs('--brand'), txt = cs('--text'), mut = cs('--muted'), acc = cs('--accent');
    var cloudFill = dark ? '#AEB9C3' : '#FFFFFF', halo = dark ? '#14211B' : '#EEF2F4';
    var sv = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Skyline from ' + IW.esc(peak.name) + '. ' + IW.esc(head) + '">';
    sv += '<defs><linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + (dark ? '#14211B' : '#E8EEF2') + '"/><stop offset="1" stop-color="' + (dark ? '#4A3424' : '#FBE3CC') + '"/></linearGradient>' +
      '<radialGradient id="sung"><stop offset="0" stop-color="' + acc + '" stop-opacity=".55"/><stop offset="1" stop-color="' + acc + '" stop-opacity="0"/></radialGradient></defs>';
    sv += '<rect width="' + W + '" height="' + base + '" fill="url(#skyg)"/>';
    sv += '<line x1="0" x2="' + W + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="' + mut + '" stroke-dasharray="3 5" opacity=".7"/><text x="6" y="' + (Y(0) - 5) + '" font-size="11" fill="' + mut + '">Eye level</text>';
    if (fl) sv += '<circle cx="' + X(fl.az) + '" cy="' + Y(fl.alt) + '" r="34" fill="url(#sung)"/>';
    // far cloud sea (seen beyond and between the hills), then the hills, then the cloud in front of them
    if (showCloud) sv += '<polygon points="0,' + base + ' ' + far.join(' ') + ' ' + W + ',' + base + '" fill="' + cloudFill + '"/>';
    sv += '<polygon points="0,' + base + ' ' + line.join(' ') + ' ' + W + ',' + base + '" fill="' + brand + '"/>';
    sv += '<polyline class="draw" points="' + line.join(' ') + '" fill="none" stroke="' + (dark ? '#8FD0A8' : '#0F2A1C') + '" stroke-width="1.6" stroke-linejoin="round"/>';
    if (showCloud) {
      sv += '<polygon points="0,' + base + ' ' + near.join(' ') + ' ' + W + ',' + base + '" fill="' + cloudFill + '"/>';
      sv += '<text x="' + (W - 8) + '" y="' + (base - 10) + '" text-anchor="end" font-size="12" font-weight="700" fill="' + (dark ? '#0F1714' : '#4B5868') + '">Cloud top ' + ct + ' m</text>';
    }
    // the sun, with its label up in the sky so it never fights the hill names
    if (fl) {
      var sx = X(fl.az), sy = Y(fl.alt);
      sv += '<line x1="' + sx + '" x2="' + sx + '" y1="' + 30 + '" y2="' + (sy - 12) + '" stroke="' + acc + '" stroke-dasharray="2 3"/>' +
        '<circle cx="' + sx + '" cy="' + sy + '" r="9" fill="' + acc + '"/>' +
        '<text x="' + sx + '" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="' + acc + '" stroke="' + halo + '" stroke-width="4" paint-order="stroke">First sun ' + hhmm(fl.t) + '</text>';
    }
    // hill labels (highest first, no overlaps)
    var placed = [];
    terrain.hills.filter(function (x) { return x.sky; }).forEach(function (x) {
      var lx = X(x.b);
      if (placed.length >= 10 || placed.some(function (p) { return Math.abs(p - lx) < 78; }) || lx < 30 || lx > W - 30) return;
      placed.push(lx);
      var ly = Math.max(Y(Math.max(x.a, skyAt(x.b))), 52);
      sv += '<line x1="' + lx + '" x2="' + lx + '" y1="' + (ly - 4) + '" y2="' + (ly - 16) + '" stroke="' + txt + '" stroke-width="1"/>' +
        '<text x="' + lx + '" y="' + (ly - 20) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="' + txt + '" stroke="' + halo + '" stroke-width="3" paint-order="stroke">' + IW.esc(x.name) + ' <tspan font-weight="400">' + x.ele + '</tspan></text>';
    });
    // compass along the bottom
    sv += '<rect y="' + base + '" width="' + W + '" height="' + (H - base) + '" fill="' + cs('--surface-2') + '"/>';
    for (var b = 0; b < 360; b += 22.5) {
      var bx = X(b), main = b % 45 === 0;
      sv += '<line x1="' + bx + '" x2="' + bx + '" y1="' + base + '" y2="' + (base + (main ? 8 : 4)) + '" stroke="' + mut + '"/>';
      if (main) sv += '<text x="' + bx + '" y="' + (base + 24) + '" text-anchor="middle" font-size="13" font-weight="700" fill="' + (b % 90 === 0 ? txt : mut) + '">' + dir16(b) + '</text>';
    }
    sv += '</svg>';
    var pano = document.getElementById('pano');
    pano.innerHTML = sv;
    pano.scrollLeft = (pano.scrollWidth - pano.clientWidth) / 2;
  }

  /* ---------- planner */
  function renderPlan() {
    var d = day();
    document.getElementById('paces').innerHTML = PACES.map(function (p, i) {
      return '<button type="button" class="btn" style="flex: 1" aria-pressed="' + (i === state.pace) + '" data-i="' + i + '">' + p[0] + '</button>';
    }).join('');
    document.querySelectorAll('#paces button').forEach(function (b) {
      b.addEventListener('click', function () { state.pace = +b.dataset.i; IW.set('pace', state.pace); renderPlan(); renderSummary(); });
    });
    var w = walkMinutes(), out = document.getElementById('plan-out'), fl = firstLight(d);
    var dur = Math.floor(w / 60) + 'h ' + ('0' + w % 60).slice(-2) + 'm';
    if (stale) out.innerHTML = '<p class="alert">The forecast has not updated recently, so start times are hidden until it does.</p>';
    else if (!d.window) out.innerHTML = '<p class="card" style="background: var(--surface-2)">No inversion window is expected on ' + IW.dayLong(d.date) + ', so there is no suggested start time. Walking time for your route is about ' + dur + '.</p>';
    else out.innerHTML = '<div class="plan-out"><div class="stack" style="--gap: 2px"><span class="small">Estimated leave-by time</span><span class="leave">' + leaveBy(d) + '</span></div>' +
      '<div class="stack" style="--gap: 2px"><span class="small">Walking time</span><b style="font-size: 18px">' + dur + '</b></div>' +
      '<div class="stack" style="--gap: 2px"><span class="small">Best window on top</span><b style="font-size: 18px">' + d.window[0] + ' to ' + d.window[1] + '</b></div>' +
      (fl ? '<div class="stack" style="--gap: 2px"><span class="small">First sun on the summit</span><b style="font-size: 18px">' + hhmm(fl.t) + '</b></div>' : '') + '</div>' +
      '<p class="muted small" style="margin-top: 10px">An estimate only, based on Naismith\'s rule (5 km/h plus 10 minutes per 100 m of ascent), aiming to reach the top ' + BUFFER + ' minutes before the best window.' + (fl && fl.blocked ? ' Hills to the ' + dir16(fl.az) + ' hold back the sun until ' + hhmm(fl.t) + ', so there is no rush to beat sunrise.' : '') + ' Your own pace, the ground and the dark will all change it.</p>';
  }

  function renderConditions() {
    var d = day();
    document.getElementById('cond-day').textContent = IW.dayLong(d.date) + ', at dawn';
    document.getElementById('c-chill').textContent = IW.temp(chill(d.st, d.wind));
    document.getElementById('c-wind').textContent = d.wind + ' mph';
    document.getElementById('c-fz').textContent = !d.fz ? 'Below valley' : d.fz > 9000 ? 'Very high' : d.fz.toLocaleString('en-GB') + ' m';
    document.getElementById('c-ice').textContent = (d.st <= 0 || (d.fz && d.fz < peak.elev)) ? 'Likely' : 'Not expected';
  }

  function renderCompass() {
    var d = day(), date = new Date(d.date + 'T12:00:00');
    var start = new Date(date.getFullYear(), 0, 0), n = Math.round((date - start) / 86400000);
    var dec = -23.44 * Math.cos(2 * Math.PI / 365 * (n + 10)) * Math.PI / 180, lat = peak.lat * Math.PI / 180;
    var az = Math.round(Math.acos(Math.max(-1, Math.min(1, Math.sin(dec) / Math.cos(lat)))) * 180 / Math.PI);
    var dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    var names = {N: 'north', NNE: 'north-north-east', NE: 'north-east', ENE: 'east-north-east', E: 'east', ESE: 'east-south-east', SE: 'south-east', SSE: 'south-south-east'};
    var dir = dirs[Math.round(az / 22.5) % 16];
    var cs = function (k) { return getComputedStyle(document.documentElement).getPropertyValue(k).trim(); };
    var r = az * Math.PI / 180, sx = Math.round(120 + 84 * Math.sin(r)), sy = Math.round(120 - 84 * Math.cos(r));
    document.getElementById('compass').innerHTML = '<svg viewBox="0 0 240 240" width="200" height="200" role="img" aria-label="Sun rises at ' + az + ' degrees, ' + (names[dir] || dir) + '">' +
      '<circle cx="120" cy="120" r="96" fill="' + cs('--chart-bg') + '" stroke="' + cs('--border') + '" stroke-width="1.5"/>' +
      '<line x1="120" y1="24" x2="120" y2="216" stroke="' + cs('--border-soft') + '"/><line x1="24" y1="120" x2="216" y2="120" stroke="' + cs('--border-soft') + '"/>' +
      ['N', 'E', 'S', 'W'].map(function (c, i) { var p = [[120, 16], [230, 125], [120, 236], [10, 125]][i]; return '<text x="' + p[0] + '" y="' + p[1] + '" text-anchor="middle" font-size="14" font-weight="700" fill="' + cs('--text') + '">' + c + '</text>'; }).join('') +
      '<line x1="120" y1="120" x2="' + sx + '" y2="' + sy + '" stroke="' + cs('--accent') + '" stroke-width="3" stroke-linecap="round"/><circle cx="' + sx + '" cy="' + sy + '" r="11" fill="' + cs('--accent') + '"/></svg>';
    document.getElementById('sun-dir').textContent = az + '° ' + dir;
    var fl = firstLight(d);
    document.getElementById('sun-text').textContent = 'The sun comes up at ' + d.sunrise + ', to the ' + (names[dir] || dir) + '. ' +
      (fl ? 'From the summit, first sun is at ' + hhmm(fl.t) + (fl.blocked ? (fl.hill ? ', once it clears ' + fl.hill.name : ', once it clears the hills') : '') + '. ' : '') + 'Face this way to see first light on the cloud.';
  }
})();
