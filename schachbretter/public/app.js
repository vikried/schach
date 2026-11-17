// Schachbretter – Oberfläche. Regeln kommen aus chess.js (gleiche Datei wie auf dem Server).
const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P'];
const DESIGNS = { holz: 'Holz', gruen: 'Grün', blau: 'Blau', grau: 'Grau', lila: 'Lila', koralle: 'Koralle' };
const app = document.getElementById('app');

// Das Farbdesign gilt pro Gerät, nicht pro Brett
function setDesign(design, store) {
  if (!DESIGNS[design]) design = 'holz';
  document.documentElement.dataset.design = design;
  if (store) {
    try {
      localStorage.setItem('design', design);
    } catch { /* nur Komfort */ }
  }
}
try {
  setDesign(localStorage.getItem('design'));
} catch {
  setDesign('holz');
}

let board = null; // aktuell geöffnetes Brett
let flipped = false;
let boardEl = null;
let canLogout = false;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = 'login';
    throw new Error('Anmeldung erforderlich');
  }
  if (!res.ok) {
    let message = '';
    try {
      message = (await res.json()).error;
    } catch { /* kein JSON */ }
    throw new Error(message || `Fehler ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// iOS (WebKit) malt Inhalte im Home-Assistant-iframe manchmal nicht neu, bis z. B. das
// HA-Menü aufgeht. Ein kurzer Transform zwingt den Browser zum Neuzeichnen.
function repaint() {
  requestAnimationFrame(() => {
    app.style.transform = 'translateZ(0)';
    requestAnimationFrame(() => {
      app.style.transform = '';
    });
  });
}

function render(...nodes) {
  app.replaceChildren(...nodes);
  repaint();
}

for (const ev of ['pageshow', 'resize', 'orientationchange']) window.addEventListener(ev, repaint);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && repaint());

function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

function pieceEl(code) {
  // U+FE0E erzwingt die Textdarstellung statt eines Emojis
  return h('span', { className: `piece ${code[0]}`, textContent: GLYPH[code[1]] + '︎' });
}

/* ---------- Liste ---------- */

async function showList() {
  board = null;
  boardEl = null;
  const boards = await api('GET', 'api/boards');
  if (board || location.hash.startsWith('#/b/')) return; // inzwischen wurde ein Brett geöffnet
  boards.sort((a, b) => b.updated - a.updated);

  const input = h('input', { placeholder: 'Name, z. B. „Gegen Jonas“', maxLength: 60 });
  const form = h('form', { className: 'new-board' }, input, h('button', { className: 'primary', textContent: 'Neues Brett' }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const created = await api('POST', 'api/boards', { name: input.value });
    location.hash = `#/b/${created.id}`;
  };

  const list = h('ul', { className: 'board-list' });
  for (const b of boards) {
    const del = h('button', { className: 'danger', textContent: 'Löschen' });
    del.onclick = async () => {
      if (!confirm(`Brett „${b.name}“ wirklich löschen?`)) return;
      await api('DELETE', `api/boards/${b.id}`);
    };
    list.append(
      h('li', {},
        h('a', { href: `#/b/${b.id}` },
          h('span', { className: 'name', textContent: b.name }),
          h('span', { className: 'muted', textContent: `Zuletzt geändert: ${new Date(b.updated).toLocaleString('de-DE')}` })),
        del));
  }

  const header = h('div', { className: 'list-header' }, h('h1', { textContent: 'Schachbretter' }));
  if (canLogout) header.append(h('a', { href: 'logout', className: 'muted', textContent: 'Abmelden' }));

  render(
    header,
    form,
    boards.length ? list : h('p', { className: 'muted', textContent: 'Noch keine Bretter. Lege oben dein erstes an.' }));
}

/* ---------- Brett ---------- */

