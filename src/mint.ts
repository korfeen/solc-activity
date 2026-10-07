// Pictures as in the addon (Minting.lua): a stack of layers, one option each, rolled by rarity weight. The
// layer data comes from the addon through scripts/build-art.mjs (src/generated/art.json). No drawing here, so
// the server (worker/room.ts) can roll pictures too; pictures.ts draws them.

import art from "./generated/art.json";

export type Rarity = "uncommon" | "rare" | "epic" | "legendary";
export type Traits = Record<string, string>;  // layer key -> option id

export interface Option {
  id: string;
  name: string;
  rarity: Rarity;
  weight?: number;
  image?: string;  // under /art; "%s" stands for the picture's skin
  rect?: [number, number, number, number];  // x, y, width, height as fractions of the picture
  color?: [number, number, number];
}
interface Layer {
  key: string;
  name: string;
  options: Option[];
}

const layers = art.layers as Layer[];
const weights = art.weights as Record<Rarity, number>;
const scores = art.scores as Record<Rarity, number>;
const inFront = new Set(art.inFront);

const weightOf = (option: Option) => option.weight ?? weights[option.rarity];
const findOption = (layer: Layer, id: string | undefined) => layer.options.find((option) => option.id === id);

// A random picture, each layer rolled by weight like a mint (random: 0 <= n < 1, Math.random by default).
export function rollTraits(random: () => number = Math.random): Traits {
  const traits: Traits = {};
  for (const layer of layers) {
    const total = layer.options.reduce((sum, option) => sum + weightOf(option), 0);
    let pick = random() * total;
    let chosen = layer.options[layer.options.length - 1];
    for (const option of layer.options) {
      pick -= weightOf(option);
      if (pick <= 0) { chosen = option; break; }
    }
    traits[layer.key] = chosen.id;
  }
  return traits;
}

// Chance that a roll scores at least s, for every score s (ns.MintRarity's ScoreOdds).
const atLeast: number[] = (() => {
  let chance = new Map<number, number>([[0, 1]]);
  for (const layer of layers) {
    const total = layer.options.reduce((sum, option) => sum + weightOf(option), 0);
    const next = new Map<number, number>();
    for (const [score, p] of chance) {
      for (const option of layer.options) {
        const s = score + scores[option.rarity];
        next.set(s, (next.get(s) ?? 0) + (p * weightOf(option)) / total);
      }
    }
    chance = next;
  }
  const maxScore = Math.max(...chance.keys());
  const result: number[] = [];
  let sum = 0;
  for (let score = maxScore; score >= 0; score--) {
    sum += chance.get(score) ?? 0;
    result[score] = sum;
  }
  return result;
})();

// The picture's overall rarity: graded by how few rolls score as high (ns.MintRarity).
export function pictureRarity(traits: Traits): Rarity {
  let score = 0;
  for (const layer of layers) {
    const option = findOption(layer, traits[layer.key]);
    if (option) score += scores[option.rarity];
  }
  const share = atLeast[score] ?? 1;
  for (const tier of art.tiers) {
    if (share <= tier.share + 1e-9) return tier.rarity as Rarity;
  }
  return "uncommon";
}

// Traits as display lines: { layer, name, rarity } in layer order.
export function traitLines(traits: Traits) {
  return layers.flatMap((layer) => {
    const option = findOption(layer, traits[layer.key]);
    return option ? [{ layer: layer.name, name: option.name, rarity: option.rarity }] : [];
  });
}

// The layers in drawing order, back to front, with the inFront options last (ns.MintDrawOrder).
export function drawOrder(traits: Traits): Option[] {
  const order: Option[] = [];
  const front: Option[] = [];
  for (const layer of layers) {
    const option = findOption(layer, traits[layer.key]);
    if (option) (inFront.has(option.id) ? front : order).push(option);
  }
  return [...order, ...front];
}
