// Sound effects, made in the browser (Web Audio), so there are no sound files to load: a bonk when pieces
// move, a pop when one lands in its place, a crunch when the puzzle's solved, countdown drums and a winner's
// fanfare. Ogre mode plays them lower and sillier. Muting is remembered in this browser.

import { isOgre } from "./ogre";

const KEY = "muted";
let context: AudioContext | undefined;
let muted = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(value: boolean) {
  muted = value;
  try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* private window */ }
}

// Browsers only allow sound after the player has touched the page, so the audio starts on the first tap.
window.addEventListener("pointerdown", () => {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
}, { once: false, passive: true });

function ready(): AudioContext | undefined {
  if (muted || !context || context.state !== "running") return undefined;
  return context;
}

const pitch = (hz: number) => (isOgre() ? hz * 0.7 : hz);

// A tone sliding from one pitch to another, fading out.
function tone(type: OscillatorType, from: number, to: number, seconds: number, volume: number, delay = 0) {
  const audio = ready();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(pitch(from), start);
  osc.frequency.exponentialRampToValueAtTime(pitch(to), start + seconds);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
}

// A burst of filtered noise (crunches and drums).
function noise(seconds: number, filterHz: number, volume: number, delay = 0) {
  const audio = ready();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * seconds), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = filterHz;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(start);
}

export const sounds = {
  bonk: () => tone("sine", 240, 120, 0.12, 0.25),
  pop: () => tone("triangle", 620, 1040, 0.08, 0.18),
  crunch: () => { noise(0.3, 1400, 0.5); tone("sine", 140, 50, 0.3, 0.4); },
  drum: (big = false) => { noise(0.12, 600, big ? 0.6 : 0.35); tone("sine", big ? 170 : 130, 55, big ? 0.3 : 0.16, big ? 0.6 : 0.4); },
  fanfare: () => [523, 659, 784, 1047].forEach((hz, i) => tone("square", hz, hz, i === 3 ? 0.45 : 0.14, 0.12, i * 0.13)),
};
