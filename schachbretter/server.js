// Schachbretter – kleiner Server ohne Abhängigkeiten.
// Hält die Bretter in einer JSON-Datei und verteilt Änderungen per Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Chess = require('./public/chess');

const PORT = Number(process.env.PORT) || 8099;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'boards.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const HISTORY_LIMIT = 500; // gespeicherte Schritte pro Brett für Zurück/Vor
const SESSION_DAYS = 30;
// Home-Assistant-Ingress kommt immer von dieser Adresse; dort ist der Nutzer schon bei HA angemeldet
const INGRESS_IP = '172.30.32.2';

const PIECES = new Set(['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

let boards = [];
try {
  boards = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(boards));
  fs.renameSync(tmp, DATA_FILE);
}

const clients = new Set();
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000).unref();

const COLOR_NAME = { w: 'Weiß', b: 'Schwarz' };

// Verlaufseintrag = Spielzustand (Stellung, wer am Zug ist, Rochaderechte, en passant, Zähler)
// plus Notation des Zugs, der dorthin geführt hat.
function entryOf(state, extra = {}) {
  const { squares, turn, castling, ep, half, full } = state;
  return { squares, turn, castling, ep, half, full, note: null, info: null, last: null, ...extra };
}

function gameStatus(board) {
  const entry = board.history[board.cursor];
  if (board.edit) return { text: 'Stellung bearbeiten', over: false, checkSquare: null };
  const st = Chess.status(entry);
  const side = COLOR_NAME[entry.turn];
  if (st.mate) return { text: `Schachmatt – ${COLOR_NAME[Chess.other(entry.turn)]} gewinnt`, over: true, checkSquare: st.checkSquare };
  if (st.stalemate) return { text: 'Patt – Remis', over: true, checkSquare: null };
  if (st.insufficient) return { text: 'Remis – keiner kann mehr mattsetzen', over: true, checkSquare: st.checkSquare };
  let text = st.check ? `${side} am Zug – Schach!` : `${side} am Zug`;
  // Stellungswiederholung und 50-Züge-Regel: Remis kann beansprucht werden
  const key = Chess.positionKey(entry);
  let repeats = 0;
  for (let i = 0; i <= board.cursor; i++) {
    if (board.history[i].turn === entry.turn && Chess.positionKey(board.history[i]) === key) repeats++;
  }
  if (repeats >= 3) text += ' · dreifache Wiederholung, Remis möglich';
  else if (entry.half >= 100) text += ' · 50-Züge-Regel, Remis möglich';
  return { text, over: false, checkSquare: st.checkSquare };
}

// Was Clients sehen: aktueller Zustand plus Infos zum Verlauf (der Verlauf selbst bleibt auf dem Server)
function view(board) {
  const e = board.history[board.cursor];
  return {
    id: board.id,
    name: board.name,
    updated: board.updated,
    squares: e.squares,
    turn: e.turn,
    castling: e.castling,
    ep: e.ep,
    half: e.half,
    full: e.full,
    note: e.note,
    info: e.info || null,
    last: e.last || null,
    edit: Boolean(board.edit),
    status: gameStatus(board),
    canUndo: board.cursor > 0,
    canRedo: board.cursor < board.history.length - 1,
  };
}

// Ältere Bretter (ohne Verlauf oder ohne Spielzustand) auf das neue Format bringen
function migrate(board) {
  if (!Array.isArray(board.history) || !board.history.length) {
    board.history = [{ squares: board.squares }];
    board.cursor = 0;
  }
  let wasOld = false;
  for (const e of board.history) {
    if (e.turn) continue;
    wasOld = true;
    e.turn = 'w';
    e.castling = Chess.deriveCastling(e.squares);
    e.ep = null;
    e.half = 0;
    e.full = e.next || 1;
    e.note = e.note || null;
    e.info = e.info || null;
    e.last = null;
    delete e.move;
    delete e.next;
  }
  board.cursor = Math.min(Math.max(0, board.cursor | 0), board.history.length - 1);
  const current = board.history[board.cursor];
  // Bei frei aufgestellten Brettern ist unklar, wer am Zug ist → erst im Bearbeiten-Modus bestätigen
  if (wasOld && typeof board.edit !== 'boolean') {
    const isStart = current.squares.every((p, i) => p === Chess.startSquares()[i]);
    board.edit = !isStart;
  }
  board.edit = Boolean(board.edit);
  board.squares = current.squares;
  return board;
}
boards.forEach(migrate);

function newBoard(name) {
  const entry = entryOf(Chess.startState());
  return { id: crypto.randomUUID(), name, squares: entry.squares, history: [entry], cursor: 0, edit: false, updated: Date.now() };
}

function touch(board) {
  board.squares = board.history[board.cursor].squares;
  board.updated = Date.now();
  save();
  broadcast({ type: 'board', board: view(board) });
}

const isSquare = (n) => Number.isInteger(n) && n >= 0 && n < 64;
const cleanName = (name) => (typeof name === 'string' ? name.trim().slice(0, 60) : '');

