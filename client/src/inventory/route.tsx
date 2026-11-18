import { Link, Navigate } from 'react-router';
import type { NavigationContext } from '@pengzhuang/client-model';
import { useAccount } from '../accounts/context';
import { InventoryEditor } from './editor';
import styles from './inventory.module.css';
export default function InventoryRoute({ context }: { context: NavigationContext }) {
  const { services, login, options, unavailable } = useAccount();
  if (unavailable && !login.user)
    return (
      <section className={styles.page}>
        <h1>账号连接中断</h1>
        <button className="pz-button" onClick={() => void services?.reconcile()}>
          重新连接账号
        </button>
      </section>
    );
  if (!services || !options || login.status === 'unknown' || (login.status === 'loading' && !login.user))
    return <p role="status">正在确认账号与阵容服务…</p>;
  if (!options.inventoryEnabled)
    return (
      <section className={styles.page}>
        <h1>阵容服务暂未开放</h1>
        <Link to="/">返回大厅</Link>
      </section>
    );
  if (login.status === 'logout-pending' || login.status === 'signing-out')
    return (
      <section className={styles.page}>
        <h1>退出状态尚待确认</h1>
        <Link to="/profile">继续处理退出</Link>
      </section>
    );
  if (!login.user) return <Navigate to="/login" replace state={{ resume: { page: 'lineup' } }} />;
  return (
    <InventoryEditor
      key={`${login.user.userId}:${login.user.sessionId}`}
      context={context}
      disabled={unavailable || login.status !== 'authenticated'}
    />
  );
}
