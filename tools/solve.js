'use strict';

// Spinga — solutore offline dei livelli, senza dipendenze.
//
// Calcola per ogni livello un "par" di spinte: il numero di spinte con cui il
// livello si risolve. Il par alimenta le stelle in gioco (par.js).
//
// Due metodi, scelti automaticamente livello per livello:
//   - A* esatto (par minimo dimostrato) quando chiude entro il budget;
//   - beam search guidata dall'euristica per i livelli grandi, che produce un par
//     di riferimento (una soluzione valida, non necessariamente la più corta).
// Il Sokoban è PSPACE-completo: i livelli con 20-34 casse non hanno speranza di
// una prova di ottimalità in tempi umani, quindi il par dichiara la sua origine.
//
// Uso:
//   node tools/solve.js            tabella completa (A* dove possibile, beam altrove)
//   node tools/solve.js --write    riscrive par.js
//   node tools/solve.js --only 7   solo il livello 7 (1-based)
//   node tools/solve.js --exact    forza solo A* (diagnosi; può non chiudere)
//   node tools/solve.js --map 2    stampa la mappa con le celle morte (x)
//   node tools/solve.js --stats    casse, target e griglia di ogni livello
//
// Ambiente: MAX_MS (budget per ricerca), MAX_STATES (A*), BEAM (ampiezza beam).
//
// Modello: si espandono le spinte, non i singoli passi. Le celle da cui una cassa
// non può più raggiungere un target (BFS inversa sul grafo delle spinte) e le
// configurazioni con una cassa congelata fuori da un target sono escluse a priori.
// L'euristica è l'assegnamento ottimo casse→target sulle distanze in spinte.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const INF = 32000;
const MATCH_LIMIT = 10;
const MAX_STATES = Number(process.env.MAX_STATES || 1500000);
const MAX_MS = Number(process.env.MAX_MS || 10000);
const BEAM = Number(process.env.BEAM || 1500);
// Interruttori di diagnosi: servono a distinguere un livello irrisolvibile da un
// pruning troppo aggressivo.
const NO_DEAD = process.env.NO_DEAD === '1';
const NO_FREEZE = process.env.NO_FREEZE === '1';
const DEBUG = process.env.DEBUG === '1';
const PLAN_DEBUG = process.env.PLAN_DEBUG === '1';

/* ---------------------------------------------------------------- livelli */

function loadLevels() {
  const src = fs.readFileSync(path.join(ROOT, 'levels.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'levels.js' });
  const levels = sandbox.window.LEVELS;
  if (!Array.isArray(levels)) throw new Error('levels.js non espone window.LEVELS');
  return levels;
}

function parse(rows) {
  const h = rows.length;
  let w = 0;
  for (const row of rows) w = Math.max(w, row.length);
  const wall = new Uint8Array(w * h);
  const goals = [];
  const boxes = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < w; x++) {
      const c = row.charAt(x) || ' ';
      const i = y * w + x;
      if (c === '#') { wall[i] = 1; continue; }
      if (c === '.' || c === '*' || c === '+') goals.push(i);
      if (c === '$' || c === '*') boxes.push(i);
      if (c === '@' || c === '+') player = i;
    }
  }
  return { w, h, wall, goals, boxes, player };
}

/* ---------------------------------------------------------------- utili */

// BFS inversa sul grafo delle spinte: dist[cell] = spinte minime per portare una
// cassa da `cell` al target `goal`, ignorando le altre casse. È un limite inferiore,
// quindi l'euristica che ne deriva resta ammissibile.
function reversePushDist(level, goal) {
  const { w, h, wall } = level;
  const dist = new Int16Array(w * h).fill(INF);
  const queue = [goal];
  dist[goal] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const b = queue[qi];
    const bx = b % w;
    const by = (b - bx) / w;
    const d = dist[b] + 1;
    for (let k = 0; k < 4; k++) {
      const dx = DIRS[k][0];
      const dy = DIRS[k][1];
      const ax = bx - dx;
      const ay = by - dy;
      const sx = bx - 2 * dx;
      const sy = by - 2 * dy;
      if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const a = ay * w + ax;
      const s = sy * w + sx;
      if (wall[a] || wall[s]) continue;
      if (dist[a] <= d) continue;
      dist[a] = d;
      queue.push(a);
    }
  }
  return dist;
}

