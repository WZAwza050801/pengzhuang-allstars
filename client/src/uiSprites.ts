import type { UiPack } from '../../packages/contracts/src/ui';
import { nineSlice } from '../../packages/game-core/src/ui-resources';
export async function loadUiPages(pack: UiPack) {
  return new Map(
    await Promise.all(
      pack.pages.map(async (page) => {
        const image = new Image();
        image.src = page.path;
        await image.decode();
        if (image.naturalWidth !== page.width || image.naturalHeight !== page.height)
          throw new Error('UI page dimensions differ');
        return [page.id, image] as const;
      }),
    ),
  );
}
export function drawUiSprite(
  ctx: CanvasRenderingContext2D,
  pack: UiPack,
  images: ReadonlyMap<string, CanvasImageSource>,
  id: string,
  width: number,
  height: number,
) {
  const s = pack.sprites.find((s) => s.id === id);
  const image = s && images.get(s.pageId);
  if (!s || !image) throw new Error('UI sprite not loaded');
  if (s.inset)
    for (const part of nineSlice(s, width, height)) {
      const a = part.from,
        b = part.to;
      if (b.width && b.height) ctx.drawImage(image, a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height);
    }
  else {
    // Contain icons/stadiums without changing their aspect ratio.
    const scale = Math.min(width / s.width, height / s.height),
      w = s.width * scale,
      h = s.height * scale;
    ctx.drawImage(image, s.x, s.y, s.width, s.height, (width - w) / 2, (height - h) / 2, w, h);
  }
}
