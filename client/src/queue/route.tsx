import { Link, Navigate, useParams } from 'react-router';
import type { NavigationContext } from '@pengzhuang/client-model';
import { QueueModeSchema } from '../../../packages/contracts/src/matchmaking';
import { useAccount } from '../accounts/context';
import { QueuePage } from './queue-page';
import styles from '../rooms/rooms.module.css';

export default function QueueRoute({ context }: { context: NavigationContext }) {
  const mode = QueueModeSchema.safeParse(useParams().mode);
  const { services, options, login, unavailable } = useAccount();
  if (!mode.success)
    return (
      <section className={styles.page}>
        <h1>匹配模式无效</h1>
        <Link to="/">返回大厅</Link>
      </section>
    );
  if (!services || !options || login.status === 'unknown' || (login.status === 'loading' && !login.user))
    return <p role="status">正在确认账号与匹配服务…</p>;
  if (!options.matchmakingEnabled || !options.inventoryEnabled)
    return (
      <section className={styles.page}>
        <h1>匹配服务暂未开放</h1>
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
  if (!login.user) return <Navigate to="/login" replace state={{ resume: { page: 'queue', mode: mode.data } }} />;
  return (
    <QueuePage
      key={`${login.user.userId}:${login.user.sessionId}:${mode.data}`}
      mode={mode.data}
      context={context}
      blocked={unavailable || login.status !== 'authenticated'}
    />
  );
}