function nearestGoalDist(perGoal) {
  const dist = new Int16Array(perGoal[0].length).fill(INF);
  for (const one of perGoal) {
    for (let i = 0; i < one.length; i++) if (one[i] < dist[i]) dist[i] = one[i];
  }
  return dist;
}

// Euristica: assegnamento ottimo casse→target sulle distanze in spinte. Con pochi
// target si risolve con una DP sui sottoinsiemi (2^target); oltre la soglia si usa
// la somma delle distanze minime, più debole ma lineare.
function makeHeuristic(perGoal) {
  const G = perGoal.length;
  if (!G) return function () { return 0; };

  if (G > MATCH_LIMIT) {
    const nearest = nearestGoalDist(perGoal);
    return function (boxes) {
      let sum = 0;
      for (let i = 0; i < boxes.length; i++) sum += nearest[boxes[i]];
      return sum;
    };
  }

  const size = 1 << G;
  const bits = new Uint8Array(size);
  for (let m = 1; m < size; m++) bits[m] = bits[m >> 1] + (m & 1);
  const dp = new Int32Array(size);

  return function (boxes) {
    dp.fill(INF);
    dp[0] = 0;
    for (let mask = 0; mask < size; mask++) {
      const i = bits[mask];
      const cur = dp[mask];
      if (cur >= INF || i >= boxes.length) continue;
      const cell = boxes[i];
      for (let g = 0; g < G; g++) {
        if (mask & (1 << g)) continue;
        const d = perGoal[g][cell];
        if (d >= INF) continue;
        const next = mask | (1 << g);
        if (cur + d < dp[next]) dp[next] = cur + d;
      }
    }
    return dp[size - 1];
  };
}

function heapPush(heap, f, g, data) {
  let i = heap.length;
  heap.push({ f, g, data });
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].f <= heap[i].f) break;
    const t = heap[p];
    heap[p] = heap[i];
    heap[i] = t;
    i = p;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && heap[l].f < heap[m].f) m = l;
      if (r < heap.length && heap[r].f < heap[m].f) m = r;
      if (m === i) break;
      const t = heap[m];
      heap[m] = heap[i];
      heap[i] = t;
      i = m;
    }
  }
  return top;
}

/* --------------------------------------------------------------- contesto */

// Tutto ciò che serve a entrambi i metodi di ricerca per un livello.
function prepare(level) {
  const n = level.w * level.h;
  const goalIndex = new Int8Array(n).fill(-1);
  level.goals.forEach(function (g, i) { goalIndex[g] = i; });
  const perGoal = level.goals.map(function (g) { return reversePushDist(level, g); });
  const nearest = nearestGoalDist(perGoal);
  const heuristic = makeHeuristic(perGoal);
  const hCache = new Map();

  return {
    level: level,
    goalIndex: goalIndex,
    perGoal: perGoal,
    nearest: nearest,
    heuristic: heuristic,
    score: function (boxes) {
      const key = boxes.join(',');
      const hit = hCache.get(key);
      if (hit !== undefined) return hit;
      const value = heuristic(boxes);
      if (hCache.size > 300000) hCache.clear();
      hCache.set(key, value);
      return value;
    }
  };
}

function unsolvableReason(ctx, boxes) {
  for (const b of boxes) {
    if (ctx.nearest[b] >= INF) return 'cassa in cella morta (riga ' + ((b / ctx.level.w) | 0) + ')';
  }
  return null;
}

/* ---------------------------------------------------------------- ricerca */

