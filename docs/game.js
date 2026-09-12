'use strict';
/* Pac-Man for Meta Display glasses — 600x600 viewport, D-pad / arrow-key controls.
   Classic rules: 244 pellets, 4 power pellets, 4 ghosts with personalities,
   score, lives, levels, tunnel, frightened mode. No network needed. */

// ---------------------------------------------------------------- maze ----

const COLS = 28, ROWS = 31, TILE = 18, OX = 48, OY = 1;
const TUNNEL_ROW = 14;
const EXTRA_LIFE_AT = 10000;

// '#' wall, '-' ghost-house door, '.' pellet, 'o' power pellet, ' ' empty path
const MAZE = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '     #.##### ## #####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.## ######## ##.#     ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

function tileChar(c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return ' ';
  return MAZE[r][c];
}

function isWall(c, r) {
  if (r === TUNNEL_ROW && (c < 0 || c >= COLS)) return false; // tunnel wrap
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
  const ch = MAZE[r][c];
  return ch === '#' || ch === '-';
}

function parsePellets() {
  const pellets = new Set();
  const powers = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = MAZE[r][c];
      if (ch === '.') pellets.add(c + ',' + r);
      else if (ch === 'o') powers.add(c + ',' + r);
    }
  }
  return { pellets, powers };
}

// --------------------------------------------------------------- state ----

const DIRS = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
];
const STOP = { x: 0, y: 0 };

let state = 'attract'; // attract | ready | playing | dying | clear | gameover | paused
let stateT = 0;
let pellets, powers;
let score = 0, hiScore = 0, lives = 3, level = 1;
let frightTimer = 0, frightCombo = 0, extraLifeGiven = false;
let modeIdx = 0, modeTimer = 0;
let flashT = 0, deathT = 0, wakaAlt = false;

const MODE_SCHEDULE = [
  { m: 'scatter', t: 7 }, { m: 'chase', t: 20 },
  { m: 'scatter', t: 7 }, { m: 'chase', t: 20 },
  { m: 'scatter', t: 5 }, { m: 'chase', t: 20 },
  { m: 'scatter', t: 5 }, { m: 'chase', t: Infinity },
];
let mode = 'scatter';

const pac = { x: 13.5, y: 23.5, dir: { x: -1, y: 0 }, next: { x: -1, y: 0 }, mouth: 0 };

function makeGhosts() {
  return [
    { name: 'blinky', color: '#ff2222', x: 13.5, y: 11.5, dir: { x: -1, y: 0 }, state: 'active', houseT: 0, scatter: { x: 25, y: 0 }, bob: 0 },
    { name: 'pinky',  color: '#ffb8ff', x: 13.5, y: 14.5, dir: { x: 0, y: 1 },  state: 'house',  houseT: 0.8, scatter: { x: 2, y: 0 },  bob: 0 },
    { name: 'inky',   color: '#00ffff', x: 11.5, y: 14.5, dir: { x: 0, y: 1 },  state: 'house',  houseT: 4,   scatter: { x: 27, y: 30 }, bob: 2 },
    { name: 'clyde',  color: '#ffb847', x: 15.5, y: 14.5, dir: { x: 0, y: 1 },  state: 'house',  houseT: 9,   scatter: { x: 0, y: 30 }, bob: 4 },
  ];
}
let ghosts = makeGhosts();

function pacSpeed() { return Math.min(11, 8.8 + 0.3 * (level - 1)); }
function ghostSpeed() { return Math.min(10.2, 8.0 + 0.35 * (level - 1)); }

function resetPositions() {
  pac.x = 13.5; pac.y = 23.5;
  pac.dir = { x: -1, y: 0 }; pac.next = { x: -1, y: 0 };
  ghosts = makeGhosts();
  frightTimer = 0; frightCombo = 0;
  modeIdx = 0; modeTimer = 0; mode = 'scatter';
}

function newLevel() {
  const p = parsePellets();
  pellets = p.pellets; powers = p.powers;
  resetPositions();
}

function startGame() {
  score = 0; lives = 3; level = 1; extraLifeGiven = false;
  newLevel();
  setState('ready');
  refreshHud();
}

// ----------------------------------------------------------- movement ----

function tileOf(x, y) { return { c: Math.round(x - 0.5), r: Math.round(y - 0.5) }; }

function blockedAt(c, r, dir) {
  return isWall(c + dir.x, r + dir.y);
}

