// The puzzle board on a canvas, played like the addon's (SOLC_Puzzle/Board.lua): click or tap two pieces to
// swap them, or a piece next to the gap to slide it. Keys: in sliding mode an arrow slides the piece on that
// side of the gap into it; in swap mode arrows move a cursor and Space or Enter picks the piece under it.

import { drawPicture, type Traits } from "./pictures";
import { isSolved, scramble, type Mode, type Move } from "./puzzle";

const PICTURE = 600;  // the picture's pixels: every grid size (3, 4, 5) divides it
const GRID_LINE = "rgba(0, 0, 0, 0.55)";
const COLORS = { selected: "255, 209, 0", target: "77, 255, 77", hover: "255, 255, 255" };

export class Board {
  onMove?: (moves: number) => void;
  onSolved?: (moves: number, seconds: number) => void;
  recording: Move[] = [];

  private context: CanvasRenderingContext2D;
  private picture = document.createElement("canvas");
  private size = 4;
  private mode: Mode = "swap";
  private slots: number[] = [];
  private playing = false;
  private moves = 0;
  private startedAt = 0;
  private selected?: number;  // slots
  private hovered?: number;
  private cursor?: number;
  private replaying?: { moves: Move[]; next: number; started: number; speed: number; onDone?: () => void };

  constructor(private canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d")!;
    this.picture.width = this.picture.height = PICTURE;
    canvas.tabIndex = 0;
    new ResizeObserver(() => this.fit()).observe(canvas);
    canvas.addEventListener("pointerdown", (event) => {
      const slot = this.slotAt(event);
      if (slot) this.click(slot);
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;  // touch has no hover
      const slot = this.slotAt(event);
      if (slot !== this.hovered) { this.hovered = slot; this.draw(); }
    });
    canvas.addEventListener("pointerleave", () => { this.hovered = undefined; this.draw(); });
    canvas.addEventListener("keydown", (event) => this.key(event));
  }

  // Draws the picture the pieces are cut from (call before start / showWhole).
  async load(traits: Traits) {
    await drawPicture(this.picture, traits);
  }

  start(mode: Mode, seed: number, size: number) {
    this.replaying = undefined;
    Object.assign(this, { mode, size, playing: true, moves: 0, selected: undefined, cursor: undefined });
    this.slots = scramble(mode, seed, size);
    this.recording = [];
    this.startedAt = performance.now();
    this.canvas.focus({ preventScroll: true });
    this.draw();
  }

  // The picture uncut (before a puzzle starts).
  showWhole(size = this.size) {
    this.replaying = undefined;
    this.size = size;
    this.playing = false;
    this.selected = undefined;
    this.slots = Array.from({ length: size * size + 1 }, (_, i) => i);
    this.draw();
  }

  stop() {
    this.playing = false;
    this.selected = undefined;
    this.draw();
  }

  get isPlaying() { return this.playing; }
  get isReplaying() { return this.replaying !== undefined; }
  get pictureCanvas() { return this.picture; }  // what the pieces are cut from (for the mini-boards)

