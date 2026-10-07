// The Activity's server: /api/token swaps the login code Discord gives the page for an access token (that
// needs the app's client secret, which can't be in the page), and /api/room is the race room's WebSocket
// (worker/room.ts, one Durable Object per Activity session). Everything else is the page itself (dist/).

export { RaceRoom } from "./room";

interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function exchangeToken(request: Request, env: Env): Promise<Response> {
  const { code } = (await request.json().catch(() => ({}))) as { code?: string };
  if (!code) return json({ error: "missing code" }, 400);
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });
  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) return json({ error: data.error ?? "token exchange failed" }, 502);
  return json({ access_token: data.access_token });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/token" && request.method === "POST") return exchangeToken(request, env);
    if (url.pathname === "/api/room") {
      // The room for this Activity session; players log in with their first message.
      const instance = url.searchParams.get("instance") ?? "";
      if (!/^[\w-]{1,100}$/.test(instance)) return json({ error: "bad instance" }, 400);
      return env.ROOMS.get(env.ROOMS.idFromName(instance)).fetch(request);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
