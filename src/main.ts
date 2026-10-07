import { Board, paintBoard } from "./board";
import { connect, inDiscord, type Player } from "./discord";
import { initOgre, isOgre, onOgreChange, say, setOgre, T } from "./ogre";
import { pictureRarity, rollTraits, traitLines, type Rarity, type Traits } from "./pictures";
import type { Race, RoomState } from "./protocol";
import { applyMoves, countInPlace, decodeMoves, DEFAULT_SIZE, encodeMoves, isSolved, newSeed, scramble, type Mode } from "./puzzle";
import { RoomClient } from "./room";
import { isMuted, setMuted, sounds } from "./sound";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");
const list = $("players");
const canvas = $<HTMLCanvasElement>("board");
const board = new Board(canvas);
const countdown = $("countdown");
const rivals = $("rivals");
const raceButton = $<HTMLButtonElement>("race"), raceStatus = $("race-status");
const puzzleTitle = $("puzzle-title");
const timeText = $("time"), movesText = $("moves"), resultText = $("result"), hintText = $("hint");
const startButton = $<HTMLButtonElement>("start"), pictureButton = $<HTMLButtonElement>("new-picture");
const rarityText = $("picture-rarity"), traitList = $("traits"), seedText = $("seed");
const ogreButton = $<HTMLButtonElement>("ogre-toggle"), muteButton = $<HTMLButtonElement>("mute");
const choiceButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode], [data-size]")];

// Every text here has a normal and an ogre version (ALL CAPS, five letters a word at most; names are exempt).
const RARITY_NAMES: Record<Rarity, [string, string]> = {
  uncommon: ["Uncommon", "GREEN"], rare: ["Rare", "BLUE"], epic: ["Epic", "PURPL"], legendary: ["Legendary", "ORANG"],
};
const HINTS: Record<Mode, [string, string]> = {
  swap: ["Click two pieces to swap them. Keys: arrows and Space.", "CLICK TWO. SWAP!"],
  sliding: ["Click a piece next to the gap to slide it in. Keys: arrows.", "CLICK NEXT TO HOLE."],
};
const START_LABELS = { start: ["Start", "GO"], restart: ["Restart", "AGAIN"], again: ["Play again", "AGAIN"], giveUp: ["Give up", "QUIT"] } as const;
const PLACES = ["🥇", "🥈", "🥉"];