// A* esatto: par minimo dimostrato. Chiude solo sui livelli piccoli.
function solveExact(ctx) {
  const level = ctx.level;
  const { w, h, wall, goals, player } = level;
  const n = w * h;
  if (level.boxes.length !== goals.length) {
    return { error: 'casse ' + level.boxes.length + ' / target ' + goals.length };
  }
  if (player < 0) return { error: 'giocatore assente' };
  const bad = unsolvableReason(ctx, level.boxes);
  if (bad) return { error: bad };
  const goalIndex = ctx.goalIndex;
  const nearest = ctx.nearest;
  const score = ctx.score;

  const solved = function (boxes) {
    for (let i = 0; i < boxes.length; i++) if (goalIndex[boxes[i]] < 0) return false;
    return true;
  };

  const room = new Int32Array(n);
  const walk = new Int16Array(n);
  let roomToken = 0;
  const flood = function (from, boxes) {
    roomToken++;
    const queue = [from];
    room[from] = roomToken;
    walk[from] = 0;
    let min = from;
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      if (c < min) min = c;
      const cx = c % w;
      const cy = (c - cx) / w;
      const d = walk[c];
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0];
        const ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (wall[nb] || room[nb] === roomToken) continue;
        if (boxes.indexOf(nb) >= 0) continue;
        room[nb] = roomToken;
        walk[nb] = d + 1;
        queue.push(nb);
      }
    }
    return min;
  };

  const immovable = new Uint8Array(n);
  const deadlocked = function (boxes) {
    immovable.set(wall);
    let changed = true;
    while (changed) {
      changed = false;
      for (let bi = 0; bi < boxes.length; bi++) {
        const b = boxes[bi];
        if (immovable[b]) continue;
        const x = b % w;
        const y = (b - x) / w;
        const up = y === 0 || immovable[b - w];
        const down = y === h - 1 || immovable[b + w];
        const left = x === 0 || immovable[b - 1];
        const right = x === w - 1 || immovable[b + 1];
        if ((up && left) || (up && right) || (down && left) || (down && right)) {
          immovable[b] = 1;
          changed = true;
          if (goalIndex[b] < 0) return true;
        }
      }
    }
    return false;
  };

  const startBoxes = level.boxes.slice().sort(function (a, b) { return a - b; });
  const open = [];
  const seen = new Map();
  const roomSeen = new Map();
  seen.set(player + '|' + startBoxes.join(','), 0);
  heapPush(open, score(startBoxes), 0, { player: player, boxes: startBoxes });

  const t0 = Date.now();
  let expanded = 0;

  while (open.length) {
    const node = heapPop(open);
    const g = node.g;
    const state = node.data;
    if (seen.get(state.player + '|' + state.boxes.join(',')) < g) continue;
    expanded++;
    if (solved(state.boxes)) return { cost: g, exact: true, expanded: expanded, ms: Date.now() - t0 };
    if (expanded > MAX_STATES || Date.now() - t0 > MAX_MS) {
      return { timeout: true, expanded: expanded, ms: Date.now() - t0 };
    }

    const boxes = state.boxes;
    const boxKey = boxes.join(',');
    const minRoom = flood(state.player, boxes);

    // Stesse casse e stessa stanza = stati equivalenti per le spinte: si espande
    // solo quello con meno spinte.
    const roomKey = boxKey + '|' + minRoom;
    const roomG = roomSeen.get(roomKey);
    if (roomG !== undefined && roomG <= g) continue;
    roomSeen.set(roomKey, g);

    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi];
      const bx = b % w;
      const by = (b - bx) / w;
      for (let k = 0; k < 4; k++) {
        const dx = DIRS[k][0];
        const dy = DIRS[k][1];
        const px = bx - dx;
        const py = by - dy;
        const tx = bx + dx;
        const ty = by + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const behind = py * w + px;
        const dest = ty * w + tx;
        if (room[behind] !== roomToken) continue;
        if (wall[dest] || boxes.indexOf(dest) >= 0) continue;
        if (!NO_DEAD && nearest[dest] >= INF) continue;

        const nextBoxes = boxes.slice();
        nextBoxes[bi] = dest;
        nextBoxes.sort(function (a, b) { return a - b; });
        if (!NO_FREEZE && deadlocked(nextBoxes)) continue;

        const nextG = g + 1;
        const key = b + '|' + nextBoxes.join(',');
        const prevG = seen.get(key);
        if (prevG !== undefined && prevG <= nextG) continue;
        seen.set(key, nextG);
        heapPush(open, nextG + score(nextBoxes), nextG, { player: b, boxes: nextBoxes });
      }
    }
  }
  return { error: 'nessuna soluzione', expanded: expanded, ms: Date.now() - t0 };
}

