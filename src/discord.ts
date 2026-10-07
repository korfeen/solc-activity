// Talking to Discord: log in through the Embedded App SDK and follow who's in the Activity. Opened in a plain
// browser (no frame_id in the address, so not inside Discord) it runs a preview with made-up players instead.

import { DiscordSDK } from "@discord/embedded-app-sdk";

export interface Player {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Session {
  me: Player;
  instanceId: string;  // the same for everyone in this Activity session: it names the race room
  inDiscord: boolean;
  accessToken?: string;  // proves who you are to the race room (Discord only)
}

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string;
export const inDiscord = new URLSearchParams(location.search).has("frame_id");

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  nickname?: string | null;
  avatar?: string | null;
}

function toPlayer(user: DiscordUser): Player {
  return {
    id: user.id,
    name: user.nickname || user.global_name || user.username,
    avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : undefined,
  };
}

const PREVIEW_PLAYERS: Player[] = [
  { id: "1", name: "Koffe" },
  { id: "2", name: "Ruuzel" },
  { id: "3", name: "Helga" },
];

// Logs in and starts reporting the players in the Activity (onPlayers, now and whenever someone joins or leaves).
export async function connect(onPlayers: (players: Player[]) => void): Promise<Session> {
  if (!inDiscord) {
    onPlayers(PREVIEW_PLAYERS);
    return { me: PREVIEW_PLAYERS[0], instanceId: "preview", inDiscord: false };
  }

  const sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds", "applications.commands"],
  });
  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error(`Login failed (${response.status})`);
  const { access_token } = (await response.json()) as { access_token: string };
  const auth = await sdk.commands.authenticate({ access_token });

  const report = (participants: DiscordUser[]) => onPlayers(participants.map(toPlayer));
  const { participants } = await sdk.commands.getInstanceConnectedParticipants();
  report(participants);
  sdk.subscribe("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", (event) => report(event.participants));

  return { me: toPlayer(auth.user), instanceId: sdk.instanceId, inDiscord: true, accessToken: access_token };
}