const formatTime = (seconds: number) =>
  seconds >= 60 ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}` : seconds.toFixed(1);
const loud = (name: string) => (isOgre() ? name.toUpperCase() : name);

let mode: Mode = "swap";
let size = DEFAULT_SIZE;
let traits: Traits;
let me: Player | undefined;
let participants: Player[] = [];  // from Discord, until the room answers
let room: RoomClient | undefined;
let racing: Race | undefined;    // the race we're in, until it's over
let shownRace: string | undefined; // the race whose picture the board has (for the mini-boards and replays)
let movesCount = 0;
let lastInPlace = 0;

initOgre();

// The texts that change, each kept as a function so ogre mode can redraw it.
const setStart = (label: keyof typeof START_LABELS) => say(startButton, () => T(START_LABELS[label][0], START_LABELS[label][1]));
const setResult = (render: () => string) => say(resultText, render);
const setHint = (hint: Mode | null) => say(hintText, () => (hint ? T(...HINTS[hint]) : ""));
const setMoves = (moves: number) => {
  movesCount = moves;
  say(movesText, () => T(`${movesCount} move${movesCount === 1 ? "" : "s"}`, `${movesCount} MOVE`));
};
const setTitle = (race: boolean) => say(puzzleTitle, () => (race ? T("Race", "RACE") : T("Practice", "THUNK")));

// A player's board in a race: its scramble with their moves so far.
const scrambles = new Map<string, number[]>();
function raceSlots(race: Race, id: string): number[] {
  let start = scrambles.get(race.id);
  if (!start) {
    start = scramble(race.mode, race.seed, race.size);
    scrambles.set(race.id, start);
  }
  return applyMoves(start, decodeMoves(race.moves?.[id] ?? ""));
}

// --- Who's here: the room's players with their race standing, or Discord's participant list ---

function standing(race: Race | null, id: string): string {
  if (!race || !race.entrants.includes(id)) return race && !race.over ? T("watching", "WATCH") : "";
  const finish = race.finishes[id];
  if (finish) {
    const place = Object.values(race.finishes).filter((other) => other.ms < finish.ms).length;
    return `${PLACES[place] ?? `#${place + 1}`} ${formatTime(finish.ms / 1000)}`;
  }
  if (race.gaveUp.includes(id)) return T("gave up", "QUIT");
  if (race.over) return T("didn't finish", "NOPE");
  return `${countInPlace(raceSlots(race, id))}/${race.size * race.size}`;
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
      name.textContent = loud(player.name) + (me && player.id === me.id ? T(" (you)", " (YOU)") : "");
      const note = document.createElement("span");
      note.className = "standing";
      note.textContent = standing(race, player.id);
      item.append(avatar, name, note);
      return item;
    }),
  );
}

// --- Everyone's boards in miniature: live while racing (not yours), all of them afterwards to replay ---

const rivalCanvases = new Map<string, HTMLCanvasElement>();
const playerName = (id: string) => loud(room?.state.players.find((p) => p.id === id)?.name ?? T("Someone", "SOME OGRE"));

function renderRivals(race: Race | null) {
  if (!race || race.id !== shownRace) {
    rivals.replaceChildren();
    rivalCanvases.clear();
    return;
  }
  const shown = race.entrants.filter((id) => race.over || id !== me?.id);
  const buttons = shown.map((id) => {
    let canvas = rivalCanvases.get(id);
    const button = (canvas?.parentElement as HTMLButtonElement | null) ?? document.createElement("button");
    if (!canvas) {
      button.type = "button";
      button.className = "rival";
      canvas = document.createElement("canvas");
      const label = document.createElement("span");
      button.append(canvas, label);
      button.addEventListener("click", () => watchReplay(id));
      rivalCanvases.set(id, canvas);
    }
    const finished = !!race.finishes[id];
    const name = playerName(id);
    button.querySelector("span")!.textContent = name;
    button.classList.toggle("done", finished);
    // Replays once the race is over, for anyone with a checked solve.
    button.disabled = !(race.over && finished);
    button.title = button.disabled ? name : `Watch ${name}'s solve`;
    const side = Math.round((canvas.clientWidth || 104) * (window.devicePixelRatio || 1));
    if (canvas.width !== side) canvas.width = canvas.height = side;
    const slots = raceSlots(race, id);
    const done = finished || isSolved(slots);
    paintBoard(canvas.getContext("2d")!, side, board.pictureCanvas, slots, race.size,
      { gap: race.mode === "sliding" && !done, grid: !done });
    return button;
  });
  rivals.replaceChildren(...buttons);
}

function watchReplay(id: string) {
  const race = room?.state.race;
  if (!race || !race.over || race.id !== shownRace || racing || !race.moves?.[id]) return;
  const finish = race.finishes[id];
  setResult(() => {
    const time = finish ? formatTime(finish.ms / 1000) : "";
    return T(`Replay: ${playerName(id)}${finish ? `, ${time} with ${finish.moves} moves` : ""} (2× speed)`,
      `WATCH ${playerName(id)}. ${time}`);
  });
  board.replay(race.mode, race.seed, race.size, decodeMoves(race.moves[id]), 2, () => {
    setResult(() => T(`That was ${playerName(id)}'s solve.`, `THAT ${playerName(id)}. SMART.`));
  });
}

// --- The picture and the board ---