// Beam search sulle spinte: non dimostra l'ottimalità, ma scala ai livelli con
// molte casse. A ogni profondità tiene i BEAM stati più promettenti.
function solveBeam(ctx) {
  const level = ctx.level;
  const { w, h, wall, goals, player } = level;
  const n = w * h;
  if (level.boxes.length !== goals.length) {
    return { error: 'casse ' + level.boxes.length + ' / target ' + goals.length };
  }
  if (player < 0) return { error: 'giocatore assente' };
  const bad = unsolvableReason(ctx, level.boxes);
  if (bad) return { error: bad };
  const goalIndex = ctx.goalIndex;
  const nearest = ctx.nearest;
  const score = ctx.score;

  const solved = function (boxes) {
    let onGoal = 0;
    for (let i = 0; i < boxes.length; i++) if (goalIndex[boxes[i]] >= 0) onGoal++;
    return onGoal === boxes.length;
  };

  const room = new Int32Array(n);
  let roomToken = 0;
  const flood = function (from, boxes) {
    roomToken++;
    const queue = [from];
    room[from] = roomToken;
    let min = from;
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      if (c < min) min = c;
      const cx = c % w;
      const cy = (c - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0];
        const ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (wall[nb] || room[nb] === roomToken) continue;
        if (boxes.indexOf(nb) >= 0) continue;
        room[nb] = roomToken;
        queue.push(nb);
      }
    }
    return min;
  };

  const immovable = new Uint8Array(n);
  const deadlocked = function (boxes) {
    immovable.set(wall);
    let changed = true;
    while (changed) {
      changed = false;
      for (let bi = 0; bi < boxes.length; bi++) {
        const b = boxes[bi];
        if (immovable[b]) continue;
        const x = b % w;
        const y = (b - x) / w;
        const up = y === 0 || immovable[b - w];
        const down = y === h - 1 || immovable[b + w];
        const left = x === 0 || immovable[b - 1];
        const right = x === w - 1 || immovable[b + 1];
        if ((up && left) || (up && right) || (down && left) || (down && right)) {
          immovable[b] = 1;
          changed = true;
          if (goalIndex[b] < 0) return true;
        }
      }
    }
    return false;
  };

  const t0 = Date.now();
  let beam = [{ player: player, boxes: level.boxes.slice().sort(function (a, b) { return a - b; }) }];
  // Solo gli ultimi livelli di profondità sono "visti": vietare per sempre uno
  // stato già incontrato farebbe collassare la beam, che non potrebbe più
  // recuperare gli stati che ha scartato.
  const recent = [];
  let evaluated = 0;
  let deadReject = 0;
  let freezeReject = 0;

  for (let depth = 1; depth <= 800; depth++) {
    const candidates = new Map();
    const deadBefore = deadReject;
    const freezeBefore = freezeReject;
    for (let si = 0; si < beam.length; si++) {
      const state = beam[si];
      const boxes = state.boxes;
      flood(state.player, boxes);
      for (let bi = 0; bi < boxes.length; bi++) {
        const b = boxes[bi];
        const bx = b % w;
        const by = (b - bx) / w;
        for (let k = 0; k < 4; k++) {
          const dx = DIRS[k][0];
          const dy = DIRS[k][1];
          const px = bx - dx;
          const py = by - dy;
          const tx = bx + dx;
          const ty = by + dy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          const behind = py * w + px;
          const dest = ty * w + tx;
          if (room[behind] !== roomToken) continue;
          if (wall[dest] || boxes.indexOf(dest) >= 0) continue;
          if (!NO_DEAD && nearest[dest] >= INF) { deadReject++; continue; }

          const nextBoxes = boxes.slice();
          nextBoxes[bi] = dest;
          nextBoxes.sort(function (a, b) { return a - b; });
          if (!NO_FREEZE && deadlocked(nextBoxes)) { freezeReject++; continue; }

          evaluated++;
          if (solved(nextBoxes)) {
            return { cost: depth, exact: false, expanded: evaluated, ms: Date.now() - t0 };
          }
          const key = b + '|' + nextBoxes.join(',');
          if (candidates.has(key) || inRecent(key)) continue;
          candidates.set(key, { key: key, player: b, boxes: nextBoxes, h: score(nextBoxes) });
        }
      }
    }
    if (DEBUG) {
      console.log('  depth ' + depth + ' beam ' + beam.length + ' cand ' + candidates.size +
        ' dead ' + (deadReject - deadBefore) + ' freeze ' + (freezeReject - freezeBefore) +
        ' recent ' + recent.length);
    }
    if (!candidates.size) {
      return { error: 'beam esaurita senza soluzione', expanded: evaluated, ms: Date.now() - t0 };
    }
    const ranked = Array.from(candidates.values());
    ranked.sort(function (a, b) { return a.h - b.h; });
    beam = ranked.slice(0, BEAM);
    const fresh = new Set();
    for (let bi = 0; bi < beam.length; bi++) fresh.add(beam[bi].key);
    recent.push(fresh);
    if (recent.length > 30) recent.shift();
    if (Date.now() - t0 > MAX_MS) {
      return { timeout: true, expanded: evaluated, ms: Date.now() - t0 };
    }
  }

  return { error: 'beam oltre la profondità massima', expanded: evaluated, ms: Date.now() - t0 };

  function inRecent(key) {
    for (let i = 0; i < recent.length; i++) if (recent[i].has(key)) return true;
    return false;
  }
}