  // Plays back a recorded solve: the same scramble, then each move at its time, speed times as fast.
  replay(mode: Mode, seed: number, size: number, moves: Move[], speed = 2, onDone?: () => void) {
    Object.assign(this, { mode, size, playing: false, selected: undefined });
    this.slots = scramble(mode, seed, size);
    this.replaying = { moves, next: 0, started: performance.now(), speed, onDone };
    const step = () => {
      const replay = this.replaying;
      if (!replay) return;
      const at = ((performance.now() - replay.started) / 1000) * replay.speed;
      while (replay.next < replay.moves.length && replay.moves[replay.next].t <= at) {
        const { a, b } = replay.moves[replay.next++];
        if (this.slots[a] !== undefined && this.slots[b] !== undefined) [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
      }
      if (replay.next >= replay.moves.length) {
        this.replaying = undefined;
        this.draw();
        replay.onDone?.();
        return;
      }
      this.draw();
      requestAnimationFrame(step);
    };
    step();
  }

  stopReplay() {
    this.replaying = undefined;
  }

  // How many pieces are in their place.
  inPlace(): number {
    let count = 0;
    for (let i = 1; i < this.slots.length; i++) if (this.slots[i] === i) count++;
    return count;
  }
  get elapsed() { return (performance.now() - this.startedAt) / 1000; }

  // --- Rules ---

  private gap() { return this.slots.indexOf(this.size * this.size); }

  private slidable(slot: number) {
    const gap = this.gap(), size = this.size;
    const sameRow = Math.floor((slot - 1) / size) === Math.floor((gap - 1) / size);
    return (Math.abs(slot - gap) === 1 && sameRow) || Math.abs(slot - gap) === size;
  }

  private swap(a: number, b: number) {
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this.recording.push({ t: this.elapsed, a, b });
    this.moves++;
    this.onMove?.(this.moves);
    if (isSolved(this.slots)) {
      this.playing = false;
      this.selected = undefined;
      this.onSolved?.(this.moves, this.elapsed);
    }
    this.draw();
  }

  private click(slot: number) {
    if (!this.playing) return;
    if (this.mode === "sliding") {
      if (this.slidable(slot)) this.swap(slot, this.gap());
    } else if (this.selected === undefined) {
      this.selected = slot;
      this.draw();
    } else {
      const first = this.selected;
      this.selected = undefined;
      if (first !== slot) this.swap(slot, first);  // the same piece again just deselects it
      else this.draw();
    }
  }

  private key(event: KeyboardEvent) {
    if (!this.playing) return;
    const directions: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    const direction = directions[event.key];
    const size = this.size;
    if (this.mode === "sliding" && direction) {
      // The piece on the far side of the gap moves in (Up moves the piece below the gap up).
      const gap = this.gap();
      const row = Math.floor((gap - 1) / size) - direction[0], col = ((gap - 1) % size) - direction[1];
      if (row >= 0 && col >= 0 && row < size && col < size) this.swap(row * size + col + 1, gap);
    } else if (this.mode === "swap" && direction) {
      const cursor = this.cursor ?? 1;
      const row = Math.max(0, Math.min(size - 1, Math.floor((cursor - 1) / size) + direction[0]));
      const col = Math.max(0, Math.min(size - 1, ((cursor - 1) % size) + direction[1]));
      this.cursor = this.hovered = row * size + col + 1;
      this.draw();
    } else if (this.mode === "swap" && (event.key === " " || event.key === "Enter")) {
      this.cursor ??= 1;
      this.hovered = this.cursor;
      this.click(this.cursor);
    } else {
      return;
    }
    event.preventDefault();
  }

  // --- Drawing ---

  private fit() {
    const ratio = window.devicePixelRatio || 1;
    const side = Math.round(this.canvas.clientWidth * ratio);
    if (side > 0 && this.canvas.width !== side) {
      this.canvas.width = this.canvas.height = side;
      this.draw();
    }
  }

  private slotAt(event: PointerEvent): number | undefined {
    const box = this.canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - box.left) / box.width) * this.size);
    const row = Math.floor(((event.clientY - box.top) / box.height) * this.size);
    if (col < 0 || row < 0 || col >= this.size || row >= this.size) return undefined;
    return row * this.size + col + 1;
  }

  // The outline state of a slot: gold = selected, green = a click would move or swap it, white = hover.
  private state(slot: number): keyof typeof COLORS | undefined {
    if (!this.playing) return undefined;
    if (slot === this.selected) return "selected";
    if (slot !== this.hovered) return undefined;
    if (this.mode === "sliding") return this.slidable(slot) ? "target" : undefined;
    return this.selected !== undefined ? "target" : "hover";
  }

  draw() {
    const context = this.context, side = this.canvas.width, size = this.size;
    if (!side || this.slots.length < 2) return;
    const active = this.playing || this.replaying !== undefined;
    paintBoard(context, side, this.picture, this.slots, size, {
      gap: this.mode === "sliding" && active,
      grid: active,
    });
    const edge = (i: number) => Math.round((i * side) / size);
    for (let slot = 1; slot <= size * size; slot++) {
      const state = this.state(slot);
      if (!state) continue;
      const col = (slot - 1) % size, row = Math.floor((slot - 1) / size);
      const x = edge(col), y = edge(row), cell = edge(col + 1) - x;
      const line = Math.max(2, side / 160);
      if (state !== "hover") {
        context.fillStyle = `rgba(${COLORS[state]}, 0.18)`;
        context.fillRect(x, y, cell, cell);
      }
      context.strokeStyle = `rgb(${COLORS[state]})`;
      context.lineWidth = line;
      context.strokeRect(x + line / 2, y + line / 2, cell - line, cell - line);
    }
  }
}

// Draws a board's pieces (slots) cut from picture onto a side x side canvas: the main board and the live
// mini-boards. gap: leave the last piece out (sliding, while playing); grid: lines between the pieces.
// A solved board that isn't being played is drawn whole, in one piece (no seams).
export function paintBoard(context: CanvasRenderingContext2D, side: number, picture: HTMLCanvasElement,
  slots: number[], size: number, options: { gap: boolean; grid: boolean }) {
  const source = picture.width / size;
  // Cuts on whole canvas pixels: a cut at a fraction of a pixel blurs into a faint seam between pieces.
  const edge = (i: number) => Math.round((i * side) / size);
  context.clearRect(0, 0, side, side);
  if (!options.grid && isSolved(slots)) {
    context.drawImage(picture, 0, 0, side, side);
    return;
  }
  context.fillStyle = "#0b0c0f";
  context.fillRect(0, 0, side, side);
  const gapPiece = options.gap ? size * size : -1;
  for (let slot = 1; slot <= size * size; slot++) {
    const piece = slots[slot];
    if (piece === gapPiece) continue;
    const col = (slot - 1) % size, row = Math.floor((slot - 1) / size);
    const x = edge(col), y = edge(row);
    const sx = ((piece - 1) % size) * source, sy = Math.floor((piece - 1) / size) * source;
    context.drawImage(picture, sx, sy, source, source, x, y, edge(col + 1) - x, edge(row + 1) - y);
  }
  if (options.grid) {
    context.fillStyle = GRID_LINE;
    const width = Math.max(1, Math.round(side / 300));
    for (let i = 1; i < size; i++) {
      context.fillRect(edge(i) - Math.floor(width / 2), 0, width, side);
      context.fillRect(0, edge(i) - Math.floor(width / 2), side, width);
    }
  }
}