function showPicture(newTraits: Traits) {
  traits = newTraits;
  const rarity = pictureRarity(traits);
  canvas.dataset.rarity = rarity;
  rarityText.dataset.rarity = rarity;
  say(rarityText, () => T(...RARITY_NAMES[rarity]));
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
  setMoves(0);
  lastInPlace = 0;
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
  setTitle(locked);
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
  const [m, s] = [mode, size];
  setResult(() => (best ? T(`Best ${m} ${s}×${s}: ${formatTime(best)}`, `BEST: ${formatTime(best)}`) : ""));
}

function toWhole() {
  board.showWhole(size);
  resetClock();
  setHint(null);
  seedText.textContent = "";
  setStart("start");
  showBest();
}

async function newPicture() {
  const rolled = rollTraits();
  pictureButton.disabled = startButton.disabled = true;
  try {
    await board.load(rolled);
  } catch (error) {
    setResult(() => (error instanceof Error ? error.message : String(error)));
    return;
  } finally {
    pictureButton.disabled = startButton.disabled = false;
  }
  showPicture(rolled);
  shownRace = undefined;
  renderRivals(null);
  toWhole();
}

function startPractice() {
  board.stopReplay();
  const seed = newSeed();
  board.start(mode, seed, size);
  resetClock();
  lastInPlace = board.inPlace();
  setResult(() => "");
  setHint(mode);
  seedText.textContent = `Puzzle ${seed} (${mode}, ${size}×${size})`;
  setStart("restart");
  sounds.drum();
  tick();
}

// --- Racing ---

let countdownTimer: number | undefined;

// A new race called (we're an entrant): load its picture, count down to the server's start, then play.
async function joinRace(race: Race) {
  racing = race;
  lockPractice(true);
  setChoices(race.mode, race.size);
  setStart("giveUp");
  setResult(() => "");
  seedText.textContent = `Puzzle ${race.seed} (${race.mode}, ${race.size}×${race.size})`;
  setHint(race.mode);
  resetClock();
  await board.load(race.traits);
  if (racing?.id !== race.id) return;  // (it ended while the art loaded)
  showPicture(race.traits);
  shownRace = race.id;
  board.showWhole(race.size);
  renderRivals(race);
  window.clearInterval(countdownTimer);
  let lastShown = "";
  const step = () => {
    const left = race.startsAt - room!.serverNow();
    if (racing?.id !== race.id) return;
    if (left > 0) {
      countdown.hidden = false;
      const shown = String(Math.ceil(left / 1000));
      if (shown !== lastShown) sounds.drum();
      countdown.textContent = lastShown = shown;
      return;
    }
    window.clearInterval(countdownTimer);
    countdown.textContent = "SMASH!";
    sounds.drum(true);
    setTimeout(() => { countdown.hidden = true; }, 600);
    board.start(race.mode, race.seed, race.size);
    lastInPlace = board.inPlace();
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
  setStart("start");
  setHint(null);
  const winner = Object.entries(race.finishes).sort((a, b) => a[1].ms - b[1].ms)[0];
  if (winner && winner[0] === me?.id) sounds.fanfare();
  setResult(() => (winner
    ? T(`${playerName(winner[0])} won in ${formatTime(winner[1].ms / 1000)} with ${winner[1].moves} moves!`,
      `${playerName(winner[0])} BIG WIN. ${formatTime(winner[1].ms / 1000)}!`)
    : T("Nobody finished that one.", "NO ONE DONE.")));
}

function renderRaceStatus(state: RoomState) {
  const race = state.race;
  const mine = race && me && race.entrants.includes(me.id);
  say(raceStatus, () => (!race || race.over
    ? T("Race everyone here on the same puzzle.", "ALL SMASH SAME PUZZL.")
    : mine ? T(`Racing: ${race.mode}, ${race.size}×${race.size}`, `RACE: ${race.mode === "sliding" ? "SLIDE" : "SWAP"}`)
      : T("A race is on. You're in the next one.", "RACE ON. YOU NEXT.")));
}

function onRoomState(state: RoomState) {
  const race = state.race;
  const mine = race && me && race.entrants.includes(me.id);
  if (race && !race.over && mine && racing?.id !== race.id) joinRace(race);
  if (racing && race?.id === racing.id && race.over) endRace(race);
  raceButton.disabled = !!race && !race.over;
  renderRaceStatus(state);
  renderPlayers();
  renderRivals(race);
}

// --- Board events ---

let sendTimer: number | undefined;

board.onMove = (moves) => {
  setMoves(moves);
  const inPlace = board.inPlace();
  if (inPlace > lastInPlace) sounds.pop(); else sounds.bonk();
  lastInPlace = inPlace;
  if (racing && !sendTimer) {
    // Everyone's mini-board of you: your moves so far, a few times a second.
    sendTimer = window.setTimeout(() => {
      sendTimer = undefined;
      if (racing && board.isPlaying) room?.send({ type: "moves", raceId: racing.id, moves: encodeMoves(board.recording) });
    }, 250);
  }
};
board.onSolved = (moves, seconds) => {
  timeText.textContent = formatTime(seconds);
  setHint(null);
  sounds.crunch();
  if (racing) {
    room?.send({ type: "finish", raceId: racing.id, moves: encodeMoves(board.recording) });
    setResult(() => T("Solved! Waiting for the others…", "DONE! WAIT FRENZ."));
    setStart("start");
    return;
  }
  const best = bestTime();
  const record = !best || seconds < best;
  if (record) {
    saveBest(seconds);
    setTimeout(sounds.fanfare, 300);
  }
  const time = formatTime(seconds);
  setResult(() => (record
    ? T(`Solved in ${time} with ${moves} moves. New best!`, `DONE! ${time}. BEST!`)
    : T(`Solved in ${time} with ${moves} moves. Best: ${formatTime(best!)}`, `DONE! ${time}. BEST ${formatTime(best!)}.`)));
  setStart("again");
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
      setResult(() => T("You gave up. Waiting for the others…", "YOU QUIT. WAIT FRENZ."));
    }
    return;
  }
  startPractice();
});
pictureButton.addEventListener("click", newPicture);
raceButton.addEventListener("click", () => room?.send({ type: "race", mode, size }));

