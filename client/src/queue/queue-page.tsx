import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router';
import type { NavigationContext } from '@pengzhuang/client-model';
import { QueueStateModel, queueActive } from '../../../packages/client-model/src/queue';
import { readInventory, type InventoryData } from '../../../packages/client-model/src/inventory';
import { canSaveOwnedLineup } from '../../../packages/client-model/src/owned-lineup';
import type { QueueCommand } from '../../../packages/contracts/src/matchmaking';
import { ACCOUNT_PROTOCOL_VERSION } from '../../../shared/protocol';
import { describeModeRules } from '../../../config/modes';
import { roomFailureText } from '../../../packages/client-model/src/room';
import { useAccount } from '../accounts/context';
import { usePublicLobby } from '../lobby-context';
import styles from '../rooms/rooms.module.css';

type Props = { mode: QueueCommand['mode']; context: NavigationContext; blocked: boolean };
export function QueuePage(props: Props) {
  const { services, login } = useAccount(),
    user = login.user!;
  const [model, setModel] = useState<QueueStateModel | null>(null);
  useEffect(() => {
    const active = new QueueStateModel(services!.api, user.userId, () => {
      const current = services!.model.snapshot.user;
      return current?.userId === user.userId && current.sessionId === user.sessionId;
    });
    setModel(active);
    void active.refresh();
    return () => active.dispose();
  }, [services, user.userId, user.sessionId]);
  return model ? <QueueContent {...props} model={model} /> : <p role="status">正在读取本人匹配状态…</p>;
}
function QueueContent({ model, mode, context, blocked }: Props & { model: QueueStateModel }) {
  const state = useSyncExternalStore(model.subscribe, () => model.snapshot),
    navigate = useNavigate();
  const { services, login } = useAccount(),
    user = login.user!,
    lobby = usePublicLobby();
  const [inventory, setInventory] = useState<InventoryData | null>(null),
    [inventoryError, setInventoryError] = useState('');
  const [attempt, setAttempt] = useState(0),
    [selection, setSelection] = useState(''),
    [region, setRegion] = useState(''),
    [tick, setTick] = useState(Date.now);
  const entry = state.data?.entry,
    active = queueActive(entry),
    online = context.network === 'online',
    remote = !blocked && online && context.service !== 'outdated';
  useEffect(() => {
    let live = true;
    setInventoryError('');
    void readInventory(services!.api, user.userId).then((result) => {
      if (
        !live ||
        services!.model.snapshot.user?.userId !== user.userId ||
        services!.model.snapshot.user.sessionId !== user.sessionId
      )
        return;
      if (!result.ok) {
        setInventoryError(roomFailureText(result.error.code));
        return;
      }
      setInventory(result.data);
      setSelection((previous) =>
        result.data.lineups.some((value) => value.id === previous) ? previous : (result.data.lineups[0]?.id ?? ''),
      );
    });
    return () => {
      live = false;
    };
  }, [services, user.userId, user.sessionId, attempt]);
  useEffect(() => {
    const load = () => {
      if (!document.hidden && navigator.onLine && !blocked) void model.refresh();
    };
    const timer = setInterval(() => {
      if (queueActive(model.snapshot.data?.entry) || model.snapshot.pending) load();
    }, 2000);
    window.addEventListener('focus', load);
    window.addEventListener('online', load);
    document.addEventListener('visibilitychange', load);
    load();
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener('online', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [model, blocked]);
  useEffect(() => {
    if (!active && !state.pending) return;
    const timer = setInterval(() => {
      if (!document.hidden) setTick(Date.now());
    }, 1000);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', warn);
    };
  }, [active, state.pending]);
  const manifest = lobby.manifest.tag === 'ready' ? lobby.manifest.data : null;
  const rules = entry?.rules ?? manifest?.modes.find((value) => value.mode === mode);
  const lineup = inventory?.lineups.find((value) => value.id === selection),
    usable = !!inventory && !!lineup && canSaveOwnedLineup(lineup.ownedCardIds, inventory.cards);
  const selectedRegion = region || state.options?.policy.regions[0]?.id || '';
  const ready =
    remote &&
    context.service === 'ready' &&
    !state.loading &&
    !state.busy &&
    !state.pending &&
    !active &&
    !!state.data &&
    !!state.options &&
    state.options.enabledModes.includes(mode) &&
    usable &&
    !!rules &&
    rules.gameDataVersion === state.options.configVersion &&
    !inventoryError &&
    !state.problem;
  const deadline = entry?.assignment?.expiresAt ?? entry?.expiresAt;
  const remaining =
    deadline && state.data
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(deadline) - Date.parse(state.data.serverNow) - Math.max(0, tick - state.observedAt)) / 1000,
          ),
        )
      : null;
  const start = () => {
    if (!ready) return;
    void model.enter({
      intentId: crypto.randomUUID(),
      protocol: ACCOUNT_PROTOCOL_VERSION,
      mode,
      lineupId: lineup!.id,
      expectedRevision: lineup!.revision,
      configVersion: state.options!.configVersion,
      region: selectedRegion,
    });
  };
  const refresh = () => {
    setAttempt((value) => value + 1);
    void model.refresh(true);
  };
  const back = async () => {
    if (entry?.state === 'queued' && !state.pending && remote) {
      await model.cancel();
      if (model.snapshot.pending || queueActive(model.snapshot.data?.entry)) return;
    } else if ((active || state.pending) && !confirm('离开页面不会自动取消本次匹配。确定返回大厅吗？')) return;
    navigate('/');
  };
  const title =
    entry?.state === 'queued'
      ? '正在寻找兼容对手'
      : entry?.state === 'matched'
        ? '已找到对手'
        : entry?.state === 'cancelled'
          ? '已取消排队'
          : entry?.state === 'expired'
            ? '本次匹配已超时'
            : entry?.state === 'failed'
              ? '本次匹配未能完成'
              : entry?.state === 'completed'
                ? '本场比赛已结束'
                : '选择阵容，开始匹配';
  return (
    <section className={styles.page} aria-busy={state.loading || state.busy}>
      <header className={styles.header}>
        <div>
          <p>均衡对战 · 真人匹配</p>
          <h1>匹配对手</h1>
        </div>
        <button className="pz-button" disabled={state.busy} onClick={() => void back()}>
          {entry?.state === 'queued' && !state.pending && remote ? '取消并返回大厅' : '返回大厅'}
        </button>
      </header>
      {rules ? <p className={styles.rules}>{describeModeRules(rules)}</p> : <p role="status">正在确认服务端规则…</p>}
      {!remote ? (
        <p role="status">
          {online ? '正在确认账号或客户端版本，请稍后重试。' : '当前离线，恢复网络后可查询或取消原排队。'}
        </p>
      ) : context.service === 'maintenance' ? (
        <p role="status">服务维护中，暂停新的匹配；可查询或取消已有排队。</p>
      ) : null}
      {state.loading ? <p role="status">正在读取本人匹配状态…</p> : <h2 aria-live="polite">{title}</h2>}
      {state.problem && (
        <p role="alert">
          {state.problem.code === 'CONFLICT'
            ? '状态或阵容已变化，请刷新状态和阵容。'
            : roomFailureText(state.problem.code)}
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {state.pending && !state.busy && (
        <div role="status">
          <p>
            {state.pending === 'entry'
              ? '入队结果尚未确认。重试会继续原请求。'
              : '取消结果尚未确认，当前不会显示为已取消。'}
          </p>
          <button className="pz-button" disabled={!remote} onClick={() => void model.retry()}>
            {state.pending === 'entry' ? '重试原入队请求' : '重试取消'}
          </button>
        </div>
      )}
      {state.busy && <p role="status">{state.pending === 'cancel' ? '正在确认取消结果…' : '正在提交匹配请求…'}</p>}
      {entry?.state === 'queued' && (
        <section className={styles.setup} aria-label="当前排队">
          <p>
            {entry.reason === 'other-server'
              ? '原匹配服务暂不可用，可取消原排队后再试。'
              : '等待使用相同规则和区域的玩家；服务器繁忙时也会继续等待空位。'}
          </p>
          <p>
            {state.options?.policy.regions.find((value) => value.id === entry.region)?.label ?? '所选区域'} · 剩余约{' '}
            {remaining} 秒，以服务器确认为准。
          </p>
          {entry.rating && <p>当前积分 {entry.rating.points}，按本赛季兼容范围匹配。</p>}
          <button
            className="pz-button"
            disabled={!remote || state.busy || !!state.pending}
            onClick={() => void model.cancel()}
          >
            取消匹配
          </button>
        </section>
      )}
      {entry?.state === 'matched' && (
        <section className={styles.setup} aria-label="匹配结果">
          <p>使用入队时的原阵容。本场配对完成后，取消排队不能撤回比赛。</p>
          <p>入场剩余约 {remaining} 秒，以服务器确认为准。</p>
          {entry.assignment?.state === 'ready' ? (
            <Link
              className="pz-button pz-primary"
              aria-disabled={!remote}
              onClick={(event) => {
                if (!remote) event.preventDefault();
              }}
              to={`/room/${entry.assignment.roomCode}?queueEntry=${entry.id}`}
            >
              进入比赛房间
            </Link>
          ) : (
            <p role="status">正在准备比赛房间…</p>
          )}
        </section>
      )}
      {entry?.state === 'failed' && (
        <p role="status">
          {entry.reason === 'account-unavailable'
            ? '账号或持有卡状态已变化，请重新确认阵容后再试。'
            : '比赛房间未能准备完成，可重新匹配。'}
        </p>
      )}
      {!active && (
        <section className={styles.setup} aria-label="匹配设置">
          <label>
            参赛阵容
            <select
              aria-label="匹配阵容"
              value={selection}
              disabled={state.busy || !!state.pending}
              onChange={(event) => setSelection(event.target.value)}
            >
              {inventory?.lineups.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name} · {value.ownedCardIds.length}/5
                </option>
              ))}
            </select>
          </label>
          {!inventory && !inventoryError ? (
            <p role="status">正在读取持有阵容…</p>
          ) : inventoryError ? (
            <p role="alert">{inventoryError}</p>
          ) : !usable ? (
            <p>阵容不完整或包含不可用卡，请先调整持有阵容。</p>
          ) : (
            <p>使用五张本人持有卡，按本场服务端规则参赛。</p>
          )}
          <label>
            匹配区域
            <select
              aria-label="匹配区域"
              value={selectedRegion}
              disabled={state.busy || !!state.pending}
              onChange={(event) => setRegion(event.target.value)}
            >
              {state.options?.policy.regions.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
          {state.options && !state.options.enabledModes.includes(mode) && (
            <p role="status">该模式尚未开放，可返回大厅选择均衡匹配。</p>
          )}
          <div className={styles.actions}>
            <button className="pz-button pz-primary" disabled={!ready} onClick={start}>
              {entry ? '重新匹配' : '开始匹配'}
            </button>
            <Link className="pz-button" to="/lineup">
              调整阵容
            </Link>
          </div>
        </section>
      )}
      <div className={styles.actions}>
        <button className="pz-button" disabled={!remote || state.busy} onClick={refresh}>
          刷新状态和阵容
        </button>
        {entry?.state === 'completed' && (
          <Link className="pz-button" to="/results">
            查看战绩
          </Link>
        )}
      </div>
      <p>关闭页面不会自动取消排队。确认取消后再离开；超时由服务器处理。</p>
    </section>
  );
}
