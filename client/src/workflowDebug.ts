import {
  MAIN_NAV,
  PAGE_FLOW,
  ALL_FEATURES,
  DEFAULT_FEATURES,
  resolveNavigation,
  type NavigationTarget,
  type NavigationContext,
  type BlockReason,
} from '../../packages/client-model/src/navigation';
import {
  Button,
  StatePanel,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Dialog,
  SafeAreaContainer,
} from './ui/components';
import { rulesForMode, describeModeRules } from '../../config/modes';
import { DEFAULT_DATA } from '../../shared/data';
import './ui/components.css';
import './workflowDebug.css';
declare global {
  interface Window {
    __workflowAudit?: { page: string; session: string; resume: string | null; history: number };
  }
}
const titles = {
  login: '登录',
  lobby: '比赛',
  lineup: '我的阵容',
  growth: '成长',
  club: '俱乐部',
  profile: '我的',
  settings: '设置',
  inbox: '消息与任务',
  queue: '匹配',
  room: '好友房',
  match: '比赛',
  result: '结算',
  history: '比赛记录',
};
const reasons: Record<BlockReason, string> = {
  'feature-off': '暂未开放',
  'session-loading': '会话读取中',
  offline: '网络断开，请恢复后重试',
  maintenance: '维护中，请稍后重试',
  outdated: '版本过旧，请更新后重试',
};
function main() {
  const root = document.querySelector<HTMLElement>('#workflow')!;
  let context: NavigationContext = {
      session: 'anonymous',
      network: 'online',
      service: 'ready',
      features: { ...ALL_FEATURES },
    },
    page: NavigationTarget = { page: 'lobby' },
    resume: NavigationTarget | null = null,
    history: NavigationTarget[] = [],
    dialog: ReturnType<typeof Dialog> | null = null,
    reward: 'pending' | 'posted' | 'error' = 'pending',
    listError = false,
    loginError = false;
  const write = (tag: string, value: string) => Object.assign(document.createElement(tag), { textContent: value });
  function go(input: unknown, replace = false) {
    const decision = resolveNavigation(input, context);
    if (decision.kind === 'invalid') {
      page = { page: 'lobby' };
      render('页面参数无效，已返回比赛入口');
      return;
    }
    if (decision.kind === 'blocked') {
      render(reasons[decision.reason]);
      return;
    }
    if (!replace) history.push(page);
    if (decision.kind === 'login') {
      resume = decision.resume;
      page = { page: 'login' };
    } else page = decision.target;
    render();
  }
  function action(label: string, target: NavigationTarget, primary = false) {
    const decision = resolveNavigation(target, context),
      blocked = decision.kind === 'blocked';
    const button = Button({
      label: blocked ? `${label} · ${reasons[decision.reason]}` : label,
      state: blocked ? 'disabled' : 'ready',
      primary,
      onActivate: () => go(target),
    }).element;
    return button;
  }
  function render(message?: string) {
    dialog?.dispose();
    dialog = null;
    root.replaceChildren();
    const header = document.createElement('header');
    header.append(write('h1', '页面流交互线框'), write('p', '演示导航与状态，不提交账号、阵容或奖励数据。'));
    root.append(header);
    const controls = document.createElement('section');
    controls.className = 'workflow-controls';
    controls.setAttribute('aria-label', '原型演示条件');
    controls.innerHTML =
      '<label>网络 <select name="network"><option value="online">在线</option><option value="offline">离线</option></select></label><label>服务 <select name="service"><option value="ready">可用</option><option value="maintenance">维护中</option><option value="outdated">版本过旧</option></select></label><label><input type="checkbox" name="features"> 开放演示功能</label>';
    const network = controls.querySelector<HTMLSelectElement>('[name=network]')!,
      service = controls.querySelector<HTMLSelectElement>('[name=service]')!,
      features = controls.querySelector<HTMLInputElement>('[name=features]')!;
    network.value = context.network;
    service.value = context.service;
    features.checked = context.features.inventory;
    network.onchange = () => {
      context = { ...context, network: network.value as NavigationContext['network'] };
      render();
    };
    service.onchange = () => {
      context = { ...context, service: service.value as NavigationContext['service'] };
      render();
    };
    features.onchange = () => {
      context = { ...context, features: { ...(features.checked ? ALL_FEATURES : DEFAULT_FEATURES) } };
      render();
    };
    root.append(controls);
    const layout = SafeAreaContainer();
    layout.classList.add('workflow-layout');
    root.append(layout);
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', '主导航');
    for (const item of MAIN_NAV) {
      const target = { page: item.page },
        decision = resolveNavigation(target, context),
        blocked = decision.kind === 'blocked';
      const button = Button({
        label: item.label,
        state: blocked ? 'disabled' : 'ready',
        onActivate: () => go(target),
      }).element;
      button.replaceChildren(write('span', item.label));
      if (blocked) {
        button.append(write('small', decision.reason === 'feature-off' ? '未开放' : reasons[decision.reason]));
        button.setAttribute('aria-label', `${item.label} · ${reasons[decision.reason]}`);
      }
      if (page.page === item.page) button.setAttribute('aria-current', 'page');
      nav.append(button);
    }
    layout.append(nav);
    const content = document.createElement('section');
    content.className = 'workflow-content';
    content.append(write('h2', titles[page.page]));
    layout.append(content);
    const status = write('p', context.session === 'authenticated' ? '演示登录态' : '游客');
    status.setAttribute('role', 'status');
    content.append(status);
    if (message) content.append(StatePanel({ state: 'error', title: message }));
    if (page.page !== 'lobby') {
      const back = Button({
        label: '返回',
        onActivate: () => {
          if (page.page === 'match') {
            dialog = Dialog({
              title: '离开比赛？',
              body: '实际比赛退出规则由服务端处理；本原型只演示返回。',
              confirmLabel: '确认返回',
              onConfirm: () => go({ page: 'lobby' }, true),
            });
            root.append(dialog.element);
            dialog.open(back.element);
          } else {
            const target = history.pop() ?? { page: PAGE_FLOW[page.page].back };
            go(target, true);
          }
        },
      });
      content.append(back.element);
    }
    const pitch = () => {
      const field = document.createElement('div');
      field.className = 'workflow-pitch';
      field.setAttribute('role', 'img');
      field.setAttribute('aria-label', '足球场线框示意');
      field.append(write('span', '球场展示示意'));
      content.append(field);
    };
    switch (page.page) {
      case 'lobby':
        if (context.service !== 'ready')
          content.append(StatePanel({ state: 'error', title: reasons[context.service] }));
        if (context.network === 'offline')
          content.append(StatePanel({ state: 'error', title: '离线，可继续本地练习' }));
        content.append(LoadingSkeleton('余额由服务端读取，演示不填入金额'));
        pitch();
        content.append(
          action('开始均衡排位', { page: 'queue', mode: 'ranked' }, true),
          action('好友约战', { page: 'room' }),
          action('自由练习', { page: 'match', mode: 'practice' }),
          action('消息与任务', { page: 'inbox', section: 'mail' }),
        );
        break;
      case 'login': {
        content.append(write('p', '后续接邮箱/微信登录；此处只演示成功后回到原操作。'));
        const loginGate = resolveNavigation({ page: 'login' }, context),
          disabled = loginGate.kind === 'blocked';
        if (disabled) content.append(StatePanel({ state: 'error', title: reasons[loginGate.reason] }));
        if (loginError)
          content.append(
            ErrorState('登录失败，请重试；原操作保留', () => {
              loginError = false;
              render();
            }),
          );
        content.append(
          Button({
            label: '模拟登录成功',
            state: disabled ? 'disabled' : 'ready',
            primary: true,
            onActivate: () => {
              context = { ...context, session: 'authenticated' };
              const target = resume ?? { page: 'lobby' };
              resume = null;
              go(target, true);
            },
          }).element,
          Button({
            label: '模拟登录失败',
            state: disabled ? 'disabled' : 'ready',
            onActivate: () => {
              loginError = true;
              render();
            },
          }).element,
          Button({
            label: '取消登录',
            onActivate: () => {
              resume = null;
              history = [];
              go({ page: 'lobby' }, true);
            },
          }).element,
        );
        break;
      }
      case 'lineup':
      case 'growth':
        if (listError)
          content.append(
            ErrorState('读取失败，原操作保留', () => {
              listError = false;
              render();
            }),
          );
        else content.append(EmptyState('持有卡由服务端提供；这里不生成演示资产'));
        content.append(
          Button({
            label: '模拟读取失败',
            onActivate: () => {
              listError = true;
              render();
            },
          }).element,
        );
        break;
      case 'room':
        content.append(
          write('p', '房间码 DEMO01（演示），等待对手与准备状态'),
          write('p', describeModeRules(rulesForMode(DEFAULT_DATA, 'friend'))),
          action('模拟双方准备', { page: 'match', mode: 'friend', matchId: 'demo-room' }, true),
        );
        break;
      case 'queue': {
        const mode = page.mode;
        content.append(
          StatePanel({ state: 'loading', title: '排队中，取消与成功竞态在匹配服务裁定' }),
          action('模拟匹配成功', { page: 'match', mode, matchId: 'demo-ranked' }, true),
          Button({ label: '取消排队', onActivate: () => go({ page: 'lobby' }, true) }).element,
        );
        break;
      }
      case 'match': {
        const mode = page.mode;
        content.append(write('p', describeModeRules(rulesForMode(DEFAULT_DATA, mode))));
        pitch();
        if (context.network === 'offline' && mode !== 'practice')
          content.append(StatePanel({ state: 'loading', title: '恢复连接中，出手暂停' }));
        content.append(action('模拟对局结束', { page: 'result', mode, matchId: page.matchId ?? 'demo-local' }, true));
        break;
      }
      case 'result': {
        const mode = page.mode;
        if (mode === 'practice' || mode === 'friend')
          content.append(StatePanel({ state: 'ready', title: '无正式奖励，不计排位' }));
        else {
          content.append(
            reward === 'error'
              ? ErrorState('查询失败，不能据此显示奖励为 0', () => {
                  reward = 'pending';
                  render();
                })
              : StatePanel({
                  state: reward === 'pending' ? 'loading' : 'ready',
                  title: reward === 'pending' ? '结算处理中，等待服务端入账' : '已入账（演示状态，无虚构金额）',
                }),
          );
          content.append(
            Button({
              label: '模拟查询失败',
              onActivate: () => {
                reward = 'error';
                render();
              },
            }).element,
            Button({
              label: '模拟已入账',
              onActivate: () => {
                reward = 'posted';
                render();
              },
            }).element,
          );
        }
        content.append(
          action(
            '再来一局',
            mode === 'practice'
              ? { page: 'match', mode: 'practice' }
              : mode === 'friend'
                ? { page: 'room' }
                : { page: 'queue', mode },
          ),
          action('回到比赛入口', { page: 'lobby' }),
        );
        break;
      }
      case 'profile':
        content.append(action('登录', { page: 'login' }), action('设置', { page: 'settings' }));
        if (context.session === 'authenticated')
          content.append(
            Button({
              label: '模拟退出登录',
              onActivate: () => {
                context = { ...context, session: 'anonymous' };
                history = [];
                resume = null;
                go({ page: 'lobby' }, true);
              },
            }).element,
          );
        break;
      case 'settings':
        content.append(write('p', '本地设置：音量、画质与安全区；账号会话功能另接服务。'));
        break;
      case 'club':
        content.append(EmptyState('暂无俱乐部（线框状态）'));
        break;
      case 'inbox':
        content.append(EmptyState('暂无消息、任务或成就（线框状态）'));
        break;
    }
    const link = document.createElement('a');
    link.href = '/';
    link.textContent = '打开现有可玩版本';
    content.append(link);
    window.__workflowAudit = {
      page: page.page,
      session: context.session,
      resume: resume?.page ?? null,
      history: history.length,
    };
  }
  render();
}
if (import.meta.env.DEV || import.meta.env.MODE === 'test') main();