// The OGRE and sound switches (each remembered in this browser).
function showToggles() {
  ogreButton.setAttribute("aria-pressed", String(isOgre()));
  muteButton.setAttribute("aria-pressed", String(isMuted()));
  muteButton.textContent = isMuted() ? "🔇" : "🔊";
  muteButton.setAttribute("aria-label", isMuted() ? "Sound off" : "Sound on");
}
ogreButton.addEventListener("click", () => {
  setOgre(!isOgre());
  showToggles();
  sounds.bonk();
});
muteButton.addEventListener("click", () => {
  setMuted(!isMuted());
  showToggles();
  sounds.pop();
});
onOgreChange(() => {
  renderPlayers();
  if (room) renderRaceStatus(room.state);
  renderRivals(room?.state.race ?? null);
});
showToggles();

// --- Start up ---

setTitle(false);
setStart("start");
connect((players) => {
  participants = players;
  renderPlayers();
})
  .then((session) => {
    me = session.me;
    renderPlayers();
    const name = session.me.name;
    say(status, () => (inDiscord
      ? T(`Welcome, ${name}.`, `OI ${name.toUpperCase()}!`)
      : T("Preview outside Discord: the players are made up.", "FAKE FRENZ. NO DSCRD.")));
    if (session.accessToken) {
      room = new RoomClient(session.instanceId, session.accessToken);
      room.onState = onRoomState;
      room.onError = (message) => say(raceStatus, () => message);
    } else {
      say(raceStatus, () => T("Races work inside Discord.", "RACE ONLY IN DSCRD."));
    }
  })
  .catch((error: unknown) => {
    status.textContent = `Couldn't connect to Discord: ${error instanceof Error ? error.message : String(error)}`;
    status.classList.add("error");
  });
newPicture();