// Distance from entity to the next tile center along its direction.
// The next center is the nearest half-integer coordinate strictly ahead
// (EPS past the current position), so a step can never straddle a center
// without landing on it — every decision point is visited exactly once.
function centerAhead(e) {
  const EPS = 1e-6;
  let tx = e.x, ty = e.y;
  if (e.dir.x > 0)      tx = Math.floor(e.x - 0.5 + EPS) + 1.5;
  else if (e.dir.x < 0) tx = Math.ceil(e.x - 0.5 - EPS) - 0.5;
  else if (e.dir.y > 0) ty = Math.floor(e.y - 0.5 + EPS) + 1.5;
  else if (e.dir.y < 0) ty = Math.ceil(e.y - 0.5 - EPS) - 0.5;
  else return { x: e.x, y: e.y, dist: 0 };
  // perpendicular axis always rests on a tile center; snap for safety
  if (e.dir.x !== 0) ty = Math.round(e.y - 0.5) + 0.5;
  else tx = Math.round(e.x - 0.5) + 0.5;
  const dist = Math.abs(tx - e.x) + Math.abs(ty - e.y);
  return { x: tx, y: ty, dist };
}

function stepEntity(e, speed, dt, onCenter) {
  let rem = speed * dt, guard = 0;
  while (rem > 1e-9 && guard++ < 10) {
    if (e.dir.x === 0 && e.dir.y === 0) break;
    const ahead = centerAhead(e);
    const step = Math.min(rem, ahead.dist);
    e.x += e.dir.x * step;
    e.y += e.dir.y * step;
    rem -= step;
    if (step >= ahead.dist - 1e-9) {
      e.x = ahead.x; e.y = ahead.y; // snap to center
      onCenter(e);
      if (e.dir.x === 0 && e.dir.y === 0) break;
    }
  }
  // tunnel wrap
  if (Math.abs(e.y - (TUNNEL_ROW + 0.5)) < 0.01) {
    if (e.x < -0.5) e.x += COLS + 1;
    else if (e.x > COLS + 0.5) e.x -= COLS + 1;
  }
}

function pacOnCenter() {
  const t = tileOf(pac.x, pac.y);
  // eat whatever is on this tile
  const key = t.c + ',' + t.r;
  if (pellets.has(key)) {
    pellets.delete(key);
    addScore(10);
    Snd.waka();
    if (pellets.size === 0 && powers.size === 0) { levelClear(); return; }
  } else if (powers.has(key)) {
    powers.delete(key);
    addScore(50);
    startFright();
    if (pellets.size === 0 && powers.size === 0) { levelClear(); return; }
  }
  // steering: queued direction wins if open
  if ((pac.next.x !== 0 || pac.next.y !== 0) && !blockedAt(t.c, t.r, pac.next)) {
    pac.dir = { x: pac.next.x, y: pac.next.y };
  }
  if (blockedAt(t.c, t.r, pac.dir)) {
    pac.dir = { x: 0, y: 0 };
  }
  pac.mouth += 0.35;
}

function startFright() {
  frightTimer = Math.max(2, 7 - 0.6 * (level - 1));
  frightCombo = 0;
  for (const g of ghosts) {
    if (g.state === 'active') g.dir = { x: -g.dir.x, y: -g.dir.y }; // classic reversal
  }
  Snd.power();
}

// ------------------------------------------------------------ ghost AI ----

function isReverse(a, b) { return a.x === -b.x && a.y === -b.y; }

function ghostTarget(g) {
  if (g.state === 'eyes') return { x: 13, y: 11 };
  if (mode === 'scatter') return g.scatter;
  const _pt = tileOf(pac.x, pac.y);
  const pt = { x: _pt.c, y: _pt.r };
  const pd = pac.dir;
  switch (g.name) {
    case 'blinky': return pt;
    case 'pinky': {
      const t = { x: pt.x + 4 * pd.x, y: pt.y + 4 * pd.y };
      if (pd.y < 0) t.x -= 4; // the famous overflow bug, kept for authenticity
      return t;
    }
    case 'inky': {
      const b = tileOf(ghosts[0].x, ghosts[0].y);
      const ax = pt.x + 2 * pd.x, ay = pt.y + 2 * pd.y;
      return { x: 2 * ax - b.c, y: 2 * ay - b.r };
    }
    case 'clyde': {
      const ct = tileOf(g.x, g.y);
      const d = Math.hypot(ct.c - pt.x, ct.r - pt.y);
      return d > 8 ? pt : g.scatter;
    }
  }
  return g.scatter;
}

