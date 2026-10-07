import { Board } from "./board";
import { connect, inDiscord, type Player } from "./discord";
import { pictureRarity, rollTraits, traitLines, type Rarity, type Traits } from "./pictures";
import type { Race, RoomState } from "./protocol";
import { DEFAULT_SIZE, encodeMoves, newSeed, type Mode } from "./puzzle";
import { RoomClient } from "./room";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");
const list = $("players");
const canvas = $<HTMLCanvasElement>("board");
const board = new Board(canvas);
const countdown = $("countdown");
const raceButton = $<HTMLButtonElement>("race"), raceStatus = $("race-status");
const puzzleTitle = $("puzzle-title");
const timeText = $("time"), movesText = $("moves"), resultText = $("result"), hintText = $("hint");
const startButton = $<HTMLButtonElement>("start"), pictureButton = $<HTMLButtonElement>("new-picture");
const rarityText = $("picture-rarity"), traitList = $("traits"), seedText = $("seed");
const choiceButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode], [data-size]")];

const RARITY_NAMES: Record<Rarity, string> = { uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const HINTS: Record<Mode, string> = {
  swap: "Click two pieces to swap them. Keys: arrows and Space.",
  sliding: "Click a piece next to the gap to slide it in. Keys: arrows.",
};
const PLACES = ["🥇", "🥈", "🥉"];

const formatTime = (seconds: number) =>
  seconds >= 60 ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}` : seconds.toFixed(1);

let mode: Mode = "swap";
let size = DEFAULT_SIZE;
let traits: Traits;
let me: Player | undefined;
let participants: Player[] = [];  // from Discord, until the room answers
let room: RoomClient | undefined;
let racing: Race | undefined;    // the race we're in, until it's over

// --- Who's here: the room's players with their race standing, or Discord's participant list ---

function standing(race: Race | null, id: string): string {
  if (!race || !race.entrants.includes(id)) return race && !race.over ? "watching" : "";
  const finish = race.finishes[id];
  if (finish) {
    const place = Object.values(race.finishes).filter((other) => other.ms < finish.ms).length;
    return `${PLACES[place] ?? `#${place + 1}`} ${formatTime(finish.ms / 1000)}`;
  }
  if (race.gaveUp.includes(id)) return "gave up";
  if (race.over) return "didn't finish";
  return `${race.progress[id] ?? 0}/${race.size * race.size}`;
}

function renderPlayers() {
  const state = room?.state;
  const players: Player[] = state?.players.length ? state.players : participants;
  const race = state?.race ?? null;
  // Finished racers first, by time.
  const order = (id: string) => race?.finishes[id]?.ms ?? Infinity;
  list.replaceChildren(
    ...[...players].sort((a, b) => order(a.id) - order(b.id)).map((player) => {
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
      name.className = "name";
      name.textContent = player.name + (me && player.id === me.id ? " (you)" : "");
      const note = document.createElement("span");
      note.className = "standing";
      note.textContent = standing(race, player.id);
      item.append(avatar, name, note);
      return item;
    }),
  );
}

// --- The picture and the board ---

function showPicture(newTraits: Traits) {
  traits = newTraits;
  const rarity = pictureRarity(traits);
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
}

function resetClock() {
  timeText.textContent = "0.0";
  movesText.textContent = "0 moves";
}

function tick() {
  if (!board.isPlaying) return;
  timeText.textContent = formatTime(board.elapsed);
  requestAnimationFrame(tick);
}

function setChoices(newMode: Mode, newSize: number) {
  mode = newMode;
  size = newSize;
  for (const button of choiceButtons) {
    const pressed = button.dataset.mode ? button.dataset.mode === mode : Number(button.dataset.size) === size;
    button.setAttribute("aria-pressed", String(pressed));
  }
}

// Practice controls are locked while racing.
function lockPractice(locked: boolean) {
  for (const button of [...choiceButtons, pictureButton]) button.disabled = locked;
  puzzleTitle.textContent = locked ? "Race" : "Practice";
}

// --- Practice ---

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
function showBest() {
  const best = bestTime();
  resultText.textContent = best ? `Best ${mode} ${size}×${size}: ${formatTime(best)}` : "";
}

function toWhole() {
  board.showWhole(size);
  resetClock();
  hintText.textContent = "";
  seedText.textContent = "";
  startButton.textContent = "Start";
  showBest();
}

async function newPicture() {
  const rolled = rollTraits();
  pictureButton.disabled = startButton.disabled = true;
  try {
    await board.load(rolled);
  } catch (error) {
    resultText.textContent = error instanceof Error ? error.message : String(error);
    return;
  } finally {
    pictureButton.disabled = startButton.disabled = false;
  }
  showPicture(rolled);
  toWhole();
}

function startPractice() {
  const seed = newSeed();
  board.start(mode, seed, size);
  resetClock();
  resultText.textContent = "";
  hintText.textContent = HINTS[mode];
  seedText.textContent = `Puzzle ${seed} (${mode}, ${size}×${size})`;
  startButton.textContent = "Restart";
  tick();
}

// --- Racing ---

let countdownTimer: number | undefined;

// A new race called (we're an entrant): load its picture, count down to the server's start, then play.
async function joinRace(race: Race) {
  racing = race;
  lockPractice(true);
  setChoices(race.mode, race.size);
  startButton.textContent = "Give up";
  resultText.textContent = "";
  seedText.textContent = `Puzzle ${race.seed} (${race.mode}, ${race.size}×${race.size})`;
  hintText.textContent = HINTS[race.mode];
  resetClock();
  await board.load(race.traits);
  if (racing?.id !== race.id) return;  // (it ended while the art loaded)
  showPicture(race.traits);
  board.showWhole(race.size);
  window.clearInterval(countdownTimer);
  const step = () => {
    const left = race.startsAt - room!.serverNow();
    if (racing?.id !== race.id) return;
    if (left > 0) {
      countdown.hidden = false;
      countdown.textContent = String(Math.ceil(left / 1000));
      return;
    }
    window.clearInterval(countdownTimer);
    countdown.textContent = "SMASH!";
    setTimeout(() => { countdown.hidden = true; }, 600);
    board.start(race.mode, race.seed, race.size);
    tick();
  };
  countdownTimer = window.setInterval(step, 100);
  step();
}

function endRace(race: Race) {
  window.clearInterval(countdownTimer);
  countdown.hidden = true;
  if (board.isPlaying) board.stop();
  racing = undefined;
  lockPractice(false);
  startButton.textContent = "Start";
  hintText.textContent = "";
  const winner = Object.entries(race.finishes).sort((a, b) => a[1].ms - b[1].ms)[0];
  const name = (id: string) => room?.state.players.find((p) => p.id === id)?.name ?? "Someone";
  resultText.textContent = winner
    ? `${name(winner[0])} won in ${formatTime(winner[1].ms / 1000)} with ${winner[1].moves} moves!`
    : "Nobody finished that one.";
}

function onRoomState(state: RoomState) {
  const race = state.race;
  const mine = race && me && race.entrants.includes(me.id);
  if (race && !race.over && mine && racing?.id !== race.id) joinRace(race);
  if (racing && race?.id === racing.id && race.over) endRace(race);
  raceButton.disabled = !!race && !race.over;
  raceStatus.textContent = !race || race.over
    ? "Race everyone here on the same puzzle."
    : mine ? `Racing: ${race.mode}, ${race.size}×${race.size}` : "A race is on. You're in the next one.";
  renderPlayers();
}

// --- Board events ---

board.onMove = (moves) => {
  movesText.textContent = `${moves} move${moves === 1 ? "" : "s"}`;
  if (racing) room?.send({ type: "progress", raceId: racing.id, inPlace: board.inPlace() });
};
board.onSolved = (moves, seconds) => {
  timeText.textContent = formatTime(seconds);
  hintText.textContent = "";
  if (racing) {
    room?.send({ type: "finish", raceId: racing.id, moves: encodeMoves(board.recording) });
    resultText.textContent = "Solved! Waiting for the others…";
    startButton.textContent = "Start";
    return;
  }
  const best = bestTime();
  const record = !best || seconds < best;
  if (record) saveBest(seconds);
  resultText.textContent = record
    ? `Solved in ${formatTime(seconds)} with ${moves} moves. New best!`
    : `Solved in ${formatTime(seconds)} with ${moves} moves. Best: ${formatTime(best!)}`;
  startButton.textContent = "Play again";
};

// --- Buttons ---

for (const button of choiceButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.mode) setChoices(button.dataset.mode as Mode, size);
    else setChoices(mode, Number(button.dataset.size));
    toWhole();
  });
}
startButton.addEventListener("click", () => {
  if (racing) {
    if (board.isPlaying) {
      room?.send({ type: "giveUp", raceId: racing.id });
      board.stop();
      resultText.textContent = "You gave up. Waiting for the others…";
    }
    return;
  }
  startPractice();
});
pictureButton.addEventListener("click", newPicture);
raceButton.addEventListener("click", () => room?.send({ type: "race", mode, size }));

// --- Start up ---

connect((players) => {
  participants = players;
  renderPlayers();
})
  .then((session) => {
    me = session.me;
    renderPlayers();
    status.textContent = inDiscord ? `Welcome, ${me.name}.` : "Preview outside Discord: the players are made up.";
    if (session.accessToken) {
      room = new RoomClient(session.instanceId, session.accessToken);
      room.onState = onRoomState;
      room.onError = (message) => { raceStatus.textContent = message; };
    } else {
      raceStatus.textContent = "Races work inside Discord.";
    }
  })
  .catch((error: unknown) => {
    status.textContent = `Couldn't connect to Discord: ${error instanceof Error ? error.message : String(error)}`;
    status.classList.add("error");
  });
newPicture();
