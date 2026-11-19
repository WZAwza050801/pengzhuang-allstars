import catalogJson from '../../data/player_catalog.json';
import { DEFAULT_DATA } from '../../shared/data';
import type { LevelAttrs } from '../../shared/data';
import { portraitUrl } from './portraits';

export interface CatalogSkill { id: string; name: string; desc: string; icon: string; unlock: number }
export interface CatalogEntry {
  id: string;
  name: string;
  position: string;
  srcPosition: string | null;
  quality: string;
  rarity: number | null;
  portraitId: string;
  card: string | null;
  skills: CatalogSkill[];
}

export const CATALOG: CatalogEntry[] = catalogJson.entries as CatalogEntry[];
const byId = new Map(CATALOG.map((e) => [e.id, e]));

const SLOTS = DEFAULT_DATA.rules.formation;
/** Formation slot role -> roster position that fills it by default. */
const ROLE_POS: Record<string, string> = { DC: 'DF', CM: 'MF', ST: 'FW' };
export const POS_LABEL: Record<string, string> = { FW: '前锋', MF: '中场', DF: '后卫', GK: '门将' };
const QUALITY_LABEL: Record<string, string> = { green: '绿色', blue: '蓝色', purple: '紫色', orange: '橙色', red: '红色', silver: '银色' };
/** Original card frames: Box_Quality_01 green … 05 red. Silver legend reuses the red frame, silvered in CSS. */
const QUALITY_FRAME: Record<string, string> = { green: '01', blue: '02', purple: '03', orange: '04', red: '05', silver: '05' };
const SETS = 3;
const KEY = 'pz_lineups';

/** Card-level attributes as the original popup lists them: 重量 力度 弧度 精准 心理, each with its own icon. */
const ATTR_ROWS: { key: keyof LevelAttrs; label: string; icon: string }[] = [
  { key: 'weight', label: '重量', icon: 'Player_Attributes_01' },
  { key: 'power', label: '力度', icon: 'Player_Attributes_02' },
  { key: 'radian', label: '弧度', icon: 'Player_Attributes_05' },
  { key: 'precision', label: '精准', icon: 'Player_Attributes_03' },
  { key: 'mind', label: '心理', icon: 'Player_Attributes_04' },
];

export function entry(id: string): CatalogEntry | undefined {
  return byId.get(id);
}

function strength(e: CatalogEntry): number {
  const a = attrsAt(e.id, DEFAULT_DATA.rules.levels.uniformLevel);
  return (e.rarity ?? 0) * 1000 + (a ? a.weight + a.power + a.radian + a.precision + a.mind : 0);
}

export function attrsAt(id: string, level: number): LevelAttrs | null {
  const src = DEFAULT_DATA.players[id]?.srcId;
  return (src && DEFAULT_DATA.levels[src]?.[String(level)]) || null;
}

/** Strongest originals per role, so a fresh install starts with a sensible team. */
function defaultSet(): string[] {
  const used = new Set<string>();
  return SLOTS.map((slot) => {
    const pick = CATALOG.filter((e) => e.position === ROLE_POS[slot.role] && !used.has(e.id)).sort((a, b) => strength(b) - strength(a))[0];
    used.add(pick.id);
    return pick.id;
  });
}

function valid(set: unknown): set is string[] {
  return Array.isArray(set) && set.length === SLOTS.length && new Set(set).size === set.length && set.every((id) => typeof id === 'string' && byId.has(id));
}

interface Store { active: number; sets: string[][] }

function load(): Store {
  const fallback = defaultSet();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Store> | null;
    const sets = Array.from({ length: SETS }, (_, i) => (valid(raw?.sets?.[i]) ? raw!.sets![i].slice() : fallback.slice()));
    const active = Number.isInteger(raw?.active) && raw!.active! >= 0 && raw!.active! < SETS ? raw!.active! : 0;
    return { active, sets };
  } catch {
    return { active: 0, sets: Array.from({ length: SETS }, () => fallback.slice()) };
  }
}

