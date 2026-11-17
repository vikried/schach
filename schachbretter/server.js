// Schachbretter – kleiner Server ohne Abhängigkeiten.
// Hält die Bretter in einer JSON-Datei und verteilt Änderungen per Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describe } = require('./notation');

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

// Feld 0 = a8, Feld 63 = h1
function startPosition() {
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const sq = new Array(64).fill(null);
  for (let i = 0; i < 8; i++) {
    sq[i] = 'b' + back[i];
    sq[8 + i] = 'bP';
    sq[48 + i] = 'wP';
    sq[56 + i] = 'w' + back[i];
  }
  return sq;
}

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

// Was Clients sehen: aktuelle Stellung plus Infos zum Verlauf (der Verlauf selbst bleibt auf dem Server)
function view(board) {
  const entry = board.history[board.cursor];
  return {
    id: board.id,
    name: board.name,
    updated: board.updated,
    squares: entry.squares,
    note: entry.note,
    info: entry.info || null,
    canUndo: board.cursor > 0,
    canRedo: board.cursor < board.history.length - 1,
  };
}

// Ältere Bretter (ohne Verlauf) bekommen einen Startpunkt
function ensureHistory(board) {
  if (!Array.isArray(board.history) || !board.history.length) {
    board.history = [{ squares: board.squares, note: null, move: null, next: 1 }];
    board.cursor = 0;
  }
  board.cursor = Math.min(Math.max(0, board.cursor | 0), board.history.length - 1);
  board.squares = board.history[board.cursor].squares;
  return board;
}
boards.forEach(ensureHistory);

function newBoard(name) {
  const squares = startPosition();
  return {
    id: crypto.randomUUID(),
    name,
    squares,
    history: [{ squares, note: null, move: null, next: 1 }],
    cursor: 0,
    updated: Date.now(),
  };
}

function touch(board) {
  board.squares = board.history[board.cursor].squares;
  board.updated = Date.now();
  save();
  broadcast({ type: 'board', board: view(board) });
}

const isSquare = (n) => Number.isInteger(n) && n >= 0 && n < 64;
const cleanName = (name) => (typeof name === 'string' ? name.trim().slice(0, 60) : '');

// Liefert die neue Stellung oder null bei ungültiger Operation
function nextSquares(current, op) {
  const sq = current.slice();
  switch (op.type) {
    case 'move':
      if (!isSquare(op.from) || !isSquare(op.to)) return null;
      if (op.from !== op.to && sq[op.from]) {
        sq[op.to] = sq[op.from];
        sq[op.from] = null;
      }
      return sq;
    case 'set':
      if (!isSquare(op.square) || !(op.piece === null || PIECES.has(op.piece))) return null;
      sq[op.square] = op.piece;
      return sq;
    case 'reset':
      return startPosition();
    case 'clear':
      return new Array(64).fill(null);
    default:
      return null;
  }
}

// Gibt false bei ungültiger Operation zurück
function applyOp(board, op) {
  if (op.type === 'undo') {
    if (board.cursor > 0) board.cursor--;
    return true;
  }
  if (op.type === 'redo') {
    if (board.cursor < board.history.length - 1) board.cursor++;
    return true;
  }

  const prev = board.history[board.cursor];
  const squares = nextSquares(prev.squares, op);
  if (!squares) return false;
  if (squares.every((p, i) => p === prev.squares[i])) return true; // nichts verändert

  const { note, move, merge, next } = describe(prev, op, squares);
  const entry = { squares, note, move, next };
  if (!note) {
    // Kein Schachzug – kurze Beschreibung, damit klar ist, was „Zurück“ rückgängig macht
    if (op.type === 'reset') entry.info = 'Startaufstellung';
    else if (op.type === 'clear') entry.info = 'Brett geleert';
    else if (op.type === 'set') entry.info = op.piece ? 'Figur hinzugefügt' : 'Figur entfernt';
  }
  board.history.length = board.cursor + 1; // „Vor“-Schritte verfallen bei neuem Zug
  if (merge && board.cursor > 0) {
    // Zweiter Teil eines Zugs (Rochade, Umwandlung, en passant): ein Zurück nimmt beides zurück
    board.history[board.cursor] = entry;
  } else {
    board.history.push(entry);
    board.cursor++;
  }
  if (board.history.length > HISTORY_LIMIT) {
    const drop = board.history.length - HISTORY_LIMIT;
    board.history.splice(0, drop);
    board.cursor -= drop;
  }
  return true;
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
    if (!applyOp(board, await readJson(req))) return json(res, 400, { error: 'invalid op' });
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
