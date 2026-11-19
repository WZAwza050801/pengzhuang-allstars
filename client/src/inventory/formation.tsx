import { DEFAULT_DATA } from '../../../shared/data';
import {
  canSaveOwnedLineup,
  type OwnedCardView,
  type LineupDraft,
} from '../../../packages/client-model/src/owned-lineup';
import type { SavedLineup } from '../../../packages/client-model/src/inventory';
import { cardName, cardStatusLabel } from './cards';
import { ImportedLineups } from './preferences';
import styles from './inventory.module.css';
export function Formation({
  userId,
  lineups,
  lineup,
  cards,
  draft,
  remote,
  selectedSlot,
  disabled,
  pending,
  saving,
  onSlot,
  onClear,
  onSelect,
  onDraft,
  onSave,
  onConfirm,
  onReset,
  onRebase,
}: {
  userId: string;
  lineups: SavedLineup[];
  lineup: SavedLineup | null;
  cards: OwnedCardView[];
  draft: LineupDraft;
  remote: SavedLineup | null;
  selectedSlot: number | null;
  disabled: boolean;
  pending: boolean;
  saving: boolean;
  onSlot(slot: number): void;
  onClear(slot: number): void;
  onSelect(id: string): void;
  onDraft(ids: string[]): void;
  onSave(): void;
  onConfirm(): void;
  onReset(): void;
  onRebase(): void;
}) {
  const dirty = !!lineup && draft.some((id, index) => id !== (lineup.ownedCardIds[index] ?? null));
  return (
    <section className={styles.panel} aria-labelledby="formation-title">
      <h2 id="formation-title">阵容草稿</h2>
      {!lineups.length ? (
        <p>暂无云端阵容。请重新读取或联系维护人员。</p>
      ) : (
        <label>
          选择云端阵容
          <select
            aria-label="选择云端阵容"
            value={lineup?.id ?? ''}
            disabled={disabled || dirty || pending}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="" disabled>
              选择阵容
            </option>
            {lineups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {dirty && <p role="status">草稿尚未保存；保存或还原后可切换阵容。</p>}
      <p>先点选阵容位置，再点选持有卡放入；已在阵容中的卡会与目标位置交换。职业只作推荐。</p>
      <div className={styles.formation}>
        {DEFAULT_DATA.rules.formation.map((slot, index) => {
          const card = cards.find((item) => item.id === draft[index]);
          return (
            <div className={`${styles.slot} ${selectedSlot === index ? styles.selected : ''}`} key={index}>
              <button
                className="pz-button"
                aria-label={`选择位置 ${index + 1}`}
                aria-pressed={selectedSlot === index}
                disabled={disabled || pending}
                onClick={() => onSlot(index)}
              >
                <span>
                  位置 {index + 1} · {slot.label}
                </span>
                <strong>{card ? cardName(card.playerDefId) : draft[index] ? '卡牌不可用' : '空位'}</strong>
                {card && (
                  <span>
                    Lv.{card.level} · {cardStatusLabel(card)}
                  </span>
                )}
              </button>
              <button
                className="pz-button"
                aria-label={`清空位置 ${index + 1}`}
                disabled={disabled || pending || !draft[index]}
                onClick={() => onClear(index)}
              >
                清空
              </button>
            </div>
          );
        })}
      </div>
      {selectedSlot !== null && <p role="status">正在为位置 {selectedSlot + 1} 选择持有卡。</p>}
      {!canSaveOwnedLineup(draft, cards) && <p>保存需要五张不同且可用的持有卡。</p>}
      {remote && (
        <div className={styles.alert} role="status">
          <p>
            服务器阵容已变化。当前服务器顺序：
            {remote.ownedCardIds
              .map((id) => {
                const card = cards.find((item) => item.id === id);
                return card ? cardName(card.playerDefId) : '不可用卡';
              })
              .join('、')}
            。你的草稿已保留。
          </p>
          <div className={styles.actions}>
            <button className="pz-button" disabled={disabled || pending} onClick={onReset}>
              采用服务器阵容
            </button>
            <button className="pz-button" disabled={disabled || pending} onClick={onRebase}>
              保留草稿并使用新版本
            </button>
          </div>
        </div>
      )}
      <div className={styles.actions}>
        <button
          className="pz-button pz-primary"
          disabled={disabled || pending || !!remote || !lineup || !canSaveOwnedLineup(draft, cards)}
          onClick={onSave}
        >
          {saving ? '正在保存…' : '保存阵容'}
        </button>
        <button className="pz-button" disabled={disabled || pending || !lineup} onClick={onReset}>
          还原当前草稿
        </button>
        {pending && !saving && (
          <button className="pz-button" disabled={disabled} onClick={onConfirm}>
            确认保存结果
          </button>
        )}
      </div>
      {pending && <p role="status">保存结果待确认，原草稿已保留。</p>}
      <ImportedLineups userId={userId} cards={cards} disabled={disabled || pending || !lineup} onApply={onDraft} />
    </section>
  );
}
