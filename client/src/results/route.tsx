import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import type { NavigationContext } from '@pengzhuang/client-model';
import { useAccount } from '../accounts/context';
import { ResultPage } from './result-page';
import { HistoryPage } from './history-page';
import styles from './results.module.css';

export default function ResultsRoute({ context }: { context: NavigationContext }) {
  const { matchId } = useParams(),
    [search] = useSearchParams();
  const { login, services, options, unavailable } = useAccount();
  const target = matchId ? { page: 'result', mode: 'friend', matchId } : { page: 'history' };
  if (matchId && !z.uuid().safeParse(matchId).success)
    return (
      <section className={styles.page}>
        <h1>比赛链接无效</h1>
        <Link to="/results">查看本人的比赛记录</Link>
      </section>
    );
  if (search.get('mode') === 'practice')
    return (
      <section className={styles.page}>
        <h1>本地练习结果</h1>
        <p>练习结果在本次比赛画面中查看，不计入账号战绩。</p>
        <Link to="/">返回大厅</Link>
      </section>
    );
  if (!services || !options || login.status === 'unknown' || (login.status === 'loading' && !login.user))
    return (
      <section className={styles.page}>
        <h1>正在确认账号</h1>
        <p role="status">
          {unavailable || context.network === 'offline' ? '联网后才能确认本人的比赛记录。' : '正在读取登录状态…'}
        </p>
        <button
          className="pz-button"
          disabled={!services || context.network === 'offline'}
          onClick={() => void services?.reconcile()}
        >
          重新确认账号
        </button>
        <Link to="/">返回大厅</Link>
      </section>
    );
  if (login.status === 'signing-out' || login.status === 'logout-pending')
    return (
      <section className={styles.page}>
        <h1>退出状态尚待确认</h1>
        <Link to="/profile">继续处理退出</Link>
      </section>
    );
  if (!options.friendRoomsEnabled)
    return (
      <section className={styles.page}>
        <h1>账号比赛记录暂未开放</h1>
        <Link to="/">返回大厅</Link>
      </section>
    );
  if (!login.user) return <Navigate to="/login" replace state={{ resume: target }} />;
  const key = `${login.user.userId}:${login.user.sessionId}:${matchId ?? 'history'}`;
  return matchId ? (
    <ResultPage key={key} matchId={matchId.toLowerCase()} context={context} />
  ) : (
    <HistoryPage key={key} context={context} />
  );
}
