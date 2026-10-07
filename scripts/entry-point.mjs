// Makes sure the app has its entry point command: the "Launch" command that puts the Activity in Discord's
// Activity launcher. Discord usually creates it when Activities are enabled; this creates it when it's missing.
// Reads the Client ID from .env and the Client Secret from .dev.vars (DISCORD_CLIENT_SECRET=..., not committed).
// Usage: node scripts/entry-point.mjs

import { readFileSync } from "node:fs";

const API = "https://discord.com/api/v10";

function readValue(file, name) {
  try {
    return readFileSync(new URL(`../${file}`, import.meta.url), "utf8").match(new RegExp(`^${name}=(.+)$`, "m"))?.[1].trim();
  } catch {
    return undefined;
  }
}

async function main() {
  const clientId = readValue(".env", "VITE_DISCORD_CLIENT_ID");
  const secret = readValue(".dev.vars", "DISCORD_CLIENT_SECRET");
  if (!clientId) return "No VITE_DISCORD_CLIENT_ID in .env.";
  if (!secret) return "No DISCORD_CLIENT_SECRET in .dev.vars. Make the file in the project folder with one line: DISCORD_CLIENT_SECRET=<your secret>";

  // An app token that may change the app's commands (client credentials grant).
  const tokenResponse = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "applications.commands.update" }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok) {
    return `Discord didn't accept the Client ID and Secret (${token.error ?? tokenResponse.status}). Check the secret in .dev.vars is the newest one.`;
  }
  const auth = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };

  const commands = await (await fetch(`${API}/applications/${clientId}/commands`, { headers: auth })).json();
  const existing = Array.isArray(commands) && commands.find((command) => command.type === 4);
  if (existing) return `The entry point command is already there: "${existing.name}" (id ${existing.id}).`;

  const response = await fetch(`${API}/applications/${clientId}/commands`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "launch",
      description: "Start SOLC Puzzle",
      type: 4,                     // PRIMARY_ENTRY_POINT
      handler: 2,                  // DISCORD_LAUNCH_ACTIVITY: Discord starts the Activity itself
      integration_types: [0, 1],   // installed in servers and by users
      contexts: [0, 1, 2],         // servers, DMs with the app, group DMs
    }),
  });
  const created = await response.json();
  if (!response.ok) return `Couldn't create it: ${JSON.stringify(created)}`;
  return `Created the entry point command "${created.name}" (id ${created.id}).`;
}

main().then(
  (message) => console.log(message),
  (error) => { console.log(`Failed: ${error.message}`); process.exitCode = 1; },
);
