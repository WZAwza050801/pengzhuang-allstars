import './style.css';
import { DEFAULT_DATA, FIELD_SKINS } from '../../shared/data';
import type { AiLevel } from '../../shared/ai';
import { GameView } from './game';
import { LocalHost } from './localHost';
import { OnlineHost, type OnlineStatus } from './onlineHost';
import { isMuted, setMuted } from './sfx';
import { activeLineup, mountLineup, randomLineup } from './lineup';

const app = document.getElementById('app')!;

let current: GameView | null = null;

type Tab = 'shop' | 'lineup' | 'play' | 'achieve' | 'club';
const TABS: { id: Tab; label: string; icon: string; open: boolean }[] = [
  { id: 'shop', label: '商店', icon: 'Tab_Icon_01', open: false },
  { id: 'lineup', label: '阵容', icon: 'Tab_Icon_02', open: true },
  { id: 'play', label: '比赛', icon: 'Tab_Icon_03', open: true },
  { id: 'achieve', label: '成就', icon: 'Tab_Icon_04', open: false },
  { id: 'club', label: '俱乐部', icon: 'Tab_Icon_06', open: false },
];

/** Lobby-only profile shown in the original top bar. Nothing in a match reads it. */
interface Profile { level: number; exp: number; cash: number; diamond: number }
function profile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem('pz_profile') || 'null') as Partial<Profile> | null;
    return { level: p?.level ?? 1, exp: p?.exp ?? 0, cash: p?.cash ?? 0, diamond: p?.diamond ?? 0 };
  } catch {
    return { level: 1, exp: 0, cash: 0, diamond: 0 };
  }
}
const EXP_PER_LEVEL = 20;

/** Same-Wi-Fi address of this machine, so a friend can open the game without being told a port by hand. */
async function copyInvite() {
  try {
    const res = await fetch('/api/join-info');
    if (!res.ok) throw new Error(String(res.status));
    const info = (await res.json()) as { urls?: { url: string; kind: 'lan' | 'vpn' }[] };
    const urls = info.urls ?? [];
    if (!urls.length) throw new Error('empty');
    const text = urls.map((x) => `${x.kind === 'lan' ? '同一 Wi-Fi' : 'Radmin'}：${x.url}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('邀请地址已复制，发给朋友即可');
    } catch {
      window.prompt('复制这个地址发给朋友', text);
    }
  } catch {
    toast('没拿到邀请地址。朋友需要和这台电脑在同一个网络');
  }
}

function toast(msg: string) {
  const box = document.querySelector('.shell-toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'shell-toast';
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

function nickname() {
  return localStorage.getItem('pz_nick') || '';
}

/** Card level picked in the menu (1–max), applied to every slot of this device's lineups. */
function cardLevel(): number {
  const v = Number(localStorage.getItem('pz_card_level'));
  const { max, uniformLevel } = DEFAULT_DATA.rules.levels;
  return Number.isInteger(v) && v >= 1 && v <= max ? v : uniformLevel;
}

function cardLevels(): number[] {
  return new Array<number>(DEFAULT_DATA.rules.formation.length).fill(cardLevel());
}

/** The server URL: same origin when the built-in server hosts the page, otherwise an explicit address. */
function serverUrl(): string {
  const saved = localStorage.getItem('pz_server');
  if (saved !== null) return saved;
  // The dev server proxies /colyseus to the game server, so an empty URL works there too.
  return '';
}

/** The original lobby frame: level / cash / diamond bar on top, tab bar at the bottom. */
function menu(tab: Tab = 'play') {
  current?.dispose();
  current = null;
  document.querySelectorAll('.pdetail').forEach((n) => n.remove());
  const p = profile();
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="tb-lv"><span class="tb-lvnum">${p.level}</span><span class="tb-exp"><i style="width:${Math.min(100, (p.exp / EXP_PER_LEVEL) * 100)}%"></i><em>${p.exp}/${EXP_PER_LEVEL}</em></span></div>
        <div class="tb-res"><img src="/assets/orig_ui/Ico_01.png" alt="钞票" /><b>${p.cash}</b><button class="tb-add" aria-label="充值"></button></div>
        <div class="tb-res"><img src="/assets/orig_ui/Ico_02.png" alt="钻石" /><b>${p.diamond}</b><button class="tb-add" aria-label="充值"></button></div>
      </header>
      <main class="shell-body"></main>
      <nav class="bottomnav">
        ${TABS.map((t) => `<button class="nav-tab${t.id === tab ? ' on' : ''}${t.open ? '' : ' locked'}" data-tab="${t.id}"><img src="/assets/orig_ui/${t.icon}.png" alt="" /><span>${t.label}</span></button>`).join('')}
      </nav>
      <div class="shell-toasts"></div>
    </div>`;
  app.querySelectorAll('.tb-add').forEach((b) => b.addEventListener('click', () => toast('商店暂未开放')));
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = TABS.find((x) => x.id === b.dataset.tab)!;
      if (!t.open) return toast(`${t.label}暂未开放`);
      if (t.id !== tab) menu(t.id);
    }),
  );
  const body = app.querySelector('.shell-body') as HTMLElement;
  if (tab === 'lineup') mountLineup(body, { cardLevel, toast });
  else playTab(body);
}

