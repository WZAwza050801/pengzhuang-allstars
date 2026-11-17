import rawTokens from './generated/tokens.canvas.json';
import { UiTokensSchema, type CardAtlas } from '../../../packages/contracts/src/index';
import { drawPlayerCard, type CardState } from '../cardSprites';
import { formatCurrency, statePresentation, type UiState, type UiTheme } from './semantics';
export const uiTokens = UiTokensSchema.parse(rawTokens);
function text(tag: string, value: string, className = '') {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
export interface ButtonProps {
  label: string;
  state?: UiState;
  primary?: boolean;
  onActivate: () => void;
}
export function Button(props: ButtonProps) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pz-button';
  const set = (next: ButtonProps) => {
    props = next;
    const state = next.state ?? 'ready',
      view = statePresentation(uiTokens, 'light', state, !!next.primary);
    button.classList.toggle('pz-primary', !!next.primary);
    button.dataset.state = state;
    button.disabled = !view.canActivate;
    button.setAttribute('aria-busy', String(view.busy));
    button.setAttribute('aria-pressed', String(state === 'selected'));
    button.textContent = `${view.marker ? view.marker + ' ' : ''}${next.label}${state !== 'ready' ? ' · ' + view.status : ''}`;
  };
  set(props);
  button.addEventListener('click', () => {
    if (!button.disabled) props.onActivate();
  });
  return { element: button, set };
}
export function StatePanel(props: { state: UiState; title: string; detail?: string; retry?: () => void }) {
  const panel = document.createElement('section');
  panel.className = 'pz-state';
  panel.dataset.state = props.state;
  panel.setAttribute('role', props.state === 'error' ? 'alert' : 'status');
  panel.setAttribute('aria-busy', String(props.state === 'loading'));
  const view = statePresentation(uiTokens, 'light', props.state);
  panel.append(text('strong', `${view.marker} ${props.title}`.trim()));
  if (props.detail) panel.append(text('p', props.detail));
  if (props.state === 'loading') {
    const skeleton = document.createElement('div');
    skeleton.className = 'pz-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    panel.append(skeleton);
  }
  if (props.state === 'error' && props.retry) panel.append(Button({ label: '重试', onActivate: props.retry }).element);
  return panel;
}
export const EmptyState = (message: string) => StatePanel({ state: 'empty', title: message });
export const ErrorState = (message: string, retry: () => void) => StatePanel({ state: 'error', title: message, retry });
export const LoadingSkeleton = (label: string) => StatePanel({ state: 'loading', title: label });
export function CurrencyAmount(value: string | null, unit: string) {
  return value === null ? LoadingSkeleton(`${unit}加载中`) : text('span', formatCurrency(value, unit), 'pz-currency');
}
export function AttributeBar(label: string, value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value < 0 || value > max)
    throw new Error('Invalid attribute range');
  const root = document.createElement('label');
  root.className = 'pz-attribute';
  root.append(text('span', `${label} ${value}/${max}`));
  const meter = document.createElement('meter');
  meter.min = 0;
  meter.max = max;
  meter.value = value;
  meter.setAttribute('aria-label', label);
  root.append(meter);
  return root;
}
export function Countdown(remainingSeconds: number) {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) throw new Error('Invalid remaining time');
  const seconds = Math.ceil(remainingSeconds);
  return text('span', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 'pz-countdown');
}
export function RuleSummary(summary: string) {
  const section = document.createElement('section');
  section.className = 'pz-rules';
  section.setAttribute('aria-label', '比赛规则');
  section.append(text('strong', '比赛规则'), text('p', summary));
  return section;
}
export function ConnectionBanner(state: 'online' | 'offline' | 'reconnecting') {
  const labels = { online: '已连接', offline: '连接中断，请检查网络', reconnecting: '正在恢复连接，暂停出手' };
  return StatePanel({
    state: state === 'online' ? 'ready' : state === 'offline' ? 'error' : 'loading',
    title: labels[state],
  });
}
export function ModeCard(props: { title: string; summary: string; state: UiState; onSelect: () => void }) {
  const section = document.createElement('article');
  section.className = 'pz-mode';
  section.append(
    text('h3', props.title),
    text('p', props.summary),
    Button({
      label: props.state === 'selected' ? '已选择' : '选择模式',
      state: props.state,
      onActivate: props.onSelect,
    }).element,
  );
  return section;
}
export function LineupSlot(label: string, player: string | null, onSelect: () => void) {
  const el = Button({ label: `${label} · ${player ?? '空位，选择球员'}`, onActivate: onSelect }).element;
  el.classList.add('pz-lineup-slot');
  return el;
}
export function RewardRow(value: string, unit: string, status: 'pending' | 'posted') {
  const row = document.createElement('div');
  row.className = 'pz-reward';
  row.append(CurrencyAmount(value, unit), text('span', status === 'posted' ? '已入账' : '处理中，请稍候'));
  return row;
}
export function Pagination(page: number, total: number, onChange: (page: number) => void) {
  if (!Number.isInteger(page) || !Number.isInteger(total) || total < 1 || page < 1 || page > total)
    throw new Error('Invalid pagination');
  const root = document.createElement('nav');
  root.className = 'pz-pagination';
  root.setAttribute('aria-label', '列表分页');
  root.append(
    Button({ label: '上一页', state: page === 1 ? 'disabled' : 'ready', onActivate: () => onChange(page - 1) }).element,
    text('span', `${page} / ${total}`),
    Button({ label: '下一页', state: page === total ? 'disabled' : 'ready', onActivate: () => onChange(page + 1) })
      .element,
  );
  return root;
}
export function SafeAreaContainer() {
  const node = document.createElement('div');
  node.className = 'pz-safe-area';
  return node;
}
export function Toast(message: string) {
  const node = text('div', message, 'pz-toast');
  node.setAttribute('role', 'status');
  return node;
}
export function Avatar(name: string, url?: string) {
  const node = document.createElement('span');
  node.className = 'pz-avatar';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', name);
  node.textContent = Array.from(name).slice(0, 1).join('') || '?';
  if (url) {
    const image = new Image();
    image.alt = '';
    image.onload = () => node.replaceChildren(image);
    image.onerror = () => {
      image.remove();
    };
    image.src = url;
  }
  return node;
}
export function PlayerCard(props: {
  atlas: CardAtlas;
  images: ReadonlyMap<string, CanvasImageSource>;
  playerId: string;
  state: CardState;
  onSelect: () => void;
}) {
  const player = props.atlas.portraits.find((p) => p.playerId === props.playerId);
  if (!player) throw new Error('Unknown player card');
  const button = Button({
    label: player.name,
    state: props.state === 'normal' ? 'ready' : props.state,
    onActivate: props.onSelect,
  }).element;
  button.className = 'pz-player-card';
  button.setAttribute(
    'aria-label',
    `${player.name} · ${props.state === 'selected' ? '已选择' : props.state === 'disabled' ? '不可用' : '可用'} · 原创占位`,
  );
  const canvas = document.createElement('canvas'),
    dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = 160 * dpr;
  canvas.height = 224 * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  drawPlayerCard(ctx, props.atlas, props.images, props.playerId, props.state);
  button.replaceChildren(canvas);
  return button;
}
let dialogSequence = 0;
export function Dialog(props: { title: string; body: string; confirmLabel: string; onConfirm: () => void }) {
  const element = document.createElement('dialog');
  element.className = 'pz-dialog';
  const heading = text('h2', props.title);
  heading.id = `pz-dialog-${++dialogSequence}`;
  element.setAttribute('aria-labelledby', heading.id);
  let opener: HTMLElement | null = null;
  const close = () => element.close();
  element.append(
    heading,
    text('p', props.body),
    Button({ label: '取消', onActivate: close }).element,
    Button({
      label: props.confirmLabel,
      primary: true,
      onActivate: () => {
        close();
        props.onConfirm();
      },
    }).element,
  );
  element.addEventListener('close', () => opener?.isConnected && opener.focus());
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const first = buttons[0],
      last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  return {
    element,
    open: () => {
      if (element.open) return;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    },
    dispose: () => {
      if (element.open) element.close();
      element.remove();
    },
  };
}
/** A small capability surface; future Canvas hosts can adapt these methods without DOM inheritance. */
export interface UiCanvas {
  box(width: number, height: number, style: { fill: string; border: string; lineWidth: number; radius: number }): void;
  label(text: string, width: number, height: number, style: { ink: string; font: string }): void;
}
export function webUiCanvas(ctx: CanvasRenderingContext2D): UiCanvas {
  return {
    box(width, height, style) {
      ctx.save();
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.border;
      ctx.lineWidth = style.lineWidth;
      ctx.beginPath();
      ctx.roundRect(2, 2, width - 4, height - 4, style.radius);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
    label(value, width, height, style) {
      ctx.save();
      ctx.fillStyle = style.ink;
      ctx.font = style.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(value, width / 2, height / 2, width - 24);
      ctx.restore();
    },
  };
}
export function drawCanvasState(
  ctx: UiCanvas,
  props: {
    theme: UiTheme;
    state: UiState;
    label: string;
    width: number;
    height: number;
    primary?: boolean;
    fontScale?: number;
  },
) {
  const view = statePresentation(uiTokens, props.theme, props.state, props.primary);
  ctx.box(props.width, props.height, {
    fill: view.fill,
    border: view.border,
    lineWidth: props.state === 'selected' ? 3 : 1,
    radius: uiTokens.radius,
  });
  ctx.label(`${view.marker} ${props.label} · ${view.status}`.trim(), props.width, props.height, {
    ink: view.ink,
    font: `600 ${uiTokens.typography.body * (props.fontScale ?? 1)}px system-ui`,
  });
  return view;
}
