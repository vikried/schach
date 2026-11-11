// Schachbretter – Oberfläche. Keine Schachregeln: Figuren lassen sich frei setzen.
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

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

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

  app.replaceChildren(
    h('h1', { textContent: 'Schachbretter' }),
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

  const palette = h('div', { className: 'palette' });
  for (const color of ['w', 'b']) {
    for (const type of PALETTE) {
      const el = pieceEl(color + type);
      el.onpointerdown = (e) => startDrag(e, color + type, null, el);
      palette.append(el);
    }
  }

  const reset = h('button', { textContent: 'Startaufstellung' });
  reset.onclick = () => confirm('Alle Figuren auf die Startaufstellung zurücksetzen?') && sendOp({ type: 'reset' });
  const clear = h('button', { textContent: 'Brett leeren' });
  clear.onclick = () => confirm('Alle Figuren vom Brett entfernen?') && sendOp({ type: 'clear' });
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

  app.replaceChildren(
    h('div', { className: 'topbar' }, h('a', { href: '#/', textContent: '← Bretter' }), title),
    boardEl,
    palette,
    h('div', { className: 'actions' }, reset, clear, flip, design),
    h('p', { className: 'hint muted', textContent: 'Figuren ziehen zum Bewegen · aus der Leiste aufs Brett ziehen zum Hinzufügen · vom Brett herunterziehen zum Entfernen' }));
  renderBoard();
}

function renderBoard() {
  if (!board || !boardEl) return;
  app.querySelector('.topbar h1').textContent = board.name;
  const squares = [];
  for (let pos = 0; pos < 64; pos++) {
    const idx = flipped ? 63 - pos : pos;
    const file = idx % 8;
    const rank = 8 - Math.floor(idx / 8);
    const sq = h('div', { className: (file + rank) % 2 ? 'sq' : 'sq light' });
    sq.dataset.idx = idx;
    if (pos % 8 === 0) sq.append(h('span', { className: 'coord rank', textContent: rank }));
    if (pos >= 56) sq.append(h('span', { className: 'coord file', textContent: 'abcdefgh'[file] }));
    const code = board.squares[idx];
    if (code) {
      const el = pieceEl(code);
      el.onpointerdown = (e) => startDrag(e, code, idx, el);
      sq.append(el);
    }
    squares.push(sq);
  }
  boardEl.replaceChildren(...squares);
}

function applyLocal(op) {
  const sq = board.squares;
  if (op.type === 'move') {
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
    await api('POST', `api/boards/${id}/ops`, op);
  } catch {
    if (board && board.id === id) showBoard(id); // Stand vom Server neu laden
  }
}

// from = Feldindex oder null, wenn die Figur aus der Leiste kommt
function startDrag(e, code, from, source) {
  if (e.button > 0) return;
  e.preventDefault();
  const ghost = pieceEl(code);
  ghost.classList.add('ghost');
  document.body.append(ghost);
  if (from !== null) source.classList.add('dragging');
  let over = null;

  const squareAt = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.sq') ?? null;
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
route();

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
events.onopen = () => {
  if (connectedOnce) route();
  connectedOnce = true;
};
