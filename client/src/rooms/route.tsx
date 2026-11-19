import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import type { NavigationContext } from '@pengzhuang/client-model';
import { useAccount } from '../accounts/context';
import { normalizeRoomCode } from '../../../packages/client-model/src/room';
import { RoomPage } from './room-page';
import styles from './rooms.module.css';

export default function RoomRoute({ context }: { context: NavigationContext }) {
  const { code } = useParams();
  const [search] = useSearchParams();
  const rawEntry = search.get('queueEntry'),
    queueEntry = rawEntry ? z.uuid().safeParse(rawEntry) : null;
  const { services, login, options, unavailable } = useAccount();
  const normalized = code ? normalizeRoomCode(code) : undefined;
  if ((code && !normalized) || (queueEntry && !queueEntry.success))
    return (
      <section className={styles.page}>
        <h1>房间码无效</h1>
        <Link to="/room">重新输入房间码</Link>
      </section>
    );
  if (!services || !options || login.status === 'unknown' || (login.status === 'loading' && !login.user))
    return <p role="status">正在确认账号与房间服务…</p>;
  if (!options.friendRoomsEnabled || !options.inventoryEnabled)
    return (
      <section className={styles.page}>
        <h1>好友房暂未开放</h1>
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
  if (!login.user)
    return (
      <Navigate to="/login" replace state={{ resume: { page: 'room', ...(normalized ? { code: normalized } : {}) } }} />
    );
  return (
    <RoomPage
      key={`${login.user.userId}:${login.user.sessionId}`}
      initialCode={normalized ?? ''}
      queueEntryId={queueEntry?.success ? queueEntry.data.toLowerCase() : undefined}
      context={context}
      blocked={unavailable || login.status !== 'authenticated'}
    />
  );
}
