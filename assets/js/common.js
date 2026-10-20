/* Shared header, footer, theme switch, search and helpers. */
(function () {
  'use strict';
  var IW = window.IW = {};

  IW.LOGO = '<svg width="40" height="30" viewBox="0 0 40 30" fill="none" aria-hidden="true"><path d="M14 2 L19 28 L24.5 2 L30 28 L35 2" stroke="#F6B678" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"/><path d="M23.23 8 L24.5 2 L25.77 8" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"/><path d="M1 19 H39" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="square"/><path d="M7 2 V28" stroke="#F6B678" stroke-width="1.8" stroke-linecap="square"/></svg>';
  var SUN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  var MOON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  IW.WARN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>';

  /* ---------- storage (never required for the page to work) */
  IW.get = function (k, d) { try { var v = localStorage.getItem('iw.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  IW.set = function (k, v) { try { localStorage.setItem('iw.' + k, JSON.stringify(v)); } catch (e) {} };

  /* ---------- theme */
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  var saved = IW.get('theme', null);
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  /* ---------- helpers */
  IW.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
  IW.heat = function (v) { return 'heat-' + (v >= 80 ? 4 : v >= 60 ? 3 : v >= 40 ? 2 : v >= 20 ? 1 : 0); };
  IW.label = function (v) { return v >= 65 ? 'Looking good' : v >= 40 ? 'Possible' : 'Unlikely'; };
  IW.pill = function (v) { return v >= 65 ? 'pill-good' : v >= 40 ? 'pill-possible' : 'pill-unlikely'; };
  IW.temp = function (t) { var r = Math.round(t); return (r < 0 ? '−' : '') + Math.abs(r) + '°C'; };
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  IW.dayShort = function (iso) { var d = new Date(iso + 'T12:00:00'); return DOW[d.getDay()] + ' ' + d.getDate(); };
  IW.dayLong = function (iso) { var d = new Date(iso + 'T12:00:00'); return DOWL[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; };
  IW.qs = function (k) { return new URLSearchParams(location.search).get(k); };
  IW.ageHours = function (iso) { return (Date.now() - new Date(iso).getTime()) / 3600000; };
  IW.updatedText = function (iso) {
    var d = new Date(iso);
    return d.toLocaleString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  };

  IW.load = function (url) {
    return fetch(url, {cache: 'no-cache'}).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) { IW.set('cache:' + url, j); return j; }).catch(function () {
      var c = IW.get('cache:' + url, null);
      if (c) { c._offline = true; return c; }
      throw new Error('Could not load ' + url);
    });
  };

  /* ---------- header + footer */
  IW.chrome = function (current) {
    var nav = [['index.html', 'UK overview', 'overview'], ['peak.html?id=helvellyn', 'Peak forecast', 'peak'], ['about.html', 'About', 'about']];
    var header = document.getElementById('site-header');
    if (header) {
      header.className = 'site-header';
      header.innerHTML = '<div class="wrap">' +
        '<a class="brand" href="index.html">' + IW.LOGO + '<span class="brand-name">Inversion Watch</span></a>' +
        '<div class="search" role="search"><label class="visually-hidden" for="peak-search">Search a UK peak</label>' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4B5868" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        '<input id="peak-search" type="search" autocomplete="off" placeholder="Search a UK peak, e.g. Helvellyn" aria-controls="search-results" aria-autocomplete="list">' +
        '<ul id="search-results" class="search-results" hidden></ul></div>' +
        '<nav class="site-nav" aria-label="Main">' + nav.map(function (n) {
          return '<a href="' + n[0] + '"' + (n[2] === current ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
        }).join('') +
        '<button class="icon-btn" type="button" id="theme-btn"></button></nav></div>';
      var btn = document.getElementById('theme-btn');
      var paint = function () {
        var dark = isDark();
        btn.innerHTML = dark ? SUN : MOON;
        btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      };
      paint();
      btn.addEventListener('click', function () {
        var next = isDark() ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        IW.set('theme', next);
        paint();
        document.dispatchEvent(new CustomEvent('iw:theme'));
      });
      setupSearch();
    }
    var footer = document.getElementById('site-footer');
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = '<div class="wrap">' +
        '<div class="row" style="justify-content: space-between; align-items: flex-start; --gap: 24px 48px">' +
        '<div class="stack" style="--gap: 8px; max-width: 360px"><a class="brand" href="index.html">' + IW.LOGO + '<span class="brand-name" style="font-size: 24px">Inversion Watch</span></a>' +
        '<span>Cloud inversion forecasts for UK peaks, up to six days ahead.</span></div>' +
        '<nav class="footer-nav" aria-label="Footer">' +
        '<a href="about.html">About</a><a href="about.html#how">How the score works</a>' +
        '<a href="credits.html">Data and photo credits</a><a href="privacy.html">Privacy</a>' +
        '<a href="terms.html">Terms of use</a><a href="' + IW.REPO + '/issues">Report a problem</a>' +
        '<a href="' + IW.REPO + '">Code on GitHub</a></nav></div>' +
        '<p class="disclaimer"><svg class="stop-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.6 1.5h8.8l6.1 6.1v8.8l-6.1 6.1H7.6l-6.1-6.1V7.6z" fill="#C8102E" stroke="#FFFFFF" stroke-width="1.2"/><rect x="5.5" y="10.6" width="13" height="2.8" rx="0.6" fill="#FFFFFF"/></svg><span>Inversion Watch is a planning tool, not a safety measure. Mountain conditions change fast: always read the full <a href="https://www.mwis.org.uk/">MWIS</a> and <a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain">Met Office mountain</a> forecasts, and be ready to turn back.</span></p>' +
        '<div class="row small" style="justify-content: space-between">' +
        '<span><a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a> (CC BY 4.0). Maps © <a href="https://www.thunderforest.com/">Thunderforest</a>, data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.</span><span>Made by Mo.</span></div></div>';
    }
  };
  IW.REPO = document.documentElement.getAttribute('data-repo') || 'https://github.com/';

  function setupSearch() {
    var input = document.getElementById('peak-search'), list = document.getElementById('search-results');
    var peaks = null;
    function ensure() {
      if (peaks) return Promise.resolve(peaks);
      return IW.load('data/peaks.json').then(function (j) { peaks = j.peaks; return peaks; });
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (!q) { list.hidden = true; return; }
      ensure().then(function (ps) {
        var hits = ps.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
        list.innerHTML = hits.length ? hits.map(function (p) {
          return '<li><a href="peak.html?id=' + p.id + '">' + IW.esc(p.name) + ' <span class="muted small">' + p.elev + ' m</span></a></li>';
        }).join('') : '<li class="muted small" style="padding: 10px 14px">No peaks found. More are coming.</li>';
        list.hidden = false;
      });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var a = list.querySelector('a'); if (a) location.href = a.href; }
      if (e.key === 'Escape') { list.hidden = true; }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) list.hidden = true; });
  }

  /* ---------- saved peaks */
  IW.favs = function () { return IW.get('favs', []); };
  IW.toggleFav = function (id) {
    var f = IW.favs(), i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.push(id);
    IW.set('favs', f);
    return i < 0;
  };
})();
