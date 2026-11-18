import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { NavigationContext } from '@pengzhuang/client-model';
import { readInventory, type InventoryData, type SavedLineup } from '../../../packages/client-model/src/inventory';
import {
  placeOwnedCard,
  resolveLineupSave,
  canSaveOwnedLineup,
  type LineupDraft,
  type OwnedCardView,
} from '../../../packages/client-model/src/owned-lineup';
import { UpgradeIntentModel } from '../../../packages/client-model/src/upgrade-intent';
import { useAccount } from '../accounts/context';
import type { UpgradeQuote } from './detail';
type SaveIntent = { lineupId: string; body: { ownedCardIds: string[]; expectedRevision: number } };
interface State {
  data: InventoryData | null;
  lineup: SavedLineup | null;
  draft: LineupDraft;
  remote: SavedLineup | null;
  loading: boolean;
  error: boolean;
  notice: string;
  pending: SaveIntent | null;
  saving: boolean;
}
const empty = (): LineupDraft => Array<string | null>(5).fill(null);
const slots = (lineup: SavedLineup | null): LineupDraft =>
  Array.from({ length: 5 }, (_, index) => lineup?.ownedCardIds[index] ?? null);
export const inventoryMessages: Record<string, string> = {
  INSUFFICIENT_FUNDS: '金币不足，升级未扣款。',
  CONFLICT: '卡牌或价格已变化，请重新读取报价后确认。',
  INVALID_REQUEST: '阵容或卡牌状态不符合要求，请刷新持有卡后重试。',
  NOT_FOUND: '卡牌或阵容不可用，请重新读取。',
  ACCOUNT_CHANGED: '账号已切换，原账号升级记录已保留。',
  STORAGE_ERROR: '无法保存或清除升级重试记录，请检查浏览器存储权限后重试。',
  INVALID_SAVED_INTENT: '本机重试记录损坏，未自动发送升级。请核对当前等级。',
  UNAUTHENTICATED: '登录已失效，请重新登录后确认原操作。',
};