async function showBoard(id) {
  try {
    board = await api('GET', `api/boards/${id}`);
  } catch {
    location.hash = '#/';
    return;
  }
  try {
    flipped = localStorage.getItem(`flip:${id}`) === '1';
  } catch {
    flipped = false;
  }

  const title = h('h1', { title: 'Zum Umbenennen klicken' });
  title.onclick = async () => {
    const name = prompt('Name des Bretts', board.name);
    if (name && name.trim()) await api('PUT', `api/boards/${board.id}`, { name });
  };

  boardEl = h('div', { className: 'board' });
  boardEl.onpointerdown = onBoardPointerDown;
  selected = null;

  const undo = h('button', { className: 'undo', title: 'Letzten Schritt rückgängig (←)', ariaLabel: 'Zurück' },
    h('span', { textContent: '◀' }), h('span', { className: 'lbl', textContent: ' Zurück' }));
  undo.onclick = () => sendHistory('undo');
  const redo = h('button', { className: 'redo', title: 'Schritt wiederherstellen (→)', ariaLabel: 'Vor' },
    h('span', { className: 'lbl', textContent: 'Vor ' }), h('span', { textContent: '▶' }));
  redo.onclick = () => sendHistory('redo');
  const moveBar = h('div', { className: 'movebar' }, undo, h('div', { className: 'last-move', ariaLive: 'polite' }), redo);

  const status = h('p', { className: 'status', ariaLive: 'polite' });
  const error = h('p', { className: 'error', hidden: true });

  // Bearbeiten-Modus: Figurenleiste, wer ist am Zug, Fertig
  const palette = h('div', { className: 'palette edit-only' });
  for (const color of ['w', 'b']) {
    for (const type of PALETTE) {
      const el = pieceEl(color + type);
      el.onpointerdown = (e) => startDrag(e, color + type, null, el);
      palette.append(el);
    }
  }
  const turnW = h('button', { className: 'turn-w', textContent: 'Weiß' });
  turnW.onclick = () => sendOp({ type: 'turn', color: 'w' });
  const turnB = h('button', { className: 'turn-b', textContent: 'Schwarz' });
  turnB.onclick = () => sendOp({ type: 'turn', color: 'b' });
  const clear = h('button', { textContent: 'Brett leeren' });
  clear.onclick = () => confirm('Alle Figuren vom Brett entfernen?') && sendOp({ type: 'clear' });
  const done = h('button', { className: 'primary', textContent: 'Fertig – weiterspielen' });
  done.onclick = () => sendOp({ type: 'edit', on: false });
  // Rochaderechte (nur wählbar, wenn König und Turm auf ihren Ausgangsfeldern stehen)
  const castleGroup = h('div', { className: 'segmented castling', role: 'group', ariaLabel: 'Rochade erlaubt' },
    h('span', { className: 'muted', textContent: 'Rochade erlaubt:' }));
  for (const [right, label] of [['K', 'Weiß O-O'], ['Q', 'Weiß O-O-O'], ['k', 'Schwarz O-O'], ['q', 'Schwarz O-O-O']]) {
    const btn = h('button', { textContent: label });
    btn.dataset.right = right;
    btn.onclick = () => {
      const has = board.castling.includes(right);
      const rights = has ? board.castling.replace(right, '') : board.castling + right;
      sendOp({ type: 'castling', rights });
    };
    castleGroup.append(btn);
  }
  const castleBar = h('div', { className: 'actions edit-only' }, castleGroup);

  const editBar = h('div', { className: 'actions edit-only' },
    h('div', { className: 'segmented', role: 'group', ariaLabel: 'Am Zug' }, h('span', { className: 'muted', textContent: 'Am Zug:' }), turnW, turnB),
    clear, done);

  // Spielmodus
  const newGame = h('button', { textContent: 'Neue Partie' });
  newGame.onclick = () => confirm('Neue Partie mit Startaufstellung beginnen? (Mit „Zurück“ kommst du wieder zur alten Stellung.)') && sendOp({ type: 'reset' });
  const edit = h('button', { className: 'play-only', textContent: 'Stellung bearbeiten' });
  edit.onclick = () => sendOp({ type: 'edit', on: true });
  const flip = h('button', { textContent: 'Brett drehen' });
  flip.onclick = () => {
    flipped = !flipped;
    try {
      localStorage.setItem(`flip:${board.id}`, flipped ? '1' : '0');
    } catch { /* nur Komfort */ }
    renderBoard();
  };
  const design = h('select', { title: 'Farbdesign' });
  design.setAttribute('aria-label', 'Farbdesign');
  for (const [value, label] of Object.entries(DESIGNS)) design.append(h('option', { value, textContent: label }));
  design.value = document.documentElement.dataset.design;
  design.onchange = () => setDesign(design.value, true);

  render(
    h('div', { className: 'topbar' }, h('a', { href: '#/', textContent: '← Bretter' }), title),
    boardEl,
    moveBar,
    status,
    error,
    palette,
    editBar,
    castleBar,
    h('div', { className: 'actions' }, newGame, edit, flip, design),
    h('p', { className: 'hint muted' }));
  renderBoard();
}

