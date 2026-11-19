import { z } from 'zod';
import { ModeIdSchema, type ModeId } from '../../contracts/src/modes';
import { QueueSchema } from '../../contracts/src/http';
const matchId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const NavigationTargetSchema = z.discriminatedUnion('page', [
  z.strictObject({ page: z.enum(['login', 'lobby', 'lineup', 'growth', 'club', 'profile', 'settings', 'history']) }),
  z.strictObject({ page: z.literal('inbox'), section: z.enum(['mail', 'tasks', 'achievements']) }),
  z.strictObject({ page: z.literal('queue'), mode: QueueSchema.shape.mode }),
  z.strictObject({
    page: z.literal('room'),
    code: z
      .string()
      .regex(/^[A-Z0-9]{6}$/)
      .optional(),
  }),
  z
    .strictObject({
      page: z.literal('match'),
      mode: ModeIdSchema,
      matchId: matchId.optional(),
    })
    .refine((value) => value.mode === 'practice' || !!value.matchId, 'Online match needs an existing match id'),
  z.strictObject({ page: z.literal('result'), mode: ModeIdSchema, matchId }),
]);
export type NavigationTarget = z.infer<typeof NavigationTargetSchema>;
export type PageId = NavigationTarget['page'];
export const MAIN_NAV = [
  { page: 'lobby', label: '比赛' },
  { page: 'lineup', label: '阵容' },
  { page: 'growth', label: '成长' },
  { page: 'club', label: '俱乐部' },
  { page: 'profile', label: '我的' },
] as const;
export const ALL_FEATURES = {
  practice: true,
  accounts: true,
  inventory: true,
  growth: true,
  club: true,
  inbox: true,
  friendRooms: true,
  matchmaking: true,
  onlineMatches: true,
};
export type FeatureKey = keyof typeof ALL_FEATURES;
export const DEFAULT_FEATURES: Readonly<Record<FeatureKey, boolean>> = {
  practice: true,
  accounts: false,
  inventory: false,
  growth: false,
  club: false,
  inbox: false,
  friendRooms: false,
  matchmaking: false,
  onlineMatches: false,
};
export interface NavigationContext {
  session: 'loading' | 'anonymous' | 'authenticated';
  network: 'online' | 'offline';
  service: 'ready' | 'maintenance' | 'outdated';
  features: Readonly<Record<FeatureKey, boolean>>;
}
export type BlockReason = 'feature-off' | 'session-loading' | 'offline' | 'maintenance' | 'outdated';
export type NavigationDecision =
  | { kind: 'show'; target: NavigationTarget }
  | { kind: 'login'; resume: NavigationTarget }
  | { kind: 'blocked'; reason: BlockReason; retry: NavigationTarget }
  | { kind: 'invalid'; fallback: { page: 'lobby' } };
const simplePolicy: Partial<Record<PageId, { features: FeatureKey[]; account: boolean; remote: boolean }>> = {
  login: { features: ['accounts'], account: false, remote: true },
  lineup: { features: ['inventory'], account: true, remote: true },
  growth: { features: ['growth', 'inventory'], account: true, remote: true },
  club: { features: ['club'], account: true, remote: true },
  history: { features: ['friendRooms'], account: true, remote: false },
  inbox: { features: ['inbox'], account: true, remote: true },
};
/** Presentation admission only. Services must still authorize every business action. */
export function resolveNavigation(input: unknown, context: NavigationContext): NavigationDecision {
  const parsed = NavigationTargetSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid', fallback: { page: 'lobby' } };
  const target = parsed.data;
  let policy = simplePolicy[target.page] ?? { features: [], account: false, remote: false };
  if (target.page === 'room') policy = { features: ['friendRooms', 'inventory'], account: true, remote: true };
  if (target.page === 'queue') policy = { features: ['matchmaking', 'inventory'], account: true, remote: true };
  if (target.page === 'match' || target.page === 'result')
    policy =
      target.mode === 'practice'
        ? { features: ['practice'], account: false, remote: false }
        : { features: ['onlineMatches'], account: target.mode === 'ranked' || target.mode === 'growth', remote: false };
  if (target.page === 'result' && target.mode !== 'practice')
    policy = { features: ['friendRooms'], account: true, remote: false };
  if (policy.features.some((key) => !context.features[key]))
    return { kind: 'blocked', reason: 'feature-off', retry: target };
  if (policy.remote) {
    if (context.service !== 'ready') return { kind: 'blocked', reason: context.service, retry: target };
    if (context.network === 'offline') return { kind: 'blocked', reason: 'offline', retry: target };
  }
  if (policy.account) {
    if (context.session === 'loading') return { kind: 'blocked', reason: 'session-loading', retry: target };
    if (context.session === 'anonymous')
      return context.features.accounts
        ? { kind: 'login', resume: target }
        : { kind: 'blocked', reason: 'feature-off', retry: target };
  }
  return { kind: 'show', target };
}
export type ResourceView<T> =
  | { tag: 'loading' }
  | { tag: 'ready'; data: T }
  | { tag: 'empty' }
  | { tag: 'error'; message: string; retryable: boolean };
