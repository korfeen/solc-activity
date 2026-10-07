import { connect, inDiscord, type Player } from "./discord";
import { drawPicture, pictureRarity, rollTraits, traitLines, type Rarity } from "./pictures";

const status = document.getElementById("status")!;
const list = document.getElementById("players")!;

// The rolled picture (M2: pictures look as in the game's Gallery).
const canvas = document.getElementById("picture") as HTMLCanvasElement;
const rarityLine = document.getElementById("picture-rarity")!;
const traitList = document.getElementById("traits")!;
const rollButton = document.getElementById("roll") as HTMLButtonElement;
const RARITY_NAMES: Record<Rarity, string> = { uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };

async function showRoll() {
  const traits = rollTraits();
  const rarity = pictureRarity(traits);
  rollButton.disabled = true;
  try {
    await drawPicture(canvas, traits);
  } catch (error) {
    rarityLine.textContent = error instanceof Error ? error.message : String(error);
    return;
  } finally {
    rollButton.disabled = false;
  }
  canvas.dataset.rarity = rarity;
  rarityLine.dataset.rarity = rarity;
  rarityLine.textContent = `${RARITY_NAMES[rarity]} picture`;
  traitList.replaceChildren(
    ...traitLines(traits).map((line) => {
      const item = document.createElement("li");
      const layer = document.createElement("span");
      layer.textContent = line.layer;
      const name = document.createElement("span");
      name.textContent = line.name;
      name.dataset.rarity = line.rarity;
      item.append(layer, name);
      return item;
    }),
  );
}
rollButton.addEventListener("click", showRoll);
showRoll();

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