/**
 * The five original league stadiums (texture/Image_01–05), each paired with the pitch scene it plays on.
 * League names are rebuilt: the screenshots only show 地区联赛 / League Two.
 */
const ARENAS = [
  { stadium: 'Image_01', skin: 'scene_01', name: '社区联赛' },
  { stadium: 'Image_02', skin: 'scene_02', name: '地区联赛' },
  { stadium: 'Image_03', skin: 'scene_03', name: '甲级联赛' },
  { stadium: 'Image_04', skin: 'scene_04', name: '超级联赛' },
  { stadium: 'Image_05', skin: 'scene_05', name: '全明星联赛' },
].filter((a) => FIELD_SKINS.some((s) => s.id === a.skin));

function arenaIndex(): number {
  const i = ARENAS.findIndex((a) => a.skin === localStorage.getItem('pz_skin'));
  return i >= 0 ? i : 0;
}

function currentSkin(): string {
  const saved = localStorage.getItem('pz_skin');
  // The five league scenes are the photos in client/public/assets/fields. A missing
  // choice, or the hand-drawn orig_2016, falls back to the stadium on screen.
  if (saved && saved !== 'orig_2016' && (ARENAS.some((a) => a.skin === saved) || FIELD_SKINS.some((s) => s.id === saved))) return saved;
  return ARENAS[0]?.skin || 'scene_01';
}