function ghostOnCenter(g) {
  const t = tileOf(g.x, g.y);
  if (g.state === 'eyes') {
    // arrived back above the house door -> go back in
    if (Math.abs(g.x - 13.5) < 0.6 && Math.abs(g.y - 11.5) < 0.6) {
      g.state = 'entering';
    }
  }
  const opts = DIRS.filter(d => !isReverse(d, g.dir) && !blockedAt(t.c, t.r, d));
  let options = opts.length ? opts : [{ x: -g.dir.x, y: -g.dir.y }]; // dead end: reverse
  if (frightTimer > 0 && g.state === 'active') {
    g.dir = options[(Math.random() * options.length) | 0];
  } else {
    const target = ghostTarget(g);
    let best = options[0], bestD = Infinity;
    for (const d of options) {
      const dd = Math.hypot(t.c + d.x - target.x, t.r + d.y - target.y);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    g.dir = { x: best.x, y: best.y };
  }
}

function moveGhost(g, dt) {
  if (g.state === 'house') {
    g.houseT -= dt;
    g.bob += dt * 6;
    g.y = 14.5 + Math.sin(g.bob) * 0.22;
    if (g.houseT <= 0) g.state = 'leaving';
    return;
  }
  if (g.state === 'leaving') {
    // glide to center, then up through the door
    const sp = 5 * dt;
    if (Math.abs(g.x - 13.5) > 0.05) {
      g.x += Math.sign(13.5 - g.x) * Math.min(sp, Math.abs(13.5 - g.x));
    } else if (g.y > 11.5) {
      g.y = Math.max(11.5, g.y - sp);
      if (g.y <= 11.5) { g.state = 'active'; g.dir = { x: -1, y: 0 }; }
    }
    return;
  }
  if (g.state === 'entering') {
    g.y = Math.min(14.5, g.y + 5 * dt);
    if (g.y >= 14.5) { g.state = 'leaving'; }
    return;
  }
  // active or eyes
  const sp = g.state === 'eyes' ? 13 : (frightTimer > 0 ? 5.4 : ghostSpeed());
  stepEntity(g, sp, dt, () => ghostOnCenter(g));
}

// -------------------------------------------------------------- rules ----

function addScore(n) {
  score += n;
  if (score > hiScore) hiScore = score;
  if (!extraLifeGiven && score >= EXTRA_LIFE_AT) {
    extraLifeGiven = true;
    lives++;
    Snd.extraLife();
  }
}

function checkCollisions() {
  for (const g of ghosts) {
    if (g.state !== 'active') continue;
    const d = Math.hypot(g.x - pac.x, g.y - pac.y);
    if (d < 0.75) {
      if (frightTimer > 0) {
        const pts = 200 * Math.pow(2, frightCombo);
        frightCombo = Math.min(3, frightCombo + 1);
        addScore(pts);
        g.state = 'eyes';
        Snd.eatGhost();
      } else {
        die();
        return;
      }
    }
  }
}

function die() {
  setState('dying');
  deathT = 0;
  Snd.death();
}

function levelClear() {
  setState('clear');
  flashT = 0;
  Snd.clear();
}

function update(dt) {
  stateT += dt;
  if (state === 'ready' && stateT > 2) { setState('playing'); hideOverlay(); return; }
  if (state === 'dying') {
    deathT += dt;
    if (deathT > 1.6) {
      lives--;
      refreshHud();
      if (lives <= 0) {
        setState('gameover');
        showOverlay('GAME OVER', 'Score  ' + score + '\nPress Enter to play again');
      } else {
        resetPositions();
        setState('ready');
      }
    }
    return;
  }
  if (state === 'clear') {
    flashT += dt;
    if (flashT > 2.2) {
      level++;
      newLevel();
      setState('ready');
      refreshHud();
    }
    return;
  }
  if (state !== 'playing') return;

  // fright timer
  if (frightTimer > 0) {
    frightTimer -= dt;
    if (frightTimer <= 0) { frightTimer = 0; frightCombo = 0; }
  }
  // scatter/chase schedule
  if (modeTimer !== Infinity) {
    modeTimer += dt;
    const cur = MODE_SCHEDULE[modeIdx];
    if (cur && modeTimer >= cur.t && modeIdx < MODE_SCHEDULE.length - 1) {
      modeIdx++; modeTimer = 0; mode = MODE_SCHEDULE[modeIdx].m;
    }
  }

  stepEntity(pac, pacSpeed(), dt, pacOnCenter);
  if (state !== 'playing') return; // level may have cleared mid-step
  for (const g of ghosts) moveGhost(g, dt);
  checkCollisions();
  refreshHud();
}

// -------------------------------------------------------------- audio ----

const Snd = {
  ctx: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { /* no audio */ }
  },
  tone(freq, dur, type, vol, when) {
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol || 0.04, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  },
  waka() { wakaAlt = !wakaAlt; this.tone(wakaAlt ? 520 : 320, 0.07, 'square', 0.03); },
  power() { this.tone(160, 0.35, 'sawtooth', 0.04); this.tone(110, 0.4, 'sawtooth', 0.04, 0.08); },
  eatGhost() { this.tone(200, 0.09, 'square', 0.05); this.tone(400, 0.09, 'square', 0.05, 0.08); this.tone(800, 0.14, 'square', 0.05, 0.16); },
  death() {
    let t = 0;
    for (let i = 0; i < 8; i++) { this.tone(500 - i * 55, 0.11, 'triangle', 0.06, t); t += 0.1; }
    this.tone(120, 0.5, 'triangle', 0.06, t);
  },
  clear() { const seq = [523, 659, 784, 1047]; seq.forEach((f, i) => this.tone(f, 0.12, 'square', 0.04, i * 0.1)); },
  extraLife() { const seq = [660, 880, 660, 880, 1320]; seq.forEach((f, i) => this.tone(f, 0.1, 'square', 0.04, i * 0.09)); },
};

