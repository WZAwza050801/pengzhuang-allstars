import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { NavigationContext } from '@pengzhuang/client-model';
import { readInventory, type InventoryData } from '../../../packages/client-model/src/inventory';
import { canSaveOwnedLineup } from '../../../packages/client-model/src/owned-lineup';
import {
  invitationUrl,
  normalizeRoomCode,
  roomFailureText,
  RoomJoinError,
} from '../../../packages/client-model/src/room';
import { DEFAULT_DATA } from '../../../shared/data';
import { ACCOUNT_PROTOCOL_VERSION, type RoomSnapshot } from '../../../shared/protocol';
import { rulesForMode, describeModeRules } from '../../../config/modes';
import { useAccount } from '../accounts/context';
import { OnlineHost, type OnlineStatus } from '../onlineHost';
import { RoomMatchView } from './match-view';
import styles from './rooms.module.css';

export function RoomPage({
  initialCode,
  context,
  blocked,
}: {
  initialCode: string;
  context: NavigationContext;
  blocked: boolean;
}) {
  const { services, login } = useAccount();
  const user = login.user!;
  const navigate = useNavigate();
  const [data, setData] = useState<InventoryData | null>(null);
  const [selection, setSelection] = useState('');
  const [code, setCode] = useState(initialCode);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<OnlineStatus | 'idle'>('idle');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [playing, setPlaying] = useState(false);
  const [readyPending, setReadyPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [opponentSeen, setOpponentSeen] = useState(false);
  const host = useRef<OnlineHost | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const sequence = useRef(0);
  const ready = !blocked && context.network === 'online' && context.service === 'ready';
  const authorized = !blocked && context.network === 'online';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
      host.current?.dispose();
      host.current = null;
    };
  }, []);
  useEffect(() => {
    host.current?.setAuthorizationReady(authorized);
  }, [authorized]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void readInventory(services!.api, user.userId).then((result) => {
      if (!active) return;
      setLoading(false);
      if (!result.ok) {
        setError(roomFailureText(result.error.code));
        return;
      }
      setData(result.data);
      setSelection((id) =>
        result.data.lineups.some((lineup) => lineup.id === id) ? id : (result.data.lineups[0]?.id ?? ''),
      );
      setError('');
    });
    return () => {
      active = false;
    };
  }, [services, user.userId, attempt]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (host.current && status !== 'ended') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  const lineup = data?.lineups.find((item) => item.id === selection);
  const usable = !!lineup && !!data && canSaveOwnedLineup(lineup.ownedCardIds, data.cards);
  const leave = () => {
    if (host.current && !playing && !confirm('离开房间会取消准备。确定返回大厅吗？')) return;
    sequence.current++;
    host.current?.dispose();
    host.current = null;
    navigate('/');
  };
  const connect = async () => {
    if (busy.current || !ready || !lineup || !usable) return;
    const target = code.trim() ? normalizeRoomCode(code) : undefined;
    if (code.trim() && !target) {
      setError('请输入正确的 6 位房间码。');
      return;
    }
    busy.current = true;
    setError('');
    setStatus('connecting');
    const request = ++sequence.current;
    const sameAccount = () => {
      const current = services!.model.snapshot;
      return current.user?.userId === user.userId && current.user.sessionId === user.sessionId;
    };
    const created = new OnlineHost(
      {
        nickname: user.profile?.nickname ?? '我',
        code: target ?? undefined,
        account: {
          userId: user.userId,
          async issueTicket(roomCode) {
            if (!sameAccount()) return { ok: false, error: { code: 'ACCOUNT_CHANGED', retryable: false } };
            const response = await services!.api.roomTicket(user.userId, {
              protocol: ACCOUNT_PROTOCOL_VERSION,
              mode: 'friend',
              lineupId: lineup.id,
              expectedRevision: lineup.revision,
              ...(roomCode ? { roomCode } : {}),
            });
            return sameAccount() ? response : { ok: false, error: { code: 'ACCOUNT_CHANGED', retryable: false } };
          },
        },
      },
      (next, detail) => {
        if (mounted.current && host.current === created) {
          setStatus(next);
          if (detail) setError(detail);
        }
      },
    );
    host.current = created;
    created.onRoomSnapshot((next) => {
      if (!mounted.current || host.current !== created) return;
      setSnapshot(next);
      setReadyPending(false);
      if (next.seats[next.mySeat === 0 ? 1 : 0]) setOpponentSeen(true);
    });
    created.onMatchReady(() => {
      if (mounted.current && host.current === created) setPlaying(true);
    });
    try {
      const roomCode = await created.connect();
      if (!mounted.current || sequence.current !== request) {
        created.dispose();
        return;
      }
      setCode(roomCode);
      navigate(`/room/${roomCode}`, { replace: true });
    } catch (cause) {
      created.dispose();
      if (!mounted.current || sequence.current !== request) return;
      host.current = null;
      setStatus('idle');
      setError(cause instanceof RoomJoinError ? cause.message : roomFailureText('NETWORK_ERROR'));
    } finally {
      if (sequence.current === request) busy.current = false;
    }
  };
  const toggleReady = () => {
    if (!host.current || !snapshot || readyPending || !ready || status !== 'lobby') return;
    setReadyPending(true);
    host.current.setReady(!snapshot.seats[snapshot.mySeat]?.ready);
  };
  const copy = async () => {
    if (!host.current) return;
    try {
      await navigator.clipboard.writeText(invitationUrl(window.location.origin, host.current.code));
      setNotice('邀请链接已复制。');
    } catch {
      setNotice('无法自动复制，请手动复制下方邀请链接。');
    }
  };
  if (playing && host.current)
    return (
      <RoomMatchView
        host={host.current}
        status={status}
        detail={error}
        service={context.service}
        onExit={() => {
          host.current?.dispose();
          host.current = null;
          navigate('/');
        }}
      />
    );
  const connected = !!snapshot && !!host.current;
  const rules = snapshot?.rules ?? rulesForMode(DEFAULT_DATA, 'friend');
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>好友约战</p>
          <h1>{connected ? `房间 ${snapshot.code}` : initialCode ? '加入好友房' : '选择阵容，邀请好友'}</h1>
        </div>
        <button className="pz-button" onClick={leave}>
          {status === 'connecting' ? '取消连接' : '返回大厅'}
        </button>
      </header>
      <p className={styles.rules}>{describeModeRules(rules)}</p>
      <p>使用账号持有阵容，双方统一 Lv5。本场不计排位、不发正式奖励。</p>
      {!ready && (
        <p role="status">
          {context.network === 'offline'
            ? '当前离线，暂停远程操作。'
            : context.service !== 'ready'
              ? '服务暂不可用，已暂停新的房间操作。'
              : '正在确认账号，暂时不能操作。'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!connected ? (
        <div className={styles.setup}>
          <label>
            持有阵容
            <select
              aria-label="参赛阵容"
              value={selection}
              disabled={loading || status === 'connecting'}
              onChange={(e) => setSelection(e.target.value)}
            >
              {data?.lineups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.ownedCardIds.length}/5
                </option>
              ))}
            </select>
          </label>
          {loading ? (
            <p role="status">正在读取持有阵容…</p>
          ) : !data?.lineups.length ? (
            <p>暂无阵容，请先在阵容页面配置持有卡。</p>
          ) : !usable ? (
            <p>当前阵容不完整或包含不可用卡，请先调整。</p>
          ) : (
            <ul className={styles.cards}>
              {lineup?.ownedCardIds.map((id) => {
                const card = data!.cards.find((item) => item.id === id);
                return (
                  <li key={id}>
                    {card ? DEFAULT_DATA.players[card.playerDefId]?.name : '不可用卡'}
                    <span>本场 Lv5</span>
                  </li>
                );
              })}
            </ul>
          )}
          <label>
            房间码（留空创建新房）
            <input
              aria-label="房间码"
              value={code}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              disabled={status === 'connecting'}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <div className={styles.actions}>
            <button
              className="pz-button pz-primary"
              disabled={!ready || !usable || loading || status === 'connecting'}
              onClick={() => void connect()}
            >
              {status === 'connecting' ? '正在进入…' : code.trim() ? '加入房间' : '创建房间'}
            </button>
            <button
              className="pz-button"
              disabled={status === 'connecting'}
              onClick={() => setAttempt((value) => value + 1)}
            >
              重新读取阵容
            </button>
            <Link to="/lineup">调整阵容</Link>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.invite}>
            <button className="pz-button" onClick={() => void copy()}>
              复制邀请链接
            </button>
            <label>
              邀请链接
              <input
                aria-label="邀请链接"
                readOnly
                value={invitationUrl(window.location.origin, snapshot.code)}
                onFocus={(e) => e.target.select()}
              />
            </label>
          </div>
          <p role="status">
            {status === 'reconnecting'
              ? '正在重新连接房间…'
              : status === 'closed'
                ? '连接已断开，请返回大厅后重试。'
                : !snapshot.seats[snapshot.mySeat === 0 ? 1 : 0]
                  ? opponentSeen
                    ? '对手已离开，等待好友加入。'
                    : '等待好友加入。'
                  : '双方就位，准备后开局。'}
          </p>
          <div className={styles.seats}>
            {snapshot.seats.map((seat, side) => (
              <section className={styles.seat} key={side}>
                <h2>
                  {side === snapshot.mySeat ? '我方' : '对方'} · {seat?.nickname ?? '等待加入'}
                </h2>
                <p>{seat ? (seat.ready ? '已准备' : '未准备') : '空位'}</p>
                {seat && (
                  <ol>
                    {seat.lineup.map((id, slot) => (
                      <li key={`${id}:${slot}`}>
                        {DEFAULT_DATA.players[id]?.name ?? id} · Lv{seat.levels[slot]}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
          <button
            className="pz-button pz-primary"
            disabled={!ready || status !== 'lobby' || readyPending}
            onClick={toggleReady}
          >
            {readyPending ? '正在确认准备…' : snapshot.seats[snapshot.mySeat]?.ready ? '取消准备' : '准备比赛'}
          </button>
          <button
            className="pz-button"
            disabled={!ready || status !== 'lobby'}
            onClick={() => host.current?.synchronize()}
          >
            重新同步房间
          </button>
        </>
      )}
    </section>
  );
}