/** 比赛 tab: the original lobby (profile row, contracts, league stadium, side icons, 杯赛 / 竞技模式). */
function playTab(root: HTMLElement) {
  const ui = (n: string) => `/assets/orig_ui/${n}.png`;
  const side = (cls: string, icon: string, label: string) => `<button class="side-btn ${cls}" data-soon="${label}"><img src="${ui(icon)}" alt="" /><span>${label}</span></button>`;
  root.innerHTML = `
    <div class="home">
      <div class="home-profile">
        <img class="hp-logo" src="${ui('Btn_Icon_06')}" alt="" />
        <div class="hp-id"><input class="nick" maxlength="12" placeholder="点此输入昵称" /><small>我的俱乐部</small></div>
        <div class="hp-gold"><img src="${ui('Ico_03')}" alt="金币" /><b>${profile().cash}</b></div>
        <button class="hp-gear" aria-label="设置"></button>
      </div>
      <div class="home-contracts">
        <button class="contract" data-soon="自由合同"><img src="${ui('Store_Icon_01')}" alt="" /><span><b>自由合同</b><small>未开放</small></span></button>
        <button class="contract heavy" data-soon="重磅合同"><span><b>重磅合同</b><small>未开放</small></span><img src="${ui('Store_Icon_05')}" alt="" /></button>
      </div>
      <div class="home-arena">
        <div class="arena-title"><img src="${ui('Btn_Icon_07')}" alt="" /><span class="arena-name"></span></div>
        <div class="arena-stage">
          <button class="arena-nav prev" aria-label="上一座"></button>
          <img class="arena-img" alt="" />
          <button class="arena-nav next" aria-label="下一座"></button>
        </div>
        <div class="arena-dots"></div>
        <div class="side-col left">${side('', 'Btn_Icon_02', '杯赛')}${side('', 'Btn_Icon_04', '任务')}${side('', 'Btn_Icon_05', '成就')}</div>
        <div class="side-col right">${side('', 'Btn_Icon_03', '训练')}${side('', 'Btn_Icon_08', '分享')}${side('', 'Btn_Icon_09', '邮件')}</div>
      </div>
      <div class="home-actions">
        <button class="btn-cup" data-soon="杯赛">杯赛</button>
        <button class="btn-play">竞技模式</button>
      </div>
    </div>
    <div class="sheet play-sheet hidden">
      <div class="sheet-win">
        <div class="sheet-title"><b>竞技模式</b><button class="sheet-close" aria-label="关闭"></button></div>
        <div class="logo"><img src="/assets/orig_ui/Logo_zh.png" alt="碰撞全明星" /></div>
        <div class="group">
          <h4>练习（电脑对手）</h4>
          <div class="row">
            <button data-bot="easy">简单</button>
            <button data-bot="normal" class="primary">普通</button>
            <button data-bot="hard">困难</button>
          </div>
        </div>
        <div class="group">
          <h4>同屏双人</h4>
          <div class="row"><button class="hotseat">本机两人轮流</button></div>
        </div>
        <div class="group">
          <h4>在线约战</h4>
          <div class="row">
            <button class="online-create">创建房间</button>
            <input class="code" maxlength="6" placeholder="6位房间码" />
            <button class="online-join">加入</button>
          </div>
          <p class="invite-note">朋友第一次打开后，先在左上角填写昵称，这就是入驻。再输入你的房间码加入。</p>
          <div class="row"><button class="invite">复制邀请地址</button></div>
        </div>
        <label class="field check sheet-opt"><input type="checkbox" class="timer" checked /> 回合计时 ${DEFAULT_DATA.rules.turnSeconds}s</label>
      </div>
    </div>
    <div class="sheet settings-sheet hidden">
      <div class="sheet-win">
        <div class="sheet-title"><b>设置</b><button class="sheet-close" aria-label="关闭"></button></div>
        <div class="group">
          <div class="row"><label class="field">卡牌等级 <select class="card-level"></select></label></div>
          <div class="row"><label class="field check"><input type="checkbox" class="mute" /> 静音</label></div>
          <div class="row"><label class="field">服务器 <input class="server" placeholder="同源（留空）" /></label></div>
        </div>
      <details class="howto">
        <summary>怎么玩</summary>
        <ul>
          <li>轮到你时，按住本方球员向<b>反方向</b>拖动，松手弹射；拖得越远力度越大（红圈）。</li>
          <li>白色虚线是准星，长度只由精准决定：同一个精准，直线和弧线、大力和小力都一样长。碰到球员或足球也不缩短；碰到墙时，剩下的长度按镜面补上。</li>
          <li>弧线球：电脑上按键盘 ← / → 调弧线（每按一次 10%，瞄准前后都能调，出手后归零）；触屏上拉线时手指向左或向右划一道弧。准星会跟着弯。出手后撞墙会镜面反弯，碰到球员或足球后弧线消失。</li>
          <li>四个角是动力弹簧，球员撞上去会被加速弹出（足球不会）。</li>
          <li>整场 3 分钟，先进 3 球直接获胜，时间到按比分判定。</li>
          <li>足球<b>整体越过门线</b>才算进球，先进 ${DEFAULT_DATA.rules.goalsToWin} 球获胜；进球后失球方开球。</li>
          <li>发光的球员本回合技能已触发，用他出手才生效。</li>
          <li>设置里的卡牌等级（Lv1–Lv${DEFAULT_DATA.rules.levels.max}）作用于本方全部球员，重量、力度、弧度、精准按该等级的属性计算；同屏双人两边同级，练习时电脑固定 Lv${DEFAULT_DATA.rules.levels.uniformLevel}。</li>
          <li>在线约战：一人创建房间拿到 6 位房间码，另一人输入房间码加入，同一局域网或同一台机器的两个浏览器均可。</li>
        </ul>
      </details>
        <p class="ver">数据版本 ${DEFAULT_DATA.version}</p>
      </div>
    </div>`;
  const nick = app.querySelector('.nick') as HTMLInputElement;
  nick.value = nickname();
  nick.addEventListener('change', () => localStorage.setItem('pz_nick', nick.value.trim()));

  const showArena = () => {
    const i = arenaIndex();
    const a = ARENAS[i];
    if (!a) return;
    // Lobby shows the original isometric stadium model, not a crop of the match pitch: same venue,
    // two different jobs (display vs. play). Reusing the pitch here was LB-1c's regression.
    (app.querySelector('.arena-img') as HTMLImageElement).src = `/assets/orig_ui/stadium/${a.stadium}.png`;
    app.querySelector('.arena-name')!.textContent = a.name;
    app.querySelector('.arena-dots')!.innerHTML = ARENAS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('');
  };
  const step = (d: number) => {
    const i = (arenaIndex() + d + ARENAS.length) % ARENAS.length;
    localStorage.setItem('pz_skin', ARENAS[i].skin);
    showArena();
  };
  app.querySelector('.arena-nav.prev')!.addEventListener('click', () => step(-1));
  app.querySelector('.arena-nav.next')!.addEventListener('click', () => step(1));
  showArena();

  app.querySelectorAll<HTMLElement>('[data-soon]').forEach((b) => b.addEventListener('click', () => toast(`${b.dataset.soon}暂未开放`)));
  const sheet = (sel: string, open: boolean) => app.querySelector(sel)!.classList.toggle('hidden', !open);
  app.querySelector('.btn-play')!.addEventListener('click', () => sheet('.play-sheet', true));
  app.querySelector('.hp-gear')!.addEventListener('click', () => sheet('.settings-sheet', true));
  app.querySelectorAll('.sheet').forEach((s) => {
    s.addEventListener('click', (e) => {
      if (e.target === s) s.classList.add('hidden');
    });
    s.querySelector('.sheet-close')!.addEventListener('click', () => s.classList.add('hidden'));
  });
  const levelSel = app.querySelector('.card-level') as HTMLSelectElement;
  for (let l = 1; l <= DEFAULT_DATA.rules.levels.max; l++) levelSel.add(new Option(`Lv${l}`, String(l), false, l === cardLevel()));
  levelSel.addEventListener('change', () => localStorage.setItem('pz_card_level', levelSel.value));
  const timer = app.querySelector('.timer') as HTMLInputElement;
  const mute = app.querySelector('.mute') as HTMLInputElement;
  mute.checked = isMuted();
  mute.addEventListener('change', () => setMuted(mute.checked));
  const server = app.querySelector('.server') as HTMLInputElement;
  server.value = localStorage.getItem('pz_server') ?? '';
  server.addEventListener('change', () => localStorage.setItem('pz_server', server.value.trim()));
  const code = app.querySelector('.code') as HTMLInputElement;
  code.addEventListener('input', () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  const me = () => nick.value.trim() || '我';
  app.querySelectorAll('[data-bot]').forEach((b) =>
    b.addEventListener('click', () => {
      const level = (b as HTMLElement).dataset.bot as AiLevel;
      const mine = activeLineup();
      start(() => new LocalHost({ mode: 'bot', level, names: [me(), '电脑'], lineups: [mine, randomLineup(mine)], levels: [cardLevels(), null], timer: timer.checked }));
    }),
  );
  app.querySelector('.hotseat')!.addEventListener('click', () => {
    const mine = activeLineup();
    start(() => new LocalHost({ mode: 'hotseat', names: [me(), '玩家2'], lineups: [mine, randomLineup(mine)], levels: [cardLevels(), cardLevels()], timer: timer.checked }));
  });

  const connectOnline = async (roomCode: string | undefined) => {
    const btn = app.querySelector(roomCode ? '.online-join' : '.online-create') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '连接中…';
    try {
      const skin = currentSkin();
      const host = new OnlineHost({ serverUrl: serverUrl(), nickname: me(), skin, code: roomCode });
      host.configure(me(), skin);
      const assigned = await host.connect();
      localStorage.setItem('pz_last_code', assigned);
      onlineLobby(host, assigned);
    } catch (err) {
      alert('连接失败：' + (err instanceof Error ? err.message : String(err)));
      btn.disabled = false;
      btn.textContent = roomCode ? '加入' : '创建房间';
    }
  };

  app.querySelector('.invite')!.addEventListener('click', () => void copyInvite());
  app.querySelector('.online-create')!.addEventListener('click', () => void connectOnline(undefined));
  app.querySelector('.online-join')!.addEventListener('click', () => {
    const c = code.value.trim().toUpperCase();
    if (c.length !== 6) {
      alert('房间码是 6 位字符');
      return;
    }
    void connectOnline(c);
  });
}

/**
 * The waiting room. The server only starts the match once both seats are ready, so this screen submits the
 * lineup, shows the room code, and waits for the opponent to show up.
 */
function onlineLobby(host: OnlineHost, roomCode: string) {
  app.innerHTML = `
    <div class="lobby online">
      <div class="logo"><img src="/assets/orig_ui/Logo_zh.png" alt="碰撞全明星" /></div>
      <p class="tag">在线约战</p>
      <div class="roomcode"><span>房间码</span><b>${roomCode}</b><small>把它发给对手</small></div>
      <p class="wait-status">等待对手加入…</p>
      <div class="row"><button class="ready primary">提交阵容并准备</button></div>
      <div class="row"><button class="cancel">返回大厅</button></div>
    </div>`;
  app.querySelector('.cancel')!.addEventListener('click', () => {
    host.dispose();
    menu();
  });
  app.querySelector('.ready')!.addEventListener('click', () => {
    host.submitLineup(activeLineup(), cardLevels());
    host.setReady(true);
    const btn = app.querySelector('.ready') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '已准备，等待对手…';
    app.querySelector('.wait-status')!.textContent = '已准备，等待对手准备…';
  });
  // The match starts server-side; the host tells us when it is time to switch to the game view.
  host.onMatchReady(() => start(() => host, { roomCode }));
  host.onRoomSnapshot((snap) => {
    const status = app.querySelector('.wait-status');
    if (!status) return;
    const other = snap.seats.find((s) => s && s.nickname !== host.seats[0].name);
    const joined = snap.seats.filter((s) => s !== null).length;
    if (joined >= 2) status.textContent = '对手已加入，提交阵容并准备';
    else if (other?.ready) status.textContent = '对手已准备，等你准备…';
  });
}

/**
 * Starts the game view. `makeHost` is called once: the online host must survive across the lobby and the match.
 */
function start(makeHost: () => LocalHost | OnlineHost, opts?: { roomCode?: string }) {
  const skinId = currentSkin();
  const host = makeHost();
  current = new GameView(app, host, { skinId, onExit: () => menu(), onRematch: () => { current?.dispose(); start(makeHost, opts); } });
  if (opts?.roomCode) {
    // The code is what the other player types: show it once, prominently.
    app.querySelector('.lobby')?.remove();
    const banner = document.createElement('div');
    banner.className = 'room-banner';
    banner.innerHTML = `<span>房间码</span><b>${opts.roomCode}</b><small>把它发给对手</small>`;
    app.querySelector('.game')?.prepend(banner);
  }
}

menu();
