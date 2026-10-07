// The race room: one Durable Object per Activity session (named by Discord's instance id), holding everyone's
// WebSocket. It checks who each player is with Discord, calls races (a rolled picture, mode, size and seed for
// all), counts down on its own clock, passes everyone's moves around while racing (live mini-boards), and
// accepts a finish only when replaying the player's moves on the scramble really solves it, timed by the
// server; those moves are kept for replays. Protocol: src/protocol.ts.

import { DurableObject } from "cloudflare:workers";
import { rollTraits } from "../src/mint";
import { decodeMoves, isSolved, newSeed, scramble, SIZES, validMoveText, type Mode } from "../src/puzzle";
import {
  COUNTDOWN_MS, RACE_LIMIT_MS,
  type ClientMessage, type Race, type RoomPlayer, type RoomState, type ServerMessage,
} from "../src/protocol";

interface Env {}

export class RaceRoom extends DurableObject<Env> {
  private race: Race | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The room sleeps between messages (hibernation); the race is kept in storage across that.
    ctx.blockConcurrencyWhile(async () => {
      this.race = (await ctx.storage.get<Race>("race")) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // --- Players ---

  private player(ws: WebSocket): RoomPlayer | null {
    return (ws.deserializeAttachment() as RoomPlayer | null) ?? null;
  }

  // Everyone connected and logged in, once each (a player may have two tabs).
  private players(): RoomPlayer[] {
    const seen = new Map<string, RoomPlayer>();
    for (const ws of this.ctx.getWebSockets()) {
      const player = this.player(ws);
      if (player) seen.set(player.id, player);
    }
    return [...seen.values()];
  }

  private state(): RoomState {
    return { players: this.players(), race: this.race };
  }

  private send(ws: WebSocket, message: ServerMessage) {
    try { ws.send(JSON.stringify(message)); } catch { /* closing */ }
  }

  private broadcast() {
    const message: ServerMessage = { type: "state", now: Date.now(), state: this.state() };
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (this.player(ws)) {
        try { ws.send(text); } catch { /* closing */ }
      }
    }
  }

  // Who owns this Discord access token (the page got it from the Embedded App SDK login).
  private async identify(token: string): Promise<RoomPlayer | null> {
    const response = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const user = (await response.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };
    return {
      id: user.id,
      name: user.global_name || user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : undefined,
    };
  }

  // --- Races ---

  private async save() {
    await this.ctx.storage.put("race", this.race);
  }

  // Over once every entrant has finished, given up or left, or at the time limit (the alarm).
  private async checkOver() {
    const race = this.race;
    if (!race || race.over) return;
    const here = new Set(this.players().map((player) => player.id));
    const done = race.entrants.every((id) => race.finishes[id] || race.gaveUp.includes(id) || !here.has(id));
    if (done || Date.now() >= race.startsAt + RACE_LIMIT_MS) {
      race.over = true;
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm() {
    await this.checkOver();
    await this.save();
    this.broadcast();
  }

  // A finish counts only if the moves are legal and leave the puzzle solved.
  private check(race: Race, encoded: string): number | null {
    const slots = scramble(race.mode, race.seed, race.size);
    const count = race.size * race.size;
    let moves = 0;
    for (const move of decodeMoves(encoded)) {
      const { a, b } = move;
      if (a < 1 || b < 1 || a > count || b > count || a === b) return null;
      if (race.mode === "sliding") {
        const gap = slots[a] === count ? a : slots[b] === count ? b : 0;
        const other = gap === a ? b : a;
        const sameRow = Math.floor((gap - 1) / race.size) === Math.floor((other - 1) / race.size);
        if (!gap || !((Math.abs(gap - other) === 1 && sameRow) || Math.abs(gap - other) === race.size)) return null;
      }
      [slots[a], slots[b]] = [slots[b], slots[a]];
      moves++;
    }
    return isSolved(slots) ? moves : null;
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    let message: ClientMessage;
    try {
      message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    const now = Date.now();

    if (message.type === "hello") {
      const you = await this.identify(String(message.token ?? ""));
      if (!you) {
        this.send(ws, { type: "error", now, message: "Discord didn't recognise your login. Restart the Activity." });
        ws.close(4001, "unauthorized");
        return;
      }
      ws.serializeAttachment(you);
      this.send(ws, { type: "welcome", now, you, state: this.state() });
      this.broadcast();
      return;
    }

    const player = this.player(ws);
    if (!player) return;  // not logged in yet
    const race = this.race;

    if (message.type === "race") {
      if (race && !race.over) return;  // one race at a time
      const mode: Mode = message.mode === "sliding" ? "sliding" : "swap";
      const size = SIZES.includes(message.size as (typeof SIZES)[number]) ? message.size : 4;
      this.race = {
        id: crypto.randomUUID(),
        mode, size, seed: newSeed(), traits: rollTraits(),
        startsAt: now + COUNTDOWN_MS,
        entrants: this.players().map((p) => p.id),
        moves: {}, finishes: {}, gaveUp: [], over: false,
      };
      await this.ctx.storage.setAlarm(this.race.startsAt + RACE_LIMIT_MS);
    } else if (!race || race.over || message.raceId !== race.id || !race.entrants.includes(player.id)) {
      return;
    } else if (message.type === "moves") {
      const moves = String(message.moves ?? "");
      if (race.finishes[player.id] || now < race.startsAt || !validMoveText(moves)) return;
      race.moves[player.id] = moves;
    } else if (message.type === "finish") {
      if (race.finishes[player.id] || now < race.startsAt) return;
      const encoded = String(message.moves ?? "");
      const moves = validMoveText(encoded) ? this.check(race, encoded) : null;
      if (moves === null) {
        this.send(ws, { type: "error", now, message: "That solve didn't check out, so it wasn't counted." });
        return;
      }
      race.finishes[player.id] = { ms: now - race.startsAt, moves };
      race.moves[player.id] = encoded;  // the checked solve, for replays
    } else if (message.type === "giveUp") {
      if (!race.gaveUp.includes(player.id) && !race.finishes[player.id]) race.gaveUp.push(player.id);
    } else {
      return;
    }
    await this.checkOver();
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    ws.serializeAttachment(null);
    await this.checkOver();
    await this.save();
    this.broadcast();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}
