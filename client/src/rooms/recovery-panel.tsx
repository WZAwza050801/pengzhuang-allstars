import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ActiveMatch, RecoverableMatch } from '../../../packages/contracts/src/match-recovery';
import { roomFailureText } from '../../../packages/client-model/src/room';
import { useAccount } from '../accounts/context';

export function ActiveMatchPanel({
  onResume,
  disabled = false,
}: {
  onResume?(match: RecoverableMatch): void;
  disabled?: boolean;
}) {
  const { services, login, options, unavailable } = useAccount();
  const [value, setValue] = useState<ActiveMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const userId = login.user?.userId,
    sessionId = login.user?.sessionId;
  const enabled = !!services && !!options?.friendRoomsEnabled && login.status === 'authenticated' && !unavailable;
  useEffect(() => {
    if (!enabled || !services || !userId) return;
    let active = true,
      pending = false;
    const load = async () => {
      if (pending || document.hidden || !navigator.onLine) return;
      pending = true;
      setLoading(true);
      setError('');
      const result = await services.api.activeMatch(userId);
      pending = false;
      if (
        !active ||
        services.model.snapshot.user?.userId !== userId ||
        services.model.snapshot.user?.sessionId !== sessionId
      )
        return;
      setLoading(false);
      if (result.ok) setValue(result.data);
      else {
        setValue(null);
        setError(roomFailureText(result.error.code));
      }
    };
    const update = () => void load();
    update();
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      active = false;
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [services, enabled, userId, sessionId, attempt]);
  if (!enabled || (!loading && !error && (!value || value.state === 'none'))) return null;
  const match = value?.state === 'available' ? value.match : null;
  return (
    <section aria-label="恢复比赛" aria-busy={loading}>
      <h2>{match ? '继续未完成的比赛' : '对局恢复'}</h2>
      {loading ? (
        <p role="status">正在查找本人对局…</p>
      ) : error ? (
        <p role="status">{error}</p>
      ) : match ? (
        <>
          <p>房间 {match.roomCode} · 使用本场原阵容恢复，已调整的阵容不会覆盖比赛。</p>
          {match.reconnectMs !== null && (
            <p>断线窗口剩余约 {Math.ceil(match.reconnectMs / 1000)} 秒，以服务端核验为准。</p>
          )}
          {match.mode !== 'friend' ? (
            <p>当前模式的网页入口尚未开放。</p>
          ) : onResume ? (
            <button
              className="pz-button pz-primary"
              disabled={disabled || !navigator.onLine}
              onClick={() => onResume(match)}
            >
              恢复对局
            </button>
          ) : (
            <Link className="pz-button" to={`/room/${match.roomCode}`}>
              继续对局
            </Link>
          )}
        </>
      ) : (
        <p role="status">
          {value?.state === 'expired'
            ? '上一场对局的重连窗口已过，不能恢复。'
            : value?.state === 'ended'
              ? '上一场比赛已结束，不能重新入场。'
              : '原比赛服务暂不可用，尚未恢复连接。请稍后重新检查。'}
        </p>
      )}
      {!loading && (
        <button className="pz-button" disabled={disabled} onClick={() => setAttempt((previous) => previous + 1)}>
          重新检查对局
        </button>
      )}
      {(value?.state === 'ended' || value?.state === 'expired') && (
        <Link className="pz-button" to="/results">
          查看比赛记录
        </Link>
      )}
    </section>
  );
}
