/* Peak page: summary, 6-day table, atmospheric profile, score breakdown, planner, conditions. */
(function () {
  'use strict';
  IW.chrome('peak');
  var id = IW.qs('id') || 'helvellyn';
  var state = {day: Math.max(0, Math.min(5, +(IW.qs('day') || 0))), hour: null, tab: 'forecast', pace: IW.get('pace', 1)};
  var PACES = [['Relaxed', 1.25], ['Steady', 1], ['Quick', 0.85]];
  var BUFFER = 20;
  var summary, peak, area, detail, stale = false;

  Promise.all([IW.load('data/forecast.json'), IW.load('data/peaks/' + id + '.json')]).then(function (r) {
    summary = r[0]; detail = r[1];
    peak = summary.peaks.filter(function (p) { return p.id === id; })[0];
    if (!peak || !detail.days.length) throw new Error('missing');
    area = summary.areas.filter(function (a) { return a.id === peak.area; })[0];
    stale = !summary.demo && IW.ageHours(summary.generated_at) > 12;
    document.getElementById('demo-banner').hidden = !summary.demo;
    setupStatic();
    render();
  }).catch(function () {
    document.getElementById('peak-name').textContent = 'Peak not found';
    document.getElementById('main').innerHTML = '<p>We could not find a forecast for this peak. <a href="index.html">Back to the UK overview</a>.</p>';
  });

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
    document.getElementById('hour').addEventListener('input', function (e) { state.hour = +e.target.value; renderProfile(); });

    var asc = IW.get('ascent:' + id, peak.elev - peak.valley_m);
    var dist = IW.get('dist:' + id, Math.round((3 + (peak.elev - peak.valley_m) / 250) * 10) / 10);
    document.getElementById('ascent').value = asc;
    document.getElementById('dist').value = dist;
    ['ascent', 'dist'].forEach(function (k) {
      document.getElementById(k).addEventListener('input', function (e) { IW.set(k + ':' + id, +e.target.value); renderPlan(); renderSummary(); });
    });
    document.addEventListener('iw:theme', function () { renderProfile(); renderCompass(); });
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
    renderSummary(); renderTable(); renderProfile(); renderFactors(); renderPlan(); renderConditions(); renderCompass();
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
    document.getElementById('sum-leave').textContent = leaveBy(d) || '–';
    document.getElementById('sum-margin').textContent = d.cloud ? (peak.elev - d.cloud[1] >= 0 ? (peak.elev - d.cloud[1]) + ' m above' : 'In cloud') : 'No cloud layer';
    document.getElementById('sum-chill').textContent = IW.temp(chill(d.st, d.wind));
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
      ['diff', 'Summit warmer than valley', 30, (Math.round(d.st - d.vt) > 0 ? '+' : Math.round(d.st - d.vt) < 0 ? '−' : '') + Math.abs(Math.round(d.st - d.vt)) + '°C at the summit; normally about 5°C colder'],
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
    s += '<polyline fill="none" stroke="' + cs('--dew') + '" stroke-width="2.5" stroke-linejoin="round" points="' + lv.map(function (l) { return X(l[2]) + ',' + Y(l[0]); }).join(' ') + '"/>';
    s += '<polyline fill="none" stroke="' + acc + '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" points="' + lv.map(function (l) { return X(l[1]) + ',' + Y(l[0]); }).join(' ') + '"/>';
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

  /* ---------- planner */
  function renderPlan() {
    var d = day();
    document.getElementById('paces').innerHTML = PACES.map(function (p, i) {
      return '<button type="button" class="btn" style="flex: 1" aria-pressed="' + (i === state.pace) + '" data-i="' + i + '">' + p[0] + '</button>';
    }).join('');
    document.querySelectorAll('#paces button').forEach(function (b) {
      b.addEventListener('click', function () { state.pace = +b.dataset.i; IW.set('pace', state.pace); renderPlan(); renderSummary(); });
    });
    var w = walkMinutes(), out = document.getElementById('plan-out');
    var dur = Math.floor(w / 60) + 'h ' + ('0' + w % 60).slice(-2) + 'm';
    if (stale) out.innerHTML = '<p class="alert">The forecast has not updated recently, so start times are hidden until it does.</p>';
    else if (!d.window) out.innerHTML = '<p class="card" style="background: var(--surface-2)">No inversion window is expected on ' + IW.dayLong(d.date) + ', so there is no suggested start time. Walking time for your route is about ' + dur + '.</p>';
    else out.innerHTML = '<div class="plan-out"><div class="stack" style="--gap: 2px"><span class="small">Estimated leave-by time</span><span class="leave">' + leaveBy(d) + '</span></div>' +
      '<div class="stack" style="--gap: 2px"><span class="small">Walking time</span><b style="font-size: 18px">' + dur + '</b></div>' +
      '<div class="stack" style="--gap: 2px"><span class="small">Best window on top</span><b style="font-size: 18px">' + d.window[0] + ' to ' + d.window[1] + '</b></div></div>' +
      '<p class="muted small" style="margin-top: 10px">An estimate only, based on Naismith\'s rule (5 km/h plus 10 minutes per 100 m of ascent), aiming to reach the top ' + BUFFER + ' minutes before the best window. Your own pace, the ground and the dark will all change it.</p>';
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
    document.getElementById('sun-text').textContent = 'The sun comes up at ' + d.sunrise + ', to the ' + (names[dir] || dir) + '. Face this way from the summit to see first light on the cloud.';
  }
})();
