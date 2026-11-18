import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type { UpgradeQuoteSchema } from '../../../packages/contracts/src/economy-operations';
import { canUseOwnedCard, type OwnedCardView } from '../../../packages/client-model/src/owned-lineup';
import type { ResourceView } from '@pengzhuang/client-model';
import { formatLobbyMoney } from '../../../packages/client-model/src/lobby';
import { levelAttrs } from '../../../packages/game-core/src/balance';
import { DEFAULT_DATA } from '../../../shared/data';
import { useAccount } from '../accounts/context';
import { usePublicLobby } from '../lobby-context';
import { cardName, roleName, cardStatusLabel } from './cards';
import styles from './inventory.module.css';
export type UpgradeQuote = z.infer<typeof UpgradeQuoteSchema>;
export function CardDetails({
  card,
  userId,
  coins,
  disabled,
  refresh,
  focus,
  onUpgrade,
}: {
  card: OwnedCardView;
  userId: string;
  coins: string | null;
  disabled: boolean;
  refresh: number;
  focus: number;
  onUpgrade(quote: UpgradeQuote): void;
}) {
  const { services } = useAccount();
  const publicLobby = usePublicLobby();
  const [quote, setQuote] = useState<ResourceView<UpgradeQuote>>({ tag: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  useEffect(() => {
    let active = true;
    if (!canUseOwnedCard(card) || card.level >= 10) return;
    setQuote({ tag: 'loading' });
    void services!.api.ownedUpgradeQuote(userId, card.id).then((result) => {
      if (active)
        setQuote(
          result.ok
            ? { tag: 'ready', data: result.data }
            : { tag: 'error', message: '无法确认当前升级报价，请重新读取。', retryable: result.error.retryable },
        );
    });
    return () => {
      active = false;
    };
  }, [services, userId, card.id, card.version, card.status, card.level, refresh, attempt]);
  const current =
    quote.tag === 'ready' && quote.data.ownedCardId === card.id && quote.data.expectedRevision === card.version
      ? quote.data
      : null;
  const sameVersion =
    publicLobby.manifest.tag === 'ready' && publicLobby.manifest.data.gameDataVersion === DEFAULT_DATA.version;
  const attrs =
    sameVersion && DEFAULT_DATA.players[card.playerDefId]
      ? levelAttrs(DEFAULT_DATA, card.playerDefId, card.level)
      : null;
  const enough = current && coins !== null && BigInt(coins) >= BigInt(current.coins);
  const skill = DEFAULT_DATA.skills[DEFAULT_DATA.players[card.playerDefId]?.skill];
  return (
    <section className={styles.panel} aria-labelledby="owned-card-detail">
      <h2 id="owned-card-detail" tabIndex={-1} ref={heading}>
        {cardName(card.playerDefId)} · 卡牌详情
      </h2>
      <p>
        {roleName(card.playerDefId)} · 持有等级 {card.level} · {cardStatusLabel(card)}
      </p>
      <p className={styles.muted}>职业可跨位置放置。正式赛事的参赛等级和技能会在入局时由服务器校验。</p>
      {attrs ? (
        <dl className={styles.stats}>
          {(
            [
              ['weight', '重量'],
              ['power', '力度'],
              ['radian', '弧度'],
              ['precision', '精准'],
              ['mind', '心理'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{attrs[key]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>属性版本尚未确认，请刷新客户端后查看。</p>
      )}
      {attrs && (
        <p>
          {skill
            ? `技能：${skill.name}（${card.level >= skill.unlockLevel ? '已解锁' : `Lv.${skill.unlockLevel} 解锁`}）。${skill.effectText}`
            : DEFAULT_DATA.players[card.playerDefId].skill === 'none'
              ? '无技能。'
              : '源技能尚未实现，正式排位与成长赛事不可用。'}
        </p>
      )}
      {!Object.hasOwn(DEFAULT_DATA.players, card.playerDefId) ? (
        <p>球员资料已更新，请刷新客户端后操作此卡。</p>
      ) : card.status !== 'active' ? (
        <p>该卡已停用，不能保存进阵容或升级。</p>
      ) : card.level >= 10 ? (
        <p>已达最高等级。</p>
      ) : (
        <>
          {quote.tag === 'loading' && <p role="status">正在读取服务端升级报价…</p>}
          {quote.tag === 'error' && <p role="status">{quote.message}</p>}
          {current && (
            <>
              <p data-upgrade-price="true">
                Lv.{current.currentLevel} → Lv.{current.nextLevel} · 花费 {formatLobbyMoney(current.coins)} 金币
              </p>
              {coins === null ? (
                <p>余额尚未读取，暂不能升级。</p>
              ) : (
                !enough && <p role="status">金币不足，请先获取更多金币。</p>
              )}
            </>
          )}
          <div className={styles.actions}>
            <button
              className="pz-button pz-primary"
              disabled={disabled || !current || !enough}
              onClick={() => current && onUpgrade(current)}
            >
              确认升级
            </button>
            <button
              className="pz-button"
              disabled={disabled || quote.tag === 'loading'}
              onClick={() => setAttempt((value) => value + 1)}
            >
              重新读取报价
            </button>
          </div>
        </>
      )}
      <button className="pz-button" onClick={() => document.getElementById('owned-cards-title')?.focus()}>
        返回持有卡列表
      </button>
    </section>
  );
}