/* ---------------------------------------------------------------- greedy */

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Piano di spinte per una singola cassa: il minor numero di spinte per portarla
// su un target libero, con le altre casse come ostacoli fissi. BFS a strati sul
// numero di spinte; il giocatore è canonicalizzato alla stanza, quindi conta solo
// la raggiungibilità. Restituisce la sequenza di spinte e la posizione finale.
function planBox(ctx, boxes, bi, player) {
  const level = ctx.level;
  const { w, h, wall } = level;
  const goalIndex = ctx.goalIndex;
  const n = w * h;
  const boxCell = boxes[bi];
  const occupied = new Uint8Array(n);
  for (let i = 0; i < boxes.length; i++) if (i !== bi) occupied[boxes[i]] = 1;

  const room = new Int32Array(n);
  let token = 0;
  const flood = function (from, at) {
    token++;
    const queue = [from];
    room[from] = token;
    let min = from;
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      if (c < min) min = c;
      const cx = c % w;
      const cy = (c - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0];
        const ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (wall[nb] || room[nb] === token) continue;
        if (nb === at || occupied[nb]) continue;
        room[nb] = token;
        queue.push(nb);
      }
    }
    return min;
  };

  const pushSkipped = { behind: 0, blocked: 0, dead: 0 };
  const startRoom = flood(player, boxCell);
  if (PLAN_DEBUG) console.log('  planBox cassa ' + boxCell + ' giocatore ' + player + ' stanza ' + startRoom);
  const startKey = boxCell + '|' + startRoom;
  const info = new Map();
  info.set(startKey, { box: boxCell, room: startRoom, parent: null, via: null });
  let layer = [startKey];

  for (let pushes = 0; pushes < 400 && layer.length; pushes++) {
    const next = [];
    for (const key of layer) {
      const st = info.get(key);
      flood(st.room, st.box);
      const b = st.box;
      const bx = b % w;
      const by = (b - bx) / w;
      const myToken = token;
      const fresh = [];
      for (let k = 0; k < 4; k++) {
        const dx = DIRS[k][0];
        const dy = DIRS[k][1];
        const px = bx - dx;
        const py = by - dy;
        const tx = bx + dx;
        const ty = by + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const behind = py * w + px;
        const dest = ty * w + tx;
        if (room[behind] !== myToken) { if (PLAN_DEBUG) pushSkipped.behind++; continue; }
        if (wall[dest] || occupied[dest]) { if (PLAN_DEBUG) pushSkipped.blocked++; continue; }
        if (!NO_DEAD && ctx.nearest[dest] >= INF) { if (PLAN_DEBUG) pushSkipped.dead++; continue; }

        const via = { bi: bi, from: b, to: dest };
        if (goalIndex[dest] >= 0) {
          const seq = [via];
          let cur = st;
          while (cur.parent) {
            seq.unshift(cur.via);
            cur = info.get(cur.parent);
          }
          return { path: seq, pushes: seq.length, playerEnd: b };
        }
        fresh.push({ dest: dest, via: via });
      }

      // Le stanze dei successori si calcolano solo a fine giro: flood cambia il
      // token e invaliderebbe i controlli delle direzioni successive.
      for (const succ of fresh) {
        const newRoom = flood(b, succ.dest);
        const nk = succ.dest + '|' + newRoom;
        if (info.has(nk)) continue;
        info.set(nk, { box: succ.dest, room: newRoom, parent: key, via: succ.via });
        next.push(nk);
      }
    }
    if (PLAN_DEBUG) console.log('   spinta ' + pushes + ' stati ' + layer.length + ' -> ' + next.length +
      ' scartate(behind ' + pushSkipped.behind + ', blocked ' + pushSkipped.blocked + ', dead ' + pushSkipped.dead + ')');
    layer = next;
  }
  return null;
}

