import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { NavigationContext } from '@pengzhuang/client-model';
import type { MatchResult } from '../../../packages/contracts/src/match-results';
import { resultTitle, resultReason, resultFailureText } from '../../../packages/client-model/src/match-result';
import { useAccount } from '../accounts/context';
import { ActiveMatchPanel } from '../rooms/recovery-panel';
import styles from './results.module.css';

export function HistoryPage({ context }: { context: NavigationContext }) {
  const { services, login } = useAccount(),
    owner = login.user!;
  const [items, setItems] = useState<MatchResult[]>(() => services!.results.list(owner));
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false),
    [next, setNext] = useState<string | null>(null);
  const load = useRef<(more: boolean) => Promise<void>>(async () => undefined);
  const online = context.network === 'online' && login.status === 'authenticated';
  useEffect(() => {
    let active = true,
      pending = false,
      cursor: string | null = null;
    const read = async (more = false) => {
      if (
        !active ||
        pending ||
        !navigator.onLine ||
        document.hidden ||
        services!.model.snapshot.status !== 'authenticated' ||
        !services!.results.isIdentity(owner) ||
        (more && !cursor)
      )
        return;
      pending = true;
      setLoading(true);
      setError('');
      const response = await services!.api.matchHistory(owner.userId, more ? { cursor: cursor! } : {});
      pending = false;
      if (!active || !services!.results.isIdentity(owner)) return;
      setLoading(false);
      if (!response.ok) {
        setError(resultFailureText(response.error.code));
        if (['UNAUTHENTICATED', 'ACCOUNT_CHANGED', 'FORBIDDEN'].includes(response.error.code)) {
          services!.results.setIdentity(null);
          setItems([]);
          void services!.reconcile();
        }
        return;
      }
      const accepted = response.data.matches.map((row) => {
        services!.results.write(owner, row);
        return services!.results.read(owner, row.matchId)!;
      });
      setItems((previous) =>
        more
          ? [...previous, ...accepted.filter((row) => !previous.some((old) => old.matchId === row.matchId))]
          : accepted,
      );
      cursor = response.data.nextCursor;
      setNext(cursor);
      setLoaded(true);
    };
    load.current = read;
    const refresh = () => void read();
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      load.current = async () => undefined;
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [services, owner.userId, owner.sessionId]);
  return (
    <section className={styles.page} aria-label="本人比赛记录" aria-busy={loading}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>本人战绩</p>
          <h1>比赛记录</h1>
        </div>
        <Link className="pz-button" to="/">
          返回大厅
        </Link>
      </header>
      <p>只显示本账号的比赛。已结束的比赛可查看原结果，不能重新占用原房间。</p>
      {!online && (
        <p className={styles.notice} role="status">
          当前离线，仅显示本会话已读取的记录；联网后可继续查询。
        </p>
      )}
      {error && (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">正在读取本人比赛…</p>}
      {!items.length && !loading && (
        <p>
          {loaded ? '暂无已记录的比赛结果。' : online ? '尚未取得比赛记录，请重新查询。' : '本会话尚未读取过比赛记录。'}
        </p>
      )}
      <ol className={styles.history}>
        {items.map((result) => (
          <li className={styles.card} key={result.matchId}>
            <div className={styles.header}>
              <strong>
                {resultTitle(result)} · 我方 {result.score[result.side]} : {result.score[result.side === 0 ? 1 : 0]}{' '}
                对方
              </strong>
              <span>
                {result.status === 'settled' ? '已结算' : result.status === 'failed' ? '等待处理' : '等待结算'}
              </span>
            </div>
            <p>
              {resultReason(result.reason)} ·{' '}
              <time dateTime={result.endedAt}>{new Date(result.endedAt).toLocaleString('zh-CN')}</time>
            </p>
            <Link className="pz-button" to={`/result/${result.matchId}?mode=${result.mode}`}>
              查看本场结果
            </Link>
          </li>
        ))}
      </ol>
      <div className={styles.actions}>
        <button className="pz-button" disabled={!online || loading} onClick={() => void load.current(false)}>
          重新查询比赛记录
        </button>
        {next && (
          <button className="pz-button" disabled={!online || loading} onClick={() => void load.current(true)}>
            加载更早的比赛
          </button>
        )}
      </div>
      <ActiveMatchPanel disabled={!online} />
    </section>
  );
}