/* ---------- Darstellung ---------- */

let selected = null; // ausgewähltes Feld im Spielmodus
let legal = []; // erlaubte Züge der aktuellen Stellung

function renderBoard() {
  if (!board || !boardEl) return;
  app.querySelector('.topbar h1').textContent = board.name;
  const playing = !board.edit && !board.status.over;
  legal = playing ? Chess.legalMoves(board) : [];
  if (selected !== null && !legal.some((m) => m.from === selected)) selected = null;
  const targets = new Set(legal.filter((m) => m.from === selected).map((m) => m.to));

  const squares = [];
  for (let pos = 0; pos < 64; pos++) {
    const idx = flipped ? 63 - pos : pos;
    const file = idx % 8;
    const rank = 8 - Math.floor(idx / 8);
    const cls = ['sq'];
    if (!((file + rank) % 2)) cls.push('light');
    if (board.last && (board.last.from === idx || board.last.to === idx)) cls.push('last');
    if (board.status.checkSquare === idx) cls.push('check');
    if (idx === selected) cls.push('sel');
    if (targets.has(idx)) cls.push(board.squares[idx] || (board.ep === idx && Chess.typeOf(board.squares[selected]) === 'P') ? 'capture' : 'target');
    const code = board.squares[idx];
    if (playing && code && code[0] === board.turn && legal.some((m) => m.from === idx)) cls.push('movable');
    const sq = h('div', { className: cls.join(' ') });
    sq.dataset.idx = idx;
    if (pos % 8 === 0) sq.append(h('span', { className: 'coord rank', textContent: rank }));
    if (pos >= 56) sq.append(h('span', { className: 'coord file', textContent: 'abcdefgh'[file] }));
    if (code) sq.append(pieceEl(code));
    squares.push(sq);
  }
  boardEl.replaceChildren(...squares);
  boardEl.classList.toggle('editing', board.edit);

  // Letzter Zug und Zurück/Vor
  const lastMove = app.querySelector('.last-move');
  if (board.note) {
    lastMove.replaceChildren(h('span', { className: 'muted', textContent: 'Letzter Zug ' }), h('strong', { textContent: board.note }));
  } else {
    lastMove.replaceChildren(h('span', { className: 'muted', textContent: board.info || (board.canUndo ? '' : 'Noch kein Zug') }));
  }
  app.querySelector('.movebar .undo').disabled = !board.canUndo;
  app.querySelector('.movebar .redo').disabled = !board.canRedo;

  const status = app.querySelector('.status');
  status.textContent = board.status.text;
  status.className = `status${board.status.over ? ' over' : ''}${board.status.checkSquare !== null && !board.edit ? ' check' : ''}`;

  for (const el of app.querySelectorAll('.edit-only')) el.hidden = !board.edit;
  for (const el of app.querySelectorAll('.play-only')) el.hidden = board.edit;
  app.querySelector('.turn-w').setAttribute('aria-pressed', board.turn === 'w');
  app.querySelector('.turn-b').setAttribute('aria-pressed', board.turn === 'b');
  const possible = Chess.deriveCastling(board.squares);
  for (const btn of app.querySelectorAll('.castling button')) {
    const right = btn.dataset.right;
    btn.disabled = !possible.includes(right);
    btn.setAttribute('aria-pressed', possible.includes(right) && board.castling.includes(right));
    btn.title = btn.disabled ? 'König oder Turm steht nicht auf dem Ausgangsfeld' : '';
  }
  app.querySelector('.hint').textContent = board.edit
    ? 'Figuren frei ziehen · aus der Leiste aufs Brett ziehen zum Hinzufügen · vom Brett herunterziehen zum Entfernen'
    : 'Figur antippen oder ziehen – erlaubte Felder werden markiert';
  repaint();
}

