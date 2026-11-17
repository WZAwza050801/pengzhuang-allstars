import { CardAtlasSchema, CARD_QUALITIES } from '../../packages/contracts/src/card-atlas';
import { CARD_LABELS, CARD_STATE_LABELS, drawPlayerCard, loadCardPages, type CardState } from './cardSprites';
import './cardDebug.css';
import { WebAssetScene } from './assets';

declare global {
  interface Window {
    __cardAudit?: { version: string; portraits: number; frames: number; pages: number; drawn: number; dpr: number };
  }
}

async function main() {
  const root = document.querySelector<HTMLElement>('#cards')!;
  root.innerHTML =
    '<h1>球员卡资源验收</h1><p>原创程序化占位图 · 不代表球员真实肖像 · 名字与状态实时绘制</p><p role="status">加载图集…</p>';
  const status = root.querySelector<HTMLElement>('[role=status]')!;
  const resources = new WebAssetScene();
  window.addEventListener('pagehide', () => resources.dispose(), { once: true });
  try {
    const atlas = CardAtlasSchema.parse(await resources.data('card.atlas'));
    const images = await loadCardPages(atlas, resources);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const canvasFor = (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      return { canvas, ctx };
    };
    const heading = document.createElement('h2');
    heading.textContent = '品质与状态';
    root.append(heading);
    const samples = document.createElement('div');
    samples.className = 'frame-grid';
    root.append(samples);
    for (const frame of atlas.frames) {
      const figure = document.createElement('figure'),
        { canvas, ctx } = canvasFor(160, 224);
      const source = images.get(frame.pageId)!;
      ctx.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, 160, 224);
      const caption = document.createElement('figcaption');
      caption.textContent = `${CARD_LABELS[frame.quality]} · ${CARD_STATE_LABELS[frame.state]}`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', caption.textContent);
      figure.append(canvas, caption);
      samples.append(figure);
    }
    const controls = document.createElement('div');
    controls.className = 'card-controls';
    controls.innerHTML =
      '<label>品质 <select name="quality"><option value="all">全部</option></select></label><label>状态 <select name="state"><option value="normal">正常</option><option value="selected">已选择</option><option value="disabled">不可用</option></select></label>';
    root.append(controls);
    const quality = controls.querySelector<HTMLSelectElement>('[name=quality]')!;
    for (const item of CARD_QUALITIES) quality.add(new Option(CARD_LABELS[item], item));
    const state = controls.querySelector<HTMLSelectElement>('[name=state]')!;
    const title = document.createElement('h2');
    title.textContent = '全卡联系表';
    root.append(title);
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    root.append(grid);
    const requested = Number(new URLSearchParams(location.search).get('limit'));
    const limit =
      Number.isInteger(requested) && requested > 0
        ? Math.min(requested, atlas.portraits.length)
        : atlas.portraits.length;
    const render = () => {
      grid.replaceChildren();
      const selected = atlas.portraits
        .filter((p) => quality.value === 'all' || p.quality === quality.value)
        .slice(0, limit);
      for (const player of selected) {
        const button = document.createElement('button'),
          { canvas, ctx } = canvasFor(160, 224);
        const cardState = state.value as CardState;
        button.className = 'player-sample';
        button.dataset.player = player.playerId;
        button.disabled = cardState === 'disabled';
        button.setAttribute('aria-pressed', String(cardState === 'selected'));
        button.setAttribute(
          'aria-label',
          `${player.playerId} ${player.name} ${CARD_LABELS[player.quality]} 稀有度${player.rarity ?? '未知'} ${CARD_STATE_LABELS[cardState]} 原创占位`,
        );
        canvas.setAttribute('aria-hidden', 'true');
        drawPlayerCard(ctx, atlas, images, player.playerId, cardState);
        button.addEventListener('click', () => {
          const next = button.getAttribute('aria-pressed') === 'true' ? 'normal' : 'selected';
          button.setAttribute('aria-pressed', String(next === 'selected'));
          button.setAttribute(
            'aria-label',
            `${player.playerId} ${player.name} ${CARD_LABELS[player.quality]} 稀有度${player.rarity ?? '未知'} ${CARD_STATE_LABELS[next]} 原创占位`,
          );
          drawPlayerCard(ctx, atlas, images, player.playerId, next);
        });
        button.append(canvas);
        grid.append(button);
      }
      if (!selected.length) {
        const empty = document.createElement('p');
        empty.textContent = '该品质没有球员';
        grid.append(empty);
      }
      status.textContent = `${atlas.portraits.length} 名球员 · ${atlas.frames.length} 种卡框 · ${atlas.pages.length} 张图集 · 当前 ${selected.length} 张 / DPR ${dpr}`;
      window.__cardAudit = {
        version: atlas.version,
        portraits: atlas.portraits.length,
        frames: atlas.frames.length,
        pages: images.size,
        drawn: selected.length,
        dpr,
      };
    };
    quality.addEventListener('change', render);
    state.addEventListener('change', render);
    render();
  } catch {
    status.textContent = '资源加载失败，请检查导出结果后重试。';
    const retry = document.createElement('button');
    retry.textContent = '重试';
    retry.addEventListener('click', () => location.reload());
    root.append(retry);
  }
}
if (import.meta.env.DEV || import.meta.env.MODE === 'test') void main();
