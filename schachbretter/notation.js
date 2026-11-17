// Algebraische Notation (SAN) mit Figurensymbolen für einen frei gezogenen Zug.
// Die App kennt keine Regeln – hier wird nur beschrieben, was auf dem Brett passiert ist.
// Feld 0 = a8, Feld 63 = h1. Weiß zieht „nach oben“ (Index wird kleiner).

const FIGURINE = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const FILES = 'abcdefgh';

const fileOf = (i) => i % 8;
const rowOf = (i) => Math.floor(i / 8); // 0 = Reihe 8
const squareName = (i) => FILES[fileOf(i)] + (8 - rowOf(i));
const colorOf = (p) => p && p[0];
const typeOf = (p) => p && p[1];
const other = (c) => (c === 'w' ? 'b' : 'w');

function at(row, file) {
  return row >= 0 && row < 8 && file >= 0 && file < 8 ? row * 8 + file : -1;
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// Felder, die die Figur auf `from` angreift (für Bauern nur die Schlagfelder)
function attacks(sq, from) {
  const p = sq[from];
  const r = rowOf(from);
  const f = fileOf(from);
  const out = [];
  const steps = (dirs) => {
    for (const [dr, df] of dirs) {
      const t = at(r + dr, f + df);
      if (t >= 0) out.push(t);
    }
  };
  const slides = (dirs) => {
    for (const [dr, df] of dirs) {
      for (let k = 1; k < 8; k++) {
        const t = at(r + dr * k, f + df * k);
        if (t < 0) break;
        out.push(t);
        if (sq[t]) break;
      }
    }
  };
  switch (typeOf(p)) {
    case 'N': steps(KNIGHT); break;
    case 'K': steps(KING); break;
    case 'R': slides(ROOK); break;
    case 'B': slides(BISHOP); break;
    case 'Q': slides(ROOK); slides(BISHOP); break;
    case 'P': {
      const dr = colorOf(p) === 'w' ? -1 : 1;
      steps([[dr, -1], [dr, 1]]);
      break;
    }
  }
  return out;
}

function isAttacked(sq, target, byColor) {
  for (let i = 0; i < 64; i++) {
    if (colorOf(sq[i]) === byColor && attacks(sq, i).includes(target)) return true;
  }
  return false;
}

function inCheck(sq, color) {
  const king = sq.indexOf(color + 'K');
  return king >= 0 && isAttacked(sq, king, other(color));
}

// Pseudolegale Ziele einer Figur (ohne Rochade und en passant)
function targets(sq, from) {
  const p = sq[from];
  const c = colorOf(p);
  if (typeOf(p) !== 'P') return attacks(sq, from).filter((t) => colorOf(sq[t]) !== c);
  const out = [];
  const dr = c === 'w' ? -1 : 1;
  const r = rowOf(from);
  const f = fileOf(from);
  const one = at(r + dr, f);
  if (one >= 0 && !sq[one]) {
    out.push(one);
    const startRow = c === 'w' ? 6 : 1;
    const two = at(r + 2 * dr, f);
    if (r === startRow && two >= 0 && !sq[two]) out.push(two);
  }
  for (const t of attacks(sq, from)) if (sq[t] && colorOf(sq[t]) !== c) out.push(t);
  return out;
}

function isLegal(sq, from, to) {
  const next = sq.slice();
  next[to] = next[from];
  next[from] = null;
  return !inCheck(next, colorOf(sq[from]));
}

function hasLegalMove(sq, color) {
  for (let i = 0; i < 64; i++) {
    if (colorOf(sq[i]) !== color) continue;
    for (const t of targets(sq, i)) if (isLegal(sq, i, t)) return true;
  }
  return false;
}

// „+“ oder „#“ für die Stellung nach dem Zug von `color`
function checkSuffix(sq, color) {
  const opp = other(color);
  if (!sq.includes(opp + 'K') || !inCheck(sq, opp)) return '';
  return hasLegalMove(sq, opp) ? '+' : '#';
}

// Notation eines Zugs from→to in der Stellung `before` (vor dem Zug) → `after`
function moveSan(before, after, from, to) {
  const piece = before[from];
  const type = typeOf(piece);
  const color = colorOf(piece);
  const captured = before[to] && colorOf(before[to]) !== color;
  let san;

  if (type === 'P') {
    const diagonal = fileOf(from) !== fileOf(to);
    san = diagonal ? `${FILES[fileOf(from)]}x${squareName(to)}` : squareName(to);
  } else {
    // Gleiche Figuren, die das Zielfeld ebenfalls erreichen könnten → eindeutig machen
    const rivals = [];
    for (let i = 0; i < 64; i++) {
      if (i !== from && before[i] === piece && targets(before, i).includes(to) && isLegal(before, i, to)) rivals.push(i);
    }
    let dis = '';
    if (rivals.length) {
      if (!rivals.some((i) => fileOf(i) === fileOf(from))) dis = FILES[fileOf(from)];
      else if (!rivals.some((i) => rowOf(i) === rowOf(from))) dis = String(8 - rowOf(from));
      else dis = squareName(from);
    }
    san = FIGURINE[type] + dis + (captured ? 'x' : '') + squareName(to);
  }
  return san + checkSuffix(after, color);
}

/**
 * Beschreibt den Schritt von `prev` (Verlaufseintrag) zur neuen Stellung `squares` nach `op`.
 * Ergebnis: { note, move, merge }
 *   note  – Text wie „12. ♘f3+“ oder null, wenn es kein Zug war
 *   move  – Daten des Zugs, damit ein Folgeschritt (Turm bei Rochade, Umwandlung, en passant) anschließen kann
 *   merge – true, wenn der Schritt mit dem vorherigen Eintrag zu einem Zug zusammengefasst wird
 *   next  – Zugnummer für den nächsten weißen Zug
 */
function describe(prev, op, squares) {
  const before = prev.squares;
  const last = prev.move; // Zug, der zu `prev` geführt hat (falls vorhanden)
  const label = (num, color, san) => (color === 'w' ? `${num}. ${san}` : `${num}… ${san}`);
  const nextNo = (num, color) => (color === 'b' ? num + 1 : num);

  if (op.type === 'reset') return { note: null, move: null, merge: false, next: 1 };
  if (op.type === 'clear') return { note: null, move: null, merge: false, next: 1 };

  if (op.type === 'move' && op.from !== op.to && before[op.from]) {
    const piece = before[op.from];
    const color = colorOf(piece);
    const type = typeOf(piece);
    const backRow = color === 'w' ? 7 : 0;

    // Rochade, König zuerst: König zieht zwei Felder von e1/e8
    if (type === 'K' && rowOf(op.from) === backRow && fileOf(op.from) === 4 && rowOf(op.to) === backRow
        && Math.abs(fileOf(op.to) - 4) === 2) {
      const short = fileOf(op.to) === 6;
      const rookFrom = at(backRow, short ? 7 : 0);
      const rookTo = at(backRow, short ? 5 : 3);
      const base = short ? 'O-O' : 'O-O-O';
      // Turm wurde schon vorher gezogen → beide Schritte sind ein Zug
      if (last && last.kind === 'plain' && last.from === rookFrom && last.to === rookTo && last.piece === color + 'R') {
        const san = base + checkSuffix(squares, color);
        return { note: label(last.num, color, san), move: { kind: 'castled', num: last.num, color }, merge: true, next: nextNo(last.num, color) };
      }
      const san = base + checkSuffix(squares, color);
      return {
        note: label(prev.next, color, san),
        move: { kind: 'castle', num: prev.next, color, base, rookFrom, rookTo },
        merge: false,
        next: nextNo(prev.next, color),
      };
    }

    // Rochade, zweiter Schritt: passender Turmzug direkt nach dem Königszug
    if (last && last.kind === 'castle' && piece === last.color + 'R' && op.from === last.rookFrom && op.to === last.rookTo) {
      const san = last.base + checkSuffix(squares, last.color);
      return { note: label(last.num, last.color, san), move: { kind: 'castled', num: last.num, color: last.color }, merge: true, next: nextNo(last.num, last.color) };
    }

    const san = moveSan(before, squares, op.from, op.to);
    const move = { kind: 'plain', num: prev.next, color, piece, from: op.from, to: op.to, san };
    const lastRow = color === 'w' ? 0 : 7;
    if (type === 'P' && rowOf(op.to) === lastRow) move.kind = 'promote';
    else if (type === 'P' && fileOf(op.from) !== fileOf(op.to) && !before[op.to]) {
      move.kind = 'ep';
      move.victim = at(rowOf(op.from), fileOf(op.to));
    }
    return { note: label(prev.next, color, san), move, merge: false, next: nextNo(prev.next, color) };
  }

  if (op.type === 'set' && last) {
    // Umwandlung: neue Figur der eigenen Farbe auf das Feld des Bauern gesetzt
    if (last.kind === 'promote' && op.square === last.to && op.piece && colorOf(op.piece) === last.color
        && 'QRBN'.includes(typeOf(op.piece))) {
      const base = last.san.replace(/[+#]$/, '');
      const san = `${base}=${FIGURINE[typeOf(op.piece)]}${checkSuffix(squares, last.color)}`;
      return {
        note: label(last.num, last.color, san),
        move: { ...last, kind: 'promoted', san },
        merge: true,
        next: nextNo(last.num, last.color),
      };
    }
    // En passant: geschlagener Bauer wird direkt danach vom Brett genommen
    if (last.kind === 'ep' && op.square === last.victim && op.piece === null
        && before[last.victim] === other(last.color) + 'P') {
      const base = last.san.replace(/[+#]$/, '');
      const san = `${base} e.p.${checkSuffix(squares, last.color)}`;
      return { note: label(last.num, last.color, san), move: { ...last, kind: 'done', san }, merge: true, next: nextNo(last.num, last.color) };
    }
  }

  // Figur hinzugefügt oder entfernt: kein Zug
  return { note: null, move: null, merge: false, next: prev.next };
}

module.exports = { describe };