let errorTimer = null;
function showError(message) {
  const el = app.querySelector('.error');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

/* ---------- Server ---------- */

async function sendHistory(type) {
  if (!board) return;
  selected = null;
  const id = board.id;
  try {
    const updated = await api('POST', `api/boards/${id}/ops`, { type });
    if (board && board.id === id) {
      board = updated;
      renderBoard();
    }
  } catch {
    if (board && board.id === id) showBoard(id);
  }
}

// Pfeiltasten ← → für Zurück/Vor, Esc hebt die Auswahl auf
window.addEventListener('keydown', (e) => {
  if (!board || e.target.closest?.('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowLeft' && board.canUndo) sendHistory('undo');
  else if (e.key === 'ArrowRight' && board.canRedo) sendHistory('redo');
  else if (e.key === 'Escape' && selected !== null) {
    selected = null;
    renderBoard();
  }
});

// Sofort anzeigen, was der Server gleich bestätigen wird
function applyLocal(op) {
  const sq = board.squares;
  if (op.type === 'move' && board.edit) {
    sq[op.to] = sq[op.from];
    sq[op.from] = null;
  } else if (op.type === 'set') {
    sq[op.square] = op.piece;
  }
}

async function sendOp(op) {
  const id = board.id;
  applyLocal(op);
  renderBoard();
  try {
    const updated = await api('POST', `api/boards/${id}/ops`, op);
    if (board && board.id === id) {
      board = updated;
      renderBoard();
    }
  } catch (err) {
    showError(err.message);
    if (board && board.id === id) {
      try {
        board = await api('GET', `api/boards/${id}`);
        renderBoard();
      } catch { /* Seite lädt beim nächsten Ereignis neu */ }
    }
  }
}

/* ---------- Spielmodus: Züge nach den Regeln ---------- */

function localStatus(state) {
  const st = Chess.status(state);
  const side = state.turn === 'w' ? 'Weiß' : 'Schwarz';
  const winner = state.turn === 'w' ? 'Schwarz' : 'Weiß';
  if (st.mate) return { text: `Schachmatt – ${winner} gewinnt`, over: true, checkSquare: st.checkSquare };
  if (st.stalemate) return { text: 'Patt – Remis', over: true, checkSquare: null };
  if (st.insufficient) return { text: 'Remis – keiner kann mehr mattsetzen', over: true, checkSquare: st.checkSquare };
  return { text: st.check ? `${side} am Zug – Schach!` : `${side} am Zug`, over: false, checkSquare: st.checkSquare };
}

async function tryMove(from, to) {
  const candidates = legal.filter((m) => m.from === from && m.to === to);
  if (!candidates.length) return;
  let move = candidates[0];
  if (move.promo) {
    const promo = await choosePromotion(board.turn);
    if (!promo || !board) return;
    move = candidates.find((m) => m.promo === promo);
  }
  selected = null;
  const id = board.id;
  const label = board.turn === 'w' ? `${board.full}. ` : `${board.full}… `;
  const note = label + Chess.san(board, move);
  const next = Chess.applyMove(board, move);
  board = { ...board, ...next, note, info: null, last: { from, to }, canUndo: true, canRedo: false, status: localStatus(next) };
  renderBoard();
  try {
    const updated = await api('POST', `api/boards/${id}/ops`, { type: 'move', from, to, promo: move.promo || null });
    if (board && board.id === id) {
      board = updated;
      renderBoard();
    }
  } catch (err) {
    showError(err.message);
    if (board && board.id === id) showBoard(id);
  }
}

// Auswahl der Figur bei der Bauernumwandlung
function choosePromotion(color) {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    const choices = h('div', { className: 'promo-choices' });
    for (const type of ['Q', 'R', 'B', 'N']) {
      const btn = h('button', { title: { Q: 'Dame', R: 'Turm', B: 'Läufer', N: 'Springer' }[type] }, pieceEl(color + type));
      btn.onclick = (e) => {
        e.stopPropagation();
        close(type);
      };
      choices.append(btn);
    }
    const overlay = h('div', { className: 'promo' }, h('div', { className: 'promo-box' }, h('p', { textContent: 'Umwandeln in:' }), choices));
    overlay.onclick = () => close(null);
    document.body.append(overlay);
    choices.querySelector('button').focus();
  });
}

