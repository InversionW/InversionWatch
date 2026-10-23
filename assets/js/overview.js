/* UK overview: heatmap, map and best-peaks list. */
(function () {
  'use strict';
  IW.chrome('overview');
  var state = {day: 0, area: IW.get('area', 'lake-district')};
  var data, map, layer;

  IW.load('data/forecast.json').then(function (d) {
    data = d;
    data.byArea = {};
    data.areas.forEach(function (a) { data.byArea[a.id] = d.peaks.filter(function (p) { return p.area === a.id && p.days.length; }); });
    if (!data.byArea[state.area] || !data.byArea[state.area].length) state.area = data.areas[0].id;
    document.getElementById('demo-banner').hidden = !d.demo;
    document.getElementById('updated').textContent = 'Updated ' + IW.updatedText(d.generated_at) + (d._offline ? ' (offline copy)' : '');
    if (IW.ageHours(d.generated_at) > 12 && !d.demo) {
      var s = document.getElementById('stale');
      s.innerHTML = IW.WARN + '<span>This forecast has not updated for over 12 hours. Check MWIS and the Met Office before relying on it.</span>';
      s.hidden = false;
    }
    render();
    if (IW.motion) try { IW.motion.refresh(); } catch (e) {}
  }).catch(function () {
    document.getElementById('heatmap').innerHTML = '<p class="muted" style="padding: 20px">The forecast could not be loaded. Please try again later.</p>';
  });

  function days() { return data.peaks[0].days.map(function (d) { return d.date; }); }
  function areaBest(areaId, di) {
    var best = null;
    data.byArea[areaId].forEach(function (p) { var d = p.days[di]; if (d && (!best || d.score > best.score)) best = {score: d.score, peak: p}; });
    return best;
  }

  function render() { renderBest(); renderHeat(); renderMap(); renderList(); renderSaved(); }

  function renderHeat() {
    var ds = days();
    var html = '<table><thead><tr class="band"><th class="area" aria-hidden="true"></th><th colspan="3" class="mwis">MWIS forecast · higher confidence</th><th colspan="' + (ds.length - 3) + '" class="outlook">Model outlook · lower confidence</th></tr>' +
      '<tr><th class="area" scope="col"><span class="visually-hidden">Area</span></th>' + ds.map(function (d, i) {
        return '<th scope="col"><button type="button" data-day="' + i + '" aria-pressed="' + (i === state.day) + '">' + IW.dayShort(d) + '</button></th>';
      }).join('') + '</tr></thead><tbody>';
    data.areas.forEach(function (a) {
      if (!data.byArea[a.id].length) return;
      html += '<tr><th class="area" scope="row"><button type="button" data-area="' + a.id + '" aria-pressed="' + (a.id === state.area) + '"><span class="full">' + IW.esc(a.name) + '</span></button></th>';
      ds.forEach(function (d, i) {
        var b = areaBest(a.id, i), v = b ? b.score : 0;
        var sel = i === state.day && a.id === state.area;
        html += '<td><button type="button" class="' + IW.heat(v) + (sel ? ' sel' : '') + '" data-area="' + a.id + '" data-day="' + i + '" aria-label="' + IW.esc(a.name) + ', ' + IW.dayLong(d) + ': ' + v + '%">' + v + '</button></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    var el = document.getElementById('heatmap');
    el.innerHTML = html;
    if (window.innerWidth < 600) el.querySelectorAll('.area .full').forEach(function (s, i) {
      var a = data.areas.filter(function (x) { return data.byArea[x.id].length; })[i]; if (a) s.textContent = a.short;
    });
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.day !== undefined) state.day = +b.dataset.day;
        if (b.dataset.area) { state.area = b.dataset.area; IW.set('area', state.area); }
        render();
      });
    });
  }

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function renderMap() {
    document.getElementById('map-title').textContent = 'Map · ' + IW.dayLong(days()[state.day]);
    if (!window.L) return;
    if (!map) {
      map = L.map('map', {scrollWheelZoom: false, attributionControl: true});
      map.fitBounds(data.peaks.map(function (p) { return [p.lat, p.lon]; }), {padding: [24, 24]});
      var tfKey = (window.IW_CONFIG || {}).thunderforestKey;
      if (tfKey) {
        L.tileLayer('https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}{r}.png?apikey=' + encodeURIComponent(tfKey), {maxZoom: 14, attribution: 'Maps © <a href="https://www.thunderforest.com/">Thunderforest</a>, data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
      } else {
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 12, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
      }
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    data.peaks.forEach(function (p) {
      var d = p.days[state.day]; if (!d) return;
      var cls = IW.heat(d.score);
      var size = p.area === state.area ? 34 : 28;
      var icon = L.divIcon({className: '', html: '<div class="map-dot ' + cls + '" style="width:' + size + 'px;height:' + size + 'px">' + d.score + '</div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2]});
      L.marker([p.lat, p.lon], {icon: icon, title: p.name + ': ' + d.score + '%', keyboard: true})
        .bindTooltip(IW.esc(p.name) + ' · ' + d.score + '%')
        .on('click', function () { location.href = 'peak.html?id=' + p.id + '&day=' + state.day; })
        .addTo(layer);
    });
  }

  function peakRow(p, di) {
    var d = p.days[di];
    var margin = d.cloud ? (p.elev - d.cloud[1] >= 0 ? (p.elev - d.cloud[1]) + ' m above the cloud' : 'In the cloud') : 'No cloud layer expected';
    return '<li><a href="peak.html?id=' + p.id + '&day=' + di + '"><span class="badge ' + IW.heat(d.score) + '">' + d.score + '%</span>' +
      '<span class="stack" style="--gap: 0; min-width: 0"><b style="font-size: 17px">' + IW.esc(p.name) + '</b><span class="muted small">' + p.elev + ' m · ' + (d.why ? IW.esc(d.why) : margin) + '</span></span>' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a></li>';
  }

  function renderList() {
    var area = data.areas.filter(function (a) { return a.id === state.area; })[0];
    var ps = data.byArea[state.area].slice().sort(function (a, b) { return b.days[state.day].score - a.days[state.day].score; });
    document.getElementById('list-day').textContent = IW.dayLong(days()[state.day]);
    document.getElementById('list-title').textContent = 'Best peaks in ' + area.name;
    document.getElementById('list-note').innerHTML = 'Chance of standing above a cloud sea at dawn. <a href="' + area.mwis + '">Read the MWIS ' + IW.esc(area.short) + ' forecast</a>.';
    document.getElementById('peak-list').innerHTML = ps.map(function (p) { return peakRow(p, state.day); }).join('');
  }

  /* The best peak and day this week, preferring the three MWIS days. */
  function renderBest() {
    if (renderBest.done) return;
    var picks = [];
    data.peaks.forEach(function (p) {
      p.days.forEach(function (d, i) { picks.push({p: p, d: d, i: i, rank: d.score + (i < 3 ? 15 : 0) - i}); });
    });
    picks.sort(function (a, b) { return b.rank - a.rank; });
    var top = picks[0], el = document.getElementById('bestbet');
    if (!top || top.d.score < 40) { el.hidden = true; return; }
    renderBest.done = true;
    var href = 'peak.html?id=' + top.p.id + '&day=' + top.i;
    var area = data.areas.filter(function (a) { return a.id === top.p.area; })[0] || {name: ''};
    var arc = document.getElementById('bb-arc'), C = 2 * Math.PI * 52;
    arc.style.strokeDasharray = C.toFixed(1);
    arc.style.strokeDashoffset = (C * (1 - top.d.score / 100)).toFixed(1);
    var dial = document.getElementById('bb-dial');
    dial.className = 'dial ' + IW.pill(top.d.score).replace('pill-', 'dial-');
    dial.href = href;
    document.getElementById('bb-score').textContent = top.d.score + '%';
    document.getElementById('bb-eyebrow').textContent = 'Best bet this week · ' + IW.dayLong(top.d.date);
    var link = document.getElementById('bb-link');
    link.textContent = top.p.name; link.href = href;
    document.getElementById('bb-go').href = href;
    var win = top.d.window ? ' · best ' + top.d.window[0] + '–' + top.d.window[1] : '';
    document.getElementById('bb-meta').textContent = area.name + ' · ' + top.p.elev + ' m · sunrise ' + top.d.sunrise + win;
    document.getElementById('bb-why').textContent = top.d.why ? top.d.why + '.' : '';
    /* Runners-up: the next best, one per peak and a different area where possible. */
    var seen = {}, areas = {}, runners = [];
    seen[top.p.id] = 1; areas[top.p.area] = 1;
    [true, false].forEach(function (newArea) {
      picks.forEach(function (x) {
        if (runners.length >= 3 || seen[x.p.id] || x.d.score < 40 || (newArea && areas[x.p.area])) return;
        seen[x.p.id] = 1; areas[x.p.area] = 1; runners.push(x);
      });
    });
    document.getElementById('bb-more-wrap').hidden = !runners.length;
    document.getElementById('bb-runners').innerHTML = runners.map(function (x) {
      return '<li><a href="peak.html?id=' + x.p.id + '&day=' + x.i + '"><span class="badge ' + IW.heat(x.d.score) + '">' + x.d.score + '%</span>' +
        '<span class="stack" style="--gap: 0; min-width: 0"><b>' + IW.esc(x.p.name) + '</b><span class="muted small">' + IW.dayShort(x.d.date) + ' · ' + IW.esc((data.areas.filter(function (a) { return a.id === x.p.area; })[0] || {}).short || '') + '</span></span></a></li>';
    }).join('');
    el.hidden = false;
  }

  function renderSaved() {
    var favs = IW.favs();
    var ps = data.peaks.filter(function (p) { return favs.indexOf(p.id) >= 0 && p.days.length; });
    document.getElementById('saved').hidden = !ps.length;
    document.getElementById('saved-list').innerHTML = ps.map(function (p) {
      var best = 0; p.days.forEach(function (d, i) { if (d.score > p.days[best].score) best = i; });
      return peakRow(p, best).replace('m · ', 'm · best on ' + IW.dayShort(p.days[best].date) + ' · ');
    }).join('');
  }

  document.addEventListener('iw:theme', function () { if (data) render(); });
  window.addEventListener('resize', function () { if (data) renderHeat(); });
})();
