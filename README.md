# SOLC Puzzle on Discord

The Sleepy Ogre Leisure Club's picture puzzles as a Discord Activity: everyone in a voice channel races to solve
the same guild picture. Sister project of the [SOLC addon](https://github.com/korfeen/SOLC).

- `src/` the Activity page (TypeScript, Vite)
- `worker/` the Cloudflare Worker: serves the page and `/api/token` (Discord login)
- `public/fonts/` Germania One and Finger Paint, as in the addon (SIL Open Font License, see the OFL files)

## One-time setup

### 1. Discord application
1. Go to <https://discord.com/developers/applications> and click **New Application** (name it e.g. *SOLC Puzzle*).
2. **OAuth2**: copy the **Client ID**, click **Reset Secret** and copy the **Client Secret** (keep it private).
   Under **Redirects**, add `https://127.0.0.1` (a placeholder Discord asks for).
3. **Activities → Settings**: tick **Enable Activities**.
4. **Installation**: make sure **Guild Install** is ticked, then open the install link and add the app to the
   guild's Discord server.

### 2. Put the Client ID in two places
- `.env`: `VITE_DISCORD_CLIENT_ID=<client id>`
- `wrangler.jsonc`: `"DISCORD_CLIENT_ID": "<client id>"`

### 3. Cloudflare
1. Make a free account at <https://dash.cloudflare.com/sign-up>.
2. In this folder: `npx wrangler login` (opens the browser).
3. `npx wrangler secret put DISCORD_CLIENT_SECRET` and paste the Client Secret.
4. `npm run deploy`. It prints the Worker's address, like `https://solc-activity.<you>.workers.dev`.

### 4. Point Discord at it
In the Developer Portal, **Activities → URL Mappings**: prefix `/`, target `solc-activity.<you>.workers.dev`
(without `https://`).

### 5. Play
Join a voice channel in the guild server, click the **rocket (Activities)** button and pick *SOLC Puzzle*.

## Working on it

- `npm run deploy`: build and publish. Discord loads the new version the next time the Activity starts.
- `npm run dev` + `npm run worker`: run it locally at <http://localhost:5173>. Outside Discord it shows a
  preview with made-up players. For a local login, put `DISCORD_CLIENT_SECRET=...` in `.dev.vars`.
- `npm run check`: type-check only.
