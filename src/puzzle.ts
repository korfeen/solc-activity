// The puzzle rules, ported from the addon (SOLC_Puzzle/Board.lua and Replays.lua) so a seed gives exactly the
// same puzzle in Discord as in game, and a recorded solve plays back in either.
//   swap     click two pieces to swap them
//   sliding  the classic 15-puzzle: the last piece is left out, slide pieces into the gap
// Slots and pieces are numbered from 1, as in Lua: slots[slot] = the piece there; solved when slots[i] === i.

export type Mode = "swap" | "sliding";
export const SIZES = [3, 4, 5] as const;
export const DEFAULT_SIZE = 4;

// Lua 5.1's % on numbers (doubles): a - floor(a / b) * b. JavaScript's % rounds differently, and the
// generator's products go past 2^53, so this must match Lua's exactly for the same scrambles.
const luaMod = (a: number, b: number) => a - Math.floor(a / b) * b;

// Deterministic random numbers: rng(n) -> 1..n (Board.lua's Random).
function random(seed: number) {
  let state = luaMod(seed, 2147483648);
  return (n: number) => {
    state = luaMod(state * 1103515245 + 12345, 2147483648);
    return luaMod(Math.floor(state / 65536), n) + 1;
  };
}

export function isSolved(slots: number[]): boolean {
  for (let i = 1; i < slots.length; i++) if (slots[i] !== i) return false;
  return true;
}

// The scrambled board for a seed: slots[1..size*size] (index 0 unused).
export function scramble(mode: Mode, seed: number, size: number): number[] {
  const rng = random(seed);
  const count = size * size;
  const slots = [0];
  for (let i = 1; i <= count; i++) slots[i] = i;
  do {
    if (mode === "sliding") {
      // Random slides from the solved board, so it's always solvable; never straight back.
      let gap = count;
      let previous: number | undefined;
      for (let step = 0; step < 15 * count; step++) {
        const row = Math.floor((gap - 1) / size), col = (gap - 1) % size;
        let options: number[] = [];
        if (row > 0) options.push(gap - size);
        if (row < size - 1) options.push(gap + size);
        if (col > 0) options.push(gap - 1);
        if (col < size - 1) options.push(gap + 1);
        options = options.filter((option) => option !== previous);
        const from = options[rng(options.length) - 1];
        [slots[gap], slots[from]] = [slots[from], slots[gap]];
        previous = gap;
        gap = from;
      }
    } else {
      for (let i = count; i >= 2; i--) {
        const j = rng(i);
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
    }
  } while (isSolved(slots));
  return slots;
}

// A new seed, in the addon's range (math.random(1, 2^30)).
export const newSeed = () => 1 + Math.floor(Math.random() * 2 ** 30);

// --- Recorded moves (Replays.lua): 5 characters per move, tenths of a second (3) and the two slots (1 each) ---

export interface Move {
  t: number;  // seconds since the start
  a: number;  // the two slots swapped
  b: number;
}

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";

function encode(n: number, width: number) {
  let s = "";
  for (let i = 0; i < width; i++) {
    s = CHARS[n % 64] + s;
    n = Math.floor(n / 64);
  }
  return s;
}
const decode = (text: string) => [...text].reduce((n, c) => n * 64 + Math.max(0, CHARS.indexOf(c)), 0);

export const encodeMoves = (moves: Move[]) =>
  moves.map((m) => encode(Math.min(262143, Math.floor(m.t * 10)), 3) + encode(m.a, 1) + encode(m.b, 1)).join("");

export function decodeMoves(text: string): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i + 5 <= text.length; i += 5) {
    moves.push({ t: decode(text.slice(i, i + 3)) / 10, a: decode(text[i + 3]), b: decode(text[i + 4]) });
  }
  return moves;
}

// A scramble with moves applied (a mirrored or replayed board), skipping any that don't fit.
export function applyMoves(slots: number[], moves: Move[]): number[] {
  const out = [...slots];
  for (const { a, b } of moves) {
    if (out[a] !== undefined && out[b] !== undefined && a > 0 && b > 0) [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}

export function countInPlace(slots: number[]): number {
  let count = 0;
  for (let i = 1; i < slots.length; i++) if (slots[i] === i) count++;
  return count;
}

// Encoded moves are 5 characters each from the replay alphabet.
export const validMoveText = (text: string) => text.length % 5 === 0 && text.length <= 5 * 4000 && /^[0-9a-zA-Z+/]*$/.test(text);
