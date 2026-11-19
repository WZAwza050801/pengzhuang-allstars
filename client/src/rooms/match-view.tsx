import { useEffect, useRef, useState } from 'react';
import { createHostBridge } from '@pengzhuang/platform';
import type { NavigationContext } from '@pengzhuang/client-model';
import { FIELD_SKINS } from '../../../shared/data';
import type { OnlineHost, OnlineStatus } from '../onlineHost';
import { GameView, type GameOptions } from '../game';
import styles from './rooms.module.css';
import type { SettlementInfo } from '../../../shared/protocol';

export function RoomMatchView({
  host,
  status,
  detail,
  service,
  onExit,
  onResult,
  onHelp,
}: {
  host: OnlineHost;
  status: OnlineStatus | 'idle';
  detail: string;
  service: NavigationContext['service'];
  onExit(): void;
  onResult(): void;
  onHelp(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const exit = useRef(onExit);
  exit.current = onExit;
  const result = useRef(onResult);
  result.current = onResult;
  const help = useRef(onHelp);
  help.current = onHelp;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [settlement, setSettlement] = useState<SettlementInfo | null>(null);
  useEffect(() => host.onSettlement(setSettlement), [host]);
  useEffect(() => {
    if (!root.current) return;
    let active = true;
    const bridge = createHostBridge<HTMLElement, { host: OnlineHost; options: GameOptions }>(
      (element, input) => new GameView(element, input.host, input.options),
    );
    setError(false);
    void bridge
      .mount(root.current, {
        host,
        options: {
          hostLifetime: 'owner',
          skinId: FIELD_SKINS[0].id,
          onExit: () => exit.current(),
          onResult: () => result.current(),
          onHelp: () => help.current(),
        },
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      void bridge.dispose();
    };
  }, [host, attempt]);
  return (
    <section className={styles.match} aria-label="账号好友赛">
      <h1 className="pz-sr-only" tabIndex={-1}>
        账号好友赛
      </h1>
      <div ref={root} className={styles.host} />
      <aside className={styles.connection} aria-live="polite">
        <span>
          {settlement?.status === 'failed'
            ? settlement.recorded
              ? '结果已保存 · 结算暂未完成'
              : '结果尚未保存 · 请保持连接，等待处理'
            : settlement?.status === 'pending'
              ? '等待保存比赛结果 · 暂停出手'
              : settlement?.status === 'recorded'
                ? '比赛结果已保存 · 等待结算'
                : settlement?.status === 'settled'
                  ? '本场已结算 · 好友赛不计排位和奖励'
                  : status === 'reconnecting'
                    ? '连接恢复中 · 暂停出手'
                    : status === 'closed'
                      ? detail || '连接已断开'
                      : status === 'ended'
                        ? '本场已结束 · 不计排位和奖励'
                        : service === 'maintenance'
                          ? '服务维护中 · 本场继续计时'
                          : service === 'outdated'
                            ? '规则已更新 · 本场沿用开局版本'
                            : '账号好友赛 · 服务端计时'}
        </span>
        {host.endedMatchId && (
          <button className="pz-button" onClick={onResult}>
            查看结算
          </button>
        )}
        {status !== 'ended' && (
          <button
            className="pz-button"
            disabled={status === 'reconnecting' || status === 'closed'}
            onClick={() => host.synchronize()}
          >
            重新同步
          </button>
        )}
      </aside>
      {status === 'closed' && (
        <div className={styles.fallback}>
          <h1>连接已断开</h1>
          <p>{detail || '不能继续出手，请返回大厅。'}</p>
          <button className="pz-button" onClick={onExit}>
            返回大厅
          </button>
        </div>
      )}
      {error && (
        <div className={styles.fallback}>
          <h1>比赛画面未能启动</h1>
          <p>服务端仍在计时，可重试载入画面。</p>
          <button className="pz-button" onClick={() => setAttempt((value) => value + 1)}>
            重试画面
          </button>
          <button
            className="pz-button"
            onClick={() => {
              if (confirm('离开后仍按服务端断线规则计时，确定返回大厅吗？')) onExit();
            }}
          >
            返回大厅
          </button>
        </div>
      )}
    </section>
  );
}
