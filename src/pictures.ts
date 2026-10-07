// Drawing pictures (see mint.ts for what a picture is): the layers stacked onto a canvas from the art in
// public/art, built from the addon by scripts/build-art.mjs.

import { drawOrder, type Traits } from "./mint";

export { pictureRarity, rollTraits, traitLines, type Rarity, type Traits } from "./mint";

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let promise = images.get(src);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Couldn't load ${src}`));
      image.src = src;
    });
    images.set(src, promise);
  }
  return promise;
}

// Draws the picture onto a canvas, filling it (square canvases; the art is square).
export async function drawPicture(canvas: HTMLCanvasElement, traits: Traits): Promise<void> {
  const order = drawOrder(traits);
  const loaded = await Promise.all(
    order.map((option) => (option.image ? loadImage("/art/" + option.image.replace("%s", traits.skin)) : null)),
  );
  const context = canvas.getContext("2d")!;
  const size = canvas.width;
  context.clearRect(0, 0, size, canvas.height);
  context.imageSmoothingQuality = "high";
  order.forEach((option, i) => {
    const [x, y, w, h] = option.rect ?? [0, 0, 1, 1];
    const image = loaded[i];
    if (image) {
      context.drawImage(image, x * size, y * size, w * size, h * size);
    } else if (option.color) {
      context.fillStyle = `rgb(${option.color.map((c) => Math.round(c * 255)).join(",")})`;
      context.fillRect(x * size, y * size, w * size, h * size);
    }
  });
}