export interface LobbyView {
  session: NavigationContext['session'];
  wallet: ResourceView<{ coins: string; fragments: string }>;
  lineup: ResourceView<{ id: string; revision: number; ownedCardIds: readonly string[] }>;
  connection: NavigationContext['network'];
  service: NavigationContext['service'];
}
export type MatchPhase = 'my-turn' | 'opponent-turn' | 'pending' | 'playback' | 'recovering' | 'finished';
export interface MatchView {
  matchId: string;
  mode: ModeId;
  phase: MatchPhase;
  ruleSummary: string;
  remainingSeconds: number;
  canShoot: boolean;
  canSurrender: boolean;
}
export type RewardView =
  | { tag: 'none'; reason: 'practice-or-friend' }
  | { tag: 'pending' }
  | { tag: 'posted'; coins: string; ledgerId: string }
  | { tag: 'error'; retryable: boolean }
  | { tag: 'void'; message: string };
export interface ResultView {
  matchId: string;
  mode: ModeId;
  score: readonly [number, number];
  reward: RewardView;
}
export const PAGE_FLOW: Readonly<Record<PageId, { path: string; back: PageId; states: readonly string[] }>> = {
  history: { path: '/results', back: 'lobby', states: ['loading', 'ready', 'empty', 'offline', 'error'] },
  login: { path: '/login', back: 'lobby', states: ['ready', 'submitting', 'error', 'offline', 'cancelled'] },
  lobby: {
    path: '/',
    back: 'lobby',
    states: ['anonymous', 'loading', 'ready', 'offline', 'maintenance', 'outdated', 'error'],
  },
  lineup: {
    path: '/lineup',
    back: 'lobby',
    states: ['loading', 'ready', 'empty', 'conflict', 'insufficient', 'error'],
  },
  growth: { path: '/growth', back: 'lobby', states: ['loading', 'ready', 'empty', 'disabled', 'error'] },
  club: {
    path: '/club',
    back: 'lobby',
    states: ['loading', 'none', 'member', 'full', 'forbidden', 'disabled', 'error'],
  },
  profile: { path: '/profile', back: 'lobby', states: ['anonymous', 'loading', 'ready', 'error'] },
  settings: { path: '/settings', back: 'profile', states: ['ready', 'saving', 'offline', 'error'] },
  inbox: {
    path: '/inbox/:section',
    back: 'lobby',
    states: ['loading', 'empty', 'ready', 'claiming', 'expired', 'error'],
  },
  queue: { path: '/queue/:mode', back: 'lobby', states: ['queueing', 'cancelling', 'matched', 'timeout', 'error'] },
  room: {
    path: '/room/:code?',
    back: 'lobby',
    states: ['waiting', 'ready', 'opponent-left', 'conflict', 'incompatible', 'error'],
  },
  match: {
    path: '/match/:matchId?',
    back: 'lobby',
    states: ['my-turn', 'opponent-turn', 'pending', 'playback', 'recovering', 'finished'],
  },
  result: { path: '/result/:matchId', back: 'lobby', states: ['local-only', 'pending', 'posted', 'void', 'error'] },
};
