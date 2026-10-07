import { Board } from "./board";
import { connect, inDiscord, type Player } from "./discord";
import { pictureRarity, rollTraits, traitLines, type Rarity, type Traits } from "./pictures";
import { DEFAULT_SIZE, newSeed, type Mode } from "./puzzle";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");
const list = $("players");

// --- Who's here ---

function renderPlayers(players: Player[], me?: Player) {
  list.replaceChildren(
    ...players.map((player) => {
      const item = document.createElement("li");
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = player.name.slice(0, 1).toUpperCase();
      if (player.avatarUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = player.avatarUrl;
        img.onerror = () => img.remove();  // keep the initial if Discord's image can't load
        avatar.append(img);
      }
      const name = document.createElement("span");
      name.textContent = player.name + (me && player.id === me.id ? " (you)" : "");
      item.append(avatar, name);
      return item;
    }),
  );
}

let me: Player | undefined;
let latest: Player[] = [];
connect((players) => {
  latest = players;
  renderPlayers(players, me);
})
  .then((session) => {
    me = session.me;
    renderPlayers(latest, me);
    status.textContent = inDiscord ? `Welcome, ${me.name}.` : "Preview outside Discord: the players are made up.";
  })
  .catch((error: unknown) => {
    status.textContent = `Couldn't connect to Discord: ${error instanceof Error ? error.message : String(error)}`;
    status.classList.add("error");
  });

// --- Practice puzzle ---

const canvas = $<HTMLCanvasElement>("board");
const board = new Board(canvas);
const timeText = $("time"), movesText = $("moves"), resultText = $("result"), hintText = $("hint");
const startButton = $<HTMLButtonElement>("start"), pictureButton = $<HTMLButtonElement>("new-picture");
const rarityText = $("picture-rarity"), traitList = $("traits"), seedText = $("seed");
const RARITY_NAMES: Record<Rarity, string> = { uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const HINTS: Record<Mode, string> = {
  swap: "Click two pieces to swap them. Keys: arrows and Space.",
  sliding: "Click a piece next to the gap to slide it in. Keys: arrows.",
};

let mode: Mode = "swap";
let size = DEFAULT_SIZE;
let traits: Traits;

// Best times per mode and size, kept in this browser only.
function bestTime(): number | undefined {
  try {
    const value = Number(localStorage.getItem(`best:${mode}:${size}`));
    return value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
function saveBest(seconds: number) {
  try { localStorage.setItem(`best:${mode}:${size}`, String(seconds)); } catch { /* private window */ }
}
const formatTime = (seconds: number) =>
  seconds >= 60 ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}` : seconds.toFixed(1);

function showBest() {
  const best = bestTime();
  resultText.textContent = best ? `Best ${mode} ${size}×${size}: ${formatTime(best)}` : "";
}

function resetClock() {
  timeText.textContent = "0.0";
  movesText.textContent = "0 moves";
}

async function newPicture() {
  traits = rollTraits();
  const rarity = pictureRarity(traits);
  pictureButton.disabled = startButton.disabled = true;
  try {
    await board.load(traits);
  } catch (error) {
    resultText.textContent = error instanceof Error ? error.message : String(error);
    return;
  } finally {
    pictureButton.disabled = startButton.disabled = false;
  }
  canvas.dataset.rarity = rarity;
  rarityText.dataset.rarity = rarity;
  rarityText.textContent = RARITY_NAMES[rarity];
  traitList.replaceChildren(
    ...traitLines(traits).map((line) => {
      const item = document.createElement("li");
      const layer = document.createElement("span");
      layer.textContent = line.layer;
      const name = document.createElement("span");
      name.textContent = line.name;
      name.dataset.rarity = line.rarity;
      item.append(layer, name);
      return item;
    }),
  );
  board.showWhole(size);
  resetClock();
  seedText.textContent = "";
  startButton.textContent = "Start";
  showBest();
}

function start() {
  const seed = newSeed();
  board.start(mode, seed, size);
  resetClock();
  resultText.textContent = "";
  hintText.textContent = HINTS[mode];
  seedText.textContent = `Puzzle ${seed} (${mode}, ${size}×${size})`;
  startButton.textContent = "Restart";
  tick();
}

function tick() {
  if (!board.isPlaying) return;
  timeText.textContent = formatTime(board.elapsed);
  requestAnimationFrame(tick);
}

board.onMove = (moves) => { movesText.textContent = `${moves} move${moves === 1 ? "" : "s"}`; };
board.onSolved = (moves, seconds) => {
  timeText.textContent = formatTime(seconds);
  const best = bestTime();
  const record = !best || seconds < best;
  if (record) saveBest(seconds);
  resultText.textContent = record
    ? `Solved in ${formatTime(seconds)} with ${moves} moves. New best!`
    : `Solved in ${formatTime(seconds)} with ${moves} moves. Best: ${formatTime(best!)}`;
  hintText.textContent = "";
  startButton.textContent = "Play again";
};

// Mode and size: changing either goes back to the whole picture.
function choose(group: "mode" | "size", value: string) {
  if (group === "mode") mode = value as Mode;
  else size = Number(value);
  for (const button of document.querySelectorAll<HTMLButtonElement>(`[data-${group}]`)) {
    button.setAttribute("aria-pressed", String(button.dataset[group] === value));
  }
  board.showWhole(size);
  resetClock();
  hintText.textContent = "";
  seedText.textContent = "";
  startButton.textContent = "Start";
  showBest();
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
  button.addEventListener("click", () => choose("mode", button.dataset.mode!));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
  button.addEventListener("click", () => choose("size", button.dataset.size!));
}
startButton.addEventListener("click", start);
pictureButton.addEventListener("click", newPicture);
newPicture();
