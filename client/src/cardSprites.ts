import type { CardAtlas } from '../../packages/contracts/src/card-atlas';
import type { WebAssetScene } from './assets';
export type CardState = CardAtlas['frames'][number]['state'];
export const CARD_LABELS = { white: '白色', green: '绿色', blue: '蓝色', purple: '紫色', orange: '橙色' };
export const CARD_STATE_LABELS = { normal: '正常', selected: '已选择', disabled: '不可用' };
const POSITION_LABELS: Record<string, string> = { FW: '前锋', MF: '中场', DF: '后卫', GK: '门将' };

export async function loadCardPages(
  atlas: CardAtlas,
  resources: WebAssetScene,
): Promise<Map<string, HTMLImageElement>> {
  const rows = await Promise.all(
    atlas.pages.map(async (page) => {
      const image = resources.bind(page.path);
      await resources.wait(image);
      if (image.naturalWidth !== page.width || image.naturalHeight !== page.height)
        throw new Error('Card page dimensions differ');
      return [page.id, image] as const;
    }),
  );
  return new Map(rows);
}
/** Labels are drawn at runtime; the PNGs contain no player names, levels or translated button text. */
export function drawPlayerCard(
  ctx: CanvasRenderingContext2D,
  atlas: CardAtlas,
  images: ReadonlyMap<string, CanvasImageSource>,
  playerId: string,
  state: CardState = 'normal',
) {
  const portrait = atlas.portraits.find((p) => p.playerId === playerId);
  const frame = atlas.frames.find((f) => f.quality === portrait?.quality && f.state === state);
  if (!portrait || !frame) throw new Error('Unknown card identity or state');
  const frameImage = images.get(frame.pageId),
    portraitImage = images.get(portrait.pageId);
  if (!frameImage || !portraitImage) throw new Error('Card page not loaded');
  ctx.clearRect(0, 0, 160, 224);
  ctx.drawImage(frameImage, frame.x, frame.y, frame.width, frame.height, 0, 0, 160, 224);
  ctx.save();
  ctx.globalAlpha = state === 'disabled' ? 0.5 : 1;
  ctx.drawImage(portraitImage, portrait.x, portrait.y, portrait.width, portrait.height, 16, 10, 128, 128);
  ctx.restore();
  ctx.fillStyle = '#173c53';
  ctx.beginPath();
  ctx.arc(139, 126, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 11px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(portrait.rarity === null ? '?' : String(portrait.rarity), 139, 126);
  ctx.fillStyle = '#172c3b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 15;
  ctx.font = `700 ${size}px system-ui`;
  while (ctx.measureText(portrait.name).width > 136 && size > 10) ctx.font = `700 ${--size}px system-ui`;
  let text = portrait.name;
  while (ctx.measureText(text).width > 136) text = Array.from(text).slice(0, -2).join('') + '…';
  ctx.fillText(text, 80, 165);
  ctx.font = '600 11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`${POSITION_LABELS[portrait.position] ?? portrait.position} · ${CARD_STATE_LABELS[state]}`, 14, 199);
}