function onBoardPointerDown(e) {
  if (e.button > 0 || !board) return;
  const sqEl = e.target.closest('.sq');
  if (!sqEl) return;
  const idx = Number(sqEl.dataset.idx);
  const code = board.squares[idx];

  if (board.edit) {
    if (code) startDrag(e, code, idx, sqEl.querySelector('.piece'));
    return;
  }
  // Zielfeld der ausgewählten Figur angetippt
  if (selected !== null && legal.some((m) => m.from === selected && m.to === idx)) {
    e.preventDefault();
    tryMove(selected, idx);
    return;
  }
  if (legal.some((m) => m.from === idx)) {
    const wasSelected = selected === idx;
    selected = idx;
    renderBoard();
    startMoveDrag(e, idx, wasSelected);
    return;
  }
  if (selected !== null) {
    selected = null;
    renderBoard();
  }
}

// Ziehen im Spielmodus: Figur folgt dem Finger erst nach kurzer Bewegung, Tippen wählt nur aus
function startMoveDrag(e, from, wasSelected) {
  e.preventDefault();
  const code = board.squares[from];
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost = null;
  let over = null;
  const squareAt = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.board .sq') ?? null;

  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      ghost = pieceEl(code);
      ghost.classList.add('ghost');
      document.body.append(ghost);
      boardEl.querySelector(`.sq[data-idx="${from}"] .piece`)?.classList.add('dragging');
    }
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    const sq = squareAt(ev);
    if (sq !== over) {
      over?.classList.remove('over');
      sq?.classList.add('over');
      over = sq;
    }
  };
  const end = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    over?.classList.remove('over');
    if (!ghost) {
      // Nur getippt: zweites Tippen auf dieselbe Figur hebt die Auswahl auf
      if (wasSelected && ev.type !== 'pointercancel') {
        selected = null;
        renderBoard();
      }
      return;
    }
    ghost.remove();
    boardEl.querySelector('.piece.dragging')?.classList.remove('dragging');
    if (ev.type === 'pointercancel' || !board) return;
    const sq = squareAt(ev);
    const to = sq ? Number(sq.dataset.idx) : null;
    if (to !== null && to !== from) tryMove(from, to);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/* ---------- Bearbeiten-Modus: freies Ziehen ---------- */

// from = Feldindex oder null, wenn die Figur aus der Leiste kommt
function startDrag(e, code, from, source) {
  if (e.button > 0) return;
  e.preventDefault();
  const ghost = pieceEl(code);
  ghost.classList.add('ghost');
  document.body.append(ghost);
  if (from !== null) source.classList.add('dragging');
  let over = null;

  const squareAt = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.board .sq') ?? null;
  const move = (ev) => {
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
    const sq = squareAt(ev);
    if (sq !== over) {
      over?.classList.remove('over');
      sq?.classList.add('over');
      over = sq;
    }
  };
  const end = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    ghost.remove();
    over?.classList.remove('over');
    source.classList.remove('dragging');
    if (ev.type === 'pointercancel' || !board) return;

    const sq = squareAt(ev);
    const to = sq ? Number(sq.dataset.idx) : null;
    if (from === null) {
      if (to !== null) sendOp({ type: 'set', square: to, piece: code });
    } else if (to === null) {
      sendOp({ type: 'set', square: from, piece: null });
    } else if (to !== from) {
      sendOp({ type: 'move', from, to });
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  move(e);
}

/* ---------- Routing & Live-Abgleich ---------- */

function route() {
  const m = location.hash.match(/^#\/b\/([\w-]+)/);
  if (m) showBoard(m[1]);
  else showList();
}
window.addEventListener('hashchange', route);
api('GET', 'api/session')
  .then((s) => { canLogout = s.canLogout; })
  .catch(() => {})
  .finally(route);

const events = new EventSource('api/events');
events.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (!board) {
    if (!location.hash.startsWith('#/b/')) showList();
  } else if (msg.type === 'board' && msg.board.id === board.id) {
    board = msg.board;
    renderBoard();
  } else if (msg.type === 'deleted' && msg.id === board.id) {
    location.hash = '#/';
  }
};
// Nach einem Verbindungsabbruch verpasste Änderungen nachholen
let connectedOnce = false;
// Abgelaufene Sitzung: EventSource meldet nur einen Fehler, also kurz nachfragen
events.onerror = () => {
  fetch('api/session').then((r) => r.status === 401 && (location.href = 'login')).catch(() => {});
};
events.onopen = () => {
  if (connectedOnce) route();
  connectedOnce = true;
};
