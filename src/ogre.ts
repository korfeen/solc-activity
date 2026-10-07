// Ogre mode, as in the addon (/solc ogre): the page's words in ogre talk (ALL CAPS, five letters a word at most)
// and headings and buttons in wobbly crayon letters (Finger Paint, each letter its own colour, size and height,
// seeded by the word so it always looks the same). Each player chooses for themselves; this browser remembers.
//
// Texts go through say(element, () => T(normal, ogre)): T picks the version for the current mode, and toggling
// redraws every text said that way. Elements with data-crayon get crayon letters in ogre mode.

const KEY = "ogre";
const COLORS = ["#ff4d40", "#ff9e26", "#ffe640", "#73e04d", "#59a6ff", "#c780ff", "#ff8cc7"];  // the addon's crayons

function stored(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

let on = stored();
const renderers = new Map<HTMLElement, () => string>();
const listeners: (() => void)[] = [];

export const isOgre = () => on;
export const T = (normal: string, ogre: string) => (on ? ogre : normal);

// A random number source (-1 to 1) seeded by the word, as the addon's ogre letters.
function wobble(word: string) {
  let seed = 7;
  for (let i = 0; i < word.length; i++) seed = (seed * 31 + word.charCodeAt(i)) % 2147483647;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
}

function crayon(element: HTMLElement, text: string) {
  const random = wobble(text);
  let last = -1;
  element.replaceChildren(...[...text].map((char) => {
    if (char === " ") return document.createTextNode(" ");
    const letter = document.createElement("span");
    letter.className = "crayon-letter";
    let pick = Math.floor(((random() + 1) / 2) * COLORS.length) % COLORS.length;
    if (pick === last) pick = (pick + 1) % COLORS.length;
    last = pick;
    letter.style.color = COLORS[pick];
    letter.style.fontSize = `${1 + random() * 0.18}em`;
    letter.style.transform = `translateY(${(random() * 0.08).toFixed(3)}em) rotate(${(random() * 7).toFixed(1)}deg)`;
    letter.textContent = char;
    return letter;
  }));
  element.setAttribute("aria-label", text);
}

function paint(element: HTMLElement, text: string) {
  if (on && element.dataset.crayon !== undefined) {
    crayon(element, text);
  } else {
    element.textContent = text;
    element.removeAttribute("aria-label");
  }
}

// Sets an element's text now, and again whenever the mode changes.
export function say(element: HTMLElement, render: () => string) {
  renderers.set(element, render);
  paint(element, render());
}

export function onOgreChange(listener: () => void) {
  listeners.push(listener);
}

export function setOgre(value: boolean) {
  on = value;
  try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* private window */ }
  document.documentElement.classList.toggle("ogre", on);
  for (const [element, render] of renderers) paint(element, render());
  for (const listener of listeners) listener();
}

// The page's fixed texts: elements with data-ogre="OGRE TEXT" switch between their own text and that.
export function initOgre() {
  document.documentElement.classList.toggle("ogre", on);
  for (const element of document.querySelectorAll<HTMLElement>("[data-ogre]")) {
    const normal = element.textContent ?? "";
    say(element, () => T(normal, element.dataset.ogre!));
  }
}