function pushEntry(board, entry) {
  board.history.length = board.cursor + 1; // „Vor“-Schritte verfallen bei neuem Zug
  board.history.push(entry);
  board.cursor++;
  if (board.history.length > HISTORY_LIMIT) {
    const drop = board.history.length - HISTORY_LIMIT;
    board.history.splice(0, drop);
    board.cursor -= drop;
  }
}

// Gibt null bei Erfolg zurück, sonst eine Fehlermeldung
function applyOp(board, op) {
  const cur = board.history[board.cursor];

  switch (op.type) {
    case 'undo':
      if (board.cursor > 0) board.cursor--;
      return null;
    case 'redo':
      if (board.cursor < board.history.length - 1) board.cursor++;
      return null;

    case 'reset': // Neue Partie
      board.edit = false;
      pushEntry(board, entryOf(Chess.startState(), { info: 'Neue Partie' }));
      return null;

    case 'edit': {
      if (op.on) {
        board.edit = true;
        return null;
      }
      // Bearbeiten beenden: Stellung muss spielbar sein
      const state = { ...cur, castling: Chess.deriveCastling(cur.squares, cur.castling), ep: null };
      const error = Chess.validate(state);
      if (error) return error;
      board.edit = false;
      if (state.castling !== cur.castling || cur.ep !== null) pushEntry(board, entryOf(state, { info: 'Stellung übernommen' }));
      return null;
    }

    case 'move': {
      if (!isSquare(op.from) || !isSquare(op.to) || op.from === op.to) return 'Ungültiger Zug.';
      if (board.edit) {
        if (!cur.squares[op.from]) return 'Dort steht keine Figur.';
        const squares = cur.squares.slice();
        squares[op.to] = squares[op.from];
        squares[op.from] = null;
        pushEntry(board, entryOf({ ...cur, squares }, { info: 'Figur versetzt', last: { from: op.from, to: op.to } }));
        return null;
      }
      const st = Chess.status(cur);
      if (st.mate || st.stalemate || st.insufficient) return 'Die Partie ist beendet.';
      const move = st.moves.find((m) => m.from === op.from && m.to === op.to && (m.promo || null) === (op.promo || null));
      if (!move) return 'Dieser Zug ist nach den Regeln nicht erlaubt.';
      const label = cur.turn === 'w' ? `${cur.full}. ` : `${cur.full}… `;
      const note = label + Chess.san(cur, move);
      pushEntry(board, entryOf(Chess.applyMove(cur, move), { note, last: { from: op.from, to: op.to } }));
      return null;
    }

    // Ab hier nur im Bearbeiten-Modus
    case 'set': {
      if (!board.edit) return 'Figuren lassen sich nur im Bearbeiten-Modus setzen.';
      if (!isSquare(op.square) || !(op.piece === null || PIECES.has(op.piece))) return 'Ungültige Figur.';
      if (cur.squares[op.square] === op.piece) return null;
      const squares = cur.squares.slice();
      squares[op.square] = op.piece;
      pushEntry(board, entryOf({ ...cur, squares }, { info: op.piece ? 'Figur hinzugefügt' : 'Figur entfernt' }));
      return null;
    }
    case 'clear':
      if (!board.edit) return 'Das Brett lässt sich nur im Bearbeiten-Modus leeren.';
      pushEntry(board, entryOf({ ...cur, squares: new Array(64).fill(null), castling: 'KQkq', ep: null, half: 0, full: 1 }, { info: 'Brett geleert' }));
      return null;
    case 'turn':
      if (!board.edit) return 'Wer am Zug ist, lässt sich nur im Bearbeiten-Modus ändern.';
      if (op.color !== 'w' && op.color !== 'b') return 'Ungültige Farbe.';
      if (cur.turn === op.color) return null;
      pushEntry(board, entryOf({ ...cur, turn: op.color, ep: null }, { info: `${COLOR_NAME[op.color]} am Zug` }));
      return null;
    default:
      return 'Unbekannte Aktion.';
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10000) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data === undefined ? '' : JSON.stringify(data));
}

