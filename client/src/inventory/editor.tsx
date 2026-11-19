import type { NavigationContext } from '@pengzhuang/client-model';
import { formatLobbyMoney } from '../../../packages/client-model/src/lobby';
import { Formation } from './formation';
import { OwnedCards } from './cards';
import { CardDetails } from './detail';
import { useCardArt } from './card-art';
import { useInventoryEditor, inventoryMessages } from './use-editor';
import styles from './inventory.module.css';

export function InventoryEditor({ context, disabled }: { context: NavigationContext; disabled: boolean }) {
  const editor = useInventoryEditor(context, disabled);
  const { state, operation, userId, blocked, editingBlocked, selected, focus, quoteRefresh } = editor;
  const art = useCardArt();
  const chosen = state.data?.cards.find((card) => card.id === selected);
  const coins = !state.error
    ? (state.data?.wallets.find((wallet) => wallet.currency === 'coins')?.balance ?? null)
    : null;
  return (
    <section className={styles.page}>
      <h1>我的阵容与持有卡</h1>
      {(context.network !== 'online' || context.service !== 'ready' || disabled) && (
        <p role="status" className={styles.alert}>
          当前离线、服务维护或账号状态正在确认。草稿保留，恢复连接后再保存或升级。
        </p>
      )}
      <div className={styles.actions}>
        <p data-inventory-coins="true">金币：{coins === null ? '尚未确认' : formatLobbyMoney(coins)}</p>
        <button className="pz-button" disabled={state.loading || state.saving} onClick={() => void editor.read()}>
          刷新持有卡与余额
        </button>
      </div>
      {state.loading && <p role="status">正在读取持有卡与阵容…</p>}
      <p role="status">{state.notice}</p>
      {(operation.intent || operation.error || operation.result) && (
        <section className={styles.panel} aria-label="升级操作状态">
          <p role="status">
            {operation.busy
              ? '正在确认升级，请稍候…'
              : operation.result
                ? operation.error === 'STORAGE_ERROR'
                  ? '升级已确认成功，但本机重试记录未清除，请再次确认以清理记录。'
                  : '升级已确认成功。当前卡级和余额以重新读取的库存为准。'
                : operation.error && inventoryMessages[operation.error]
                  ? inventoryMessages[operation.error]
                  : '升级结果尚未确认，请使用原记录重试确认。'}
          </p>
          {operation.intent && (
            <button
              className="pz-button"
              disabled={blocked || operation.busy || state.saving || !!state.pending}
              onClick={() => void editor.runUpgrade()}
            >
              确认上次升级结果
            </button>
          )}
        </section>
      )}
      {state.data && (
        <>
          <Formation
            userId={userId}
            lineups={state.data.lineups}
            lineup={state.lineup}
            cards={state.data.cards}
            draft={state.draft}
            remote={state.remote}
            selectedSlot={editor.slot}
            disabled={editingBlocked}
            pending={!!state.pending}
            saving={state.saving}
            onSlot={editor.setSlot}
            onClear={editor.clearSlot}
            onSelect={editor.selectLineup}
            onDraft={editor.applyDraft}
            onSave={() => void editor.save()}
            onConfirm={editor.confirmPending}
            onReset={editor.resetDraft}
            onRebase={editor.rebaseDraft}
          />
          <div className={styles.workspace}>
            <OwnedCards
              cards={state.data.cards}
              draft={state.draft}
              selected={selected}
              art={art}
              onSelect={editor.choose}
            />
            {chosen && (
              <CardDetails
                card={chosen}
                userId={userId}
                coins={coins}
                disabled={editingBlocked || !!state.pending}
                refresh={quoteRefresh}
                focus={focus}
                onUpgrade={(quote) => void editor.runUpgrade(quote)}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
