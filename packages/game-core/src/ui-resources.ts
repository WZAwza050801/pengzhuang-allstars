import {
  UI_THEMES,
  UI_SURFACES,
  UI_STATES,
  UI_ICONS,
  UI_STADIUMS,
  UiPackLayoutSchema,
  type UiPackLayout,
} from '../../contracts/src/ui';
export function layoutUiPack(): UiPackLayout {
  const pack: UiPackLayout = {
    schemaVersion: 1,
    gutter: 2,
    source: 'original-procedural-placeholder',
    pages: [],
    sprites: [],
  };
  for (const theme of UI_THEMES) {
    const pageId = `chrome-${theme}`;
    pack.pages.push({ id: pageId, path: `/assets/ui/${pageId}.png`, width: 512, height: 208 });
    for (const [i, kind] of UI_SURFACES.entries())
      for (const [j, state] of UI_STATES.entries())
        pack.sprites.push({
          id: `surface.${theme}.${kind}.${state}`,
          kind: 'surface',
          pageId,
          x: 2 + j * 68,
          y: 2 + i * 68,
          width: 64,
          height: 64,
          inset: 16,
        });
    UI_ICONS.forEach((name, i) =>
      pack.sprites.push({
        id: `icon.${theme}.${name}`,
        kind: 'icon',
        pageId,
        x: 218 + (i % 4) * 52,
        y: 2 + Math.floor(i / 4) * 52,
        width: 48,
        height: 48,
        inset: 0,
      }),
    );
  }
  pack.pages.push({ id: 'stadiums', path: '/assets/ui/stadiums.png', width: 1300, height: 196 });
  UI_STADIUMS.forEach((id, i) =>
    pack.sprites.push({
      id: `stadium.${id}`,
      kind: 'stadium',
      pageId: 'stadiums',
      x: 2 + i * 260,
      y: 2,
      width: 256,
      height: 192,
      inset: 0,
    }),
  );
  return UiPackLayoutSchema.parse(pack);
}
export interface UiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function nineSlice(
  source: UiRect & { inset: number },
  width: number,
  height: number,
): { from: UiRect; to: UiRect }[] {
  const cap = source.inset;
  if (
    ![source.x, source.y, source.width, source.height, cap, width, height].every(Number.isFinite) ||
    cap <= 0 ||
    source.width <= cap * 2 ||
    source.height <= cap * 2 ||
    width < cap * 2 ||
    height < cap * 2
  )
    throw new Error('Invalid nine-slice dimensions');
  const sx = [source.x, source.x + cap, source.x + source.width - cap],
    sy = [source.y, source.y + cap, source.y + source.height - cap];
  const dx = [0, cap, width - cap],
    dy = [0, cap, height - cap];
  const sw = [cap, source.width - 2 * cap, cap],
    sh = [cap, source.height - 2 * cap, cap];
  const dw = [cap, width - 2 * cap, cap],
    dh = [cap, height - 2 * cap, cap];
  return sy.flatMap((y, j) =>
    sx.map((x, i) => ({
      from: { x, y, width: sw[i], height: sh[j] },
      to: { x: dx[i], y: dy[j], width: dw[i], height: dh[j] },
    })),
  );
}