async function handleApi(req, res, parts) {
  const { method } = req;

  if (parts[0] === 'session' && method === 'GET') {
    // Abmelden ergibt nur außerhalb von Home Assistant Sinn
    return json(res, 200, { canLogout: !isIngress(req) });
  }

  if (parts[0] === 'events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': verbunden\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (parts[0] !== 'boards') return json(res, 404, { error: 'not found' });

  if (parts.length === 1) {
    if (method === 'GET') {
      return json(res, 200, boards.map(({ id, name, updated }) => ({ id, name, updated })));
    }
    if (method === 'POST') {
      const body = await readJson(req);
      const board = newBoard(cleanName(body.name) || 'Neues Brett');
      boards.push(board);
      touch(board);
      return json(res, 201, view(board));
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  const board = boards.find((b) => b.id === parts[1]);
  if (!board) return json(res, 404, { error: 'not found' });

  if (parts.length === 2) {
    if (method === 'GET') return json(res, 200, view(board));
    if (method === 'PUT') {
      const name = cleanName((await readJson(req)).name);
      if (!name) return json(res, 400, { error: 'name required' });
      board.name = name;
      touch(board);
      return json(res, 200, view(board));
    }
    if (method === 'DELETE') {
      boards = boards.filter((b) => b !== board);
      save();
      broadcast({ type: 'deleted', id: board.id });
      return json(res, 204);
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  if (parts.length === 3 && parts[2] === 'ops' && method === 'POST') {
    const error = applyOp(board, await readJson(req));
    if (error) return json(res, 400, { error });
    touch(board);
    return json(res, 200, view(board));
  }

  return json(res, 404, { error: 'not found' });
}

/* ---------- Anmeldung ---------- */

// Passwort: Add-on-Option "admin_password" (HA schreibt /data/options.json) oder Umgebungsvariable
function loadPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const opts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8'));
    return typeof opts.admin_password === 'string' ? opts.admin_password : '';
  } catch {
    return '';
  }
}
const PASSWORD = loadPassword();
if (!PASSWORD) console.warn('WARNUNG: Kein Admin-Passwort gesetzt – Zugriff nur über Home Assistant (Ingress) möglich.');

// Geheimer Schlüssel für Sitzungs-Cookies; ein neues Passwort macht alte Sitzungen ungültig
function loadSecret() {
  const file = path.join(DATA_DIR, 'secret');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}
const SIGN_KEY = crypto.createHash('sha256').update(loadSecret() + '\0' + PASSWORD).digest();
const sign = (value) => crypto.createHmac('sha256', SIGN_KEY).update(value).digest('base64url');

function makeSession() {
  const expires = String(Date.now() + SESSION_DAYS * 864e5);
  return `${expires}.${sign(expires)}`;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const isIngress = (req) => req.socket.remoteAddress?.replace(/^::ffff:/, '') === INGRESS_IP;

function isAuthed(req) {
  if (isIngress(req)) return true;
  if (!PASSWORD) return false;
  const token = getCookie(req, 'schach_session');
  if (!token) return false;
  const [expires, sig] = token.split('.');
  return Boolean(sig) && safeEqual(sig, sign(expires)) && Number(expires) > Date.now();
}

function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
}

// Höchstens 10 Fehlversuche pro 15 Minuten und IP
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) return false;
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 15 * 60e3 });
  else f.count++;
}

function cookieHeader(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.headers['cf-visitor']?.includes('https');
  return `schach_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function loginPage(res, status, message) {
  const note = !PASSWORD
    ? '<p class="error">Es ist noch kein Admin-Passwort gesetzt. Trage es in Home Assistant in den Add-on-Optionen ein und starte das Add-on neu.</p>'
    : message ? `<p class="error">${message}</p>` : '';
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Anmelden – Schachbretter</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="login">
    <h1>♞ Schachbretter</h1>
    ${note}
    <form method="post" action="login">
      <input type="password" name="password" placeholder="Admin-Passwort" autocomplete="current-password" required autofocus ${PASSWORD ? '' : 'disabled'}>
      <button class="primary" ${PASSWORD ? '' : 'disabled'}>Anmelden</button>
    </form>
  </main>
</body>
</html>`);
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (tooManyFailures(ip)) return loginPage(res, 429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2000) return loginPage(res, 413, 'Ungültige Eingabe.');
  }
  const password = new URLSearchParams(body).get('password') || '';
  if (PASSWORD && safeEqual(password, PASSWORD)) {
    failures.delete(ip);
    res.writeHead(303, { Location: './', 'Set-Cookie': cookieHeader(req, makeSession(), SESSION_DAYS * 86400) });
    return res.end();
  }
  recordFailure(ip);
  await new Promise((r) => setTimeout(r, 1000)); // bremst Raten aus
  console.warn(`Fehlgeschlagene Anmeldung von ${ip}`);
  loginPage(res, 401, 'Falsches Passwort.');
}

function serveStatic(req, res, pathname) {
  const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
    const parts = pathname.split('/').filter(Boolean);

    if (pathname === '/login') {
      if (req.method === 'POST') {
        return handleLogin(req, res).catch(() => !res.headersSent && loginPage(res, 400, 'Ungültige Eingabe.'));
      }
      return isAuthed(req) ? (res.writeHead(303, { Location: './' }), res.end()) : loginPage(res, 200);
    }
    if (pathname === '/logout') {
      res.writeHead(303, { Location: 'login', 'Set-Cookie': cookieHeader(req, '', 0) });
      return res.end();
    }
    // style.css braucht auch die Anmeldeseite
    if (!isAuthed(req) && pathname !== '/style.css') {
      if (parts[0] === 'api') return json(res, 401, { error: 'login required' });
      res.writeHead(303, { Location: 'login' });
      return res.end();
    }

    if (parts[0] === 'api') {
      handleApi(req, res, parts.slice(1)).catch(() => {
        if (!res.headersSent) json(res, 400, { error: 'bad request' });
      });
    } else if (req.method === 'GET') {
      serveStatic(req, res, pathname);
    } else {
      json(res, 405, { error: 'method not allowed' });
    }
  })
  .listen(PORT, () => console.log(`Schachbretter läuft auf http://localhost:${PORT}`));