function save(s: Store) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** The lineup this device plays with, in formation slot order. */
export function activeLineup(): string[] {
  const s = load();
  return s.sets[s.active].slice();
}

/** A random all-original team for the computer or the second hotseat player. */
export function randomLineup(avoid: string[] = []): string[] {
  const used = new Set(avoid);
  return SLOTS.map((slot) => {
    let pool = CATALOG.filter((e) => e.position === ROLE_POS[slot.role] && !used.has(e.id));
    if (!pool.length) pool = CATALOG.filter((e) => !used.has(e.id));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    used.add(pick.id);
    return pick.id;
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ui = (name: string) => `/assets/orig_ui/${name}.png`;

/** Slot centre on the LineUp_01 half pitch, in percent. Strikers sit near the halfway arc at the top. */
function slotPos(i: number): { x: number; y: number } {
  const { x, y } = SLOTS[i];
  const depths = Object.values(DEFAULT_DATA.rules.lineDepth);
  const lo = Math.min(...depths);
  const hi = Math.max(...depths);
  return { x: 50 + (x / 1.8) * 30, y: 16 + ((y - lo) / (hi - lo)) * 62 };
}

function cardHtml(e: CatalogEntry, level: number, inLineup: boolean): string {
  const frame = QUALITY_FRAME[e.quality] ?? '01';
  return `<button class="pcard q-${e.quality}${inLineup ? ' on' : ''}" data-card="${e.id}" style="background-image:url(${ui('Box_Quality_' + frame)})">
    <span class="pc-pos pos-${e.position}">${POS_LABEL[e.position] ?? ''}</span>
    <img class="pc-face" src="${portraitUrl(e.id)}" alt="" loading="lazy" />
    <span class="pc-name">${esc(e.name)}</span>
    <span class="pc-lv">${level}</span>
    ${inLineup ? '<span class="pc-on">已上场</span>' : ''}
  </button>`;
}

export interface LineupScreenOpts {
  cardLevel: () => number;
  toast: (msg: string) => void;
}

/** 阵容: the original "首发阵容" half pitch with three saved teams, the position-filtered card pool and the player popup. */
export function mountLineup(root: HTMLElement, opts: LineupScreenOpts) {
  const store = load();
  let slot = 0;
  let filter = 'ALL';

  const render = () => {
    const level = opts.cardLevel();
    const set = store.sets[store.active];
    const onPitch = new Set(set);
    const pool = CATALOG.filter((e) => filter === 'ALL' || e.position === filter).sort((a, b) => strength(b) - strength(a));
    root.innerHTML = `
      <section class="lineup-screen">
        <div class="lu-panel">
          <div class="lu-head">
            <img src="${ui('Btn_Icon_07')}" alt="" />
            <b>首发阵容</b>
            <div class="lu-sets">${Array.from({ length: SETS }, (_, i) => `<button class="lu-set${i === store.active ? ' on' : ''}" data-set="${i}">${i + 1}</button>`).join('')}</div>
          </div>
          <div class="lu-pitch">
            ${set
              .map((id, i) => {
                const e = byId.get(id)!;
                const p = slotPos(i);
                return `<button class="lu-slot${i === slot ? ' on' : ''}" data-slot="${i}" style="left:${p.x}%;top:${p.y}%">
                  <img src="${portraitUrl(id)}" alt="" />
                  <span>LV.${level} ${esc(e.name)}</span>
                </button>`;
              })
              .join('')}
            <span class="lu-formation">阵型 2-2-1</span>
          </div>
          <p class="lu-hint">先点球场上的位置（<b>${SLOTS[slot].label}</b>），再从下方卡池选人替换</p>
        </div>
        <div class="lu-pool">
          <div class="lu-tabs">
            ${[['ALL', '全部'], ['FW', '前锋'], ['MF', '中场'], ['DF', '后卫']]
              .map(([k, label]) => `<button class="lu-tab t-${k}${k === filter ? ' on' : ''}" data-filter="${k}">${label}</button>`)
              .join('')}
            <span class="lu-count">${pool.length} 人</span>
          </div>
          <div class="lu-grid">${pool.map((e) => cardHtml(e, level, onPitch.has(e.id))).join('')}</div>
        </div>
      </section>`;

    root.querySelectorAll<HTMLElement>('[data-set]').forEach((b) =>
      b.addEventListener('click', () => {
        store.active = Number(b.dataset.set);
        save(store);
        render();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.slot);
        if (i === slot) detail(set[i]);
        slot = i;
        render();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) =>
      b.addEventListener('click', () => {
        filter = b.dataset.filter!;
        render();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-card]').forEach((b) => b.addEventListener('click', () => detail(b.dataset.card!)));
  };

  const place = (id: string) => {
    const set = store.sets[store.active];
    const from = set.indexOf(id);
    if (from === slot) return;
    // Already on the pitch: swap the two slots instead of duplicating the player.
    if (from >= 0) set[from] = set[slot];
    set[slot] = id;
    save(store);
    opts.toast(`${byId.get(id)!.name} 上场：${SLOTS[slot].label}`);
  };

  const detail = (id: string) => {
    const e = byId.get(id);
    if (!e) return;
    const level = opts.cardLevel();
    const a = attrsAt(id, level);
    const next = attrsAt(id, Math.min(level + 1, DEFAULT_DATA.rules.levels.max));
    const set = store.sets[store.active];
    const here = set[slot] === id;
    const pop = document.createElement('div');
    pop.className = 'overlay pdetail';
    pop.innerHTML = `
      <div class="pd-win">
        <div class="pd-title"><b>${esc(e.name)}</b><button class="pd-close" aria-label="关闭"></button></div>
        <div class="pd-top">
          ${cardHtml(e, level, false)}
          <div class="pd-meta">
            <div><small>品质：</small><b class="qtext q-${e.quality}">${QUALITY_LABEL[e.quality] ?? e.quality}</b></div>
            <div><small>位置：</small><b>${POS_LABEL[e.position] ?? e.position}</b></div>
            <div><small>卡牌等级：</small><b>LV.${level}</b></div>
          </div>
        </div>
        <div class="pd-attrs">
          ${ATTR_ROWS.map((r) => {
            const v = a ? a[r.key] : 0;
            const up = a && next ? next[r.key] - v : 0;
            return `<div class="pd-attr"><img src="${ui(r.icon)}" alt="" /><span class="pa-l">${r.label}</span>
              <span class="pa-bar"><i style="width:${Math.min(100, v)}%"></i></span><b>${v}</b>${up > 0 ? `<em>+${up}</em>` : '<em></em>'}</div>`;
          }).join('')}
        </div>
        <div class="pd-skills">
          ${
            e.skills.length
              ? e.skills
                  .map(
                    (s) => `<div class="pd-skill${level >= s.unlock ? '' : ' locked'}"><img src="/assets/skills/${s.icon}.png" alt="" />
                <div><b>${esc(s.name)}</b><p>${esc(s.desc)}</p></div><span>${level >= s.unlock ? '已解锁' : `LV.${s.unlock} 解锁`}</span></div>`,
                  )
                  .join('')
              : '<p class="pd-noskill">这张原版卡没有技能</p>'
          }
          <p class="pd-note">技能文字为原版描述；比赛里目前只有部分技能已实现。</p>
        </div>
        <div class="pd-btns">
          <button class="primary pd-place"${here ? ' disabled' : ''}>${here ? `已在${SLOTS[slot].label}` : `上场：${SLOTS[slot].label}`}</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    const close = () => pop.remove();
    pop.addEventListener('click', (ev) => {
      if (ev.target === pop) close();
    });
    pop.querySelector('.pd-close')!.addEventListener('click', close);
    pop.querySelector('.pd-place')!.addEventListener('click', () => {
      place(id);
      close();
      render();
    });
  };

  render();
}
