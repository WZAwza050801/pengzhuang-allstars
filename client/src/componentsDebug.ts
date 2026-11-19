import { CardAtlasSchema } from '../../packages/contracts/src/card-atlas';
import { loadCardPages } from './cardSprites';
import * as UI from './ui/components';
import { statePresentation, type UiState, type UiTheme } from './ui/semantics';
import './ui/components.css';
import './componentsDebug.css';
import { WebAssetScene } from './assets';
declare global {
  interface Window {
    __componentsAudit?: { components: number; theme: UiTheme; states: UiState[]; cardVersion: string };
  }
}
const states: UiState[] = ['ready', 'selected', 'disabled', 'loading', 'empty', 'error'];
async function main() {
  const root = document.querySelector<HTMLElement>('#components')!;
  root.replaceChildren();
  root.append(Object.assign(document.createElement('h1'), { textContent: '组件样例' }));
  const intro = document.createElement('p');
  intro.textContent = '本页使用演示数据检查组件；不是账号资产、奖励或匹配服务。';
  root.append(intro);
  const controls = document.createElement('div');
  controls.className = 'component-controls';
  controls.innerHTML =
    '<label>外观 <select name="theme"><option value="light">亮色</option><option value="dark">暗色</option></select></label><label>字号 <select name="font"><option value="1">标准</option><option value="2">200%</option></select></label>';
  root.append(controls);
  const theme = controls.querySelector<HTMLSelectElement>('[name=theme]')!,
    font = controls.querySelector<HTMLSelectElement>('[name=font]')!;
  let activeDialog: ReturnType<typeof UI.Dialog> | null = null;
  const content = UI.SafeAreaContainer();
  content.classList.add('component-grid');
  root.append(content);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = '加载组件资源…';
  root.append(status);
  try {
    const resources = new WebAssetScene();
    window.addEventListener('pagehide', () => resources.dispose(), { once: true });
    const atlas = CardAtlasSchema.parse(await resources.data('card.atlas')),
      images = await loadCardPages(atlas, resources);
    const render = () => {
      activeDialog?.dispose();
      content.replaceChildren();
      const selected = theme.value as UiTheme;
      document.documentElement.dataset.uiTheme = selected;
      const scale = Number(font.value);
      content.style.setProperty('--ui-body', `${UI.uiTokens.typography.body * scale}px`);
      content.style.setProperty('--ui-number', `${UI.uiTokens.typography.number * scale}px`);
      content.style.fontSize = 'var(--ui-body)';
      const sample = (name: string, props: string) => {
        const section = document.createElement('section');
        section.className = 'component-sample';
        section.dataset.component = name;
        const h = document.createElement('h2');
        h.textContent = name;
        const note = document.createElement('p');
        note.className = 'component-props';
        note.textContent = props;
        section.append(h, note);
        content.append(section);
        return section;
      };
      let actions = 0;
      const actionResult = document.createElement('p');
      actionResult.dataset.result = 'actions';
      actionResult.textContent = '操作次数 0';
      const buttons = sample('PrimaryButton', 'label / state / primary / onActivate');
      for (const state of states) {
        const b = UI.Button({
          label: '开始比赛',
          state,
          primary: true,
          onActivate: () => {
            actionResult.textContent = `操作次数 ${++actions}`;
          },
        }).element;
        b.dataset.sampleState = state;
        buttons.append(b);
      }
      buttons.append(actionResult);
      const modes = sample('ModeCard', 'title / summary / state / onSelect');
      let modeSelected = false;
      const renderMode = () => {
        modes.querySelector('article')?.remove();
        modes.append(
          UI.ModeCard({
            title: '均衡好友赛',
            summary: '统一 Lv5 · 不计排位 · 无正式奖励',
            state: modeSelected ? 'selected' : 'ready',
            onSelect: () => {
              modeSelected = !modeSelected;
              renderMode();
            },
          }),
        );
      };
      renderMode();
      const players = sample('PlayerCard', 'atlas / playerId / state / onSelect');
      let cardSelected = false;
      const renderCard = () => {
        players.querySelector('[data-card-active]')?.remove();
        const card = UI.PlayerCard({
          atlas,
          images,
          playerId: 'p01',
          state: cardSelected ? 'selected' : 'normal',
          onSelect: () => {
            cardSelected = !cardSelected;
            renderCard();
          },
        });
        card.dataset.cardActive = 'true';
        players.append(card);
      };
      renderCard();
      players.append(
        UI.PlayerCard({
          atlas,
          images,
          playerId: 'p02',
          state: 'disabled',
          onSelect: () => {
            throw new Error('Disabled card activated');
          },
        }),
      );
      sample('Avatar', 'name / optional url / image-failure initial').append(UI.Avatar('队长'));
      sample('CurrencyAmount', 'exact integer string | null / unit').append(
        UI.CurrencyAmount('9223372036854775807', '金币'),
        UI.CurrencyAmount(null, '碎片'),
      );
      sample('AttributeBar', 'label / value / max').append(UI.AttributeBar('力量', 78, 100));
      const lineup = sample('LineupSlot', 'position label / player | null / onSelect');
      let hasPlayer = false;
      const renderSlot = () => {
        lineup.querySelector('button')?.remove();
        lineup.append(
          UI.LineupSlot('前锋', hasPlayer ? '示例球员' : null, () => {
            hasPlayer = !hasPlayer;
            renderSlot();
          }),
        );
      };
      renderSlot();
      sample('RuleSummary', 'server-provided summary text').append(
        UI.RuleSummary('统一 Lv5 · 180 秒 / 先进 3 球 · 回合 20 秒 · 重连 60 秒'),
      );
      sample('ConnectionBanner', 'online / offline / reconnecting').append(
        UI.ConnectionBanner('online'),
        UI.ConnectionBanner('offline'),
        UI.ConnectionBanner('reconnecting'),
      );
      sample('Countdown', 'authoritative remainingSeconds (presentation only)').append(UI.Countdown(18));
      const dialogSample = sample('Dialog', 'title / body / confirmLabel / onConfirm');
      const confirmed = document.createElement('p');
      confirmed.dataset.result = 'dialog';
      confirmed.textContent = '尚未确认';
      activeDialog = UI.Dialog({
        title: '离开比赛？',
        body: '这是组件演示，不会执行真实认输。',
        confirmLabel: '确认离开',
        onConfirm: () => {
          confirmed.textContent = '已确认';
        },
      });
      root.append(activeDialog.element);
      const dialogOpener = UI.Button({
        label: '打开确认框',
        onActivate: () => activeDialog?.open(dialogOpener.element),
      });
      dialogSample.append(dialogOpener.element, confirmed);
      sample('Toast', 'message; polite status, no focus movement').append(UI.Toast('阵容已保存（演示）'));
      sample('EmptyState', 'message').append(UI.EmptyState('暂无可用阵容，请先选择球员'));
      const errors = sample('ErrorState', 'message / retry');
      const retryResult = document.createElement('div');
      retryResult.dataset.result = 'retry';
      retryResult.append(
        UI.ErrorState('连接失败，阵容尚未保存', () =>
          retryResult.replaceChildren(UI.StatePanel({ state: 'ready', title: '重试成功（演示）' })),
        ),
      );
      errors.append(retryResult);
      sample('LoadingSkeleton', 'label; aria-busy; no fake balance').append(UI.LoadingSkeleton('读取余额中'));
      sample('RewardRow', 'exact value / unit / pending | posted').append(
        UI.RewardRow('40', '金币', 'pending'),
        UI.RewardRow('40', '金币', 'posted'),
      );
      const pagination = sample('Pagination', 'page / total / onChange');
      let page = 1;
      const renderPage = () => {
        pagination.querySelector('nav')?.remove();
        pagination.append(
          UI.Pagination(page, 3, (next) => {
            page = next;
            renderPage();
          }),
        );
      };
      renderPage();
      sample('SafeAreaContainer', 'content; env(safe-area-inset-*)').append('内容按宿主安全区留白');
      const canvasSample = sample('CanvasState', 'same statePresentation; platform input adapter remains host-owned');
      for (const state of states) {
        const canvas = document.createElement('canvas'),
          dpr = Math.min(devicePixelRatio || 1, 3),
          width = 260,
          height = scale === 2 ? 128 : 64;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Canvas ${statePresentation(UI.uiTokens, selected, state).status}`);
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);
        const view = UI.drawCanvasState(UI.webUiCanvas(ctx), {
          theme: selected,
          state,
          label: '比赛',
          width,
          height,
          primary: true,
          fontScale: scale,
        });
        canvas.dataset.state = state;
        canvas.dataset.canActivate = String(view.canActivate);
        canvasSample.append(canvas);
      }
      window.__componentsAudit = {
        components: content.querySelectorAll('[data-component]').length,
        theme: selected,
        states: [...states],
        cardVersion: atlas.version,
      };
      status.textContent = '19 类组件 · Web / Canvas 同源语义';
    };
    theme.addEventListener('change', render);
    font.addEventListener('change', render);
    render();
    window.addEventListener('pagehide', () => activeDialog?.dispose(), { once: true });
  } catch {
    content.append(UI.ErrorState('组件资源加载失败', () => location.reload()));
    status.textContent = '加载失败，可重试';
  }
}
if (import.meta.env.DEV || import.meta.env.MODE === 'test') void main();