function canReach(level, boxes, from, target) {
  const { w, h, wall } = level;
  const n = w * h;
  const blocked = new Uint8Array(n);
  for (const b of boxes) blocked[b] = 1;
  const seen = new Uint8Array(n);
  const queue = [from];
  seen[from] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    if (c === target) return true;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DIRS[k][0];
      const ny = cy + DIRS[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (wall[nb] || blocked[nb] || seen[nb]) continue;
      seen[nb] = 1;
      queue.push(nb);
    }
  }
  return false;
}

// Verifica una sequenza di spinte dallo stato iniziale: ogni spinta deve essere
// legale e la fine deve avere tutte le casse sui target. Serve a non salvare come
// par una soluzione inventata dal solver.
function verifyPushes(level, goalIndex, steps) {
  const { w, h, wall } = level;
  let boxes = level.boxes.slice();
  let player = level.player;
  for (const step of steps) {
    const bi = boxes.indexOf(step.from);
    if (bi < 0) return false;
    const fx = step.from % w;
    const fy = (step.from - fx) / w;
    const tx = step.to % w;
    const ty = (step.to - tx) / w;
    const dx = tx - fx;
    const dy = ty - fy;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
    const behind = (fy - dy) * w + (fx - dx);
    if (behind < 0 || behind >= w * h || wall[behind]) return false;
    if (!canReach(level, boxes, player, behind)) return false;
    if (wall[step.to] || boxes.indexOf(step.to) >= 0) return false;
    boxes[bi] = step.to;
    player = step.from;
  }
  for (const b of boxes) if (goalIndex[b] < 0) return false;
  return true;
}

// Greedy: consegna una cassa alla volta al target più comodo, scegliendo tra i
// piani migliori con un pizzico di casualità. Molti tentativi con semi diversi:
// è il metodo che prova a dare un par di riferimento quando A* e beam non chiudono.
function solveGreedy(ctx, seed) {
  const level = ctx.level;
  const goalIndex = ctx.goalIndex;
  if (level.boxes.length !== level.goals.length) {
    return { error: 'casse ' + level.boxes.length + ' / target ' + level.goals.length };
  }
  if (level.player < 0) return { error: 'giocatore assente' };
  const bad = unsolvableReason(ctx, level.boxes);
  if (bad) return { error: bad };

  const rng = makeRng(seed);
  let boxes = level.boxes.slice().sort(function (a, b) { return a - b; });
  let player = level.player;
  const steps = [];
  const limit = boxes.length * 6 + 30;

  for (let guard = 0; guard < limit; guard++) {
    let solved = true;
    for (const b of boxes) if (goalIndex[b] < 0) { solved = false; break; }
    if (solved) {
      if (!verifyPushes(level, goalIndex, steps)) return { error: 'verifica fallita' };
      return { cost: steps.length, exact: false, seed: seed, expanded: steps.length };
    }

    const plans = [];
    for (let bi = 0; bi < boxes.length; bi++) {
      if (goalIndex[boxes[bi]] >= 0) continue;
      const plan = planBox(ctx, boxes, bi, player);
      if (DEBUG) {
        console.log('   cassa ' + boxes[bi] + ' (' + (boxes[bi] % level.w) + ',' + ((boxes[bi] / level.w) | 0) + ')' +
          ' piano ' + (plan ? plan.pushes : 'nessuno'));
      }
      if (plan) plans.push(plan);
    }
    if (!plans.length) return { error: 'greedy bloccato', seed: seed };

    plans.sort(function (a, b) { return a.pushes - b.pushes; });
    const top = plans.slice(0, 3);
    const plan = top[Math.min(top.length - 1, Math.floor(rng() * top.length))];

    const bi = plan.path[0].bi;
    boxes = boxes.slice();
    boxes[bi] = plan.path[plan.path.length - 1].to;
    boxes.sort(function (a, b) { return a - b; });
    player = plan.playerEnd;
    for (const step of plan.path) steps.push(step);
  }

  return { error: 'greedy senza progresso', seed: seed };
}

/* ------------------------------------------------------------------- main */

function printMap(rows) {
  const level = parse(rows);
  const perGoal = level.goals.map(function (g) { return reversePushDist(level, g); });
  const nearest = nearestGoalDist(perGoal);
  const goalSet = new Set(level.goals);
  const boxSet = new Set(level.boxes);
  const out = [];
  for (let y = 0; y < level.h; y++) {
    let line = '';
    for (let x = 0; x < level.w; x++) {
      const i = y * level.w + x;
      if (level.wall[i]) line += '#';
      else if (boxSet.has(i)) line += '$';
      else if (level.player === i) line += '@';
      else if (goalSet.has(i)) line += '.';
      else if (nearest[i] >= INF) line += 'x';
      else line += ' ';
    }
    out.push(line);
  }
  console.log(out.join('\n'));
}