export function useInventoryEditor(context: NavigationContext, disabled: boolean) {
  const { services, login } = useAccount();
  const userId = login.user!.userId;
  const [upgrade] = useState(
    () =>
      new UpgradeIntentModel(
        userId,
        {
          getItem: (key) => sessionStorage.getItem(key),
          setItem: (key, value) => sessionStorage.setItem(key, value),
          removeItem: (key) => sessionStorage.removeItem(key),
        },
        (intent) => services!.api.upgradeOwnedCard(intent),
        () => crypto.randomUUID(),
      ),
  );
  const operation = useSyncExternalStore(upgrade.subscribe, upgrade.getSnapshot);
  const [state, set] = useState<State>({
    data: null,
    lineup: null,
    draft: empty(),
    remote: null,
    loading: true,
    error: false,
    notice: '',
    pending: null,
    saving: false,
  });
  const [selected, setSelected] = useState<string | null>(operation.intent?.ownedCardId ?? null);
  const [slot, setSlot] = useState<number | null>(null);
  const [focus, setFocus] = useState(0);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const alive = useRef(true);
  const sequence = useRef(0);
  const saveFlight = useRef(false);
  const sameAccount = useCallback(
    () => alive.current && services!.model.snapshot.user?.userId === userId,
    [services, userId],
  );
  const accountError = useCallback(
    (code: string) => {
      if (code === 'ACCOUNT_CHANGED' || code === 'FORBIDDEN') void services!.reconcile();
      else if (code === 'UNAUTHENTICATED') void services!.changed(false);
    },
    [services],
  );
  const read = useCallback(async () => {
    const request = ++sequence.current;
    set((previous) => ({ ...previous, loading: true }));
    const result = await readInventory(services!.api, userId);
    if (!sameAccount() || request !== sequence.current) return;
    if (!result.ok) {
      set((previous) => ({
        ...previous,
        loading: false,
        error: true,
        notice: '持有卡与余额未能完整读取。草稿已保留，请重试。',
      }));
      accountError(result.error.code);
      return;
    }
    set((previous) => {
      const fresh =
        result.data.lineups.find((item) => item.id === previous.lineup?.id) ??
        (previous.lineup ? null : (result.data.lineups[0] ?? null));
      const dirty =
        !!previous.lineup && previous.draft.some((id, index) => id !== (previous.lineup!.ownedCardIds[index] ?? null));
      if ((dirty || previous.pending) && previous.lineup)
        return {
          ...previous,
          data: result.data,
          loading: false,
          error: false,
          remote: fresh && fresh.revision !== previous.lineup.revision ? fresh : previous.remote,
        };
      return {
        ...previous,
        data: result.data,
        lineup: fresh,
        draft: slots(fresh),
        remote: null,
        loading: false,
        error: false,
      };
    });
    setSelected((previous) =>
      result.data.cards.some((card) => card.id === previous) ? previous : (result.data.cards[0]?.id ?? null),
    );
    setQuoteRefresh((value) => value + 1);
  }, [services, userId, sameAccount, accountError]);
  useEffect(() => {
    alive.current = true;
    void read();
    const update = () => {
      if (!document.hidden && navigator.onLine) void read();
    };
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    return () => {
      alive.current = false;
      sequence.current++;
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
    };
  }, [read]);
  const blocked =
    disabled || context.network !== 'online' || context.service !== 'ready' || state.error || state.loading;
  const editingBlocked = blocked || state.saving || !!operation.intent || operation.busy;
  async function confirmSave(intent: SaveIntent) {
    const result = await services!.api.inventoryLineup(userId, intent.lineupId);
    if (!sameAccount()) return;
    if (!result.ok) {
      set((previous) => ({ ...previous, saving: false, notice: '保存结果尚未确认，请保留草稿并重新确认。' }));
      accountError(result.error.code);
      return;
    }
    const outcome = resolveLineupSave(result.data, intent.body);
    set((previous) =>
      outcome === 'saved'
        ? {
            ...previous,
            lineup: result.data,
            draft: slots(result.data),
            remote: null,
            pending: null,
            saving: false,
            notice: '已确认阵容保存成功。',
          }
        : {
            ...previous,
            pending: null,
            saving: false,
            remote: result.data,
            notice: '服务器当前阵容已读取，你的草稿已保留。请选择采用服务器阵容或继续保存草稿。',
          },
    );
  }
  async function save() {
    if (
      editingBlocked ||
      saveFlight.current ||
      state.pending ||
      state.remote ||
      !state.lineup ||
      !state.data ||
      !canSaveOwnedLineup(state.draft, state.data.cards)
    )
      return;
    saveFlight.current = true;
    const intent = {
      lineupId: state.lineup.id,
      body: { ownedCardIds: [...state.draft], expectedRevision: state.lineup.revision },
    };
    set((previous) => ({ ...previous, saving: true, pending: intent, notice: '' }));
    try {
      const result = await services!.api.saveOwnedLineup(userId, intent.lineupId, intent.body);
      if (!sameAccount()) return;
      if (result.ok) {
        set((previous) => ({
          ...previous,
          lineup: result.data,
          draft: slots(result.data),
          remote: null,
          pending: null,
          saving: false,
          notice: '阵容已保存。',
        }));
        await read();
      } else if (['ACCOUNT_CHANGED', 'UNAUTHENTICATED'].includes(result.error.code)) {
        set((previous) => ({ ...previous, saving: false, notice: inventoryMessages[result.error.code] }));
        accountError(result.error.code);
      } else if (['INVALID_REQUEST', 'NOT_FOUND', 'FORBIDDEN', 'RATE_LIMITED'].includes(result.error.code)) {
        set((previous) => ({
          ...previous,
          saving: false,
          pending: null,
          notice: inventoryMessages[result.error.code] ?? '保存未完成，请重试。',
        }));
        await read();
      } else await confirmSave(intent);
    } finally {
      saveFlight.current = false;
    }
  }
  async function runUpgrade(quote?: UpgradeQuote) {
    if (blocked || state.saving || state.pending) return;
    if (quote) await upgrade.begin(quote);
    else await upgrade.retry();
    if (!sameAccount() || upgrade.snapshot.busy) return;
    accountError(upgrade.snapshot.error ?? '');
    await read();
  }
  function choose(card: OwnedCardView) {
    setSelected(card.id);
    setFocus((value) => value + 1);
    if (slot !== null && !editingBlocked && !state.pending && state.data) {
      const next = placeOwnedCard(state.draft, slot, card.id, state.data.cards);
      if (next) {
        set((previous) => ({ ...previous, draft: next, notice: `已放入位置 ${slot + 1}，保存后生效。` }));
        setSlot(null);
      }
    }
  }

  function selectLineup(id: string) {
    const lineup = state.data?.lineups.find((item) => item.id === id);
    if (lineup) set((previous) => ({ ...previous, lineup, draft: slots(lineup), remote: null, notice: '' }));
  }
  function clearSlot(index: number) {
    set((previous) => ({
      ...previous,
      draft: previous.draft.map((id, at) => (at === index ? null : id)),
      notice: '已清空位置，保存后生效。',
    }));
  }
  function applyDraft(ids: string[]) {
    if (state.data && canSaveOwnedLineup(ids, state.data.cards))
      set((previous) => ({ ...previous, draft: [...ids], notice: '已采用旧偏好草稿，保存后才会更新云端阵容。' }));
  }
  function resetDraft() {
    set((previous) => {
      const lineup = previous.remote ?? previous.lineup;
      return { ...previous, lineup, draft: slots(lineup), remote: null, notice: '已采用服务器阵容。' };
    });
  }
  function rebaseDraft() {
    set((previous) =>
      previous.remote
        ? { ...previous, lineup: previous.remote, remote: null, notice: '草稿保留，请核对后再次保存。' }
        : previous,
    );
  }
  function confirmPending() {
    if (state.pending && !saveFlight.current) {
      saveFlight.current = true;
      set((previous) => ({ ...previous, saving: true }));
      void confirmSave(state.pending).finally(() => {
        saveFlight.current = false;
      });
    }
  }
  return {
    state,
    operation,
    userId,
    slot,
    setSlot,
    selected,
    focus,
    quoteRefresh,
    blocked,
    editingBlocked,
    read,
    save,
    runUpgrade,
    choose,
    selectLineup,
    clearSlot,
    applyDraft,
    resetDraft,
    rebaseDraft,
    confirmPending,
  };
}
