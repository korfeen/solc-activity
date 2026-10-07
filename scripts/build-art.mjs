// Builds the picture art for the page from the SOLC addon, so pictures here look exactly like in game:
// - src/generated/art.json: the layers and their options, read by running the addon's own MintArt.lua and
//   Minting.lua in a Lua VM (fengari), plus the roll weights, rarity scores and tiers, and the options drawn
//   in front of the rest (ns.MINT_*).
// - public/art/<Layer>/[<skin>/]<option>.png: each option's art, cropped to its rect like the game's
//   textures, from the full-size source PNGs (%USERPROFILE%\killtracker-art, see the addon's
//   tools/convert-art.js) at the game's density.
// Usage: node scripts/build-art.mjs   (SOLC_ADDON=<path> if the addon isn't in ../SOLC)

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const ADDON = process.env.SOLC_ADDON || path.resolve(ROOT, "..", "SOLC");
const DENSITY = 512;  // pixels per whole picture, as the game's textures
const ART_OUT = path.join(ROOT, "public", "art");
const JSON_OUT = path.join(ROOT, "src", "generated", "art.json");

const { SOURCE, decodePng, resample } = require(path.join(ADDON, "tools", "convert-art.js"));
const { lua, lauxlib, lualib, to_luastring } = require("fengari");

// --- The addon's layer data, from its own Lua ---------------------------------------------------------

const TO_JSON = String.raw`
local function str(s)
    return '"' .. s:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end) .. '"'
end
function toJSON(v)
    local t = type(v)
    if t == "table" then
        local parts = {}
        if #v > 0 then
            for _, item in ipairs(v) do parts[#parts + 1] = toJSON(item) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        for k, item in pairs(v) do
            if type(item) ~= "function" then parts[#parts + 1] = str(tostring(k)) .. ":" .. toJSON(item) end
        end
        return "{" .. table.concat(parts, ",") .. "}"
    elseif t == "string" then return str(v)
    elseif t == "number" or t == "boolean" then return tostring(v)
    end
    return "null"
end`;

function doLua(L, code) {
  if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
}

// Runs an addon file the way WoW does: with the addon's name and the shared ns table.
function runAddonFile(L, name) {
  if (lauxlib.luaL_loadstring(L, to_luastring(fs.readFileSync(path.join(ADDON, name), "utf8"))) !== lua.LUA_OK) {
    throw new Error(name + ": " + lua.lua_tojsstring(L, -1));
  }
  lua.lua_pushstring(L, to_luastring("SOLC"));
  lua.lua_getglobal(L, to_luastring("ns"));
  if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) throw new Error(name + ": " + lua.lua_tojsstring(L, -1));
}

function readAddon() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  // Just enough of WoW for the files to load.
  doLua(L, `ns = {}
local frame = setmetatable({}, { __index = function() return function() end end })
CreateFrame = function() return frame end
StaticPopupDialogs = {}
hooksecurefunc = function() end
` + TO_JSON);
  runAddonFile(L, "MintArt.lua");
  runAddonFile(L, "Minting.lua");
  doLua(L, `return toJSON({ layers = ns.MintLayers, weights = ns.MINT_WEIGHTS, scores = ns.MINT_SCORES,
    tiers = ns.MINT_TIERS, inFront = ns.MINT_IN_FRONT })`);
  return JSON.parse(lua.lua_tojsstring(L, -1));
}

// --- Art -----------------------------------------------------------------------------------------------

const toId = (name) => name.toLowerCase().replace(/\.png$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// The source PNG for a texture path ("...\Collectible\Eyes\moss\bloodshot"), and its path under public/art.
function sourceFor(texture) {
  const parts = texture.split("\\");
  const rel = parts.slice(parts.indexOf("Collectible") + 1);
  const [folder, ...rest] = rel;
  const id = rest[rest.length - 1], skin = rest.length > 1 ? rest[0] : null;
  const layerDir = path.join(SOURCE, folder);
  for (const rarity of fs.existsSync(layerDir) ? fs.readdirSync(layerDir) : []) {
    let dir = path.join(layerDir, rarity);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (skin) {  // the skin's folder, named like the skin id with dashes (mud-brown for mud_brown)
      const skinDir = fs.readdirSync(dir).find((d) => toId(d) === skin && fs.statSync(path.join(dir, d)).isDirectory());
      if (!skinDir) continue;
      dir = path.join(dir, skinDir);
    }
    const file = fs.readdirSync(dir).find((f) => /\.png$/i.test(f) && toId(f) === id);
    if (file) return { file: path.join(dir, file), out: rel.join("/") + ".png" };
  }
  throw new Error(`No source art for ${rel.join("/")} in ${SOURCE}`);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
function writePng(file, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;  // RGBA
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

// Writes one texture's art: the option's rect of the source (the whole picture without one) at DENSITY.
function writeArt(texture, rect) {
  const { file, out } = sourceFor(texture);
  const image = decodePng(file);
  const [rx, ry, rw, rh] = rect || [0, 0, 1, 1];
  const outW = Math.max(1, Math.round(rw * DENSITY)), outH = Math.max(1, Math.round(rh * DENSITY));
  const rgba = resample(image, rx * image.width, ry * image.height, rw * image.width, rh * image.height, outW, outH);
  writePng(path.join(ART_OUT, out), outW, outH, rgba);
  return out;
}

// --- Build ---------------------------------------------------------------------------------------------

const data = readAddon();
const skins = data.layers.find((layer) => layer.key === "skin").options.map((option) => option.id);
fs.rmSync(ART_OUT, { recursive: true, force: true });
let files = 0, bytes = 0;
const layers = data.layers.map((layer) => ({
  key: layer.key,
  name: layer.name,
  options: layer.options.map((option) => {
    let image;
    if (option.texture) {
      const textures = option.perSkin ? skins.map((skin) => option.texture.replace("%s", skin)) : [option.texture];
      const outs = textures.map((texture) => writeArt(texture, option.rect));
      files += outs.length;
      image = option.perSkin ? outs[0].replace(`/${skins[0]}/`, "/%s/") : outs[0];
    }
    return {
      id: option.id,
      name: option.name,
      rarity: option.rarity,
      ...(option.weight ? { weight: option.weight } : {}),
      ...(image ? { image } : {}),
      ...(option.rect ? { rect: option.rect } : {}),
      ...(option.color ? { color: option.color } : {}),
    };
  }),
}));
for (const file of fs.readdirSync(ART_OUT, { recursive: true })) {
  const full = path.join(ART_OUT, file);
  if (fs.statSync(full).isFile()) bytes += fs.statSync(full).size;
}

const tiers = data.tiers.map(([rarity, share]) => ({ rarity, share }));
const art = { density: DENSITY, weights: data.weights, scores: data.scores, tiers, inFront: Object.keys(data.inFront ?? {}), layers };
fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
fs.writeFileSync(JSON_OUT, JSON.stringify(art, null, 1) + "\n");
console.log(`${layers.length} layers, ${layers.reduce((n, l) => n + l.options.length, 0)} options, ${files} images (${(bytes / 1048576).toFixed(1)} MB)`);
