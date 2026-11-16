(function () {
  'use strict';

  // Spinga — Fase 2 P2: redo/ghost, conferma restart, pausa, accessibilità, mobile.
  // Grafica Fase 1: marching squares, ombre/AO, cache pavimento, materiali.
  // Cache-busting: ?v=17 (Sclera automatica dopo un minuto di inattività).

  var LEVELS = Array.isArray(window.LEVELS) ? window.LEVELS : [];
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var stage = document.querySelector('.stage');
  var $ = function (id) { return document.getElementById(id); };

  // Il manifest serve solo via http(s): su file:// il browser bloccherebbe la
  // richiesta con un errore CORS in console.
  if (/^https?:$/.test(location.protocol)) {
    var manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = 'manifest.webmanifest';
    document.head.appendChild(manifestLink);
  }

  var DIRS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 }
  ];
  var K = function (x, y) { return x + ',' + y; };
  var osReduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var reduceMotion = false;

  /* ---------------------------------------------------------------- save */

  var SAVE_KEY = 'spinga.save.v1';
  var LEGACY_KEY = 'crateshift.save.v1';
  var save = {
    lastLevel: 0, completed: {}, muted: false, volume: 0.7, motion: 'auto',
    haptics: true, padSize: 'md', padSide: 'right', contrast: false
  };
  try {
    var rawSave = localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (rawSave) {
      var parsed = JSON.parse(rawSave);
      if (parsed && typeof parsed === 'object') {
        save.lastLevel = parsed.lastLevel | 0;
        save.completed = parsed.completed && typeof parsed.completed === 'object' ? parsed.completed : {};
        save.muted = !!parsed.muted;
        if (typeof parsed.volume === 'number') save.volume = Math.max(0, Math.min(1, parsed.volume));
        if (parsed.motion === 'reduce' || parsed.motion === 'full') save.motion = parsed.motion;
        if (typeof parsed.haptics === 'boolean') save.haptics = parsed.haptics;
        if (parsed.padSize === 'sm' || parsed.padSize === 'lg') save.padSize = parsed.padSize;
        if (parsed.padSide === 'left') save.padSide = 'left';
        save.contrast = !!parsed.contrast;
      }
    }
  } catch (e) { /* storage unavailable */ }

  reduceMotion = save.motion === 'reduce' || (save.motion !== 'full' && osReduce);
  var highContrast = !!save.contrast;

  function applyLookPrefs() {
    var root = document.documentElement;
    root.setAttribute('data-pad', save.padSize);
    root.setAttribute('data-pad-side', save.padSide);
    root.classList.toggle('contrast', highContrast);
  }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }

  /* --------------------------------------------------------------- sound */

  // Su Android la vibrazione parte solo dopo un tocco: i primi passi avvengono dopo
  // il "Continua", quindi l'attivazione utente c'è già. Durate sotto i 10 ms molti
  // telefoni non le rendono, per questo i tick stanno sui 12-18 ms.
  function buzz(pattern) {
    if (!save.haptics || !navigator.vibrate || document.hidden) return;
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }

  var sfx = (function () {
    var ac = null;

    function ensure() {
      if (save.muted || save.volume <= 0.001) return null;
      try {
        if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
        return ac;
      } catch (e) {
        return null;
      }
    }

    function tone(freq, dur, type, vol, slideTo, delay) {
      var a = ensure();
      if (!a) return;
      var t = a.currentTime + (delay || 0);
      var osc = a.createOscillator();
      var gain = a.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      var peak = Math.max(0.0001, Math.min(1, vol * save.volume));
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(a.destination);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }

    return {
      init: function () { ensure(); },
      step: function () { tone(300, 0.06, 'triangle', 0.03, 240); },
      push: function () { tone(165, 0.1, 'sawtooth', 0.028, 110); },
      thud: function () { tone(85, 0.07, 'sine', 0.03); },
      goal: function () {
        tone(880, 0.12, 'sine', 0.045);
        tone(1320, 0.16, 'sine', 0.04, null, 0.07);
      },
      win: function () {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
          tone(f, 0.22, 'triangle', 0.045, null, i * 0.11);
        });
      },
      crash: function () {
        tone(72, 0.34, 'sawtooth', 0.05, 36);
        tone(190, 0.12, 'square', 0.03, 90);
      },
      snip: function () {
        tone(1600, 0.05, 'square', 0.028, 1100);
        tone(900, 0.07, 'triangle', 0.022, 620, 0.035);
      },
      hit: function () {
        tone(58, 0.18, 'sine', 0.06, 34);
        tone(150, 0.09, 'square', 0.03, 70);
      },
      roar: function () {
        tone(130, 0.5, 'sawtooth', 0.05, 52);
        tone(92, 0.62, 'square', 0.02, 44, 0.05);
      },
      ui: function () { tone(420, 0.05, 'square', 0.02); }
    };
  })();

  /* --------------------------------------------------------------- state */

  var levelIndex = Math.max(0, Math.min(LEVELS.length - 1, save.lastLevel || 0));
  var level = { w: 0, h: 0 };
  var walls = new Set();
  var goals = new Set();
  var floorSet = new Set();
  var floorList = [];
  var boxes = [];
  var boxAt = new Map();
  var player = { x: 0, y: 0, dir: 2, vx: 0, vy: 0, bump: 0, bumpDir: 2 };
  var history = [];
  var redoStack = [];
  var trail = [];
  var paused = false;
  var moves = 0;
  var pushes = 0;
  var started = false;
  var startTs = 0;
  var elapsed = 0;
  var won = false;
  var particles = [];
  var shake = 0;
  var lastActivity = 0;
  var lastTimerPaint = 0;

  var view = { w: 0, h: 0 };
  var layout = { tile: 40, ox: 0, oy: 0 };
  var staticBoard = null;
  var staticDirty = true;

  /* -------------------------------------------------------------- parsing */

  function parseLevel(rows) {
    var h = rows.length;
    var w = 0;
    for (var i = 0; i < rows.length; i++) w = Math.max(w, rows[i].length);

    walls = new Set();
    goals = new Set();
    boxes = [];
    boxAt = new Map();

    var px = 0;
    var py = 0;
    var found = false;

    for (var y = 0; y < h; y++) {
      var row = rows[y] || '';
      for (var x = 0; x < w; x++) {
        var c = row.charAt(x) || ' ';
        if (c === '#') { walls.add(K(x, y)); continue; }
        if (c === '.' || c === '*' || c === '+') goals.add(K(x, y));
        if (c === '$' || c === '*') {
          var box = { x: x, y: y, vx: x, vy: y, pulse: 0, squash: 0, ang: 0 };
          boxes.push(box);
          boxAt.set(K(x, y), box);
        }
        if (c === '@' || c === '+') { px = x; py = y; found = true; }
      }
    }

    if (!found) {
      for (var yy = 0; yy < h && !found; yy++) {
        for (var xx = 0; xx < w; xx++) {
          if (rows[yy].charAt(xx) !== '#' && rows[yy].charAt(xx) !== ' ') {
            px = xx; py = yy; found = true; break;
          }
        }
      }
    }

    var startDir = 2;
    [2, 1, 0, 3].some(function (d) {
      if (!walls.has(K(px + DIRS[d].x, py + DIRS[d].y))) { startDir = d; return true; }
      return false;
    });

    floorSet = new Set([K(px, py)]);
    var queue = [[px, py]];
    while (queue.length) {
      var cur = queue.pop();
      for (var d = 0; d < DIRS.length; d++) {
        var nx = cur[0] + DIRS[d].x;
        var ny = cur[1] + DIRS[d].y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var key = K(nx, ny);
        if (walls.has(key) || floorSet.has(key)) continue;
        floorSet.add(key);
        queue.push([nx, ny]);
      }
    }
    goals.forEach(function (g) { floorSet.add(g); });

    floorList = [];
    floorSet.forEach(function (key) {
      var parts = key.split(',');
      floorList.push([+parts[0], +parts[1]]);
    });

    player = { x: px, y: py, dir: startDir, vx: px, vy: py, bump: 0, bumpDir: startDir };
    level = { w: w, h: h };
  }

  /* ------------------------------------------------------------- commands */

  function snapshot() {
    return {
      p: { x: player.x, y: player.y, dir: player.dir },
      boxes: boxes.map(function (b) { return { x: b.x, y: b.y }; }),
      moves: moves,
      pushes: pushes
    };
  }

  function countOnGoal() {
    var n = 0;
    goals.forEach(function (g) { if (boxAt.has(g)) n++; });
    return n;
  }

  function tryMove(dirIndex) {
    if (won || paused || !level.w) return false;
    noteActivity();
    var dir = DIRS[dirIndex];
    player.dir = dirIndex;

    var nx = player.x + dir.x;
    var ny = player.y + dir.y;
    var key = K(nx, ny);

    if (walls.has(key)) { bump(dirIndex); return false; }

    var box = boxAt.get(key);

    if (box) {
      var bx = nx + dir.x;
      var by = ny + dir.y;
      var keyB = K(bx, by);
      if (walls.has(keyB) || boxAt.has(keyB)) { bump(dirIndex); return false; }

      redoStack = [];
      rememberTrail();
      history.push(snapshot());
      boxAt.delete(key);
      box.x = bx;
      box.y = by;
      boxAt.set(keyB, box);

      player.x = nx;
      player.y = ny;
      player.vx = nx;
      player.vy = ny;
      moves++;
      pushes++;
      startTimer();

      box.squash = 1;
      box.ang = Math.atan2(dir.y, dir.x);
      dust(bx, by);

      if (goals.has(keyB)) {
        box.pulse = 1;
        burst(bx, by, true);
        sfx.goal();
        buzz([16, 30, 20]);
      } else {
        sfx.push();
        buzz(18);
      }

      if (checkWin()) win();
    } else {
      redoStack = [];
      rememberTrail();
      history.push(snapshot());
      player.x = nx;
      player.y = ny;
      player.vx = nx;
      player.vy = ny;
      moves++;
      startTimer();
      sfx.step();
      buzz(12);
    }

    updateHud();
  }

  function bump(dirIndex) {
    player.bump = 1;
    player.bumpDir = dirIndex;
    sfx.thud();
    buzz(12);
  }

  function rememberTrail() {
    trail.push({ x: player.x, y: player.y });
    if (trail.length > 3) trail.shift();
  }

  function restoreSnap(snap) {
    player.x = snap.p.x;
    player.y = snap.p.y;
    player.dir = snap.p.dir;
    player.vx = snap.p.x;
    player.vy = snap.p.y;
    boxes = snap.boxes.map(function (o) {
      return { x: o.x, y: o.y, vx: o.x, vy: o.y, pulse: 0, squash: 0, ang: 0 };
    });
    boxAt = new Map();
    boxes.forEach(function (b) { boxAt.set(K(b.x, b.y), b); });
    moves = snap.moves;
    pushes = snap.pushes;
    trail = [];
  }

  function undo() {
    if (won || paused || !history.length) return;
    noteActivity();
    redoStack.push(snapshot());
    restoreSnap(history.pop());
    updateHud();
    sfx.ui();
  }

  function redo() {
    if (won || paused || !redoStack.length) return;
    noteActivity();
    history.push(snapshot());
    restoreSnap(redoStack.pop());
    updateHud();
    sfx.ui();
  }

  function checkWin() {
    if (!goals.size) return false;
    var ok = true;
    goals.forEach(function (g) { if (!boxAt.has(g)) ok = false; });
    return ok;
  }

  function win() {
    won = true;
    if (started) elapsed = performance.now() - startTs;
    started = false;
    shake = reduceMotion ? 0 : 1;

    goals.forEach(function (g) {
      var p = g.split(',');
      burst(+p[0], +p[1], false);
    });
    sfx.win();
    buzz([30, 50, 30, 50, 70]);

    var prev = save.completed[levelIndex];
    var prevStars = prev && prev.stars ? prev.stars : (prev ? 1 : 0);
    var timeSec = Math.round(elapsed / 100) / 10;
    var isRecord = !prev || moves < prev.moves || (moves === prev.moves && timeSec < prev.time);
    var stars = Math.max(prevStars, starsForRun(prev, moves));
    if (isRecord) {
      save.completed[levelIndex] = { moves: moves, time: timeSec, pushes: pushes, stars: stars };
    } else if (stars > prevStars) {
      save.completed[levelIndex].stars = stars;
    }
    save.lastLevel = levelIndex;
    persist();

    var lvl = levelIndex;
    var token = ++winToken;
    window.setTimeout(function () {
      if (!won || levelIndex !== lvl || token !== winToken) return;
      $('winStats').textContent = moves + ' mosse · ' + pushes + ' spinte · ' + fmtTime(elapsed);
      $('winRecord').classList.toggle('hidden', !isRecord);
      $('winStars').innerHTML = starHtml(stars);
      $('winOverlay').classList.remove('hidden');
      focusOverlay('winOverlay');
      announce('Livello completato. ' + stars + (stars === 1 ? ' stella' : ' stelle') + ' su 3.');
    }, 460);

    updateHud();
  }

  // 1 stella alla prima vittoria; poi una in più se il record di mosse cala del 5% / 15%.
  // I par ottimali per livello richiedono il solver (ancora da fare): qui si premia il miglioramento.
  function starsForRun(prev, runMoves) {
    if (!prev || !prev.moves) return 1;
    var gain = (prev.moves - runMoves) / prev.moves;
    if (gain >= 0.15) return 3;
    if (gain >= 0.05) return 2;
    return 1;
  }

  function starHtml(n) {
    var out = '';
    for (var i = 0; i < 3; i++) {
      out += i < n
        ? '<span class="star-on">\u2605</span>'
        : '<span class="star-off">\u2606</span>';
    }
    return out;
  }

  function levelStars(i) {
    var rec = save.completed[i];
    if (!rec) return 0;
    return rec.stars || 1;
  }

  var winToken = 0;

  function startTimer() {
    if (started) return;
    started = true;
    startTs = performance.now() - elapsed;
  }

  function loadLevel(index) {
    if (!LEVELS.length) return;
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    parseLevel(LEVELS[levelIndex]);

    history = [];
    redoStack = [];
    trail = [];
    paused = false;
    moves = 0;
    pushes = 0;
    elapsed = 0;
    started = false;
    startTs = 0;
    won = false;
    particles = [];
    shake = 0;
    lastTimerPaint = 0;
    noteActivity();
    ++winToken;
    staticDirty = true;

    save.lastLevel = levelIndex;
    persist();

    $('winOverlay').classList.add('hidden');
    $('levelsOverlay').classList.add('hidden');
    $('confirmOverlay').classList.add('hidden');
    $('pauseOverlay').classList.add('hidden');
    if (rage.open) {
      rage.open = false;
      if (rage.raf) window.cancelAnimationFrame(rage.raf);
      rage.raf = 0;
      $('rageOverlay').classList.add('hidden');
    }

    computeLayout();
    updateHud();
    $('statTime').textContent = '0:00';
  }

  function nextLevel() {
    loadLevel((levelIndex + 1) % LEVELS.length);
  }

  /* ------------------------------------------------------------------ hud */

  function fmtTime(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateHud() {
    $('statLevel').textContent = (levelIndex + 1) + ' / ' + LEVELS.length;
    $('statMoves').textContent = String(moves);
    $('statPushes').textContent = String(pushes);
    $('statGoals').textContent = countOnGoal() + ' / ' + goals.size;
    $('statStars').innerHTML = starHtml(levelStars(levelIndex));
    $('statTime').textContent = fmtTime(elapsed);
    $('btnUndo').disabled = !history.length || won || paused;
    $('btnRedo').disabled = !redoStack.length || won || paused;
    $('btnRage').disabled = won;
    announce('Mosse ' + moves + ', spinte ' + pushes + ', target ' + countOnGoal() + ' su ' + goals.size);
  }

  function updateSoundButton() {
    $('btnSound').textContent = save.muted ? 'Audio: OFF' : 'Audio: ON';
    $('btnSound').setAttribute('aria-pressed', save.muted ? 'false' : 'true');
  }

  function toggleSound() {
    save.muted = !save.muted;
    persist();
    updateSoundButton();
    if (!save.muted) { sfx.init(); sfx.ui(); }
  }

  /* -------------------------------------------------------------- overlays */

  function buildLevelGrid() {
    var grid = $('levelGrid');
    grid.innerHTML = '';
    LEVELS.forEach(function (_, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lvl' + (i === levelIndex ? ' current' : '') + (save.completed[i] ? ' done' : '');
      btn.title = 'Livello ' + (i + 1);

      var num = document.createElement('span');
      num.textContent = String(i + 1);
      btn.appendChild(num);

      if (save.completed[i]) {
        var st = document.createElement('span');
        st.className = 'stars';
        st.innerHTML = starHtml(levelStars(i));
        btn.appendChild(st);

        var best = document.createElement('em');
        best.textContent = String(save.completed[i].moves);
        btn.appendChild(best);
      }

      btn.addEventListener('click', function () {
        sfx.ui();
        loadLevel(i);
      });
      grid.appendChild(btn);
    });
  }

  function toggleLevels() {
    var overlay = $('levelsOverlay');
    if (overlay.classList.contains('hidden')) {
      buildLevelGrid();
      overlay.classList.remove('hidden');
      focusOverlay('levelsOverlay');
    } else {
      overlay.classList.add('hidden');
      if (levelsFromMenu) {
        levelsFromMenu = false;
        showMenu(false);
      } else if (paused) {
        openPause();
      } else {
        restoreFocus();
      }
    }
  }

  var menuOpen = true;
  var levelsFromMenu = false;

  function showMenu(showSettings) {
    menuOpen = true;
    $('menuOverlay').classList.remove('hidden');
    $('settingsPanel').classList.toggle('hidden', !showSettings);
    $('menuActions').classList.toggle('hidden', !!showSettings);
    $('levelsOverlay').classList.add('hidden');
    focusOverlay('menuOverlay');
  }

  function closeMenu() {
    menuOpen = false;
    $('menuOverlay').classList.add('hidden');
    restoreFocus();
  }

  function closeOverlays() {
    if (rage.open) { closeRage(); return; }
    var wasPaused = paused;
    closeMenu();
    levelsFromMenu = false;
    paused = false;
    $('winOverlay').classList.add('hidden');
    $('levelsOverlay').classList.add('hidden');
    $('confirmOverlay').classList.add('hidden');
    $('pauseOverlay').classList.add('hidden');
    if (wasPaused && moves > 0) {
      started = true;
      startTs = performance.now() - elapsed;
    }
    updateHud();
    noteActivity();
    restoreFocus();
  }

  function levelsOpen() {
    return menuOpen || paused || rage.open ||
      !$('levelsOverlay').classList.contains('hidden') ||
      !$('winOverlay').classList.contains('hidden') ||
      !$('confirmOverlay').classList.contains('hidden') ||
      !$('pauseOverlay').classList.contains('hidden');
  }

  function syncSettingsUi() {
    $('setVolume').value = String(Math.round(save.volume * 100));
    $('setVolumeVal').textContent = Math.round(save.volume * 100) + '%';
    $('setMotion').checked = save.motion === 'reduce';
    $('setHaptics').checked = save.haptics !== false;
    $('setContrast').checked = !!highContrast;
    $('setPadSize').value = save.padSize;
    $('setPadSide').value = save.padSide;
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncFullscreenUi() {
    var on = !!fullscreenElement();
    $('btnFull').textContent = on ? 'Esci' : 'Schermo';
    $('btnFull').title = on ? 'Esci da schermo intero (F)' : 'Schermo intero (F)';
    $('btnSettingsFull').textContent = on ? 'Esci da schermo intero' : 'Schermo intero';
  }

  function toggleFullscreen() {
    var el = document.querySelector('.app');
    if (fullscreenElement()) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        var p = exit.call(document);
        if (p && p.catch) p.catch(function () {});
      }
    } else if (el) {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        var q = req.call(el);
        if (q && q.catch) q.catch(function () {});
      }
    }
  }

  /* ------------------------------------------------ conferma, pausa, focus */

  var lastFocus = null;
  var CONFIRM_MOVES = 20;

  function focusables(overlay) {
    var all = overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], textarea');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null) out.push(all[i]);
    }
    return out;
  }

  function focusOverlay(id) {
    var overlay = $(id);
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (!lastFocus || !document.body.contains(lastFocus)) lastFocus = document.activeElement;
    var items = focusables(overlay);
    if (items.length) {
      window.setTimeout(function () { try { items[0].focus(); } catch (e) { /* ignore */ } }, 20);
    }
  }

  function restoreFocus() {
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus(); } catch (e) { /* ignore */ }
    }
    lastFocus = null;
  }

  function visibleOverlay() {
    var ids = ['rageOverlay', 'confirmOverlay', 'pauseOverlay', 'winOverlay', 'levelsOverlay', 'menuOverlay'];
    for (var i = 0; i < ids.length; i++) {
      if (!$(ids[i]).classList.contains('hidden')) return $(ids[i]);
    }
    return null;
  }

  function trapTab(e) {
    var overlay = visibleOverlay();
    if (!overlay) return;
    var items = focusables(overlay);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (!overlay.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function announce(text) {
    var live = $('liveRegion');
    if (live) live.textContent = text;
  }

  function openConfirm() {
    $('confirmText').textContent = 'Le ' + moves + ' mosse di questo tentativo andranno perse.';
    $('confirmOverlay').classList.remove('hidden');
    focusOverlay('confirmOverlay');
  }

  function closeConfirm() {
    $('confirmOverlay').classList.add('hidden');
    restoreFocus();
  }

  function requestRestart() {
    if (won || paused) return;
    if (moves >= CONFIRM_MOVES) { openConfirm(); return; }
    loadLevel(levelIndex);
  }

  function openPause() {
    $('pauseStats').textContent = moves + ' mosse · ' + pushes + ' spinte · ' + fmtTime(elapsed);
    $('pauseOverlay').classList.remove('hidden');
    focusOverlay('pauseOverlay');
  }

  function pauseGame(showOverlay) {
    if (paused || won || !level.w) return;
    paused = true;
    if (started) {
      elapsed = performance.now() - startTs;
      started = false;
    }
    $('statTime').textContent = fmtTime(elapsed);
    updateHud();
    if (showOverlay !== false) openPause();
    announce('In pausa');
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    $('pauseOverlay').classList.add('hidden');
    if (moves > 0) {
      started = true;
      startTs = performance.now() - elapsed;
    }
    noteActivity();
    updateHud();
    restoreFocus();
    announce('Ripreso');
  }

  function togglePause() {
    if (paused) resumeGame();
    else pauseGame();
  }

  /* --------------------------------------------------------------- sclera */

  // Effetto commemorativo e puramente decorativo: il gioco resta in pausa e
  // riprende esattamente da dove era quando il popup si chiude.
  var RAGE_MS = 10400;
  var IDLE_RAGE_MS = 60000;
  var rageCanvas = $('rageCanvas');
  var rctx = rageCanvas ? rageCanvas.getContext('2d') : null;
  var rage = { open: false, raf: 0, start: 0, last: 0, w: 0, h: 0, parts: [], fx: {}, caption: '' };

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothStep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
  function mix(a, b, t) { return a + (b - a) * t; }

  function rageResize() {
    if (!rageCanvas || !rctx || !rage.open) return;
    var rect = rageCanvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    rage.w = rect.width;
    rage.h = rect.height;
    rageCanvas.width = Math.round(rect.width * dpr);
    rageCanvas.height = Math.round(rect.height * dpr);
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rageBurst(x, y, n, kind) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 60 + Math.random() * 240;
      rage.parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 90,
        life: 0.35 + Math.random() * 0.5,
        size: 1.4 + Math.random() * 3,
        kind: kind || 'spark'
      });
    }
    if (rage.parts.length > 220) rage.parts.splice(0, rage.parts.length - 220);
  }

  function rageSound(key, fn) {
    if (rage.fx[key]) return;
    rage.fx[key] = true;
    fn();
  }

  function rageRR(x, y, w, h, r) {
    rctx.beginPath();
    rctx.moveTo(x + r, y);
    rctx.arcTo(x + w, y, x + w, y + h, r);
    rctx.arcTo(x + w, y + h, x, y + h, r);
    rctx.arcTo(x, y + h, x, y, r);
    rctx.arcTo(x, y, x + w, y, r);
    rctx.closePath();
  }

  function drawRageStar(x, y, r, rot) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(rot);
    rctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 ? r * 0.45 : r;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      if (i === 0) rctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else rctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    rctx.closePath();
    rctx.fillStyle = '#ffe58a';
    rctx.fill();
    rctx.strokeStyle = 'rgba(120, 80, 0, 0.5)';
    rctx.lineWidth = 1;
    rctx.stroke();
    rctx.restore();
  }

  function drawRageCracks(x, y, count, seed) {
    if (!count) return;
    rctx.save();
    rctx.strokeStyle = 'rgba(6, 8, 16, 0.82)';
    rctx.lineWidth = 2;
    rctx.lineCap = 'round';
    for (var i = 0; i < count; i++) {
      var ang = -0.7 + i * 0.55;
      var len = 26 + i * 8;
      var lx = x + 2;
      var ly = y + (i - 1) * 6;
      rctx.beginPath();
      rctx.moveTo(lx, ly);
      for (var j = 1; j <= 4; j++) {
        lx = x + 2 + Math.cos(ang) * len * j / 4 + Math.sin(seed + i * 3 + j) * 7;
        ly = y + (i - 1) * 6 + Math.sin(ang) * len * j / 4 + Math.cos(seed + i * 2 + j) * 7;
        rctx.lineTo(lx, ly);
      }
      rctx.stroke();
      rctx.beginPath();
      rctx.moveTo(lx, ly);
      rctx.lineTo(lx + 8, ly + Math.sin(seed + i + 2) * 14);
      rctx.stroke();
    }
    rctx.restore();
  }

  function drawRagePallet(x, y, rot, scale) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(rot);
    rctx.scale(scale, scale);

    [[-0.62, -0.16, 0.19], [0.82, -0.14, 0.15]].forEach(function (w) {
      rctx.beginPath();
      rctx.arc(w[0], w[1], w[2], 0, Math.PI * 2);
      rctx.fillStyle = '#151b28';
      rctx.fill();
      rctx.strokeStyle = '#4b5a78';
      rctx.lineWidth = 0.035;
      rctx.stroke();
    });

    var fork = rctx.createLinearGradient(0, -0.72, 0, -0.2);
    fork.addColorStop(0, '#ffd75e');
    fork.addColorStop(0.55, '#ffcf3a');
    fork.addColorStop(1, '#d99f14');
    rageRR(-0.55, -0.72, 1.72, 0.17, 0.06);
    rctx.fillStyle = fork;
    rctx.fill();
    rctx.strokeStyle = 'rgba(24, 20, 8, 0.65)';
    rctx.lineWidth = 0.025;
    rctx.stroke();
    rageRR(-0.55, -0.42, 1.66, 0.12, 0.05);
    rctx.fillStyle = '#f2b922';
    rctx.fill();
    rctx.stroke();

    rageRR(-0.95, -1.62, 0.42, 1.05, 0.1);
    rctx.fillStyle = '#f6c02b';
    rctx.fill();
    rctx.stroke();
    rctx.beginPath();
    rctx.arc(-0.74, -1.15, 0.09, 0, Math.PI * 2);
    rctx.fillStyle = '#b57c0c';
    rctx.fill();

    rctx.strokeStyle = '#e7b31f';
    rctx.lineWidth = 0.13;
    rctx.lineCap = 'round';
    rctx.beginPath();
    rctx.moveTo(-0.78, -1.55);
    rctx.lineTo(-1.5, -2.18);
    rctx.stroke();
    rctx.strokeStyle = '#1d2433';
    rctx.lineWidth = 0.11;
    rctx.beginPath();
    rctx.moveTo(-1.42, -2.04);
    rctx.lineTo(-1.66, -2.28);
    rctx.stroke();

    rctx.strokeStyle = 'rgba(255, 250, 210, 0.5)';
    rctx.lineWidth = 0.025;
    rctx.beginPath();
    rctx.moveTo(-0.45, -0.65);
    rctx.lineTo(1.05, -0.65);
    rctx.stroke();

    rctx.restore();
  }

  function drawRageScissors(x, y, scale, open, alpha) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(-0.3);
    rctx.scale(scale, scale);
    rctx.globalAlpha = alpha;
    var spread = open * 0.34;

    [-1, 1].forEach(function (side) {
      rctx.save();
      rctx.rotate(side * spread);

      // manico: asta e anello separato
      rctx.strokeStyle = '#8d1f31';
      rctx.lineWidth = 0.12;
      rctx.lineCap = 'round';
      rctx.beginPath();
      rctx.moveTo(0, 0);
      rctx.lineTo(-0.58, side * 0.44);
      rctx.stroke();
      rctx.beginPath();
      rctx.arc(-0.78, side * 0.58, 0.25, 0, Math.PI * 2);
      rctx.strokeStyle = '#c03a4c';
      rctx.lineWidth = 0.12;
      rctx.stroke();
      rctx.beginPath();
      rctx.arc(-0.78, side * 0.58, 0.1, 0, Math.PI * 2);
      rctx.strokeStyle = 'rgba(30, 6, 12, 0.85)';
      rctx.lineWidth = 0.04;
      rctx.stroke();

      // lama lunga con filo
      rctx.beginPath();
      rctx.moveTo(0.02, -0.08);
      rctx.lineTo(2.5, -0.01);
      rctx.lineTo(2.32, 0.13);
      rctx.lineTo(0.02, 0.09);
      rctx.closePath();
      var steel = rctx.createLinearGradient(0, -0.1, 0, 0.14);
      steel.addColorStop(0, '#f4f9ff');
      steel.addColorStop(0.55, '#b9c9dc');
      steel.addColorStop(1, '#73849e');
      rctx.fillStyle = steel;
      rctx.fill();
      rctx.strokeStyle = 'rgba(20, 30, 45, 0.75)';
      rctx.lineWidth = 0.02;
      rctx.stroke();

      rctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      rctx.lineWidth = 0.018;
      rctx.beginPath();
      rctx.moveTo(0.25, -0.045);
      rctx.lineTo(2.4, -0.012);
      rctx.stroke();
      rctx.strokeStyle = 'rgba(70, 92, 120, 0.5)';
      rctx.lineWidth = 0.012;
      rctx.beginPath();
      rctx.moveTo(0.2, 0.055);
      rctx.lineTo(2.2, 0.09);
      rctx.stroke();

      rctx.restore();
    });

    rctx.beginPath();
    rctx.arc(0, 0, 0.1, 0, Math.PI * 2);
    rctx.fillStyle = '#eef6ff';
    rctx.fill();
    rctx.strokeStyle = '#42526b';
    rctx.lineWidth = 0.03;
    rctx.stroke();

    rctx.restore();
  }

  function drawRager(cx, floorY, s, o) {
    rctx.save();
    rctx.translate(cx + (o.tremble || 0), floorY);

    rctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    rctx.beginPath();
    rctx.ellipse(0, 4, s * 0.7, s * 0.18, 0, 0, Math.PI * 2);
    rctx.fill();

    rctx.rotate(o.lean || 0);

    var stride = o.mode === 'butt' ? s * 0.12 : 0;
    rageRR(-s * 0.34, -s * 0.92, s * 0.24, s * 0.9, s * 0.1);
    rctx.fillStyle = '#263242';
    rctx.fill();
    rageRR(s * 0.1, -s * 0.92, s * 0.24, s * 0.9, s * 0.1);
    rctx.fillStyle = '#2d3a4c';
    rctx.fill();
    rageRR(-s * 0.4 - stride, -s * 0.08, s * 0.42, s * 0.14, s * 0.05);
    rctx.fillStyle = '#1a1f2b';
    rctx.fill();
    rageRR(s * 0.06 + stride, -s * 0.08, s * 0.42, s * 0.14, s * 0.05);
    rctx.fillStyle = '#1a1f2b';
    rctx.fill();

    var jacket = rctx.createLinearGradient(-s * 0.6, -s * 2, s * 0.6, -s * 0.8);
    jacket.addColorStop(0, '#3f8499');
    jacket.addColorStop(1, '#1c4858');
    rageRR(-s * 0.52, -s * 1.95, s * 1.04, s * 1.08, s * 0.28);
    rctx.fillStyle = jacket;
    rctx.fill();

    var vest = rctx.createLinearGradient(0, -s * 1.9, 0, -s * 0.9);
    vest.addColorStop(0, '#e2f77a');
    vest.addColorStop(0.55, '#c9e94f');
    vest.addColorStop(1, '#9cbf2c');
    rageRR(-s * 0.47, -s * 1.88, s * 0.86, s * 0.94, s * 0.22);
    rctx.fillStyle = vest;
    rctx.fill();

    rctx.strokeStyle = 'rgba(240, 252, 255, 0.65)';
    rctx.lineWidth = Math.max(1, s * 0.05);
    rctx.beginPath();
    rctx.moveTo(-s * 0.4, -s * 1.55);
    rctx.lineTo(s * 0.3, -s * 1.55);
    rctx.moveTo(-s * 0.4, -s * 1.18);
    rctx.lineTo(s * 0.3, -s * 1.18);
    rctx.stroke();

    var hands;
    var armColor = '#3f8499';
    var armW = s * 0.18;
    if (o.mode === 'throw') {
      hands = [[s * 0.95, -s * 1.7], [s * 0.75, -s * 1.45]];
      rageLimb(-s * 0.4, -s * 1.75, hands[0][0], hands[0][1], armW, armColor);
      rageLimb(s * 0.32, -s * 1.7, hands[1][0], hands[1][1], armW, armColor);
    } else if (o.mode === 'scissors') {
      hands = [[s * 0.62, -s * 1.45], [s * 0.68, -s * 1.2]];
      rageLimb(-s * 0.4, -s * 1.75, hands[0][0], hands[0][1], armW, armColor);
      rageLimb(s * 0.28, -s * 1.8, hands[1][0], hands[1][1], armW, armColor);
    } else if (o.mode === 'butt') {
      hands = [[-s * 0.85, -s * 1.5], [-s * 0.7, -s * 1.35]];
      rageLimb(-s * 0.4, -s * 1.75, hands[0][0], hands[0][1], armW, armColor);
      rageLimb(s * 0.3, -s * 1.75, hands[1][0], hands[1][1], armW, armColor);
    } else if (o.mode === 'head') {
      hands = [[s * 0.35, -s * 2.4]];
      rageLimb(-s * 0.4, -s * 1.75, hands[0][0], hands[0][1], armW, armColor);
      rageLimb(s * 0.3, -s * 1.75, s * 0.1, -s * 1.1, armW, armColor);
    } else {
      hands = [[-s * 0.45, -s * 1.02], [s * 0.36, -s * 1.02]];
      rageLimb(-s * 0.4, -s * 1.75, hands[0][0], hands[0][1], armW, armColor);
      rageLimb(s * 0.32, -s * 1.75, hands[1][0], hands[1][1], armW, armColor);
    }

    hands.forEach(function (h) {
      rctx.beginPath();
      rctx.arc(h[0], h[1], s * 0.115, 0, Math.PI * 2);
      rctx.fillStyle = '#eab68c';
      rctx.fill();
      rctx.strokeStyle = 'rgba(70, 40, 20, 0.55)';
      rctx.lineWidth = Math.max(1, s * 0.02);
      rctx.stroke();
    });

    var headX = s * 0.08;
    var headY = -s * 2.32;
    rctx.beginPath();
    rctx.arc(headX, headY, s * 0.42, 0, Math.PI * 2);
    var skin = rctx.createRadialGradient(headX + s * 0.15, headY - s * 0.1, s * 0.05, headX, headY, s * 0.45);
    skin.addColorStop(0, '#f6c79d');
    skin.addColorStop(1, '#d99a6c');
    rctx.fillStyle = skin;
    rctx.fill();
    rctx.strokeStyle = 'rgba(70, 40, 20, 0.55)';
    rctx.lineWidth = Math.max(1, s * 0.022);
    rctx.stroke();

    if (o.red > 0) {
      rctx.globalAlpha = 0.18 + 0.34 * o.red;
      rctx.fillStyle = '#ff4d5e';
      rctx.beginPath();
      rctx.arc(headX + s * 0.1, headY + s * 0.04, s * 0.31, 0, Math.PI * 2);
      rctx.fill();
      rctx.globalAlpha = 1;
    }

    rctx.beginPath();
    rctx.arc(headX - s * 0.36, headY + s * 0.04, s * 0.09, 0, Math.PI * 2);
    rctx.fillStyle = '#e0a97e';
    rctx.fill();

    rctx.beginPath();
    rctx.arc(headX + s * 0.28, headY - s * 0.02, s * 0.045, 0, Math.PI * 2);
    rctx.fillStyle = '#2a1a12';
    rctx.fill();

    rctx.strokeStyle = '#3b2416';
    rctx.lineWidth = Math.max(1.5, s * 0.045);
    rctx.lineCap = 'round';
    rctx.beginPath();
    rctx.moveTo(headX + s * 0.14, headY - s * 0.18);
    rctx.lineTo(headX + s * 0.36, headY - s * 0.1);
    rctx.stroke();

    rctx.beginPath();
    if (o.mode === 'idle' && !o.dizzy) {
      rctx.arc(headX + s * 0.18, headY + s * 0.2, s * 0.1, 0.15 * Math.PI, 0.75 * Math.PI);
    } else {
      rctx.ellipse(headX + s * 0.2, headY + s * 0.22, s * 0.1, s * 0.07, 0, 0, Math.PI * 2);
    }
    rctx.strokeStyle = '#5a2b22';
    rctx.lineWidth = Math.max(1, s * 0.025);
    rctx.stroke();

    var brim = rctx.createLinearGradient(0, headY - s * 0.5, 0, headY + s * 0.02);
    brim.addColorStop(0, '#6b533a');
    brim.addColorStop(1, '#3a2c1c');
    rctx.beginPath();
    rctx.ellipse(headX, headY - s * 0.34, s * 0.55, s * 0.14, -0.04, 0, Math.PI * 2);
    rctx.fillStyle = brim;
    rctx.fill();
    rctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    rctx.lineWidth = Math.max(1, s * 0.02);
    rctx.stroke();

    var crown = rctx.createLinearGradient(0, headY - s * 0.75, 0, headY - s * 0.3);
    crown.addColorStop(0, '#8a6746');
    crown.addColorStop(1, '#544029');
    rctx.beginPath();
    rctx.ellipse(headX - s * 0.03, headY - s * 0.5, s * 0.36, s * 0.24, -0.08, 0, Math.PI * 2);
    rctx.fillStyle = crown;
    rctx.fill();
    rctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    rctx.stroke();
    rctx.strokeStyle = '#b07a45';
    rctx.lineWidth = Math.max(1, s * 0.02);
    rctx.beginPath();
    rctx.ellipse(headX - s * 0.03, headY - s * 0.5, s * 0.3, s * 0.19, -0.08, 0, Math.PI * 2);
    rctx.stroke();

    if (o.red > 0.4) {
      rctx.strokeStyle = 'rgba(255, 90, 100, 0.95)';
      rctx.lineWidth = Math.max(1.5, s * 0.035);
      var vx = headX + s * 0.1;
      var vy = headY - s * 0.15;
      rctx.beginPath();
      rctx.moveTo(vx - s * 0.12, vy);
      rctx.lineTo(vx - s * 0.04, vy);
      rctx.lineTo(vx - s * 0.08, vy + s * 0.09);
      rctx.moveTo(vx, vy - s * 0.12);
      rctx.lineTo(vx, vy - s * 0.04);
      rctx.lineTo(vx + s * 0.09, vy - s * 0.08);
      rctx.stroke();
    }

    if (o.dizzy) {
      for (var i = 0; i < 3; i++) {
        var a = (o.t || 0) * 0.004 + i * Math.PI * 2 / 3;
        drawRageStar(headX + Math.cos(a) * s * 0.55, headY - s * 0.85 + Math.sin(a) * s * 0.16, s * 0.11, a);
      }
    }

    rctx.restore();
  }

  function rageLimb(x1, y1, x2, y2, w, color) {
    rctx.strokeStyle = color;
    rctx.lineWidth = w;
    rctx.lineCap = 'round';
    rctx.beginPath();
    rctx.moveTo(x1, y1);
    rctx.lineTo(x2, y2);
    rctx.stroke();
  }

  function drawRageScene(u, dt, t) {
    if (!rctx) return;
    var W = rage.w;
    var H = rage.h;
    if (!W || !H) return;
    var floorY = H * 0.78;
    var wallX = W * 0.845;
    var s = Math.min(H * 0.25, W * 0.13);
    var manX = W * 0.32;

    rctx.clearRect(0, 0, W, H);

    var bg = rctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1226');
    bg.addColorStop(0.55, '#101a34');
    bg.addColorStop(1, '#070b16');
    rctx.fillStyle = bg;
    rctx.fillRect(0, 0, W, H);

    var lamp = rctx.createRadialGradient(W * 0.32, H * 0.05, 0, W * 0.32, H * 0.05, W * 0.7);
    lamp.addColorStop(0, 'rgba(255, 224, 160, 0.18)');
    lamp.addColorStop(0.55, 'rgba(255, 196, 90, 0.04)');
    lamp.addColorStop(1, 'rgba(0, 0, 0, 0)');
    rctx.fillStyle = lamp;
    rctx.fillRect(0, 0, W, H);

    rctx.strokeStyle = 'rgba(140, 168, 220, 0.08)';
    rctx.lineWidth = 1;
    for (var px = W * 0.06; px < wallX; px += W * 0.11) {
      rctx.beginPath();
      rctx.moveTo(px, H * 0.12);
      rctx.lineTo(px, floorY);
      rctx.stroke();
    }
    rctx.beginPath();
    rctx.moveTo(0, H * 0.12);
    rctx.lineTo(wallX, H * 0.12);
    rctx.stroke();
    rctx.fillStyle = 'rgba(255, 226, 160, 0.08)';
    rctx.fillRect(W * 0.2, H * 0.13, W * 0.24, H * 0.016);

    var hits = [5.2, 6.0, 6.8];
    var impactTimes = [2.55, 5.2, 6.0, 6.8];
    var shake = 0;
    impactTimes.forEach(function (ht) {
      var d = u - ht;
      if (d >= 0 && d < 0.32) shake = Math.max(shake, 1 - d / 0.32);
    });
    var sx = 0;
    var sy = 0;
    if (!reduceMotion && shake > 0) {
      sx = Math.sin(t * 0.09) * 8 * shake;
      sy = Math.cos(t * 0.12) * 5 * shake;
    }

    rctx.save();
    rctx.translate(sx, sy);

    var wall = rctx.createLinearGradient(wallX, 0, W, 0);
    wall.addColorStop(0, '#232f4d');
    wall.addColorStop(0.35, '#1a2440');
    wall.addColorStop(1, '#121a30');
    rctx.fillStyle = wall;
    rctx.fillRect(wallX, 0, W - wallX, floorY);

    rctx.strokeStyle = 'rgba(6, 10, 20, 0.85)';
    rctx.lineWidth = 2;
    rctx.beginPath();
    rctx.moveTo(wallX, 0);
    rctx.lineTo(wallX, floorY);
    rctx.stroke();

    rctx.strokeStyle = 'rgba(150, 175, 220, 0.1)';
    rctx.lineWidth = 1;
    for (var wy = H * 0.18; wy < floorY; wy += H * 0.18) {
      rctx.beginPath();
      rctx.moveTo(wallX, wy);
      rctx.lineTo(W, wy);
      rctx.stroke();
    }

    for (var hx = wallX; hx < W; hx += 18) {
      rctx.fillStyle = ((hx / 18) | 0) % 2 ? 'rgba(255, 196, 60, 0.18)' : 'rgba(18, 22, 36, 0.6)';
      rctx.fillRect(hx, floorY - 12, 18, 12);
    }

    var floor = rctx.createLinearGradient(0, floorY, 0, H);
    floor.addColorStop(0, '#1b2743');
    floor.addColorStop(1, '#0a1020');
    rctx.fillStyle = floor;
    rctx.fillRect(0, floorY, W, H - floorY);

    rctx.strokeStyle = 'rgba(160, 190, 240, 0.12)';
    rctx.lineWidth = 1;
    rctx.beginPath();
    rctx.moveTo(0, floorY);
    rctx.lineTo(W, floorY);
    rctx.stroke();
    for (var fx = -W * 0.2; fx < W * 1.2; fx += W * 0.09) {
      rctx.beginPath();
      rctx.moveTo(W * 0.5 + (fx - W * 0.5) * 0.55, floorY);
      rctx.lineTo(fx, H);
      rctx.stroke();
    }

    var headHit = 0;
    hits.forEach(function (ht) {
      var d = u - ht;
      var p = 0;
      if (d >= -0.45 && d < 0) p = Math.pow(clamp01((d + 0.45) / 0.45), 2.2);
      else if (d >= 0 && d < 0.12) p = 1;
      else if (d >= 0.12 && d < 0.6) p = 1 - smoothStep((d - 0.12) / 0.48);
      if (p > headHit) headHit = p;
    });

    var manCx = manX + headHit * (wallX - manX - s * 1.05);
    var red = clamp01((u - 0.8) / 0.8) * (1 - clamp01((u - 8.9) / 0.8));
    var dizzy = u > 7.1 && u < 9.0;
    var lean = headHit * 0.22;
    if (u > 1.1 && u < 1.5) lean -= 0.05 * Math.sin(((u - 1.1) / 0.4) * Math.PI);
    if (dizzy && !reduceMotion) lean += Math.sin((u - 7.1) * 6) * 0.04;
    var tremble = (u > 0.9 && u < 2.6 && !reduceMotion) ? Math.sin(u * 65) * s * 0.012 : 0;
    var mode = u < 1.45 ? 'idle' : u < 2.9 ? 'throw' : u < 5.0 ? 'scissors' : u < 7.1 ? 'butt' : u < 8.7 ? 'head' : 'idle';

    var pallet;
    var palletX = manX + s * 0.95;
    var palletY = floorY - s * 0.02;
    var landX = wallX - s * 0.9;
    if (u < 1.35) {
      pallet = { x: palletX, y: palletY, rot: 0, scale: s * 0.68 };
    } else if (u < 2.55) {
      var pp = easeOut((u - 1.35) / 1.2);
      pallet = {
        x: mix(palletX, landX, pp),
        y: floorY - Math.sin(pp * Math.PI) * s * 1.8,
        rot: pp * Math.PI * 2.1,
        scale: s * 0.68
      };
    } else if (u < 8.1) {
      pallet = { x: landX, y: floorY, rot: 0.32, scale: s * 0.68 };
    } else {
      var qq = smoothStep((u - 8.1) / 1.3);
      pallet = {
        x: mix(landX, manX + s * 1.05, qq),
        y: floorY - Math.sin(qq * Math.PI) * s * 0.3,
        rot: mix(0.32, 0, qq),
        scale: s * 0.68
      };
    }
    drawRagePallet(pallet.x, pallet.y, pallet.rot, pallet.scale);

    var crackCount = 0;
    if (u >= 2.55) crackCount++;
    hits.forEach(function (ht) { if (u >= ht) crackCount++; });
    drawRageCracks(wallX, floorY - s * 1.2, u >= 2.55 ? 1 : 0, 3);
    drawRageCracks(wallX, floorY - s * 2.25, Math.max(0, crackCount - 1), 7);

    var flash = 0;
    hits.forEach(function (ht) {
      var fd = u - ht;
      if (fd >= 0 && fd < 0.24) flash = Math.max(flash, 1 - fd / 0.24);
    });
    if (flash > 0) {
      rctx.save();
      rctx.globalAlpha = flash * 0.85;
      rctx.fillStyle = 'rgba(255, 240, 190, 0.9)';
      rctx.beginPath();
      for (var bi = 0; bi < 12; bi++) {
        var ba = bi * Math.PI / 6;
        var br = (bi % 2 ? 0.45 : 1) * s * 0.52;
        var bx2 = wallX - s * 0.16 + Math.cos(ba) * br;
        var by2 = floorY - s * 2.2 + Math.sin(ba) * br;
        if (bi === 0) rctx.moveTo(bx2, by2);
        else rctx.lineTo(bx2, by2);
      }
      rctx.closePath();
      rctx.fill();
      rctx.restore();
    }

    if (headHit > 0.15) {
      rctx.strokeStyle = 'rgba(180, 205, 255, ' + (0.25 * headHit).toFixed(3) + ')';
      rctx.lineWidth = 2;
      for (var li = 0; li < 4; li++) {
        var ly = floorY - s * (1.9 + li * 0.22);
        rctx.beginPath();
        rctx.moveTo(manCx - s * (0.9 + li * 0.2), ly);
        rctx.lineTo(manCx - s * (0.3 + li * 0.1), ly);
        rctx.stroke();
      }
    }

    drawRager(manCx, floorY, s, {
      lean: lean, mode: mode, red: red, dizzy: dizzy, t: t, tremble: tremble
    });

    if (u >= 2.7 && u < 5.05) {
      var grow = easeOut((u - 2.7) / 0.35);
      var fade = 1 - clamp01((u - 4.8) / 0.25);
      var open = 0.2;
      if (u >= 3.35 && u < 3.85) open = Math.abs(Math.sin(((u - 3.35) / 0.5) * Math.PI)) * 1.05;
      if (u >= 4.0 && u < 4.5) open = Math.abs(Math.sin(((u - 4.0) / 0.5) * Math.PI)) * 1.05;
      drawRageScissors(manCx + s * 0.82, floorY - s * 1.28, s * 1.05 * grow, open, fade);
      if ((u > 3.1 && u < 3.25) || (u > 3.9 && u < 4.05)) {
        drawRageStar(manCx + s * 3.05, floorY - s * 1.12, s * 0.13, u * 3);
      }
    }

    if (u > 0.85 && u < 2.9) {
      for (var si = 0; si < 3; si++) {
        var sp = (u - 0.85 - si * 0.28) / 1.4;
        if (sp > 0 && sp < 1) {
          var ex = manCx - s * 0.45 + si * s * 0.28 + Math.sin(sp * 6 + si) * s * 0.08;
          var ey = floorY - s * 3.05 - sp * s * 0.7;
          rctx.beginPath();
          rctx.arc(ex, ey, s * (0.08 + sp * 0.22), 0, Math.PI * 2);
          rctx.fillStyle = 'rgba(230, 238, 255, ' + (0.22 * (1 - sp)).toFixed(3) + ')';
          rctx.fill();
        }
      }
    }

    for (var pi = rage.parts.length - 1; pi >= 0; pi--) {
      var pt = rage.parts[pi];
      pt.life -= dt;
      if (pt.life <= 0) { rage.parts.splice(pi, 1); continue; }
      pt.vy += 640 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 1 - 1.4 * dt;
      pt.vy *= 1 - 0.5 * dt;
    }

    for (var pj = 0; pj < rage.parts.length; pj++) {
      var part = rage.parts[pj];
      var alpha = clamp01(part.life / 0.55);
      rctx.globalAlpha = alpha;
      rctx.fillStyle = part.kind === 'crumb' ? '#9aa7bd' : '#ffd166';
      rctx.beginPath();
      rctx.arc(part.x, part.y, part.size, 0, Math.PI * 2);
      rctx.fill();
    }
    rctx.globalAlpha = 1;

    rageSound('grunt', function () { sfx.roar(); });
    if (u >= 2.55) {
      rageSound('crash', function () {
        sfx.crash();
        rageBurst(wallX - 6, floorY - s * 1.25, 24, 'spark');
        rageBurst(wallX - 10, floorY - s * 0.4, 14, 'crumb');
      });
    }
    if (u >= 3.45) rageSound('snip1', function () { sfx.snip(); });
    if (u >= 4.1) rageSound('snip2', function () { sfx.snip(); });
    hits.forEach(function (ht, idx) {
      if (u >= ht) {
        rageSound('hit' + idx, function () {
          sfx.hit();
          rageBurst(wallX - 4, floorY - s * 2.25, 18, 'crumb');
        });
      }
    });

    rctx.restore();

    if (u > 9.8) {
      rctx.fillStyle = 'rgba(5, 8, 18, ' + clamp01((u - 9.8) / 0.6).toFixed(3) + ')';
      rctx.fillRect(0, 0, W, H);
    }

    var cap;
    if (u < 1.3) cap = 'Spinga sta per perdere le staffe…';
    else if (u < 2.8) cap = 'Il transpallet vola contro il muro.';
    else if (u < 5.0) cap = 'E tira fuori una forbice lunghissima.';
    else if (u < 7.4) cap = 'Tre testate al muro. Con calma, eh.';
    else if (u < 9.2) cap = 'Gira la testa, si sfoga e si calma.';
    else cap = 'Tutto torna al suo posto. Si riprende.';
    if (cap !== rage.caption) {
      rage.caption = cap;
      var capEl = $('rageCaption');
      if (capEl) capEl.textContent = cap;
    }
  }

  function rageLoop(t) {
    if (!rage.open) return;
    if (!rage.start) rage.start = t;
    var dt = Math.min(0.05, Math.max(0.001, (t - rage.last) / 1000));
    rage.last = t;
    var u = (t - rage.start) / 1000;
    drawRageScene(u, dt, t);
    if (u >= RAGE_MS / 1000) {
      closeRage(true);
      return;
    }
    rage.raf = window.requestAnimationFrame(rageLoop);
  }

  // Dopo un minuto senza mosse il gioco sottolinea da solo il momento di difficoltà:
  // stesso overlay del pulsante, stessa pausa, nessun effetto su mosse, tempo e record.
  function noteActivity() {
    lastActivity = performance.now();
  }

  function checkIdleRage() {
    // fuori dal gioco (menu, pausa, overlay) il minuto di inattività non scorre
    if (rage.open || won || paused || !level.w || levelsOpen()) {
      noteActivity();
      return;
    }
    if (performance.now() - lastActivity < IDLE_RAGE_MS) return;
    openRage();
  }

  function openRage() {
    if (rage.open || won || !level.w || !rctx) return;
    sfx.init();
    sfx.ui();
    rage.open = true;
    rage.parts = [];
    rage.fx = {};
    rage.caption = '';
    rage.start = 0;
    pauseGame(false);
    $('rageOverlay').classList.remove('hidden');
    focusOverlay('rageOverlay');
    announce('Sclera: effetto commemorativo. Il gioco è in pausa.');
    rageResize();
    window.requestAnimationFrame(function (t) {
      if (!rage.open) return;
      rageResize();
      rage.start = t;
      rage.last = t;
      rageLoop(t);
    });
  }

  function closeRage(silent) {
    if (!rage.open) return;
    rage.open = false;
    if (rage.raf) window.cancelAnimationFrame(rage.raf);
    rage.raf = 0;
    $('rageOverlay').classList.add('hidden');
    if (!silent) sfx.ui();
    resumeGame();
    announce('Sclera finita. Si riprende a giocare.');
  }

  /* --------------------------------------------------------------- layout */

  function resize() {
    if (!stage) return;
    var rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = rect.width;
    view.h = rect.height;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }

  // Falda riservata al D-pad, così il campo non ci finisce sotto.
  function padReserve() {
    var none = { left: 0, right: 0, bottom: 0 };
    var pad = $('touchpad');
    if (!pad || !view.w) return none;
    if (window.getComputedStyle(pad).display === 'none') return none;
    var r = pad.getBoundingClientRect();
    if (!r.width || !r.height) return none;
    var gap = 24; // margine dal bordo + respiro tra campo e pulsanti
    // stessa condizione del CSS: HUD a colonna e D-pad di lato solo in orizzontale.
    // Non usare il rapporto del palco: su schermi stretti è più largo che alto anche in verticale.
    if (window.matchMedia('(orientation: landscape) and (max-height: 560px)').matches) {
      // il D-pad sta di lato: si riserva la fascia laterale
      if (document.documentElement.getAttribute('data-pad-side') === 'left') {
        return { left: r.width + gap, right: 0, bottom: 0 };
      }
      return { left: 0, right: r.width + gap, bottom: 0 };
    }
    // in verticale si riserva la fascia in basso
    return { left: 0, right: 0, bottom: r.height + gap };
  }

  function computeLayout() {
    if (!level.w || !view.w) return;
    // sui telefoni il margine si stringe: lo spazio va al labirinto
    var edge = Math.min(view.w, view.h) < 560 ? 10 : 28;
    var reserved = padReserve();
    var availW = Math.max(80, view.w - reserved.left - reserved.right - edge * 2);
    var availH = Math.max(80, view.h - reserved.bottom - edge * 2);
    var tile = Math.floor(Math.min(availW / level.w, availH / level.h));
    // nessun minimo che possa spingere il campo fuori dal palco
    tile = Math.max(8, Math.min(66, tile));
    layout.tile = tile;
    layout.ox = reserved.left + (view.w - reserved.left - reserved.right - level.w * tile) / 2;
    layout.oy = (view.h - reserved.bottom - level.h * tile) / 2;
    staticDirty = true;
    buildStaticBoard();
  }

  /* ------------------------------------------------------------ particles */

  function burst(tx, ty, big) {
    if (reduceMotion) return;
    var cx = layout.ox + (tx + 0.5) * layout.tile;
    var cy = layout.oy + (ty + 0.5) * layout.tile;
    var count = big ? 16 : 9;
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = (big ? 120 : 80) * (0.35 + Math.random());
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0.55 + Math.random() * 0.5,
        size: layout.tile * (0.035 + Math.random() * 0.045),
        hue: big ? 190 : 45
      });
    }
  }

  function dust(tx, ty) {
    if (reduceMotion) return;
    var cx = layout.ox + (tx + 0.5) * layout.tile;
    var cy = layout.oy + (ty + 0.78) * layout.tile;
    for (var i = 0; i < 6; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 22 + Math.random() * 46;
      particles.push({
        x: cx + (Math.random() - 0.5) * layout.tile * 0.34,
        y: cy + (Math.random() - 0.5) * layout.tile * 0.12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5 - 12,
        life: 0.3 + Math.random() * 0.3,
        size: layout.tile * (0.012 + Math.random() * 0.018),
        hue: 215,
        sat: 16,
        light: 74
      });
    }
  }

  /* ---------------------------------------------------------------- draw */

  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, view.w, view.h);
    g.addColorStop(0, '#0a0f22');
    g.addColorStop(0.55, '#0c132c');
    g.addColorStop(1, '#111938');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    var rg = ctx.createRadialGradient(
      view.w * 0.5, view.h * 0.32, 0,
      view.w * 0.5, view.h * 0.32, Math.max(view.w, view.h) * 0.75
    );
    rg.addColorStop(0, 'rgba(96, 128, 255, 0.12)');
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (var x = 22; x < view.w; x += 44) {
      for (var y = 22; y < view.h; y += 44) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawBoard() {
    var t = layout.tile;
    var ox = layout.ox;
    var oy = layout.oy;
    var boardW = level.w * t;
    var boardH = level.h * t;
    var pad = Math.max(10, t * 0.22);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = 'rgba(10, 15, 32, 0.55)';
    rr(ox - pad, oy - pad, boardW + pad * 2, boardH + pad * 2, 20);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
    ctx.lineWidth = 1;
    rr(ox - pad, oy - pad, boardW + pad * 2, boardH + pad * 2, 20);
    ctx.stroke();
  }

  function tilePath(g, x, y, w, h, rtl, rtr, rbr, rbl) {
    rtl = Math.min(rtl, w / 2, h / 2);
    rtr = Math.min(rtr, w / 2, h / 2);
    rbr = Math.min(rbr, w / 2, h / 2);
    rbl = Math.min(rbl, w / 2, h / 2);
    g.moveTo(x + rtl, y);
    g.lineTo(x + w - rtr, y);
    if (rtr) g.arcTo(x + w, y, x + w, y + rtr, rtr);
    g.lineTo(x + w, y + h - rbr);
    if (rbr) g.arcTo(x + w, y + h, x + w - rbr, y + h, rbr);
    g.lineTo(x + rbl, y + h);
    if (rbl) g.arcTo(x, y + h, x, y + h - rbl, rbl);
    g.lineTo(x, y + rtl);
    if (rtl) g.arcTo(x, y, x + rtl, y, rtl);
    g.closePath();
  }

  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7 + 13.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function edgeAO(g, px, py, t, side, alpha, len) {
    var span = t * len;
    var grd;
    var x0 = px;
    var y0 = py;
    var w = t;
    var h = t;
    if (side === 'n') {
      grd = g.createLinearGradient(0, py, 0, py + span);
      h = span;
    } else if (side === 's') {
      grd = g.createLinearGradient(0, py + t, 0, py + t - span);
      y0 = py + t - span;
      h = span;
    } else if (side === 'w') {
      grd = g.createLinearGradient(px, 0, px + span, 0);
      w = span;
    } else {
      grd = g.createLinearGradient(px + t, 0, px + t - span, 0);
      x0 = px + t - span;
      w = span;
    }
    grd.addColorStop(0, 'rgba(0, 0, 0, ' + alpha + ')');
    grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grd;
    g.fillRect(x0, y0, w, h);
  }

  function buildStaticBoard() {
    staticDirty = false;
    staticBoard = null;
    if (!level.w || !layout.tile) return;
    var w = level.w * layout.tile;
    var h = level.h * layout.tile;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Solo il fondale fisso: casse, giocatore, obiettivi animati e ombre
    // cambiano ogni frame e vanno disegnati dal vivo, mai nella cache.
    drawFloorTo(g, w, h);
    drawWallsTo(g, w, h);
    staticBoard = c;
  }

  function drawFloorTo(g, boardW, boardH) {
    var t = layout.tile;
    var i, x, y, px, py, k;
    for (i = 0; i < floorList.length; i++) {
      x = floorList[i][0];
      y = floorList[i][1];
      px = x * t;
      py = y * t;

      g.fillStyle = highContrast
        ? (((x + y) & 1) ? '#05080f' : '#080c18')
        : (((x + y) & 1) ? '#131a34' : '#151d3b');
      g.fillRect(px, py, t, t);

      for (k = 0; k < 3; k++) {
        var hx = hash2(x * 5 + k * 13, y * 7 + k * 3);
        var hy = hash2(y * 11 + k * 7, x * 3 + k * 19);
        var ha = hash2(x * 2 + k * 23, y * 13 + k * 5);
        var rad = Math.max(0.5, t * (0.004 + ha * 0.008));
        g.fillStyle = ha > 0.52
          ? 'rgba(255, 255, 255, ' + (0.018 + ha * 0.02).toFixed(3) + ')'
          : 'rgba(0, 0, 0, ' + (0.05 + ha * 0.06).toFixed(3) + ')';
        g.beginPath();
        g.arc(px + hx * t, py + hy * t, rad, 0, Math.PI * 2);
        g.fill();
      }

    }

    // Reticolo dei pannelli: un solo tracciato per tutto il pavimento.
    g.strokeStyle = highContrast ? 'rgba(140, 170, 255, 0.22)' : 'rgba(0, 0, 0, 0.15)';
    g.lineWidth = 1;
    g.beginPath();
    for (i = 0; i < floorList.length; i++) {
      x = floorList[i][0];
      y = floorList[i][1];
      px = x * t;
      py = y * t;
      g.moveTo(px, py + t - 0.5);
      g.lineTo(px + t, py + t - 0.5);
      g.moveTo(px + t - 0.5, py);
      g.lineTo(px + t - 0.5, py + t);
    }
    g.stroke();

    // Luce diagonale applicata al pavimento in un unico passaggio.
    g.save();
    g.beginPath();
    for (i = 0; i < floorList.length; i++) {
      g.rect(floorList[i][0] * t, floorList[i][1] * t, t, t);
    }
    g.clip();
    var lg = g.createLinearGradient(0, 0, boardW, boardH);
    lg.addColorStop(0, 'rgba(140, 170, 235, 0.05)');
    lg.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    lg.addColorStop(1, 'rgba(0, 0, 0, 0.10)');
    g.fillStyle = lg;
    g.fillRect(0, 0, boardW, boardH);
    g.restore();

    for (i = 0; i < floorList.length; i++) {
      x = floorList[i][0];
      y = floorList[i][1];
      px = x * t;
      py = y * t;
      if (walls.has(K(x, y - 1))) edgeAO(g, px, py, t, 'n', 0.24, 0.5);
      if (walls.has(K(x, y + 1))) edgeAO(g, px, py, t, 's', 0.10, 0.35);
      if (walls.has(K(x - 1, y))) edgeAO(g, px, py, t, 'w', 0.18, 0.45);
      if (walls.has(K(x + 1, y))) edgeAO(g, px, py, t, 'e', 0.08, 0.3);
    }
  }

  function drawGoals(t) {
    var tile = layout.tile;
    var lockAnim = reduceMotion ? 0 : 0.3 + 0.7 * Math.sin(t * 0.004 + goals.size * 0.2);
    goals.forEach(function (key) {
      var p = key.split(',');
      var x = +p[0];
      var y = +p[1];
      var cx = layout.ox + (x + 0.5) * tile;
      var cy = layout.oy + (y + 0.5) * tile;
      var pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.0035 + x * 0.7 + y * 0.5);
      var occupied = boxAt.has(key);
      var s = tile * 0.56;
      var tone = occupied ? '255, 205, 100' : (highContrast ? '150, 245, 255' : '110, 231, 255');

      if (occupied) {
        // Anello esterno "lock" pulsante quando la cassa è sul target
        var gg = ctx.createRadialGradient(cx, cy, tile * 0.05, cx, cy, tile * 0.64);
        gg.addColorStop(0, 'rgba(255, 205, 90, 0.18)');
        gg.addColorStop(0.4, 'rgba(255, 180, 60, 0.35)');
        gg.addColorStop(1, 'rgba(255, 205, 90, 0)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(cx, cy, tile * 0.64, 0, Math.PI * 2);
        ctx.fill();

        // Lock icona (quadrato con angoli arrotondati) che pulsa
        ctx.fillStyle = 'rgba(255, 190, 85, ' + (0.18 + lockAnim * 0.22).toFixed(3) + ')';
        ctx.strokeStyle = 'rgba(255, 180, 60, ' + (0.4 + lockAnim * 0.3).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, tile * 0.032);
        rr(cx - tile * 0.18, cy - tile * 0.18, tile * 0.36, tile * 0.36, tile * 0.08);
        ctx.fill();
        ctx.stroke();
        
        // Punto al centro del lock
        ctx.fillStyle = 'rgba(255, 240, 180, ' + (0.7 + lockAnim * 0.3).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(cx + tile * 0.08, cy, tile * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(' + tone + ', ' + (0.06 + (occupied ? 0.1 : 0.05) * pulse).toFixed(3) + ')';
      ctx.strokeStyle = 'rgba(' + tone + ', ' + (0.34 + 0.26 * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, tile * 0.035);
      rr(cx - s / 2, cy - s / 2, s, s, s * 0.3);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.shadowColor = 'rgba(' + tone + ', 0.9)';
      ctx.shadowBlur = tile * 0.35;
      ctx.fillStyle = 'rgba(' + (occupied ? '255, 246, 210' : '180, 248, 255') + ', ' + (0.6 + 0.3 * pulse).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, tile * (0.085 + 0.02 * pulse), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawWallsTo(g, boardW, boardH) {
    if (!walls.size) return;
    var t = layout.tile;
    var lift = Math.max(2, t * 0.09);
    var r = Math.min(t * 0.2, 10);

    function wallPath(offsetY) {
      g.beginPath();
      walls.forEach(function (key) {
        var p = key.split(',');
        var x = +p[0];
        var y = +p[1];
        var n = walls.has(K(x, y - 1));
        var e = walls.has(K(x + 1, y));
        var s = walls.has(K(x, y + 1));
        var w = walls.has(K(x - 1, y));
        tilePath(
          g,
          x * t, y * t + offsetY, t, t,
          (!n && !w) ? r : 0,
          (!n && !e) ? r : 0,
          (!s && !e) ? r : 0,
          (!s && !w) ? r : 0
        );
      });
    }

    wallPath(lift);
    var sg = g.createLinearGradient(0, 0, 0, boardH);
    sg.addColorStop(0, '#111833');
    sg.addColorStop(1, '#060a16');
    g.fillStyle = sg;
    g.fill();

    wallPath(0);
    var tg = g.createLinearGradient(0, 0, 0, boardH);
    if (highContrast) {
      tg.addColorStop(0, '#c3d0ff');
      tg.addColorStop(0.5, '#96a8ef');
      tg.addColorStop(1, '#7285cc');
    } else {
      tg.addColorStop(0, '#6a7aba');
      tg.addColorStop(0.5, '#4e5b98');
      tg.addColorStop(1, '#343f70');
    }
    g.fillStyle = tg;
    g.fill();

    g.save();
    wallPath(0);
    g.clip();
    var rg = g.createRadialGradient(
      boardW * 0.22, -boardH * 0.1, 0,
      boardW * 0.32, boardH * 0.28, Math.max(boardW, boardH) * 0.85
    );
    rg.addColorStop(0, 'rgba(226, 238, 255, 0.15)');
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, boardW, boardH);

    walls.forEach(function (key) {
      var p = key.split(',');
      var x = +p[0];
      var y = +p[1];
      var px = x * t;
      var py = y * t;
      for (var k = 0; k < 2; k++) {
        var hx = hash2(x * 7 + k * 17, y * 5 + k * 29);
        var hy = hash2(y * 13 + k * 11, x * 3 + k * 7);
        var ha = hash2(x * 5 + k, y * 17 + k);
        g.fillStyle = ha > 0.5 ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.06)';
        g.beginPath();
        g.arc(px + hx * t, py + hy * t, Math.max(0.6, t * (0.006 + ha * 0.006)), 0, Math.PI * 2);
        g.fill();
      }
    });
    g.restore();

    g.lineCap = 'butt';
    g.strokeStyle = highContrast ? 'rgba(255, 255, 255, 0.92)' : 'rgba(214, 229, 255, 0.46)';
    g.lineWidth = Math.max(1, t * (highContrast ? 0.05 : 0.032));
    g.beginPath();
    walls.forEach(function (key) {
      var p = key.split(',');
      var x = +p[0];
      var y = +p[1];
      var px = x * t;
      var py = y * t;
      var n = walls.has(K(x, y - 1));
      var e = walls.has(K(x + 1, y));
      var s = walls.has(K(x, y + 1));
      var w = walls.has(K(x - 1, y));
      var rtl = (!n && !w) ? r : 0;
      var rtr = (!n && !e) ? r : 0;
      var rbr = (!s && !e) ? r : 0;
      var rbl = (!s && !w) ? r : 0;
      if (!n) {
        g.moveTo(px + rtl, py + 0.75);
        g.lineTo(px + t - rtr, py + 0.75);
      }
      if (!w) {
        g.moveTo(px + 0.75, py + rtl);
        g.lineTo(px + 0.75, py + t - rbl);
      }
    });
    g.stroke();

    g.strokeStyle = 'rgba(6, 9, 20, 0.5)';
    g.lineWidth = Math.max(1, t * 0.028);
    g.beginPath();
    walls.forEach(function (key) {
      var p = key.split(',');
      var x = +p[0];
      var y = +p[1];
      var px = x * t;
      var py = y * t;
      var e = walls.has(K(x + 1, y));
      var s = walls.has(K(x, y + 1));
      var w = walls.has(K(x - 1, y));
      var n = walls.has(K(x, y - 1));
      var rbr = (!s && !e) ? r : 0;
      var rbl = (!s && !w) ? r : 0;
      var rtr = (!n && !e) ? r : 0;
      if (!s) {
        g.moveTo(px + rbl, py + t - 0.75);
        g.lineTo(px + t - rbr, py + t - 0.75);
      }
      if (!e) {
        g.moveTo(px + t - 0.75, py + rtr);
        g.lineTo(px + t - 0.75, py + t - rbr);
      }
    });
    g.stroke();
  }

  function drawCrate(cx, cy, size, onGoal, tile, squash) {
    ctx.save();

    // Ombra proiettata sotto la cassa
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(cx + size * 0.1, cy + size * 0.45, size * 0.48, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    var x = cx - size / 2;
    var y = cy - size / 2;
    var r = size * 0.16;

    var g = ctx.createLinearGradient(x, y, x, y + size);
    if (onGoal) {
      g.addColorStop(0, '#ffe6a3');
      g.addColorStop(0.5, '#ffcf6b');
      g.addColorStop(1, '#e2a52f');
      ctx.shadowColor = 'rgba(255, 200, 90, 0.75)';
      ctx.shadowBlur = tile * 0.5;
    } else {
      g.addColorStop(0, highContrast ? '#ffcf8a' : '#d99a5b');
      g.addColorStop(0.55, highContrast ? '#e39a52' : '#b9763b');
      g.addColorStop(1, highContrast ? '#b46a28' : '#8f5527');
      // Venature legno procedurale sulle casse
      g.addColorStop(0.2, '#c4834a');
      g.addColorStop(0.4, '#b5743a');
      g.addColorStop(0.6, '#a6652b');
      g.addColorStop(0.8, '#97561c');
    }

    rr(x, y, size, size, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = onGoal ? 'rgba(120, 75, 0, 0.6)' : 'rgba(70, 38, 12, 0.65)';
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.stroke();

    var inset = size * 0.16;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.lineWidth = Math.max(1, size * 0.035);
    rr(x + inset, y + inset, size - inset * 2, size - inset * 2, size * 0.09);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.beginPath();
    ctx.moveTo(x + inset, y + size * 0.34);
    ctx.lineTo(x + size - inset, y + size * 0.34);
    ctx.moveTo(x + inset, y + size * 0.66);
    ctx.lineTo(x + size - inset, y + size * 0.66);
    ctx.stroke();

    if (size > 15) {
      ctx.strokeStyle = onGoal ? 'rgba(120, 80, 10, 0.18)' : 'rgba(60, 30, 8, 0.2)';
      ctx.lineWidth = Math.max(1, size * 0.016);
      for (var gi = 0; gi < 2; gi++) {
        var gy = y + size * (0.24 + gi * 0.52);
        ctx.beginPath();
        ctx.moveTo(x + inset * 1.15, gy);
        ctx.bezierCurveTo(
          x + size * 0.34, gy - size * 0.035,
          x + size * 0.64, gy + size * 0.04,
          x + size - inset * 1.15, gy
        );
        ctx.stroke();
      }

      var cap = size * 0.16;
      var corners = [[inset, inset], [size - inset, inset], [inset, size - inset], [size - inset, size - inset]];
      ctx.fillStyle = onGoal ? 'rgba(92, 62, 12, 0.45)' : 'rgba(48, 31, 17, 0.5)';
      ctx.strokeStyle = 'rgba(255, 232, 195, 0.12)';
      ctx.lineWidth = 1;
      corners.forEach(function (pos) {
        var bx = x + pos[0] - cap / 2;
        var by = y + pos[1] - cap / 2;
        rr(bx, by, cap, cap, cap * 0.28);
        ctx.fill();
        ctx.stroke();
      });

      ctx.fillStyle = 'rgba(255, 232, 200, 0.22)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = Math.max(1, size * 0.012);
      ctx.beginPath();
      ctx.moveTo(x + size * 0.22, y + size * 0.28);
      ctx.lineTo(x + size * 0.28, y + size * 0.28);
      ctx.lineTo(x + size * 0.28, y + size * 0.34);
      ctx.lineTo(x + size * 0.22, y + size * 0.34);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + size * 0.72, y + size * 0.28);
      ctx.lineTo(x + size * 0.78, y + size * 0.28);
      ctx.lineTo(x + size * 0.78, y + size * 0.34);
      ctx.lineTo(x + size * 0.72, y + size * 0.34);
      ctx.stroke();

      // Angoli metallici sulle casse
      var metalGrad = ctx.createLinearGradient(x, y, x + size, y);
      metalGrad.addColorStop(0, 'rgba(180, 190, 210, 0.28)');
      metalGrad.addColorStop(0.5, 'rgba(200, 210, 230, 0.42)');
      metalGrad.addColorStop(1, 'rgba(180, 190, 210, 0.28)');
      ctx.fillStyle = metalGrad;
      corners.forEach(function (pos) {
        var mx = x + pos[0] - cap * 0.35;
        var my = y + pos[1] - cap * 0.35;
        rr(mx, my, cap * 0.7, cap * 0.7, cap * 0.25);
        ctx.fill();
        ctx.strokeStyle = 'rgba(220, 230, 250, 0.35)';
        ctx.lineWidth = Math.max(1, size * 0.008);
        ctx.stroke();
      });
    }

    ctx.restore();
  }

  function drawBoxes() {
    var tile = layout.tile;
    var t = Date.now() * 0.0015;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var cx = layout.ox + (b.vx + 0.5) * tile;
      var cy = layout.oy + (b.vy + 0.5) * tile;
      var pulseScale = 1 + 0.08 * b.pulse;
      var sq = b.squash || 0;
      var sqVisual = Math.max(0, sq * (1 - Math.sin(t * 8) * 0.3));

      ctx.save();
      if (sqVisual > 0.001) {
        var ang = b.ang || 0;
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.scale(1 - 0.08 * sqVisual, 1 + 0.05 * sqVisual);
        ctx.rotate(-ang);
        ctx.translate(-cx, -cy);
      }
      drawCrate(cx, cy, tile * 0.72 * pulseScale, goals.has(K(b.x, b.y)), tile, sqVisual);
      ctx.restore();
    }
  }

  function getPlayerPose(t) {
    var tile = layout.tile;
    var s = tile * 0.88;
    var dir = DIRS[player.dir] || DIRS[2];
    var bumpDir = DIRS[player.bumpDir] || DIRS[2];
    var bumpOff = Math.sin(player.bump * Math.PI * 5) * tile * 0.06 * player.bump;
    var bob = reduceMotion ? 0 : Math.sin(t * 0.004) * tile * 0.015;
    var cx = layout.ox + (player.vx + 0.5) * tile + bumpOff * bumpDir.x;
    var cy = layout.oy + (player.vy + 0.5) * tile + bob + bumpOff * bumpDir.y;
    var ax = player.x + dir.x;
    var ay = player.y + dir.y;
    var blocked = ax < 0 || ay < 0 || ax >= level.w || ay >= level.h || walls.has(K(ax, ay));
    var speed = Math.abs(player.x - player.vx) + Math.abs(player.y - player.vy);
    return {
      s: s,
      cx: cx,
      cy: cy,
      ang: Math.atan2(dir.y, dir.x),
      blocked: blocked,
      moving: Math.min(1, speed * 3)
    };
  }

  function drawPlayerShadow(p) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(p.cx + p.s * 0.1, p.cy + p.s * 0.22, p.s * 0.5, p.s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayerForks(p) {
    var s = p.s;
    var len = p.blocked ? s * 0.48 : s * 0.8;
    var fw = s * 0.075;
    var grad = ctx.createLinearGradient(0, -s * 0.18, 0, s * 0.18);
    grad.addColorStop(0, '#d2e0f2');
    grad.addColorStop(0.5, '#93a9c8');
    grad.addColorStop(1, '#5c7397');

    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(p.ang);

    [-1, 1].forEach(function (side) {
      var y = side * s * 0.12;

      ctx.fillStyle = '#171d2b';
      ctx.beginPath();
      ctx.arc(len - s * 0.03, y + side * s * 0.025, s * 0.052, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#54627f';
      ctx.lineWidth = Math.max(1, s * 0.014);
      ctx.stroke();

      rr(s * 0.21, y - fw / 2, len - s * 0.21, fw, fw / 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(8, 16, 32, 0.6)';
      ctx.lineWidth = Math.max(1, s * 0.016);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.lineWidth = Math.max(1, fw * 0.2);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.26, y - fw * 0.16);
      ctx.lineTo(len - fw * 0.7, y - fw * 0.16);
      ctx.stroke();
    });

    ctx.strokeStyle = 'rgba(40, 52, 74, 0.8)';
    ctx.lineWidth = Math.max(1, s * 0.028);
    ctx.beginPath();
    ctx.moveTo(s * 0.24, -s * 0.12);
    ctx.lineTo(s * 0.24, s * 0.12);
    ctx.stroke();

    ctx.restore();
  }

  function drawPlayerBoot(x, y, s) {
    rr(x - s * 0.095, y - s * 0.055, s * 0.19, s * 0.11, s * 0.045);
    ctx.fillStyle = '#242936';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawPlayerFigure(p, t) {
    var s = p.s;

    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(p.ang);

    var stride = reduceMotion ? 0 : Math.sin(t * 0.02) * s * 0.055 * p.moving;
    drawPlayerBoot(-s * 0.17 + stride, -s * 0.105, s);
    drawPlayerBoot(-s * 0.17 - stride, s * 0.105, s);

    var skin = '#eab68c';
    var skinEdge = 'rgba(70, 40, 20, 0.55)';

    [-1, 1].forEach(function (side) {
      ctx.strokeStyle = '#3a7d91';
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.02, side * s * 0.2);
      ctx.quadraticCurveTo(s * 0.2, side * s * 0.19, s * 0.29, side * s * 0.15);
      ctx.stroke();

      ctx.strokeStyle = skin;
      ctx.lineWidth = s * 0.065;
      ctx.beginPath();
      ctx.moveTo(s * 0.26, side * s * 0.16);
      ctx.lineTo(s * 0.35, side * s * 0.135);
      ctx.stroke();
    });

    var jacket = ctx.createLinearGradient(0, -s * 0.23, 0, s * 0.23);
    jacket.addColorStop(0, '#3a7f93');
    jacket.addColorStop(1, '#1e4c5e');

    rr(-s * 0.18, -s * 0.23, s * 0.31, s * 0.46, s * 0.14);
    ctx.fillStyle = jacket;
    ctx.fill();
    ctx.strokeStyle = 'rgba(4, 10, 22, 0.55)';
    ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.stroke();

    var vest = ctx.createLinearGradient(0, -s * 0.19, 0, s * 0.19);
    vest.addColorStop(0, '#dff56e');
    vest.addColorStop(0.5, '#c6e64f');
    vest.addColorStop(1, '#a2c530');
    rr(-s * 0.16, -s * 0.19, s * 0.26, s * 0.38, s * 0.11);
    ctx.fillStyle = vest;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 46, 8, 0.45)';
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(240, 252, 255, 0.72)';
    ctx.lineWidth = Math.max(1, s * 0.024);
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, side * s * 0.115);
      ctx.lineTo(s * 0.07, side * s * 0.115);
      ctx.stroke();
    });

    var steel = ctx.createLinearGradient(0, -s * 0.14, 0, s * 0.14);
    steel.addColorStop(0, '#b5c8e0');
    steel.addColorStop(1, '#5a7094');
    rr(s * 0.215, -s * 0.11, s * 0.13, s * 0.22, s * 0.04);
    ctx.fillStyle = steel;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8, 16, 32, 0.6)';
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.stroke();

    var carriage = ctx.createLinearGradient(0, -s * 0.16, 0, s * 0.16);
    carriage.addColorStop(0, '#c4d4e8');
    carriage.addColorStop(1, '#6c82a2');
    rr(s * 0.285, -s * 0.165, s * 0.05, s * 0.33, s * 0.02);
    ctx.fillStyle = carriage;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8, 16, 32, 0.55)';
    ctx.lineWidth = Math.max(1, s * 0.014);
    ctx.stroke();

    [-1, 1].forEach(function (side) {
      ctx.fillStyle = '#1c2331';
      ctx.beginPath();
      ctx.arc(s * 0.215, side * s * 0.195, s * 0.048, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#67748c';
      ctx.lineWidth = Math.max(1, s * 0.015);
      ctx.stroke();
    });

    ctx.strokeStyle = 'rgba(20, 26, 40, 0.7)';
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.345, -s * 0.19);
    ctx.lineTo(s * 0.345, s * 0.19);
    ctx.stroke();

    ctx.strokeStyle = '#f2a33c';
    ctx.lineWidth = s * 0.058;
    ctx.beginPath();
    ctx.moveTo(s * 0.345, -s * 0.185);
    ctx.lineTo(s * 0.345, s * 0.185);
    ctx.stroke();

    [-1, 1].forEach(function (side) {
      ctx.fillStyle = '#242a38';
      ctx.beginPath();
      ctx.arc(s * 0.345, side * s * 0.185, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
    });

    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.arc(s * 0.345, side * s * 0.135, s * 0.055, 0, Math.PI * 2);
      ctx.fillStyle = skin;
      ctx.fill();
      ctx.strokeStyle = skinEdge;
      ctx.lineWidth = Math.max(1, s * 0.015);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.ellipse(s * 0.13, 0, s * 0.1, s * 0.115, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.strokeStyle = skinEdge;
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.stroke();

    var brim = ctx.createLinearGradient(0, -s * 0.16, 0, s * 0.16);
    brim.addColorStop(0, '#5a452f');
    brim.addColorStop(1, '#372a1c');
    ctx.beginPath();
    ctx.ellipse(s * 0.07, 0, s * 0.105, s * 0.148, 0, 0, Math.PI * 2);
    ctx.fillStyle = brim;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(s * 0.225, 0, s * 0.032, 0, Math.PI * 2);
    ctx.fillStyle = '#e0a97e';
    ctx.fill();

    var crown = ctx.createLinearGradient(0, -s * 0.12, 0, s * 0.12);
    crown.addColorStop(0, '#8a6746');
    crown.addColorStop(1, '#5a422c');
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.08, s * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = crown;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = Math.max(1, s * 0.014);
    ctx.stroke();

    ctx.strokeStyle = '#b07a45';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.068, s * 0.098, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 236, 210, 0.35)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.065, Math.PI * 1.1, Math.PI * 1.65);
    ctx.stroke();

    ctx.fillStyle = '#3b2d1f';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.018, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawDustMarks(t) {
    var tile = layout.tile;
    var dustAlpha = 0.12 + 0.18 * Math.sin(t * 0.0025);
    
    for (var i = 0; i < Math.min(10, Math.floor(player.bump / 8)); i++) {
      var angle = (i / 10) * Math.PI * 2;
      var dist = (i % 2 === 0) ? tile * 0.45 : tile * 0.28;
      var px = layout.ox + (player.vx + 0.5) * tile + Math.cos(angle) * dist;
      var py = layout.oy + (player.vy + 0.5) * tile + Math.sin(angle) * dist;
      var s = tile * 0.08;
      
      ctx.fillStyle = 'rgba(160, 170, 190, ' + dustAlpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var alpha = Math.max(0, Math.min(1, p.life / 0.4));
      ctx.fillStyle = 'hsla(' + p.hue + ', ' + (p.sat == null ? 100 : p.sat) + '%, ' + (p.light == null ? 70 : p.light) + '%, ' + alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLighting() {
    var lg = ctx.createRadialGradient(
      view.w * 0.18, view.h * 0.08, 0,
      view.w * 0.3, view.h * 0.2, Math.max(view.w, view.h) * 0.95
    );
    lg.addColorStop(0, 'rgba(150, 190, 255, 0.055)');
    lg.addColorStop(0.45, 'rgba(0, 0, 0, 0)');
    lg.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  function drawGhosts() {
    if (!trail.length) return;
    var tile = layout.tile;
    var base = highContrast ? 0.3 : 0.18;
    ctx.save();
    for (var i = 0; i < trail.length; i++) {
      var g = trail[i];
      var alpha = reduceMotion ? base * 0.6 : base * (0.45 + 0.55 * (i + 1) / trail.length);
      ctx.fillStyle = 'rgba(170, 200, 255, ' + alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(
        layout.ox + (g.x + 0.5) * tile,
        layout.oy + (g.y + 0.5) * tile + tile * 0.22,
        tile * 0.19, tile * 0.09, 0, 0, Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  function render(t) {
    ctx.clearRect(0, 0, view.w, view.h);
    drawBackground();
    if (!level.w) return;

    var sx = 0;
    var sy = 0;
    if (shake > 0.001) {
      sx = Math.sin(t * 0.05) * shake * 5;
      sy = Math.cos(t * 0.065) * shake * 4;
    }

    ctx.save();
    ctx.translate(sx, sy);

    drawBoard();
    if (staticDirty) buildStaticBoard();
    if (staticBoard) {
      ctx.drawImage(
        staticBoard,
        layout.ox, layout.oy,
        level.w * layout.tile, level.h * layout.tile
      );
    }
    drawGoals(t);
    drawGhosts();

    var pose = getPlayerPose(t);
    drawPlayerShadow(pose);
    drawPlayerForks(pose);
    drawBoxes();
    drawPlayerFigure(pose, t);
    drawDustMarks(t);
    drawParticles();

    ctx.restore();
    drawLighting();
  }

  /* ---------------------------------------------------------------- loop */

  function update(dt, t) {
    var k = 1 - Math.exp(-dt * 13);

    player.vx += (player.x - player.vx) * k;
    player.vy += (player.y - player.vy) * k;
    if (Math.abs(player.x - player.vx) < 0.001) player.vx = player.x;
    if (Math.abs(player.y - player.vy) < 0.001) player.vy = player.y;

    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      b.vx += (b.x - b.vx) * k;
      b.vy += (b.y - b.vy) * k;
      if (Math.abs(b.x - b.vx) < 0.001) b.vx = b.x;
      if (Math.abs(b.y - b.vy) < 0.001) b.vy = b.y;
      if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt * 2.5);
      if (b.squash > 0) b.squash = Math.max(0, b.squash - dt * 5.5);
    }

    for (var j = particles.length - 1; j >= 0; j--) {
      var p = particles[j];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(j, 1); continue; }
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 0.6 * dt;
    }

    if (player.bump > 0) player.bump = Math.max(0, player.bump - dt * 3.5);
    if (shake > 0) shake = Math.max(0, shake - dt * 1.8);

    if (started) {
      elapsed = performance.now() - startTs;
      if (t - lastTimerPaint > 160) {
        lastTimerPaint = t;
        $('statTime').textContent = fmtTime(elapsed);
      }
    }
  }

  var lastFrame = 0;

  function frame(t) {
    if (!lastFrame) lastFrame = t;
    var dt = Math.min(0.05, (t - lastFrame) / 1000);
    lastFrame = t;
    update(dt, t);
    checkIdleRage();
    render(t);
    window.requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------------- input */

  function onKey(e) {
    var key = e.key.toLowerCase();
    var handled = true;

    if (rage.open) {
      if (key === 'escape') closeRage();
      e.preventDefault();
      return;
    }

    if (key === 'arrowup' || key === 'w') {
      if (!levelsOpen()) tryMove(0);
    } else if (key === 'arrowright' || key === 'd') {
      if (!levelsOpen()) tryMove(1);
    } else if (key === 'arrowdown' || key === 's') {
      if (!levelsOpen()) tryMove(2);
    } else if (key === 'arrowleft' || key === 'a') {
      if (!levelsOpen()) tryMove(3);
    } else if (key === 'z' || key === 'u') {
      undo();
    } else if (key === 'y') {
      redo();
    } else if (key === 'r') {
      requestRestart();
      sfx.ui();
    } else if (key === 'p') {
      if (!menuOpen) togglePause();
    } else if (key === 'l') {
      if (!menuOpen) { toggleLevels(); sfx.ui(); }
    } else if (key === 'f') {
      toggleFullscreen();
    } else if (key === 'm') {
      toggleSound();
    } else if (key === 'n') {
      if (won) nextLevel();
    } else if (key === 'escape') {
      if (!$('confirmOverlay').classList.contains('hidden')) {
        closeConfirm();
      } else if (!$('pauseOverlay').classList.contains('hidden')) {
        resumeGame();
      } else if (levelsOpen()) {
        closeOverlays();
      } else {
        showMenu(false);
      }
    } else {
      handled = false;
    }

    if (handled) e.preventDefault();
  }

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    sfx.init();
    if (e.key === 'Tab') { trapTab(e); return; }
    onKey(e);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !levelsOpen()) pauseGame();
  });

  window.addEventListener('pointerdown', function () { sfx.init(); }, { passive: true });

  /* swipe */
  var swipeStart = null;
  canvas.addEventListener('pointerdown', function (e) {
    swipeStart = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', function (e) {
    if (!swipeStart) return;
    var dx = e.clientX - swipeStart.x;
    var dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      tryMove(dx > 0 ? 1 : 3);
    } else {
      tryMove(dy > 0 ? 2 : 0);
    }
  });

  canvas.addEventListener('pointercancel', function () { swipeStart = null; });

  /* touch pad */
  var tbuttons = document.querySelectorAll('.tbtn');
  for (var i = 0; i < tbuttons.length; i++) {
    tbuttons[i].addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (!levelsOpen()) tryMove(+this.getAttribute('data-dir'));
    });
  }

  /* buttons */
  $('btnUndo').addEventListener('click', function () { sfx.ui(); undo(); });
  $('btnRedo').addEventListener('click', function () { sfx.ui(); redo(); });
  $('btnRestart').addEventListener('click', function () { sfx.ui(); requestRestart(); });
  $('btnLevels').addEventListener('click', function () { sfx.ui(); toggleLevels(); });
  $('btnPause').addEventListener('click', function () { sfx.ui(); togglePause(); });
  $('btnRage').addEventListener('click', openRage);
  $('btnRageDone').addEventListener('click', function () { closeRage(); });
  $('btnRageClose').addEventListener('click', function () { closeRage(); });
  $('btnSound').addEventListener('click', toggleSound);

  $('btnConfirmRestart').addEventListener('click', function () {
    sfx.ui();
    closeConfirm();
    loadLevel(levelIndex);
  });
  $('btnConfirmCancel').addEventListener('click', function () { sfx.ui(); closeConfirm(); });

  $('btnResume').addEventListener('click', function () { sfx.ui(); resumeGame(); });
  $('btnPauseRestart').addEventListener('click', function () { sfx.ui(); loadLevel(levelIndex); });
  $('btnPauseLevels').addEventListener('click', function () { sfx.ui(); toggleLevels(); });

  $('btnReplay').addEventListener('click', function () { sfx.ui(); loadLevel(levelIndex); });
  $('btnNext').addEventListener('click', function () { sfx.ui(); nextLevel(); });
  $('btnWinLevels').addEventListener('click', function () { sfx.ui(); toggleLevels(); });
  $('btnCloseLevels').addEventListener('click', function () { sfx.ui(); toggleLevels(); });

  /* menu e impostazioni */
  $('btnContinue').addEventListener('click', function () { sfx.ui(); closeMenu(); });
  $('btnMenuLevels').addEventListener('click', function () {
    sfx.ui();
    levelsFromMenu = true;
    closeMenu();
    toggleLevels();
  });
  $('btnMenuSettings').addEventListener('click', function () { sfx.ui(); showMenu(true); });
  $('btnSettingsBack').addEventListener('click', function () { sfx.ui(); showMenu(false); });

  $('setVolume').addEventListener('input', function () {
    save.volume = Math.max(0, Math.min(1, (+this.value) / 100));
    persist();
    syncSettingsUi();
  });
  $('setVolume').addEventListener('change', function () { sfx.ui(); });

  $('setMotion').addEventListener('change', function () {
    save.motion = this.checked ? 'reduce' : 'auto';
    reduceMotion = save.motion === 'reduce' || (save.motion !== 'full' && osReduce);
    persist();
    syncSettingsUi();
    sfx.ui();
  });

  $('setHaptics').addEventListener('change', function () {
    save.haptics = this.checked;
    persist();
    syncSettingsUi();
    if (save.haptics) buzz([40, 60, 40]);
  });

  $('setContrast').addEventListener('change', function () {
    save.contrast = this.checked;
    highContrast = !!save.contrast;
    applyLookPrefs();
    staticDirty = true;
    if (level.w) buildStaticBoard();
    persist();
    syncSettingsUi();
    sfx.ui();
  });

  $('setPadSize').addEventListener('change', function () {
    save.padSize = this.value;
    applyLookPrefs();
    if (level.w) computeLayout();
    persist();
    sfx.ui();
  });

  $('setPadSide').addEventListener('change', function () {
    save.padSide = this.value;
    applyLookPrefs();
    if (level.w) computeLayout();
    persist();
    sfx.ui();
  });

  $('btnFull').addEventListener('click', function () { sfx.ui(); toggleFullscreen(); });
  $('btnSettingsFull').addEventListener('click', function () { sfx.ui(); toggleFullscreen(); });
  document.addEventListener('fullscreenchange', syncFullscreenUi);
  document.addEventListener('webkitfullscreenchange', syncFullscreenUi);

  window.addEventListener('resize', function () {
    resize();
    if (rage.open) rageResize();
  });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

  /* ---------------------------------------------------------------- init */

  if (!LEVELS.length) {
    $('statLevel').textContent = '—';
    return;
  }

  updateSoundButton();
  applyLookPrefs();
  syncSettingsUi();
  syncFullscreenUi();
  resize();
  loadLevel(levelIndex);
  resize();
  showMenu(false);
  window.requestAnimationFrame(frame);

  // La PWA funziona solo se servita via http(s); con file:// si gioca comunque offline.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
