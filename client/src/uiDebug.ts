import rawTokens from '../../config/ui-tokens.json';
import {
  UiPackSchema,
  UiTokensSchema,
  UI_SURFACES,
  UI_STATES,
  UI_ICONS,
  UI_STADIUMS,
  UI_AUDIO,
} from '../../packages/contracts/src/ui';
import { loadUiPages, drawUiSprite } from './uiSprites';
import { sfx, setMuted, isMuted, disposeAudio } from './sfx';
import './uiDebug.css';
declare global {
  interface Window {
    __uiAudit?: { version: string; sprites: number; pages: number; theme: string; fontScale: number };
  }
}
const labels: Record<string, string> = {
  primary: '开始比赛',
  secondary: '好友约战',
  panel: '比赛规则',
  normal: '正常',
  selected: '已选择',
  disabled: '不可用',
  back: '返回',
  settings: '设置',
  ball: '比赛',
  lineup: '阵容',
  mail: '邮件',
  trophy: '荣誉',
  check: '确认',
  close: '关闭',
  hit: '碰撞',
  kick: '踢球',
  wall: '边墙',
  spring: '弹簧',
  post: '门柱',
  shoot: '出手',
  goal: '进球',
  skill: '技能',
  turn: '回合',
};
async function main() {
  const root = document.querySelector<HTMLElement>('#ui-resources')!;
  root.innerHTML =
    '<h1>大厅与比赛资源</h1><p>原创几何占位 · 文字实时显示 · 球场仅作展示</p><p role="status">加载资源…</p>';
  const status = root.querySelector<HTMLElement>('[role=status]')!;
  try {
    const tokens = UiTokensSchema.parse(rawTokens);
    const response = await fetch('/assets/ui/pack.json');
    if (!response.ok) throw new Error('UI manifest unavailable');
    const pack = UiPackSchema.parse(await response.json()),
      images = await loadUiPages(pack);
    const controls = document.createElement('div');
    controls.className = 'ui-controls';
    controls.innerHTML =
      '<label>外观 <select name="theme"><option value="light">亮色</option><option value="dark">暗色</option></select></label><label>字号 <select name="font"><option value="1">标准</option><option value="1.5">大字体 150%</option><option value="2">大字体 200%</option></select></label><label><input type="checkbox" name="muted">静音</label>';
    root.append(controls);
    const theme = controls.querySelector<HTMLSelectElement>('[name=theme]')!,
      font = controls.querySelector<HTMLSelectElement>('[name=font]')!,
      muted = controls.querySelector<HTMLInputElement>('[name=muted]')!;
    muted.checked = isMuted();
    muted.addEventListener('change', () => setMuted(muted.checked));
    const gallery = document.createElement('div');
    root.append(gallery);
    let observer: ResizeObserver | null = null;
    const render = () => {
      observer?.disconnect();
      gallery.replaceChildren();
      const selected = theme.value as 'light' | 'dark',
        palette = tokens.themes[selected],
        scale = Number(font.value);
      document.documentElement.dataset.theme = selected;
      for (const [key, value] of Object.entries(palette))
        document.documentElement.style.setProperty(`--ui-${key}`, value);
      gallery.style.fontSize = `${tokens.typography.body * scale}px`;
      const canvasEntries: { canvas: HTMLCanvasElement; id: string; target: HTMLElement }[] = [];
      function sprite(parent: HTMLElement, id: string, width?: number, height?: number) {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        if (width && height) {
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        } else canvas.className = 'ui-surface';
        parent.prepend(canvas);
        canvasEntries.push({ canvas, id, target: width ? canvas : parent });
      }
      const section = (title: string, className = 'ui-grid') => {
        const heading = document.createElement('h2');
        heading.textContent = title;
        gallery.append(heading);
        const grid = document.createElement('div');
        grid.className = className;
        gallery.append(grid);
        return grid;
      };
      const surfaces = section('按钮与面板');
      for (const kind of UI_SURFACES)
        for (const state of UI_STATES) {
          const el = kind === 'panel' ? document.createElement('section') : document.createElement('button');
          el.className = `ui-tile ui-${kind}`;
          el.dataset.state = state;
          const text = document.createElement('span');
          text.textContent = `${labels[kind]} · ${labels[state]}`;
          el.append(text);
          if (el instanceof HTMLButtonElement) {
            el.disabled = state === 'disabled';
            el.setAttribute('aria-pressed', String(state === 'selected'));
            el.addEventListener('click', () => {
              const on = el.getAttribute('aria-pressed') !== 'true';
              el.setAttribute('aria-pressed', String(on));
              el.dataset.state = on ? 'selected' : 'normal';
              const entry = canvasEntries.find((e) => e.target === el)!;
              entry.id = `surface.${selected}.${kind}.${el.dataset.state}`;
              text.textContent = `${labels[kind]} · ${labels[el.dataset.state]}`;
              paint(entry);
            });
          } else el.setAttribute('aria-label', text.textContent);
          surfaces.append(el);
          sprite(el, `surface.${selected}.${kind}.${state}`);
        }
      const icons = section('图标');
      for (const name of UI_ICONS) {
        const item = document.createElement('div');
        item.className = 'ui-icon';
        const label = document.createElement('span');
        label.textContent = labels[name];
        item.append(label);
        sprite(item, `icon.${selected}.${name}`, 32, 32);
        icons.append(item);
      }
      const stadiums = section('球场展示');
      for (const [i, id] of UI_STADIUMS.entries()) {
        const item = document.createElement('figure');
        const caption = document.createElement('figcaption');
        caption.textContent = `球场 ${i + 1}`;
        item.append(caption);
        sprite(item, `stadium.${id}`, 256, 192);
        stadiums.append(item);
      }
      const sounds = section('比赛音效');
      for (const name of UI_AUDIO) {
        const button = document.createElement('button');
        button.className = 'ui-audio';
        button.dataset.sound = name;
        button.textContent = labels[name];
        button.addEventListener('click', () => {
          sfx.unlock();
          if (name === 'hit' || name === 'kick' || name === 'wall') sfx[name](4);
          else if (name === 'shoot') sfx.shoot(0.7);
          else sfx[name]();
        });
        sounds.append(button);
      }
      function paint(entry: (typeof canvasEntries)[number]) {
        const rect = entry.target.getBoundingClientRect(),
          dpr = Math.min(devicePixelRatio || 1, 3);
        if (!rect.width || !rect.height) return;
        entry.canvas.width = Math.round(rect.width * dpr);
        entry.canvas.height = Math.round(rect.height * dpr);
        const ctx = entry.canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);
        drawUiSprite(ctx, pack, images, entry.id, rect.width, rect.height);
      }
      observer = new ResizeObserver((entries) => {
        for (const target of entries)
          for (const item of canvasEntries.filter((e) => e.target === target.target)) paint(item);
      });
      for (const item of canvasEntries) {
        observer.observe(item.target);
        paint(item);
      }
      status.textContent = `${pack.sprites.length} 个资源 · ${pack.pages.length} 张图集 · ${pack.audio.ids.length} 种程序音效`;
      window.__uiAudit = {
        version: pack.version,
        sprites: pack.sprites.length,
        pages: images.size,
        theme: selected,
        fontScale: scale,
      };
    };
    theme.addEventListener('change', render);
    font.addEventListener('change', render);
    render();
    window.addEventListener(
      'pagehide',
      () => {
        observer?.disconnect();
        disposeAudio();
      },
      { once: true },
    );
  } catch {
    status.textContent = '资源加载失败，请重试。';
    const retry = document.createElement('button');
    retry.textContent = '重试';
    retry.addEventListener('click', () => location.reload());
    root.append(retry);
  }
}
if (import.meta.env.DEV || import.meta.env.MODE === 'test') void main();
