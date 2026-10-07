import { defineConfig } from "vite";

// `npm run dev` serves the page with hot reload; /api goes to `npm run worker` (wrangler dev, port 8787).
// For testing inside Discord, deploy (`npm run deploy`) and map "/" to the Worker in the Developer Portal.
export default defineConfig({
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
