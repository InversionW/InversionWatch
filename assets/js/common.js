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
        '<input id="peak-search"
