import { useEffect, useRef, useState } from 'react';
import type { ResourceView } from '@pengzhuang/client-model';
import type { LobbyAccount } from '../../packages/contracts/src/lobby';
import { formatLobbyMoney } from '../../packages/client-model/src/lobby';
import { useAccount } from './accounts/context';
import { usePublicLobby } from './lobby-context';
import type { NavigateTarget } from './webScreens';
import styles from './webShell.module.css';
import { Link } from 'react-router';
import { ActiveMatchPanel } from './rooms/recovery-panel';

export function LobbyAccountPanel({ onNavigate }: { onNavigate: NavigateTarget }) {
  const { services, login, unavailable } = useAccount();
  const [expired, setExpired] = useState(false);
  if (unavailable || login.status === 'error')
    return (
      <section className={styles.infoCard}>
        <h2>账号连接中断</h2>
        <p>暂时无法确认账号和余额。原账号资料不会被覆盖。</p>
        <button className="pz-button" onClick={() => void services?.reconcile()}>
          重新连接账号
        </button>
      </section>
    );
  if (login.status === 'authenticated' && login.user)
    return <SignedInLobby key={`${login.user.userId}:${login.user.sessionId}`} onExpired={() => setExpired(true)} />;
  return (
    <section className={styles.infoCard} aria-labelledby="account-title">
      <h2 id="account-title">账号与资产</h2>
      {login.status === 'unknown' || login.status === 'loading' ? (
        <p role="status">正在恢复账号，余额尚未读取…</p>
      ) : login.status === 'signing-out' || login.status === 'logout-pending' ? (
        <p>退出状态尚待确认，请在“我的”继续处理。</p>
      ) : (
        <>
          <p>{expired ? '登录信息已失效，请重新登录。' : '登录后查看云端资料、余额与持有卡。游客可直接练习。'}</p>
          <button className="pz-button" onClick={() => onNavigate({ page: 'login' })}>
            登录账号
          </button>
        </>
      )}
    </section>
  );
}
function SignedInLobby({ onExpired }: { onExpired(): void }) {
  const { services, login } = useAccount();
  const publicLobby = usePublicLobby();
  const [resource, setResource] = useState<ResourceView<LobbyAccount>>({ tag: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const userId = login.user!.userId;
  useEffect(() => {
    let active = true;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const request = ++sequence.current;
      setResource({ tag: 'loading' });
      const result = await services!.api.lobby(userId);
      pending = false;
      if (!active || request !== sequence.current) return;
      if (result.ok) setResource({ tag: 'ready', data: result.data });
      else {
        setResource({ tag: 'error', message: '未能读取资产，余额尚未确认。', retryable: result.error.retryable });
        if (result.error.code === 'UNAUTHENTICATED') {
          onExpired();
          void services!.changed(false);
        }
      }
    };
    const update = () => void load();
    update();
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      active = false;
      sequence.current++;
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [services, userId, attempt, login.user?.profile?.version]);
  const data = resource.tag === 'ready' ? resource.data : null;
  return (
    <section className={styles.infoCard} aria-labelledby="account-title" aria-busy={resource.tag === 'loading'}>
      <h2 id="account-title">账号与资产</h2>
      {resource.tag === 'loading' && <p role="status">正在读取云端资产，余额尚未确认…</p>}
      {resource.tag === 'error' && <p role="status">{resource.message}</p>}
      {data && (
        <>
          {data.profile ? (
            <p>
              {data.profile.nickname} · 账号等级 {data.profile.level} · 经验 {formatLobbyMoney(data.profile.exp)}
            </p>
          ) : (
            <p>云端资料暂未建立，请重新读取或联系维护人员。</p>
          )}
          <dl className={styles.wallet} aria-label="云端余额">
            {(['coins', 'fragments'] as const).map((currency) => {
              const wallet = data.wallets.find((row) => row.currency === currency);
              return (
                <div key={currency}>
                  <dt>{currency === 'coins' ? '金币' : '碎片'}</dt>
                  <dd data-wallet={currency}>{wallet ? formatLobbyMoney(wallet.balance) : '尚未建立'}</dd>
                </div>
              );
            })}
          </dl>
          <p>持有卡：{data.cardCount} 张</p>
          {data.defaultLineup ? (
            <p>
              {data.defaultLineup.name}：{data.defaultLineup.readyCards}/5 张可用 · 版本 {data.defaultLineup.revision}
            </p>
          ) : (
            <p>尚无云端阵容。</p>
          )}
          <p>可在“阵容”查看持有卡、保存阵容并确认升级。</p>
        </>
      )}
      <ActiveMatchPanel />
      <div className={styles.actions}>
        <button
          className="pz-button"
          disabled={resource.tag === 'loading'}
          onClick={() => {
            setAttempt((value) => value + 1);
            void services!.reconcile();
            void publicLobby.refresh();
          }}
        >
          刷新大厅数据
        </button>
        <Link className="pz-button" to="/profile">
          账号资料与设备
        </Link>
      </div>
    </section>
  );
}
