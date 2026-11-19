import { useState } from 'react';
import { DEFAULT_DATA } from '../../../shared/data';
import { canUseOwnedCard, type OwnedCardView } from '../../../packages/client-model/src/owned-lineup';
import { CardArtView, type CardArt } from './card-art';
import styles from './inventory.module.css';
import { POS_LABEL } from '../lineup';
export const cardName = (id: string) => DEFAULT_DATA.players[id]?.name ?? id;
export const roleName = (id: string) => POS_LABEL[DEFAULT_DATA.players[id]?.position] ?? '未知职业';
export const cardStatusLabel = (card: OwnedCardView) =>
  card.status === 'disabled' ? '已停用' : canUseOwnedCard(card) ? '可用' : '资料待更新';

export function OwnedCards({
  cards,
  draft,
  selected,
  art,
  onSelect,
}: {
  cards: readonly OwnedCardView[];
  draft: readonly (string | null)[];
  selected: string | null;
  art: CardArt | null;
  onSelect(card: OwnedCardView): void;
}) {
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(0);
  const filtered = cards.filter(
    (card) =>
      (position === 'ALL' || DEFAULT_DATA.players[card.playerDefId]?.position === position) &&
      (status === 'ALL' ||
        (status === 'active'
          ? canUseOwnedCard(card)
          : status === 'disabled'
            ? card.status === 'disabled'
            : !Object.hasOwn(DEFAULT_DATA.players, card.playerDefId))) &&
      cardName(card.playerDefId).includes(search.trim()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 12)),
    current = Math.min(page, pages - 1);
  return (
    <section className={styles.panel} aria-labelledby="owned-cards-title">
      <h2 id="owned-cards-title" tabIndex={-1}>
        持有卡
      </h2>
      <div className={styles.filters}>
        <label>
          搜索球员
          <input
            type="search"
            maxLength={80}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          职业筛选
          <select
            aria-label="职业筛选"
            value={position}
            onChange={(event) => {
              setPosition(event.target.value);
              setPage(0);
            }}
          >
            <option value="ALL">全部职业</option>
            <option value="FW">前锋</option>
            <option value="MF">中场</option>
            <option value="DF">后卫</option>
            <option value="GK">门将</option>
          </select>
        </label>
        <label>
          状态筛选
          <select
            aria-label="状态筛选"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="ALL">全部状态</option>
            <option value="active">可用</option>
            <option value="disabled">已停用</option>
            <option value="unknown">资料待更新</option>
          </select>
        </label>
      </div>
      <p role="status">
        共 {filtered.length} 张 · 第 {current + 1}/{pages} 页
      </p>
      {!cards.length ? (
        <p>当前账号暂无持有卡，请重新读取或联系维护人员。</p>
      ) : !filtered.length ? (
        <p>没有符合筛选条件的持有卡。</p>
      ) : (
        <ul className={styles.grid}>
          {filtered.slice(current * 12, current * 12 + 12).map((card) => (
            <li key={card.id}>
              <button
                type="button"
                data-owned-card={card.id}
                aria-pressed={selected === card.id}
                aria-label={`${cardName(card.playerDefId)} · 持有等级 ${card.level} · ${cardStatusLabel(card)}`}
                className={`${styles.card} ${selected === card.id ? styles.selected : ''}`}
                onClick={() => onSelect(card)}
              >
                {art?.atlas.portraits.some((entry) => entry.playerId === card.playerDefId) && (
                  <CardArtView art={art} card={card} selected={selected === card.id} />
                )}
                <strong>{cardName(card.playerDefId)}</strong>
                <span>
                  {roleName(card.playerDefId)} · 持有 Lv.{card.level}
                </span>
                <span>
                  {!canUseOwnedCard(card)
                    ? cardStatusLabel(card)
                    : draft.includes(card.id)
                      ? '已在草稿阵容'
                      : '可放入阵容'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button className="pz-button" disabled={current === 0} onClick={() => setPage(current - 1)}>
          上一页持有卡
        </button>
        <button className="pz-button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>
          下一页持有卡
        </button>
      </div>
    </section>
  );
}
