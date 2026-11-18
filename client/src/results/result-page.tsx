import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { NavigationContext } from '@pengzhuang/client-model';
import {
  MatchResultModel,
  resultTitle,
  resultReason,
  resultFailureText,
  type ResultSnapshot,
} from '../../../packages/client-model/src/match-result';
import { formatLobbyMoney } from '../../../packages/client-model/src/lobby';
import { useAccount } from '../accounts/context';
import { ActiveMatchPanel } from '../rooms/recovery-panel';
import styles from './results.module.css';

export function ResultPage({ matchId, context }: { matchId: string; context: NavigationContext }) {
  const { services, login, options } = useAccount(),
    owner = login.user!;
  const model = useRef<MatchResultModel | null>(null);
  const [view, setView] = useState<Readonly<ResultSnapshot>>({
    value: services!.results.read(owner, matchId),
    loading: false,
    offline: context.network === 'offline',
    error: null,
    ledger: null,
    ledgerLoading: false,
    ledgerError: null,
  });
  useEffect(() => {
    const current = new MatchResultModel(services!.api, owner, matchId, services!.results);
    model.current = current;
    current.setOnline(navigator.onLine);
    setView(current.snapshot);
    const unsubscribe = current.subscribe(() => setView(current.snapshot));
    let active = true,
      polls = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!active || document.hidden || services!.model.snapshot.status !== 'authenticated') return;
      if (timer) clearTimeout(timer);
      await current.refresh();
      if (!active || current.snapshot.offline) return;
      const state = current.snapshot;
      if (state.value && ['pending', 'recorded'].includes(state.value.status) && !state.error && polls < 8)
        timer = setTimeout(() => void load(), Math.min(15000, 1000 * 2 ** polls++));
    };
    const refresh = () => {
      current.setOnline(navigator.onLine);
      polls = 0;
      void load();
    };
    const offline = () => current.setOnline(false);
    void load();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      current.dispose();
      if (model.current === current) model.current = null;
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [services, owner.userId, owner.sessionId, matchId]);
  useEffect(() => {
    if (view.error && ['UNAUTHENTICATED', 'ACCOUNT_CHANGED', 'FORBIDDEN'].includes(view.error.code))
      void services?.reconcile();
  }, [services, view.error]);
  const result = view.value,
    reward = result?.status === 'settled' ? result.reward : null;
  const online = context.network === 'online' && !view.offline && login.status === 'authenticated';
  const canRematch =
    online &&
    context.service === 'ready' &&
    options?.friendRoomsEnabled &&
    options.inventoryEnabled &&
    result?.mode === 'friend' &&
    result.recorded;
  return (
    <section className={styles.page} aria-label="本场结算" aria-busy={view.loading}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>比赛结果</p>
          <h1>{result ? resultTitle(result) : '查看本场结果'}</h1>
        </div>
        <Link className="pz-button" to="/">
          返回大厅
        </Link>
      </header>
      {view.offline && (
        <p className={styles.notice} role="status">
          {result
            ? '当前离线，以下为本会话此前确认的结果；恢复网络后会重新查询。'
            : '当前离线，尚无已确认结果。联网后可查询原比赛。'}
        </p>
      )}
      {context.service !== 'ready' && <p role="status">服务暂不可发起新局，仍可查看已有结果。</p>}
      {view.error && (
        <p className={styles.notice} role="alert">
          {resultFailureText(view.error.code)}
        </p>
      )}
      {view.loading && <p role="status">正在核对比赛结果…</p>}
      {result && (
        <>
          <section className={styles.card} aria-label="比赛比分">
            <p>{result.mode === 'friend' ? '好友赛' : result.mode === 'growth' ? '成长赛' : '排位赛'}</p>
            <div className={styles.score}>
              <span>
                我方<strong>{result.score[result.side]}</strong>
              </span>
              <b aria-hidden="true">:</b>
              <span>
                对方<strong>{result.score[result.side === 0 ? 1 : 0]}</strong>
              </span>
            </div>
            <p>
              {resultReason(result.reason)} · 共 {result.finalSeq} 次出手
            </p>
            <time dateTime={result.endedAt}>{new Date(result.endedAt).toLocaleString('zh-CN')}</time>
          </section>
          <section className={styles.card} aria-live="polite" aria-label="结算进度">
            <h2>
              {result.status === 'settled'
                ? '结算已完成'
                : result.status === 'failed'
                  ? '结算暂未完成'
                  : result.recorded
                    ? '结果已保存，等待奖励入账'
                    : '比赛已结束，结果等待保存'}
            </h2>
            {!reward && (
              <p>
                {result.recorded
                  ? '服务端正在处理原比赛。重新查询只会读取进度，不会重复发奖。'
                  : '尚未确认数据库保存成功，请保持连接，稍后查询原结果。'}
              </p>
            )}
            {result.status === 'failed' && (
              <p>结果保留等待处理。可稍后重查，或通过反馈入口联系维护人员；奖励尚未确认。</p>
            )}
            {reward && (
              <>
                <dl className={styles.rewards} aria-label="本场实际奖励">
                  <div>
                    <dt>金币</dt>
                    <dd>+{formatLobbyMoney(reward.coins)}</dd>
                  </div>
                  <div>
                    <dt>碎片</dt>
                    <dd>+{formatLobbyMoney(reward.fragments)}</dd>
                  </div>
                </dl>
                {reward.playerDefId && (
                  <p>
                    参与球员卡奖励已处理；已持有时按规则转为碎片。<Link to="/lineup">查看持有阵容</Link>
                  </p>
                )}
                {result.mode === 'friend' ? (
                  <p>好友赛不发正式奖励，本场记录已保存。</p>
                ) : (
                  !reward.eligible && <p>本场未满足正式奖励条件。</p>
                )}
              </>
            )}
            <p>
              {result.mode === 'friend' ? '好友赛不计排位积分。' : '积分变更尚未确认，待积分服务提供实际记录后查询。'}
            </p>
          </section>
          {reward && (
            <section className={styles.card} aria-label="本场奖励流水">
              <h2>奖励流水</h2>
              {!reward.ledgerIds.length ? (
                <p>本场没有货币流水；已完成的结算记录不受影响。</p>
              ) : (
                <>
                  <button
                    className="pz-button"
                    disabled={!online || view.ledgerLoading}
                    onClick={() => void model.current?.readLedger()}
                  >
                    {view.ledgerLoading ? '正在读取流水…' : view.ledgerError ? '重新查询流水' : '查看本场流水'}
                  </button>
                  {view.ledgerError && <p role="alert">流水暂时未能核验，已确认奖励保持不变。请稍后重查。</p>}
                  {view.ledger && (
                    <ul className={styles.ledger}>
                      {view.ledger.map((entry) => (
                        <li key={entry.id}>
                          <strong>
                            {entry.currency === 'coins' ? '金币' : '碎片'} +{formatLobbyMoney(entry.delta)}
                          </strong>
                          <span>入账后余额 {formatLobbyMoney(entry.balanceAfter)}</span>
                          <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('zh-CN')}</time>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!online && !view.ledger && <p>联网后可核对本场实际入账流水。</p>}
                </>
              )}
            </section>
          )}
        </>
      )}
      <div className={styles.actions}>
        <button className="pz-button" disabled={!online || view.loading} onClick={() => void model.current?.refresh()}>
          重新查询结果
        </button>
        {canRematch ? (
          <Link className="pz-button pz-primary" to="/room">
            再来一局
          </Link>
        ) : (
          <span>
            {result && result.mode !== 'friend'
              ? '该模式暂未开放新的对局。'
              : result?.recorded
                ? '恢复服务连接后可再开好友赛。'
                : '结果保存确认后可再开好友赛。'}
          </span>
        )}
        <Link className="pz-button" to="/results">
          查看比赛记录
        </Link>
      </div>
      {canRematch && <p>再来一局会进入新好友房设置，使用当前阵容重新邀请；原比赛不会再次结算。</p>}
      {!result && !view.loading && <ActiveMatchPanel disabled={!online} />}
    </section>
  );
}
