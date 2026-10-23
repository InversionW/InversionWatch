/* Peak page: summary, 6-day table, atmospheric profile, score breakdown, planner, conditions. */
(function () {
  'use strict';
  IW.chrome('peak');
  var id = IW.qs('id') || 'helvellyn';
  var state = {day: Math.max(0, Math.min(5, +(IW.qs('day') || 0))), hour: null, sky: null, face: IW.get('face', 'S'), cloudOn: IW.get('cloudOn', true), tab: 'forecast', pace: IW.get('pace', 1)};
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
    if (detail) { renderSkyline(); renderProfile(); renderPlan(); renderCompass(); if (IW.motion) try { IW.motion.refresh(); } catch (e) {} }
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
    
    document.getElementById('sky-range').addEventListener('input', function (e) { state.sky = +e.target.value; renderSkyline(); renderProfile(); });
    document.getElementById('why-more').addEventListener('click', function () { state.whyOpen = !state.whyOpen; renderWhy(day()); });
    ['S', 'N'].forEach(function (f) {
      document.getElementById('face-' + f).addEventListener('click', function () {
        state.face = f; IW.set('face', f);
        if (gsv.state === 'open') gsv.panorama.setPov({heading: f === 'N' ? 0 : 180, pitch: 4});
        else if (photo.state === 'ready') photo.viewer.lookAt(4, yawFor(f === 'N' ? 0 : 180), 100); else renderSkyline();
      });
    });
    document.getElementById('gsv-open').addEventListener('click', openGoogle);
    document.getElementById('cloud-toggle').addEventListener('change', function (e) { state.cloudOn = e.target.checked; IW.set('cloudOn', state.cloudOn); renderSkyline(); });
    document.getElementById('face-sun').addEventListener('click', function () {
      var q = skyDay(day()).path[state.sky || 0];
      if (gsv.state === 'open' && q) { gsv.panorama.setPov({heading: q.az, pitch: Math.max(2, q.alt / 2)}); return; }
      if (photo.state !== 'ready') return;
      if (q) photo.viewer.lookAt(Math.max(2, q.alt / 2), yawFor(q.az), Math.min(120, Math.max(80, q.alt * 2.6)));
    });

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
    chips.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { state.day = +b.dataset.i; state.hour = null; state.sky = null; render(); }); });
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
    var arc = document.getElementById('dial-arc'), C = 2 * Math.PI * 52;
    arc.style.strokeDasharray = C.toFixed(1);
    arc.style.strokeDashoffset = (C * (1 - Math.max(0, Math.min(100, d.score)) / 100)).toFixed(1);
    document.getElementById('dial').className = 'dial ' + IW.pill(d.score).replace('pill-', 'dial-');
    document.getElementById('score-day').textContent = 'Chance of a cloud sea at dawn on ' + IW.dayLong(d.date) + ' · ' + d.conf.toLowerCase() + ' confidence';
    renderPeakbar();
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
  // One line per signal: what it is, the key number, and the points it adds to the score.
  var WEIGHT = {diff: 30, moist: 20, wind: 15, pressure: 15, below: 10, clear: 10};
  function whyValue(k, d) {
    if (k === 'diff') { var inv = d.inv != null ? d.inv : Math.max(0, d.st - d.vt); return inv >= 0.5 ? '+' + inv.toFixed(1) + '°C' + (d.inv_top ? ' at ' + d.inv_top + ' m' : '') : 'cools with height'; }
    if (k === 'moist') return d.rh_valley + '% humidity';
    if (k === 'wind') return d.wind + ' mph on top';
    if (k === 'pressure') return d.pressure + ' hPa';
    if (k === 'below') return d.cloud ? 'top ~' + d.cloud[1] + ' m' + (d.cloud[1] < peak.elev ? ', ' + (peak.elev - d.cloud[1]) + ' m below you' : '') : 'none forecast';
    if (k === 'clear') return d.high_cloud + '% high cloud';
    return '';
  }
  function renderWhy(d) {
    var box = document.getElementById('why');
    if (!d.why) { box.hidden = true; return; }
    box.hidden = false;
    var keyed = d.why.good.length && typeof d.why.good[0] === 'object' || d.why.held.length && d.why.held[0].key;
    var li = function (it, st) {
      if (!keyed) return '<li>' + ICON[st] + '<span>' + IW.esc(typeof it === 'string' ? it : it.text) + '</span></li>';
      var f = d.factors ? d.factors[it.key] || 0 : 0, w = WEIGHT[it.key] || 10, short = it.short.charAt(0).toUpperCase() + it.short.slice(1);
      return '<li class="why-item">' + ICON[st] + '<span class="why-line"><b>' + IW.esc(short) + '</b> <span class="muted">· ' + IW.esc(whyValue(it.key, d)) + '</span>' +
        '<span class="why-full">' + IW.esc(it.text) + '</span></span>' +
        '<span class="why-pts" title="Points towards the score"><span class="why-bar ' + st + '"><i style="width:' + Math.round(f * 100) + '%"></i></span>' + Math.round(f * w) + '/' + w + '</span></li>';
    };
    document.getElementById('why-good').innerHTML = d.why.good.length ? d.why.good.map(function (t) { return li(t, 'good'); }).join('') : '<li class="none">Nothing much on this morning.</li>';
    document.getElementById('why-held').innerHTML = d.why.held.length ? d.why.held.map(function (h) { return li(h, h.state); }).join('') : '<li class="none">Nothing: every signal is in its favour.</li>';
    var need = d.why.need || '', i = need.indexOf(': ');
    document.getElementById('why-need').innerHTML = i > 0 ? '<b>' + IW.esc(need.slice(0, i)) + ':</b> <span style="font-weight: 400">' + IW.esc(need.slice(i + 2)) + (state.day >= 3 ? ' This day is four or more days out, so treat it as a heads-up.' : '') + '</span>' : IW.esc(need);
    var more = document.getElementById('why-more');
    more.hidden = !keyed;
    more.setAttribute('aria-expanded', state.whyOpen ? 'true' : 'false');
    more.textContent = state.whyOpen ? 'Show the short version' : 'Read the full reasons';
    box.classList.toggle('open', !!state.whyOpen);
  }

  // 6. A slim bar that stays at the top: the peak, the day and its score.
  function renderPeakbar() {
    if (!detail) return;
    document.getElementById('pb-name').textContent = peak.name;
    var d = day();
    document.getElementById('pb-score').innerHTML = '<span class="verdict-pill small ' + IW.pill(d.score) + '">' + d.score + '% · ' + IW.label(d.score) + '</span>';
    var box = document.getElementById('pb-days');
    box.innerHTML = detail.days.map(function (x, i) {
      return '<button type="button" data-i="' + i + '" aria-pressed="' + (i === state.day) + '"><span>' + IW.dayShort(x.date) + '</span><b class="' + IW.heat(x.score) + '">' + x.score + '</b></button>';
    }).join('');
    box.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { state.day = +b.dataset.i; state.hour = null; state.sky = null; render(); }); });
  }
  (function watchSummary() {
    var bar = document.getElementById('peakbar'), sum = document.getElementById('summary');
    if (!('IntersectionObserver' in window) || !sum) return;
    new IntersectionObserver(function (es) { bar.hidden = es[0].isIntersecting || !detail; }, {rootMargin: '-60px 0px 0px 0px'}).observe(sum);
  })();

  function renderTable() {
    var ds = detail.days;
    // Colour each weather cell the way the score judges it (same thresholds as the reasons).
    var grade = function (d, k) { var v = d.factors ? d.factors[k] : null; return v == null ? '' : v >= 0.67 ? 'sig-good' : v < 0.34 ? 'sig-bad' : 'sig-mixed'; };
    var tcls = function (t) { return 'tchip ' + (t <= 0 ? 't0' : t <= 4 ? 't1' : t <= 8 ? 't2' : 't3'); };
    var ICONS = {
      score: '<path d="M3 17l5-7 4 4 3-5 6 8z"/><path d="M3 20h18"/>',
      temp: '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/>',
      layer: '<path d="M3 16l5-8 4 5 3-4 6 7z"/><path d="M2 12h20" stroke-dasharray="2 2"/>',
      rh: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
      wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
      p: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4"/>',
      cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/>'
    };
    var ico = function (k) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>'; };
    function row(icon, label, note, fn, cls) {
      return '<tr><th scope="row"><span class="rl">' + ico(icon) + '<span>' + label + (note ? '<br><span class="muted small" style="font-weight: 400">' + note + '</span>' : '') + '</span></span></th>' +
        ds.map(function (d, i) { return '<td class="' + (cls ? cls(d) : '') + (i === state.day ? ' sel' : '') + '">' + fn(d) + '</td>'; }).join('') + '</tr>';
    }
    // A tiny picture of where the cloud sits against the summit.
    var cloudPic = function (d) {
      if (!d.cloud) return '<span class="muted">None</span>';
      var top = Math.max(peak.elev + 150, d.cloud[1] + 50), Yc = function (z) { return 30 - Math.max(0, Math.min(top, z)) / top * 28; };
      var y0 = Yc(d.cloud[1]), y1 = Yc(d.cloud[0]), ys = Yc(peak.elev);
      return '<span class="cloudpic"><svg width="56" height="32" viewBox="0 0 56 32" aria-hidden="true"><path d="M4 31 L22 ' + ys.toFixed(1) + ' L28 ' + (ys + 3).toFixed(1) + ' L52 31z" fill="var(--brand)"/>' +
        '<rect x="0" y="' + y0.toFixed(1) + '" width="56" height="' + Math.max(2, y1 - y0).toFixed(1) + '" fill="var(--cloud)" opacity=".85"/></svg>' +
        '<span>' + d.cloud[0] + '–' + d.cloud[1] + ' m</span></span>';
    };
    var warm = function (d) {
      var inv = d.inv != null ? d.inv : Math.max(0, d.st - d.vt);
      return inv >= 0.5 ? '<b>+' + inv.toFixed(1) + '°C</b>' + (d.inv_top ? '<br><span class="small">at ' + d.inv_top + ' m</span>' : '') : '<b>None</b><br><span class="small">cools with height</span>';
    };
    var html = '<table><thead><tr><th scope="row"><span class="visually-hidden">Day</span></th>' + ds.map(function (d, i) {
      return '<th scope="col" class="dayhead ' + (i < 3 ? 'mwis' : 'outlook') + (i === state.day ? ' sel' : '') + '"><button type="button" data-i="' + i + '" aria-pressed="' + (i === state.day) + '">' +
        '<span class="dh-day">' + IW.dayShort(d.date) + '</span><span class="dh-sub">' + (i < 3 ? 'MWIS window' : 'Outlook') + ' · sunrise ' + d.sunrise + '</span></button></th>';
    }).join('') + '</tr></thead><tbody>' +
      row('score', 'Inversion chance', '', function (d) { return '<b class="chance">' + d.score + '%</b><span class="chance-word">' + IW.label(d.score) + '</span>'; }, function (d) { return 'chance-cell ' + IW.heat(d.score); }) +
      row('temp', 'Summit', peak.elev + ' m', function (d) { return '<span class="' + tcls(d.st) + '">' + IW.temp(d.st) + '</span>'; }) +
      row('temp', 'Valley', peak.valley_m + ' m', function (d) { return '<span class="' + tcls(d.vt) + '">' + IW.temp(d.vt) + '</span>'; }) +
      row('temp', 'Summit minus valley', 'positive = inversion', function (d) { var x = Math.round(d.st - d.vt); return '<b>' + (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x) + '°C</b>'; }, function (d) { return Math.round(d.st - d.vt) > 0 ? 'sig-good' : ''; }) +
      row('rh', 'Valley humidity', '', function (d) { return '<b>' + d.rh_valley + '%</b><span class="minibar"><i style="width: ' + Math.max(0, Math.min(100, d.rh_valley)) + '%"></i></span>'; }, function (d) { return grade(d, 'moist'); }) +
      row('wind', 'Summit wind', 'mph', function (d) { return '<b>' + d.wind + '</b>'; }, function (d) { return grade(d, 'wind'); }) +
      row('p', 'Pressure', 'hPa', function (d) { return '<b>' + d.pressure + '</b>'; }, function (d) { return grade(d, 'pressure'); }) +
      row('cloud', 'Cloud layer', 'base–top, m', cloudPic, function (d) { return grade(d, 'below'); }) +
      '</tbody></table>' +
      '<div class="sig-key"><span><i class="sig-good"></i>Helping</span><span><i class="sig-mixed"></i>Borderline</span><span><i class="sig-bad"></i>Holding it back</span><span class="muted">Select a day to see it in full.</span></div>';
    var el = document.getElementById('daytable');
    el.innerHTML = html;
    el.querySelectorAll('.dayhead button').forEach(function (b) {
      b.addEventListener('click', function () { state.day = +b.dataset.i; state.hour = null; state.sky = null; render(); });
    });
  }


  function renderFactors() {
    document.getElementById('sources').innerHTML = 'Check these too: <a href="' + area.mwis + '">MWIS ' + IW.esc(area.short) + '</a> (days 1–3) · ' +
      '<a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain">Met Office mountain</a> · <a href="https://www.mountain-forecast.com/">Mountain-Forecast</a>';
  }

  /* ---------- atmospheric profile */
  function renderProfile() {
    var d = day(), hours = (d.hours || []).filter(function (h) { return +h.t.slice(0, 2) <= 12; });
    if (!hours.length) { document.getElementById('profile-svg').innerHTML = '<p class="muted">No profile available.</p>'; return; }
    // Follow the page's time slider; before it is ready, show the hour of sunrise.
    var want = +d.sunrise.slice(0, 2), sd = terrain ? skyDay(d) : null, later = false;
    if (sd && sd.path.length) {
      var q = sd.path[state.sky == null ? sd.start : state.sky] || sd.path[0];
      want = localHour(q.t + 30 * 60000);
      later = want > +hours[hours.length - 1].t.slice(0, 2);
    }
    state.hour = 0;
    hours.forEach(function (hh, i) { if (+hh.t.slice(0, 2) <= want) state.hour = i; });
    var h = hours[state.hour];
    document.getElementById('hour-out').textContent = '· ' + h.t;
    document.getElementById('sunrise-note').textContent = later ? 'The profile covers the morning only; this is the last one, at ' + h.t + '.' : 'Follows the time slider above. Sunrise ' + d.sunrise + '.';

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

  /* ---------- 360° skyline, with the sun's path from first light to midday */
  function localHour(ms) { return +new Date(ms).toLocaleTimeString('en-GB', {hour: '2-digit', hour12: false, timeZone: 'Europe/London'}).slice(0, 2); }
  // Forecast hour nearest a moment (hours run 03:00 to 12:00).
  function hourFor(d, ms) {
    var hrs = d.hours || [], want = localHour(ms + 30 * 60000), best = null;
    hrs.forEach(function (h) { var hh = +h.t.slice(0, 2); if (!best || Math.abs(hh - want) < Math.abs(+best.t.slice(0, 2) - want)) best = h; });
    return best;
  }
  // Last moment the sun is above the skyline in the evening.
  function lastLight(dateIso) {
    var p = dateIso.split('-'), t = Date.UTC(+p[0], +p[1] - 1, +p[2], 23, 0), stop = Date.UTC(+p[0], +p[1] - 1, +p[2], 12, 0);
    for (; t > stop; t -= 30000) { var s = sunAt(t, terrain.lat, terrain.lon); if (s.alt >= skyAt(s.az) - 0.833) return t; }
    return null;
  }
  var skyCache = {};
  function skyDay(d) {
    if (skyCache[d.date]) return skyCache[d.date];
    var fl = firstLight(d), path = [], end = lastLight(d.date), start = 0;
    if (fl && end) {
      var add = function (t) { var sp = sunAt(t, terrain.lat, terrain.lon); path.push({t: t, az: sp.az, alt: sp.alt}); };
      var p3 = d.date.split('-'), u3 = Date.UTC(+p3[0], +p3[1] - 1, +p3[2], 3, 0), t3 = u3 - (localHour(u3) - 3) * 3600000; // 03:00 UK time
      for (var t0 = t3; t0 < fl.t; t0 += 600000) add(t0);
      start = path.length;
      add(fl.t);
      for (var t = Math.ceil((fl.t + 1) / 600000) * 600000; t < end; t += 600000) add(t);
    }
    if (path.length && path[path.length - 1].t < end) { var se = sunAt(end, terrain.lat, terrain.lon); path.push({t: end, az: se.az, alt: se.alt}); }
    return (skyCache[d.date] = {fl: fl, ll: end, path: path, start: start});
  }

  /* ---------- the forecast cloud sea, as angles: for each 2° of compass, the top (far edge) and bottom (near edge) */
  function cloudBand(ct) {
    var c = terrain && terrain.cloud;
    if (!c || !ct || !c.levels.length) return null;
    var k = 0;
    c.levels.forEach(function (lv, i) { if (Math.abs(lv - ct) < Math.abs(c.levels[k] - ct)) k = i; });
    var lv = c.levels[k], R = 6371000, K = 0.13, ang = function (dd) { return Math.atan2(lv - terrain.eye - dd * dd / (2 * R) * (1 - K), dd) * 180 / Math.PI; };
    var out = [];
    for (var i = 0; i < c.near[k].length; i++) {
      var n = c.near[k][i] * 10, f = c.far[k][i] * 10;
      out.push(n ? {az: i * c.az_step, top: ang(f || 40000), bottom: ang(Math.max(n, 60))} : null);
    }
    return {level: lv, cols: out};
  }
  // Runs of neighbouring columns that have cloud, so each can be drawn as one shape.
  function bandRuns(band, from, to) {
    var runs = [], cur = null, st = band.cols.length, step = 360 / st;
    for (var a = from; a <= to; a += step) {
      var i = Math.round(((a % 360) + 360) % 360 / step) % st, col = band.cols[i];
      if (col) { if (!cur) { cur = []; runs.push(cur); } cur.push({az: a, top: col.top, bottom: col.bottom}); } else cur = null;
    }
    return runs;
  }

  /* ---------- the summit photo (Mapillary 360°), when there is one */
  var photo = {entry: null, state: 'none', viewer: null, spots: [], fixed: false};
  function startMapillary() {
  IW.load('data/panos.json').then(function (j) {
    var e = j && j.peaks && j.peaks[id], tok = (window.IW_CONFIG || {}).mapillaryToken;
    if (!e || !tok) return;
    photo.entry = e; photo.state = 'loading';
    var big = window.innerWidth > 700;
    fetch('https://graph.mapillary.com/' + encodeURIComponent(e.id) + '?fields=thumb_2048_url,thumb_original_url&access_token=' + encodeURIComponent(tok))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (m) {
        var url = (big && m.thumb_original_url) || m.thumb_2048_url || m.thumb_original_url;
        if (!url) throw new Error('no image');
        return loadPannellum().then(function () { startPhoto(url); });
      })
      .catch(function () { photo.state = 'failed'; if (detail && terrain) renderSkyline(); });
  }).catch(function () {});
  }

  /* ---------- Google Street View from the summit (preferred when there is one) */
  var gsv = {state: 'none', pano: null, panorama: null, at: null};
  (function startGoogle() {
    var key = (window.IW_CONFIG || {}).googleMapsKey;
    if (!key) { startMapillary(); return; }
    gsv.state = 'looking';
    window.__iwGmaps = function () {
      // Finding the nearest 360° view is a free metadata lookup; nothing is billed until someone opens it.
      var where = function () { return terrain ? {lat: terrain.lat, lng: terrain.lon} : {lat: peak ? peak.lat : 0, lng: peak ? peak.lon : 0}; };
      var go = function () {
        new google.maps.StreetViewService().getPanorama({location: where(), radius: 100, preference: google.maps.StreetViewPreference.NEAREST, sources: [google.maps.StreetViewSource.DEFAULT]}, function (data, status) {
          if (status === 'OK' && data && data.location) {
            gsv.state = 'found'; gsv.pano = data.location.pano;
            gsv.at = {lat: data.location.latLng.lat(), lng: data.location.latLng.lng(), desc: data.location.description || '', when: data.imageDate || ''};
            if (detail && terrain) renderSkyline();
          } else { gsv.state = 'none'; startMapillary(); }
        });
      };
      if (peak) go(); else { var wait = setInterval(function () { if (peak) { clearInterval(wait); go(); } }, 200); }
    };
    var js = document.createElement('script');
    js.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=weekly&callback=__iwGmaps';
    js.async = true; js.onerror = function () { gsv.state = 'none'; startMapillary(); };
    document.head.appendChild(js);
  })();

  // Street View is the default: it opens by itself once the card scrolls into view, so visitors who
  // never get that far don't use up any of Google's free monthly allowance.
  function autoOpenGoogle() {
    if (gsv.watching) return;
    gsv.watching = true;
    // Only load once the viewer area itself is properly on screen and stays there for a
    // moment, so a quick glance at the score or a fast scroll past doesn't use a load.
    var spot = document.getElementById('gsv');
    if (!('IntersectionObserver' in window)) return; // old browsers keep the "Open" button
    var timer = null;
    var io = new IntersectionObserver(function (es) {
      var seen = es.some(function (e) { return e.isIntersecting; });
      if (seen && !timer) timer = setTimeout(function () { io.disconnect(); openGoogle(); }, 1200);
      if (!seen && timer) { clearTimeout(timer); timer = null; }
    }, {rootMargin: '0px 0px -30% 0px'});
    io.observe(spot);
  }

  // Open the Street View (this is the only step that counts towards Google's monthly allowance).
  function openGoogle() {
    if (gsv.state !== 'found') return;
    var d = day(), sd = skyDay(d), q = sd.path[state.sky || 0] || sd.path[0];
    document.getElementById('gsv-frame').hidden = false;
    document.getElementById('gsv-open').hidden = true;
    gsv.panorama = new google.maps.StreetViewPanorama(document.getElementById('gsv-view'), {
      pano: gsv.pano, pov: {heading: q ? q.az : 120, pitch: q ? Math.max(2, q.alt / 2) : 4}, zoom: 1,
      addressControl: false, showRoadLabels: false, linksControl: false, motionTracking: false, motionTrackingControl: false, fullscreenControl: false
    });
    ['pov_changed', 'zoom_changed', 'status_changed'].forEach(function (ev) { gsv.panorama.addListener(ev, drawOverlay); });
    window.addEventListener('resize', drawOverlay);
    gsv.state = 'open';
    var dist = Math.round(haversine(gsv.at.lat, gsv.at.lng, terrain.lat, terrain.lon));
    document.getElementById('gsv-credit').textContent = 'Street View imagery © Google and its contributors' + (gsv.at.when ? ', taken ' + gsv.at.when : '') + ', about ' + dist + ' m from the top. It shows the weather on the day it was taken, not the forecast.';
    renderSkyline();
  }
  function haversine(a1, o1, a2, o2) {
    var r = Math.PI / 180, x = Math.sin((a2 - a1) * r / 2), y = Math.sin((o2 - o1) * r / 2);
    return 2 * 6371000 * Math.asin(Math.sqrt(x * x + Math.cos(a1 * r) * Math.cos(a2 * r) * y * y));
  }

  // Where a bearing and height (degrees) land on screen, for the current Street View camera. Null if behind you.
  function project(az, alt, pov, zoom, w, h) {
    var r = Math.PI / 180, fov = 180 / Math.pow(2, zoom), f = (w / 2) / Math.tan(fov / 2 * r);
    var A = az * r, E = alt * r, H = pov.heading * r, P = pov.pitch * r;
    var d = [Math.cos(E) * Math.sin(A), Math.cos(E) * Math.cos(A), Math.sin(E)];
    var fw = [Math.cos(P) * Math.sin(H), Math.cos(P) * Math.cos(H), Math.sin(P)];
    var rt = [Math.cos(H), -Math.sin(H), 0];
    var up = [-Math.sin(P) * Math.sin(H), -Math.sin(P) * Math.cos(H), Math.cos(P)];
    var z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    if (z <= 0.05) return null;
    var x = d[0] * rt[0] + d[1] * rt[1], y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    return {x: w / 2 + f * x / z, y: h / 2 - f * y / z};
  }
  var overlayItems = [], overlayBand = null;
  function drawOverlay() {
    if (gsv.state !== 'open' || !gsv.panorama) return;
    var box = document.getElementById('gsv-over'), w = box.clientWidth, h = box.clientHeight;
    var pov = gsv.panorama.getPov(), zoom = gsv.panorama.getZoom() || 1, html = '';
    if (overlayBand && state.cloudOn) {
      // Only the part of the view on screen: wider angles distort badly in a flat projection.
      var fov = 180 / Math.pow(2, zoom), vhalf = Math.atan(h / w * Math.tan(fov / 2 * Math.PI / 180)) * 180 / Math.PI, svg = '';
      var floor = pov.pitch - vhalf - 3;
      bandRuns(overlayBand, pov.heading - fov / 2 - 6, pov.heading + fov / 2 + 6).forEach(function (run) {
        var seg = [];
        var flush = function () {
          if (seg.length > 1) svg += '<polygon points="' + seg.map(function (q) { return q.t; }).concat(seg.map(function (q) { return q.b; }).reverse()).join(' ') + '"/>';
          seg = [];
        };
        run.forEach(function (c) {
          var t = project(c.az, c.top, pov, zoom, w, h), b = project(c.az, Math.max(c.bottom, floor), pov, zoom, w, h);
          if (t && b) seg.push({t: t.x.toFixed(1) + ',' + t.y.toFixed(1), b: b.x.toFixed(1) + ',' + b.y.toFixed(1)}); else flush();
        });
        flush();
      });
      html += '<svg class="o-cloud" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><defs><filter id="ocb"><feGaussianBlur stdDeviation="3"/></filter></defs><g filter="url(#ocb)">' + svg + '</g></svg>';
      // label near the left edge, just above the cloud top
      var la = pov.heading - fov * 0.38, col = overlayBand.cols[Math.round((((la % 360) + 360) % 360) / (360 / overlayBand.cols.length)) % overlayBand.cols.length];
      var lp = col ? project(la, col.top, pov, zoom, w, h) : null;
      if (lp) html += '<span class="o-tag" style="left:' + Math.max(100, Math.min(w - 100, lp.x)).toFixed(1) + 'px;top:' + lp.y.toFixed(1) + 'px"><span class="iw-tag cloudtag">Forecast cloud top ≈ ' + overlayBand.level + ' m</span></span>';
    }
    overlayItems.forEach(function (it) {
      var p = project(it.az, it.alt, pov, zoom, w, h);
      if (!p || p.x < -80 || p.x > w + 80 || p.y < -40 || p.y > h + 40) return;
      html += it.html.replace('{x}', p.x.toFixed(1)).replace('{y}', p.y.toFixed(1));
    });
    box.innerHTML = html;
  }
  function placeOnGoogle(path, now, hidden, band) {
    overlayBand = band;
    var items = [], tagStyle = 'left:{x}px;top:{y}px';
    path.forEach(function (q, i) {
      var a = q.alt + refract(q.alt), hr = new Date(q.t).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'});
      items.push({az: q.az, alt: a, html: '<i class="o-dot" style="' + tagStyle + '"></i>'});
      if (i && hr.slice(3) === '00' && +hr.slice(0, 2) % 2 === 0 && Math.abs(q.t - now.t) > 25 * 60000)
        items.push({az: q.az, alt: a, html: '<span class="o-tag" style="' + tagStyle + '"><span class="iw-tag">' + hr + '</span></span>'});
    });
    var na = now.alt + refract(now.alt);
    items.push({az: now.az, alt: na, html: '<i class="o-sun' + (hidden ? ' hidden' : '') + '" style="' + tagStyle + '"></i>'});
    items.push({az: now.az, alt: na, html: '<span class="o-tag" style="' + tagStyle + '"><span class="iw-tag sun">' + hhmm(now.t) + (hidden ? ' · hidden' : '') + '</span></span>'});
    var placed = [];
    terrain.hills.filter(function (x) { return x.sky; }).forEach(function (x) {
      if (placed.length >= 12 || placed.some(function (b) { return Math.abs(((x.b - b + 540) % 360) - 180) < 6; })) return;
      placed.push(x.b);
      items.push({az: x.b, alt: Math.max(x.a, skyAt(x.b)), html: '<span class="o-tag" style="' + tagStyle + '"><span class="iw-tag">' + IW.esc(x.name) + ' <small>' + x.ele + ' m</small></span></span>'});
    });
    ['N', 'E', 'S', 'W'].forEach(function (c, i) {
      items.push({az: i * 90, alt: skyAt(i * 90) - 6, html: '<span class="o-tag" style="' + tagStyle + '"><span class="iw-tag compass">' + c + '</span></span>'});
    });
    overlayItems = items;
    drawOverlay();
  }

  function loadPannellum() {
    if (window.pannellum) return Promise.resolve();
    return new Promise(function (ok, fail) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.css';
      document.head.appendChild(css);
      var js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.js';
      js.onload = function () { ok(); }; js.onerror = fail;
      document.head.appendChild(js);
    });
  }
  // Viewer yaw for a compass bearing: the middle of a Mapillary panorama faces its "heading".
  function yawFor(az) { return ((az - photo.entry.heading + 540) % 360) - 180; }
  // How much higher the sun looks than it really is, near the horizon (atmospheric refraction), in degrees.
  function refract(alt) { return alt < -1.5 ? 0 : 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * Math.PI / 180) / 60; }
  function startPhoto(url) {
    var wrap = document.getElementById('photo360');
    wrap.hidden = false;
    document.getElementById('pano').hidden = true;
    var e = photo.entry, sd = detail && terrain ? skyDay(day()) : null, az = sd && sd.fl ? sd.fl.az : 120;
    photo.viewer = window.pannellum.viewer('photo360-view', {
      type: 'equirectangular', panorama: url, crossOrigin: 'anonymous', autoLoad: true,
      yaw: yawFor(az), pitch: 4, hfov: 100, minHfov: 40, maxHfov: 120, showFullscreenCtrl: true, compass: false, northOffset: e.heading
    });
    photo.viewer.on('load', function () { photo.state = 'ready'; photo.fixed = false; renderSkyline(); });
    photo.viewer.on('error', function () { photo.state = 'failed'; wrap.hidden = true; renderSkyline(); });
    var c = document.getElementById('photo-credit');
    c.innerHTML = '360° photo by ' + IW.esc(e.by || 'a Mapillary contributor') + ', ' + IW.esc(e.captured) + ', taken ' + e.dist + ' m from the top. ' +
      '<a href="https://www.mapillary.com/app/?pKey=' + encodeURIComponent(e.id) + '">View on Mapillary</a> (CC BY-SA 4.0). It shows the weather on the day it was taken, not the forecast.';
  }
  function tag(cls, html) { return function (div) { var s = document.createElement('span'); s.className = 'iw-tag ' + cls; s.innerHTML = html; div.appendChild(s); }; }
  function addSpot(o) { photo.viewer.addHotSpot(o); photo.spots.push(o.id); }
  function placeOnPhoto(path, now, hidden) {
    var v = photo.viewer;
    photo.spots.forEach(function (sid) { try { v.removeHotSpot(sid); } catch (e) {} });
    photo.spots = [];
    // the sun's path through the morning, at its true height, with every other hour marked
    path.forEach(function (q, i) {
      var hr = new Date(q.t).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'});
      addSpot({id: 'p' + i, pitch: q.alt + refract(q.alt), yaw: yawFor(q.az), cssClass: 'iw-dot'});
      if (i && hr.slice(3) === '00' && +hr.slice(0, 2) % 2 === 0 && Math.abs(q.t - now.t) > 25 * 60000)
        addSpot({id: 'h' + i, pitch: q.alt + refract(q.alt), yaw: yawFor(q.az), cssClass: 'iw-label', createTooltipFunc: tag('', hr)});
    });
    addSpot({id: 'sun', pitch: now.alt + refract(now.alt), yaw: yawFor(now.az), cssClass: 'iw-sun' + (hidden ? ' hidden' : ''),
      createTooltipFunc: tag('sun', hhmm(now.t) + (hidden ? ' · hidden' : ''))});
    // named hills and the compass, pinned to their real direction
    var placed = [];
    terrain.hills.filter(function (x) { return x.sky; }).forEach(function (x, i) {
      if (placed.length >= 12 || placed.some(function (b) { return Math.abs(((x.b - b + 540) % 360) - 180) < 6; })) return;
      placed.push(x.b);
      addSpot({id: 'n' + i, pitch: Math.max(x.a, skyAt(x.b)), yaw: yawFor(x.b), cssClass: 'iw-label', createTooltipFunc: tag('', IW.esc(x.name) + ' <small>' + x.ele + ' m</small>')});
    });
    ['N', 'E', 'S', 'W'].forEach(function (c, i) {
      addSpot({id: 'c' + c, pitch: skyAt(i * 90) - 6, yaw: yawFor(i * 90), cssClass: 'iw-label', createTooltipFunc: tag('compass', c)});
    });
  }

  function renderSkyline() {
    var card = document.getElementById('skyline-card');
    if (!terrain || !detail) { card.hidden = true; return; }
    card.hidden = false;
    var d = day(), sd = skyDay(d), path = sd.path, fl = sd.fl;
    if (!path.length) { card.hidden = true; return; }
    if (state.sky == null || state.sky >= path.length) state.sky = sd.start;
    var now = path[state.sky], afternoon = localHour(now.t + 30 * 60000) > 12, h = afternoon ? null : hourFor(d, now.t);
    var cloud = afternoon ? null : h ? h.cloud : d.cloud, ct = cloud ? cloud[1] : null;
    var showCloud = ct && ct < peak.elev - 20;
    var sea = showCloud ? cloudAngle(ct, 40000) : -90;
    var hidden = now.alt < Math.max(skyAt(now.az), sea) - 0.833;
    var useGoogle = gsv.state === 'open', canGoogle = gsv.state === 'found';
    var usePhoto = !useGoogle && photo.state === 'ready';

    // slider and readout
    var range = document.getElementById('sky-range');
    range.max = path.length - 1; range.value = state.sky;
    range.setAttribute('aria-valuetext', hhmm(now.t));
    document.getElementById('sky-time').textContent = hhmm(now.t);
    document.getElementById('sky-hour').textContent = '· ' + IW.dayLong(d.date);
    document.getElementById('sky-range-ends').textContent = hhmm(path[0].t) + ' to last sun ' + hhmm(path[path.length - 1].t) + ' · moves the view and the profile below';
    var k = Math.round(now.az) % 360, who = terrain.who[k] >= 0 ? terrain.hills[terrain.who[k]] : null;
    var where = dir16(now.az), upTxt;
    if (state.sky < sd.start) upTxt = 'Before first sun on the summit, at ' + hhmm(path[sd.start].t) + '. ' + (now.alt < -6 ? 'Still dark: headtorch time.' : 'Twilight: light enough to see the cloud below.');
    else if (hidden && skyAt(now.az) >= sea) upTxt = 'The sun is behind ' + (who ? who.name : 'the hills') + ' to the ' + where + ', so the summit is in shade.';
    else if (hidden) upTxt = 'The sun is still below the cloud sea to the ' + where + '.';
    else upTxt = (now.alt < 1 ? 'The sun is just rising in the ' + where : 'The sun is ' + Math.round(now.alt) + '° up in the ' + where) + (showCloud && now.alt < 12 ? ', low enough to light the cloud sea gold.' : showCloud ? ', shining on the cloud sea.' : '.');
    document.getElementById('sky-now').textContent = upTxt;
    var tg = document.getElementById('cloud-toggle');
    tg.checked = !!state.cloudOn; tg.disabled = !showCloud;
    document.getElementById('cloud-toggle-wrap').classList.toggle('muted', !showCloud);
    ['S', 'N'].forEach(function (f) { document.getElementById('face-' + f).setAttribute('aria-pressed', !usePhoto && state.face === f); });
    document.getElementById('face-sun').hidden = !usePhoto && !useGoogle;
    document.getElementById('key-eye').hidden = usePhoto || useGoogle;
    document.getElementById('gsv').hidden = !useGoogle && !canGoogle;
    if (canGoogle) autoOpenGoogle();

    // facts
    document.getElementById('sky-sun').textContent = fl ? hhmm(fl.t) : '–';
    document.getElementById('sky-sun-note').textContent = sunNote(fl);
    var open = terrain.open, rating = open >= 0.85 ? 'Wide open' : open >= 0.6 ? 'Mostly open' : 'Partly hemmed in';
    document.getElementById('sky-open').textContent = rating;
    document.getElementById('sky-open-note').textContent = Math.round(open * 100) + '% of the skyline is lower than the summit.';
    var higher = terrain.hills.filter(function (x) { return x.vis && x.ele > peak.elev + 5; });
    document.getElementById('sky-higher').textContent = higher.length ? higher.length : 'None';
    document.getElementById('sky-higher-note').textContent = higher.length ? higher.slice(0, 4).map(function (x) { return x.name + ' ' + dir16(x.b); }).join(', ') + (higher.length > 4 ? ' and more.' : '.') : 'This is the highest top in view.';

    // headline: the forecast cloud at this time, in words
    var head, at = h ? ' at ' + h.t : '';
    if (afternoon) head = 'The cloud forecast covers the morning only, when inversions form. This shows where the sun is later in the day.';
    else if (!ct) head = 'No cloud layer forecast' + at + ', so no cloud sea.';
    else if (!showCloud) head = 'Cloud tops out around ' + ct + ' m' + at + ', at or above the summit, so you would probably be in it.';
    else {
      var secs = [], names8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      for (var s8 = 0; s8 < 8; s8++) {
        var n = 0; for (var a = s8 * 45 - 22; a < s8 * 45 + 23; a++) if (terrain.z[(a + 360) % 360] < ct) n++;
        if (n / 45 >= 0.6) secs.push(names8[s8]);
      }
      var islands = terrain.hills.filter(function (x) { return x.vis && x.ele > ct + 20; }).slice(0, 4).map(function (x) { return x.name; });
      var wh = secs.length === 8 ? 'all the way round' : secs.length >= 6 ? 'nearly all the way round' : secs.length ? 'to the ' + (secs.length > 1 ? secs.slice(0, -1).join(', ') + ' and ' + secs[secs.length - 1] : secs[0]) : 'in the valleys below, with hills breaking it up';
      var isl = islands.length > 1 ? islands.slice(0, -1).join(', ') + ' and ' + islands[islands.length - 1] : islands[0];
      head = 'Forecast cloud sea up to about ' + ct + ' m' + at + ', ' + (peak.elev - ct) + ' m below you, stretching ' + wh + '.' + (islands.length ? ' ' + isl + (islands.length > 1 ? ' rise' : ' rises') + ' above it.' : '');
    }
    document.getElementById('sky-head').textContent = head;

    if (useGoogle) {
      document.getElementById('pano').hidden = true;
      document.getElementById('photo360').hidden = true;
      placeOnGoogle(path.slice(sd.start), now, hidden, showCloud ? cloudBand(ct) : null);
      return;
    }
    if (usePhoto) {
      document.getElementById('pano').hidden = true;
      document.getElementById('photo360').hidden = false;
      placeOnPhoto(path.slice(sd.start), now, hidden);
      return;
    }
    document.getElementById('photo360').hidden = photo.state !== 'loading';
    document.getElementById('pano').hidden = false;

    // No photo: a sun-path chart. No hill shapes, just where things are.
    var cs = function (key) { return getComputedStyle(document.documentElement).getPropertyValue(key).trim(); };
    var dark = (document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    var az0 = state.face === 'N' ? 0 : 180, W = 1080, PX = W / 360, top = 24, H = 300, base = 262;
    var amin = -4, amax = Math.max(15, Math.ceil((Math.max.apply(null, path.map(function (q) { return q.alt; })) + 6) / 5) * 5);
    var X = function (az) { return ((az - az0 + 540) % 360) * PX; };
    var Y = function (ang) { return top + (amax - Math.max(amin, Math.min(amax, ang))) * (base - top) / (amax - amin); };
    var txt = cs('--text'), mut = cs('--muted'), acc = cs('--accent'), halo = dark ? '#14211B' : '#EEF2F4';
    var sv = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Sun path from ' + IW.esc(peak.name) + ' at ' + hhmm(now.t) + '. ' + IW.esc(upTxt) + '">';
    sv += '<defs><linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + (dark ? '#14211B' : '#DDE7EE') + '"/><stop offset="1" stop-color="' + (dark ? '#4A3424' : '#FBE3CC') + '"/></linearGradient>' +
      '<radialGradient id="sung"><stop offset="0" stop-color="' + acc + '" stop-opacity=".55"/><stop offset="1" stop-color="' + acc + '" stop-opacity="0"/></radialGradient><filter id="cblur"><feGaussianBlur stdDeviation="1.5"/></filter></defs>';
    sv += '<rect width="' + W + '" height="' + base + '" fill="url(#skyg)"/>';
    for (var g = 5; g < amax; g += 5) sv += '<line x1="0" x2="' + W + '" y1="' + Y(g) + '" y2="' + Y(g) + '" stroke="' + mut + '" opacity=".18"/><text x="' + (W - 6) + '" y="' + (Y(g) - 4) + '" text-anchor="end" font-size="11" fill="' + mut + '">' + g + '°</text>';
    sv += '<line x1="0" x2="' + W + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="' + mut + '" stroke-dasharray="3 5"/><text x="6" y="' + (Y(0) - 5) + '" font-size="11" fill="' + mut + '">Eye level</text>';
    // the forecast cloud sea, where it would be seen (if switched on)
    var band = showCloud && state.cloudOn ? cloudBand(ct) : null;
    if (band) {
      var runs = [];
      var cols = [], stp = 360 / band.cols.length;
      for (var xi = 0; xi <= 360; xi += stp) { var a0 = (az0 - 180 + xi + 720) % 360; cols.push({x: xi * PX, c: band.cols[Math.round(a0 / stp) % band.cols.length]}); }
      var cur = null;
      cols.forEach(function (q) { if (q.c) { if (!cur) { cur = []; runs.push(cur); } cur.push(q); } else cur = null; });
      runs.forEach(function (run) {
        if (run.length < 2) return;
        var top = run.map(function (q) { return q.x.toFixed(1) + ',' + Y(q.c.top).toFixed(1); });
        var bot = run.slice().reverse().map(function (q) { return q.x.toFixed(1) + ',' + Y(q.c.bottom).toFixed(1); });
        sv += '<polygon points="' + top.concat(bot).join(' ') + '" fill="' + (dark ? '#C9D3DC' : '#FFFFFF') + '" opacity="' + (dark ? 0.35 : 0.75) + '" filter="url(#cblur)"/>';
      });
      sv += '<text x="' + (W - 8) + '" y="' + (Y(-3.4)).toFixed(1) + '" text-anchor="end" font-size="12" font-weight="700" fill="' + mut + '">Forecast cloud top ≈ ' + band.level + ' m</text>';
    }
    // named tops, as markers at their real direction and height
    var placed = [];
    terrain.hills.filter(function (x) { return x.sky; }).forEach(function (x) {
      var lx = X(x.b);
      if (placed.length >= 10 || placed.some(function (q) { return Math.abs(q - lx) < 78; }) || lx < 30 || lx > W - 30) return;
      placed.push(lx);
      var ly = Y(Math.max(x.a, skyAt(x.b)));
      sv += '<line x1="' + lx + '" x2="' + lx + '" y1="' + ly + '" y2="' + (ly - 14) + '" stroke="' + txt + '" stroke-width="1.5"/>' +
        '<circle cx="' + lx + '" cy="' + ly + '" r="2.5" fill="' + txt + '"/>' +
        '<text x="' + lx + '" y="' + (ly - 18) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="' + txt + '" stroke="' + halo + '" stroke-width="3" paint-order="stroke">' + IW.esc(x.name) + ' <tspan font-weight="400">' + x.ele + '</tspan></text>';
    });
    // the sun's path (dotted) and the sun now
    var segs = [[]], prev = null;
    path.slice(sd.start).forEach(function (q) {
      var px = X(q.az);
      if (prev !== null && Math.abs(px - prev) > W / 2) segs.push([]);
      segs[segs.length - 1].push(px.toFixed(1) + ',' + Y(q.alt + refract(q.alt)).toFixed(1));
      prev = px;
    });
    segs.forEach(function (sg) { if (sg.length > 1) sv += '<polyline points="' + sg.join(' ') + '" fill="none" stroke="' + acc + '" stroke-width="2.2" stroke-dasharray="1 6" stroke-linecap="round"/>'; });
    path.forEach(function (q, i) {
      var c = new Date(q.t).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'});
      if (i <= sd.start || c.slice(3) !== '00' || +c.slice(0, 2) % 2 || Math.abs(X(q.az) - X(now.az)) < 60) return;
      sv += '<text x="' + X(q.az).toFixed(1) + '" y="' + (Y(q.alt) - 8).toFixed(1) + '" text-anchor="middle" font-size="11" fill="' + mut + '">' + c + '</text>';
    });
    var sx = X(now.az), sy = Y(now.alt + refract(now.alt)), left = sx > W - 120;
    if (!hidden) sv += '<circle cx="' + sx + '" cy="' + sy + '" r="34" fill="url(#sung)"/>';
    sv += '<circle cx="' + sx + '" cy="' + sy + '" r="10" fill="' + acc + '" stroke="' + halo + '" stroke-width="2"' + (hidden ? ' opacity=".45"' : '') + '/>';
    sv += '<text x="' + (left ? sx - 16 : sx + 16) + '" y="' + (sy + 5) + '" text-anchor="' + (left ? 'end' : 'start') + '" font-size="13" font-weight="700" fill="' + acc + '" stroke="' + halo + '" stroke-width="4" paint-order="stroke">' + hhmm(now.t) + (hidden ? ' · hidden' : '') + '</text>';
    // compass along the bottom
    sv += '<rect y="' + base + '" width="' + W + '" height="' + (H - base) + '" fill="' + cs('--surface-2') + '"/>';
    for (var bb = 0; bb < 360; bb += 22.5) {
      var bx = X(bb), main = bb % 45 === 0;
      sv += '<line x1="' + bx + '" x2="' + bx + '" y1="' + base + '" y2="' + (base + (main ? 8 : 4)) + '" stroke="' + mut + '"/>';
      if (main && bx > 12 && bx < W - 12) sv += '<text x="' + bx + '" y="' + (base + 24) + '" text-anchor="middle" font-size="13" font-weight="700" fill="' + (bb % 90 === 0 ? txt : mut) + '">' + dir16(bb) + '</text>';
    }
    sv += '</svg>';
    var pano = document.getElementById('pano');
    pano.innerHTML = sv;
    if (pano.scrollWidth > pano.clientWidth + 2) pano.scrollLeft = Math.max(0, sx / W * pano.scrollWidth - pano.clientWidth / 2);
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
