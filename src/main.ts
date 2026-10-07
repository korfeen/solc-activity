import { connect, inDiscord, type Player } from "./discord";

const status = document.getElementById("status")!;
const list = document.getElementById("players")!;

function renderPlayers(players: Player[], me?: Player) {
  list.replaceChildren(
    ...players.map((player) => {
      const item = document.createElement("li");
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = player.name.slice(0, 1).toUpperCase();
      if (player.avatarUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = player.avatarUrl;
        img.onerror = () => img.remove();  // keep the initial if Discord's image can't load
        avatar.append(img);
      }
      const name = document.createElement("span");
      name.textContent = player.name + (me && player.id === me.id ? " (you)" : "");
      item.append(avatar, name);
      return item;
    }),
  );
}

let me: Player | undefined;
let latest: Player[] = [];
connect((players) => {
  latest = players;
  renderPlayers(players, me);
})
  .then((session) => {
    me = session.me;
    renderPlayers(latest, me);
    status.textContent = inDiscord
      ? `Welcome, ${me.name}. Puzzles coming soon.`
      : "Preview outside Discord: these players are made up.";
  })
  .catch((error: unknown) => {
    status.textContent = `Couldn't connect to Discord: ${error instanceof Error ? error.message : String(error)}`;
    status.classList.add("error");
  });
