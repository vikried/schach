// Schachregeln – wird vom Server (Prüfung) und vom Browser (Zielfelder anzeigen) benutzt.
// Feld 0 = a8, Feld 63 = h1. Weiß zieht „nach oben“ (Index wird kleiner).
//
// Spielzustand: { squares, turn: 'w'|'b', castling: 'KQkq', ep: Feld|null, half, full }
// Zug:          { from, to, promo?: 'Q'|'R'|'B'|'N', castle?: 'K'|'Q', ep?: true, double?: true }
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const FIGURINE = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
  const fileOf = (i) => i & 7;
  const rowOf = (i) => i >> 3; // 0 = Reihe 8
  const at = (r, f) => (r >= 0 && r < 8 && f >= 0 && f < 8 ? r * 8 + f : -1);
  const squareName = (i) => FILES[fileOf(i)] + (8 - rowOf(i));
  const colorOf = (p) => p && p[0];
  const typeOf = (p) => p && p[1];
  const other = (c) => (c === 'w' ? 'b' : 'w');

  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // Ecken der Türme → Rochaderecht, das verloren geht, wenn dort etwas zieht oder geschlagen wird
  const CORNER_RIGHT = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };

  function startSquares() {
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

  function startState() {
    return { squares: startSquares(), turn: 'w', castling: 'KQkq', ep: null, half: 0, full: 1 };
  }

  // Felder, die die Figur auf `from` angreift (Bauern: nur die Schlagfelder)
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
      case 'P': steps([[colorOf(p) === 'w' ? -1 : 1, -1], [colorOf(p) === 'w' ? -1 : 1, 1]]); break;
    }
    return out;
  }

  function isAttacked(sq, target, byColor) {
    for (let i = 0; i < 64; i++) {
      if (colorOf(sq[i]) === byColor && attacks(sq, i).includes(target)) return true;
    }
    return false;
  }

  function kingSquare(sq, color) {
    return sq.indexOf(color + 'K');
  }

  function inCheck(sq, color) {
    const k = kingSquare(sq, color);
    return k >= 0 && isAttacked(sq, k, other(color));
  }

  // Alle Züge ohne Rücksicht auf den eigenen König
  function pseudoMoves(state) {
    const sq = state.squares;
    const c = state.turn;
    const moves = [];
    for (let i = 0; i < 64; i++) {
      const p = sq[i];
      if (colorOf(p) !== c) continue;
      if (typeOf(p) === 'P') {
        const dir = c === 'w' ? -1 : 1;
        const r = rowOf(i);
        const f = fileOf(i);
        const lastRow = c === 'w' ? 0 : 7;
        const add = (to, extra) => {
          if (rowOf(to) === lastRow) for (const promo of 'QRBN') moves.push({ from: i, to, promo });
          else moves.push({ from: i, to, ...extra });
        };
        const one = at(r + dir, f);
        if (one >= 0 && !sq[one]) {
          add(one);
          const two = at(r + 2 * dir, f);
          if (r === (c === 'w' ? 6 : 1) && !sq[two]) moves.push({ from: i, to: two, double: true });
        }
        for (const df of [-1, 1]) {
          const t = at(r + dir, f + df);
          if (t < 0) continue;
          if (sq[t] && colorOf(sq[t]) !== c) add(t);
          else if (t === state.ep && !sq[t]) moves.push({ from: i, to: t, ep: true });
        }
        continue;
      }
      for (const t of attacks(sq, i)) if (colorOf(sq[t]) !== c) moves.push({ from: i, to: t });

      if (typeOf(p) === 'K') {
        const home = c === 'w' ? 60 : 4;
        if (i !== home || inCheck(sq, c)) continue;
        const opp = other(c);
        const rights = c === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (state.castling.includes(rights[0]) && sq[home + 3] === c + 'R' && !sq[home + 1] && !sq[home + 2]
            && !isAttacked(sq, home + 1, opp) && !isAttacked(sq, home + 2, opp)) {
          moves.push({ from: home, to: home + 2, castle: 'K' });
        }
        if (state.castling.includes(rights[1]) && sq[home - 4] === c + 'R' && !sq[home - 1] && !sq[home - 2] && !sq[home - 3]
            && !isAttacked(sq, home - 1, opp) && !isAttacked(sq, home - 2, opp)) {
          moves.push({ from: home, to: home - 2, castle: 'Q' });
        }
      }
    }
    return moves;
  }

  // Führt einen (als gültig angenommenen) Zug aus und liefert den neuen Zustand
  function applyMove(state, m) {
    const sq = state.squares.slice();
    const piece = sq[m.from];
    const c = colorOf(piece);
    const capture = Boolean(sq[m.to]) || Boolean(m.ep);
    sq[m.to] = m.promo ? c + m.promo : piece;
    sq[m.from] = null;
    if (m.ep) sq[at(rowOf(m.from), fileOf(m.to))] = null;
    if (m.castle === 'K') {
      sq[m.from + 1] = sq[m.from + 3];
      sq[m.from + 3] = null;
    } else if (m.castle === 'Q') {
      sq[m.from - 1] = sq[m.from - 4];
      sq[m.from - 4] = null;
    }
    let castling = state.castling;
    if (typeOf(piece) === 'K') castling = castling.replace(c === 'w' ? /[KQ]/g : /[kq]/g, '');
    for (const s of [m.from, m.to]) if (CORNER_RIGHT[s]) castling = castling.replace(CORNER_RIGHT[s], '');
    return {
      squares: sq,
      turn: other(c),
      castling,
      ep: m.double ? (m.from + m.to) / 2 : null,
      half: typeOf(piece) === 'P' || capture ? 0 : state.half + 1,
      full: c === 'b' ? state.full + 1 : state.full,
    };
  }

  function legalMoves(state) {
    return pseudoMoves(state).filter((m) => !inCheck(applyMove(state, m).squares, state.turn));
  }

  // Remis, weil keiner mehr mattsetzen kann (K–K, K+L–K, K+S–K, nur Läufer auf gleichfarbigen Feldern)
  function insufficientMaterial(sq) {
    const minors = [];
    for (let i = 0; i < 64; i++) {
      const t = typeOf(sq[i]);
      if (!t || t === 'K') continue;
      if (t === 'P' || t === 'R' || t === 'Q') return false;
      minors.push({ t, shade: (rowOf(i) + fileOf(i)) % 2 });
    }
    if (minors.length <= 1) return true;
    return minors.every((m) => m.t === 'B') && minors.every((m) => m.shade === minors[0].shade);
  }

  function status(state) {
    const moves = legalMoves(state);
    const check = inCheck(state.squares, state.turn);
    return {
      check,
      checkSquare: check ? kingSquare(state.squares, state.turn) : null,
      mate: check && !moves.length,
      stalemate: !check && !moves.length,
      insufficient: insufficientMaterial(state.squares),
      moves,
    };
  }

  // Algebraische Notation mit Figurensymbolen, z. B. „♘fxe5+“, „O-O“, „exd8=♕#“
  function san(state, m) {
    const sq = state.squares;
    const piece = sq[m.from];
    const type = typeOf(piece);
    let s;
    if (m.castle) {
      s = m.castle === 'K' ? 'O-O' : 'O-O-O';
    } else if (type === 'P') {
      const capture = Boolean(sq[m.to]) || m.ep;
      s = (capture ? `${FILES[fileOf(m.from)]}x` : '') + squareName(m.to) + (m.promo ? `=${FIGURINE[m.promo]}` : '');
    } else {
      const rivals = legalMoves(state).filter((o) => o.to === m.to && o.from !== m.from && sq[o.from] === piece);
      let dis = '';
      if (rivals.length) {
        if (!rivals.some((o) => fileOf(o.from) === fileOf(m.from))) dis = FILES[fileOf(m.from)];
        else if (!rivals.some((o) => rowOf(o.from) === rowOf(m.from))) dis = String(8 - rowOf(m.from));
        else dis = squareName(m.from);
      }
      s = FIGURINE[type] + dis + (sq[m.to] ? 'x' : '') + squareName(m.to);
    }
    const after = applyMove(state, m);
    if (inCheck(after.squares, after.turn)) s += legalMoves(after).length ? '+' : '#';
    return s;
  }

  // Rochaderechte, die zur Stellung passen (König und Turm auf Ausgangsfeldern), höchstens `allowed`
  function deriveCastling(sq, allowed = 'KQkq') {
    let out = '';
    if (sq[60] === 'wK' && sq[63] === 'wR') out += 'K';
    if (sq[60] === 'wK' && sq[56] === 'wR') out += 'Q';
    if (sq[4] === 'bK' && sq[7] === 'bR') out += 'k';
    if (sq[4] === 'bK' && sq[0] === 'bR') out += 'q';
    return [...out].filter((r) => allowed.includes(r)).join('');
  }

  // Fehlermeldung, wenn mit dieser Stellung nicht gespielt werden kann, sonst null
  function validate(state) {
    const sq = state.squares;
    for (const [c, name] of [['w', 'Weiß'], ['b', 'Schwarz']]) {
      const kings = sq.filter((p) => p === c + 'K').length;
      if (kings !== 1) return `${name} braucht genau einen König (gerade: ${kings}).`;
    }
    for (let i = 0; i < 64; i++) {
      if (typeOf(sq[i]) === 'P' && (rowOf(i) === 0 || rowOf(i) === 7)) return `Auf ${squareName(i)} steht ein Bauer auf der ersten oder letzten Reihe.`;
    }
    if (inCheck(sq, other(state.turn))) {
      return `${state.turn === 'w' ? 'Schwarz' : 'Weiß'} steht im Schach, obwohl ${state.turn === 'w' ? 'Weiß' : 'Schwarz'} am Zug ist.`;
    }
    return null;
  }

  // Schlüssel für Stellungswiederholung (en passant zählt nur, wenn es wirklich möglich ist)
  function positionKey(state) {
    const epPossible = state.ep !== null && legalMoves(state).some((m) => m.ep);
    return `${state.squares.map((p) => p || '-').join('')} ${state.turn} ${state.castling} ${epPossible ? state.ep : '-'}`;
  }

  const api = {
    FIGURINE, squareName, colorOf, typeOf, other,
    startSquares, startState, applyMove, legalMoves, status, san, deriveCastling, validate, positionKey, inCheck,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Chess = api;
})(typeof window !== 'undefined' ? window : this);