// ------------------------------------------------------------ rendering ----

let canvas, ctx, overlayEl, ovTitle, ovSub;

function px(x) { return OX + x * TILE; }
function py(y) { return OY + y * TILE; }

function drawMaze() {
  const flashing = state === 'clear' && (flashT * 6 | 0) % 2 === 0;
  ctx.strokeStyle = flashing ? '#ffffff' : '#2b2bf5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(c, r) || MAZE[r][c] === '-') continue;
      const x = px(c), y = py(r);
      // stroke edges that face a non-wall tile -> classic outline look
      if (!isWall(c, r - 1) || (r === 0)) { ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + TILE - 3, y + 3); }
      if (!isWall(c, r + 1)) { ctx.moveTo(x + 3, y + TILE - 3); ctx.lineTo(x + TILE - 3, y + TILE - 3); }
      if (!isWall(c - 1, r)) { ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + 3, y + TILE - 3); }
      if (!isWall(c + 1, r)) { ctx.moveTo(x + TILE - 3, y + 3); ctx.lineTo(x + TILE - 3, y + TILE - 3); }
    }
  }
  ctx.stroke();
  // ghost house door
  ctx.strokeStyle = '#ffb8de';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px(13) + 2, py(12) + TILE / 2);
  ctx.lineTo(px(15) - 2, py(12) + TILE / 2);
  ctx.stroke();
}

function drawPellets() {
  ctx.fillStyle = '#ffb8ae';
  const pulse = 3.4 + Math.sin(Date.now() / 240) * 1.4;
  for (const key of pellets) {
    const [c, r] = key.split(',').map(Number);
    ctx.beginPath();
    ctx.arc(px(c + 0.5), py(r + 0.5), 2.2, 0, 7);
    ctx.fill();
  }
  for (const key of powers) {
    const [c, r] = key.split(',').map(Number);
    ctx.beginPath();
    ctx.arc(px(c + 0.5), py(r + 0.5), pulse, 0, 7);
    ctx.fill();
  }
}

function drawPac() {
  const x = px(pac.x), y = py(pac.y), r = TILE * 0.72;
  let ang = 0;
  if (pac.dir.x === 1) ang = 0;
  else if (pac.dir.x === -1) ang = Math.PI;
  else if (pac.dir.y === 1) ang = Math.PI / 2;
  else if (pac.dir.y === -1) ang = -Math.PI / 2;
  else if (pac.next.x === 1) ang = 0;
  else if (pac.next.x === -1) ang = Math.PI;
  else if (pac.next.y === 1) ang = Math.PI / 2;
  else if (pac.next.y === -1) ang = -Math.PI / 2;

  ctx.fillStyle = '#ffe600';
  ctx.beginPath();
  if (state === 'dying') {
    // death animation: collapsing wedge
    const t = Math.min(1, deathT / 1.4);
    const mouth = t * Math.PI;
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, mouth, 2 * Math.PI - mouth);
    ctx.closePath();
  } else {
    const moving = pac.dir.x !== 0 || pac.dir.y !== 0;
    const mouth = moving ? (0.06 + Math.abs(Math.sin(pac.mouth)) * 0.28) * Math.PI : 0.05 * Math.PI;
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, ang + mouth, ang + 2 * Math.PI - mouth);
    ctx.closePath();
  }
  ctx.fill();
}