function main() {
  const args = process.argv.slice(2);
  const write = args.indexOf('--write') >= 0;
  const onlyArg = args.indexOf('--only');
  const only = onlyArg >= 0 ? parseInt(args[onlyArg + 1], 10) : 0;
  const mapArg = args.indexOf('--map');
  const exactOnly = args.indexOf('--exact') >= 0;

  const levels = loadLevels();
  if (mapArg >= 0) {
    printMap(levels[parseInt(args[mapArg + 1], 10) - 1]);
    return;
  }
  if (args.indexOf('--stats') >= 0) {
    console.log('Livello  casse  target  griglia');
    levels.forEach(function (rows, i) {
      const level = parse(rows);
      console.log(String(i + 1).padStart(7) + ' ' + String(level.boxes.length).padStart(6) +
        ' ' + String(level.goals.length).padStart(7) + '  ' + level.w + 'x' + level.h);
    });
    return;
  }

  const rows = [];
  let failures = 0;
  let totalMs = 0;
  let exactCount = 0;

  console.log('Livello     par  metodo   stati        tempo');
  for (let i = 0; i < levels.length; i++) {
    if (only && i + 1 !== only) { rows.push(null); continue; }
    const level = parse(levels[i]);
    const ctx = prepare(level);

    let res = solveExact(ctx);
    if (res.error || res.timeout) {
      if (exactOnly) {
        const why = res.error || 'limite di ricerca A* raggiunto';
        console.log(String(i + 1).padStart(7) + '  ERRORE   ' + why + ' (espansi ' + (res.expanded || 0) + ')');
        rows.push(null);
        failures++;
        continue;
      }
      res = solveBeam(ctx);
    }
    if ((res.error || res.timeout) && !exactOnly) {
      const tries = Number(process.env.GREEDY_TRIES || 40);
      const greedyStart = Date.now();
      for (let attempt = 1; attempt <= tries; attempt++) {
        if (Date.now() - greedyStart > MAX_MS) break;
        const attemptRes = solveGreedy(ctx, attempt * 7919);
        if (!attemptRes.error) { res = attemptRes; break; }
        if (attempt === tries) res = attemptRes;
      }
    }
    if (res.error || res.timeout) {
      failures++;
      const why = res.error || 'limite di ricerca raggiunto';
      console.log(String(i + 1).padStart(7) + '  ERRORE   ' + why + ' (espansi ' + (res.expanded || 0) + ')');
      rows.push(null);
      continue;
    }
    totalMs += res.ms;
    if (res.exact) exactCount++;
    console.log(String(i + 1).padStart(7) + ' ' + String(res.cost).padStart(6) + '  ' +
      (res.exact ? 'esatto' : 'beam  ') + ' ' + String(res.expanded).padStart(9) +
      '  ' + String(res.ms).padStart(6) + ' ms');
    rows.push({ pushes: res.cost, exact: res.exact });
  }

  console.log('\nTotale ricerca: ' + (totalMs / 1000).toFixed(1) + ' s, par esatti: ' + exactCount +
    ', livelli non risolti: ' + failures);

  if (write) {
    if (failures) {
      console.warn('Attenzione: ' + failures + ' livelli senza par, scritti come null.');
    }
    const lines = [
      '// Spinga — par dei 50 livelli (spinte), generati da tools/solve.js.',
      '// par = spinte minime per risolvere il livello.',
      '// ex = true se il minimo è dimostrato (A*), false se è la migliore soluzione',
      '// trovata dalla beam search: valida ma non necessariamente la più corta.',
      '// Rigenerare con: node tools/solve.js --write',
      'window.LEVELS_PAR = ['
    ];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // null = livello senza par certo né di riferimento: in gioco le stelle
      // tornano al criterio del record personale.
      lines.push('  ' + (r ? '{ par: ' + r.pushes + ', ex: ' + (r.exact ? 'true' : 'false') + ' }' : 'null') +
        (i < rows.length - 1 ? ',' : ''));
    }
    lines.push('];', '');
    fs.writeFileSync(path.join(ROOT, 'par.js'), lines.join('\n'));
    console.log('Scritto par.js con ' + rows.length + ' livelli.');
  }

  if (failures) process.exit(2);
}

main();
