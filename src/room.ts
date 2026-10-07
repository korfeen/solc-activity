// The page's side of the race room (worker/room.ts): one WebSocket, logging in with the Discord access token,
// reconnecting if it drops. Keeps the latest room state and the offset between the server's clock and ours.

import type { ClientMessage, RoomPlayer, RoomState, ServerMessage } from "./protocol";

export class RoomClient {
  state: RoomState = { players: [], race: null };
  you?: RoomPlayer;
  onState?: (state: RoomState) => void;
  onError?: (message: string) => void;

  private socket?: WebSocket;
  private offset = 0;  // server time minus ours
  private closed = false;

  constructor(private instanceId: string, private token: string) {
    this.open();
  }

  // The server's clock now (Date.now() on the server).
  serverNow() { return Date.now() + this.offset; }

  send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close() {
    this.closed = true;
    this.socket?.close();
  }

  private open() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/room?instance=${encodeURIComponent(this.instanceId)}`);
    this.socket = socket;
    socket.onopen = () => this.send({ type: "hello", token: this.token });
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.offset = message.now - Date.now();
      if (message.type === "error") {
        this.onError?.(message.message);
        return;
      }
      if (message.type === "welcome") this.you = message.you;
      this.state = message.state;
      this.onState?.(message.state);
    };
    socket.onclose = (event) => {
      if (this.closed || event.code === 4001) return;  // 4001: login refused, retrying won't help
      setTimeout(() => this.open(), 2000);
    };
  }
}
