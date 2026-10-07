// The race room's messages, shared by the page (src/room.ts) and the server (worker/room.ts). JSON over one
// WebSocket per player to /api/room?instance=<the Activity's instance id>. Times are the server's clock in
// milliseconds (Date.now()); every server message carries `now` so pages can line their clocks up.

import type { Traits } from "./mint";
import type { Mode } from "./puzzle";

export interface RoomPlayer {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Finish {
  ms: number;     // solve time, measured by the server from the start
  moves: number;
}

export interface Race {
  id: string;
  mode: Mode;
  size: number;
  seed: number;
  traits: Traits;
  startsAt: number;                     // server time the pieces scramble (after the countdown)
  entrants: string[];                   // player ids racing (everyone here when it was called)
  moves: Record<string, string>;        // each racer's moves so far (encodeMoves); a finisher's are checked
  finishes: Record<string, Finish>;     // checked solves
  gaveUp: string[];
  over: boolean;                        // everyone finished, gave up or left, or the time ran out
}

export interface RoomState {
  players: RoomPlayer[];  // connected now
  race: Race | null;      // the current or last race
}

export type ClientMessage =
  | { type: "hello"; token: string }                                  // the Discord access token
  | { type: "race"; mode: Mode; size: number }                        // call a race for everyone here
  | { type: "moves"; raceId: string; moves: string }                 // all of your moves so far, while racing
  | { type: "finish"; raceId: string; moves: string }                 // encodeMoves of the whole solve
  | { type: "giveUp"; raceId: string };

export type ServerMessage =
  | { type: "welcome"; now: number; you: RoomPlayer; state: RoomState }
  | { type: "state"; now: number; state: RoomState }
  | { type: "error"; now: number; message: string };

export const COUNTDOWN_MS = 3500;
export const RACE_LIMIT_MS = 10 * 60 * 1000;