function drawGhost(g) {
  const x = px(g.x), y = py(g.y), r = TILE * 0.72;
  const frightened = frightTimer > 0 && g.state === 'active';
  const flash = frightened && frightTimer < 2 && ((Date.now() / 250) | 0) % 2 === 0;

  if (g.state !== 'eyes') {
    const body = frightened ? (flash ? '#ffffff' : '#2b2bf5') : g.color;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y - 1, r, Math.PI, 0); // head
    const skirtY = y - 1 + r;
    ctx.lineTo(x + r, skirtY);
    const waves = 4, w = (2 * r) / waves;
    for (let i = 0; i < waves; i++) {
      const x0 = x + r - i * w;
      ctx.lineTo(x0 - w / 2, skirtY - 4 - ((i + ((Date.now() / 300) | 0)) % 2) * 2);
      ctx.lineTo(x0 - w, skirtY);
    }
    ctx.closePath();
    ctx.fill();
  }

  // eyes
  const ex = g.dir.x * 2.4, ey = g.dir.y * 2.4;
  const eyeC = frightened ? '#ff2222' : '#ffffff';
  const pupC = frightened ? '#ffb8ae' : '#2121de';
  for (const s of [-1, 1]) {
    ctx.fillStyle = eyeC;
    ctx.beginPath();
    ctx.arc(x + s * r * 0.38 + ex, y - 3 + ey, frightened ? 2.4 : r * 0.32, 0, 7);
    ctx.fill();
    ctx.fillStyle = pupC;
    ctx.beginPath();
    ctx.arc(x + s * r * 0.38 + ex * 1.6, y - 3 + ey * 1.6, frightened ? 1.2 : r * 0.17, 0, 7);
    ctx.fill();
  }
}

function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMaze();
  if (state !== 'clear' || ((flashT * 6 | 0) % 2 === 0)) drawPellets();
  for (const g of ghosts) drawGhost(g);
  drawPac();
  if (state === 'ready') {
    ctx.fillStyle = '#ffe600';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('READY!', 300, py(17.5));
  }
}

// ----------------------------------------------------------------- DOM ----

function showOverlay(title, sub) {
  if (!overlayEl) return;
  ovTitle.textContent = title;
  ovSub.textContent = sub || '';
  overlayEl.classList.remove('hidden');
}
function hideOverlay() { if (overlayEl) overlayEl.classList.add('hidden'); }

function setState(s) {
  state = s;
  stateT = 0;
  if (s === 'ready') showOverlay('', '');
  else if (s === 'playing') hideOverlay();
  else if (s === 'attract') showOverlay('PAC-MAN', 'Press Enter to start\nArrows / D-pad to steer');
  else if (s === 'paused') showOverlay('PAUSED', 'Press P to resume');
}

function refreshHud() {
  if (typeof document === 'undefined' || !document.getElementById('score')) return;
  document.getElementById('score').textContent = score;
  document.getElementById('hiscore').textContent = hiScore;
  document.getElementById('level').textContent = level;
  const lv = document.getElementById('lives');
  lv.innerHTML = '';
  for (let i = 0; i < Math.max(0, lives); i++) {
    const d = document.createElement('div');
    d.className = 'life';
    lv.appendChild(d);
  }
}

function onKey(e) {
  const k = e.key;
  const map = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };
  if (map[k]) {
    e.preventDefault();
    Snd.init();
    pac.next = { x: map[k][0], y: map[k][1] };
    if (state === 'attract' || state === 'gameover') startGame();
    return;
  }
  if (k === 'Enter' || k === ' ') {
    e.preventDefault();
    Snd.init();
    if (state === 'attract' || state === 'gameover') startGame();
    else if (state === 'paused') { setState('playing'); }
    return;
  }
  if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'playing') setState('paused');
    else if (state === 'paused') setState('playing');
  }
}

function init() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  overlayEl = document.getElementById('overlay');
  ovTitle = document.getElementById('overlay-title');
  ovSub = document.getElementById('overlay-sub');
  const p = parsePellets();
  pellets = p.pellets; powers = p.powers;
  document.addEventListener('keydown', onKey);
  setState('attract');
  refreshHud();
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (state !== 'paused') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

// Node test hook: expose pure logic without touching the DOM.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAZE, COLS, ROWS, TUNNEL_ROW,
    tileChar, isWall, parsePellets, tileOf, centerAhead, blockedAt,
    ghostTarget, DIRS, makeGhosts,
    setMode: (m) => { mode = m; },
    // headless simulation hooks (used by node tests only)
    update, stepEntity, die, startGame, setState, resetPositions, newLevel,
    checkCollisions, pacOnCenter, moveGhost,
    getState: () => state,
    getScore: () => score,
    getLives: () => lives,
    getPac: () => pac,
    getGhosts: () => ghosts,
    _state: () => ({ pac, ghosts, get score() { return score; } }),
  };
}
