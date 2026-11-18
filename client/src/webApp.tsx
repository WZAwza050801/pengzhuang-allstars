import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_FEATURES,
  MAIN_NAV,
  resolveNavigation,
  toWebPath,
  type NavigationContext,
  type NavigationTarget,
} from '@pengzhuang/client-model';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { LobbyScreen, PlaceholderScreen, UnavailableScreen, type NavigateTarget } from './webScreens';
import styles from './webShell.module.css';
import { AccountProvider, useAccount } from './accounts/context';
import { PublicLobbyProvider, usePublicLobby } from './lobby-context';
import { loadPracticeScreen, practiceScreenLoaded } from './practice-entry';

const PracticeMatchScreen = lazy(loadPracticeScreen);
const AccountScreen = lazy(() => import('./accounts/routes'));
const InventoryScreen = lazy(() => import('./inventory/route'));

function useNavigationContext(): NavigationContext {
  const { login, options } = useAccount();
  const { service } = usePublicLobby();
  const [network, setNetwork] = useState<NavigationContext['network']>(() => (navigator.onLine ? 'online' : 'offline'));

  useEffect(() => {
    const goOnline = () => setNetwork('online');
    const goOffline = () => setNetwork('offline');
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return useMemo(
    () => ({ session: login.user ? 'authenticated' : login.status === 'unknown' || login.status === 'loading' ? 'loading' : 'anonymous', network, service, features: { ...DEFAULT_FEATURES, inventory: !!options?.inventoryEnabled, accounts: !!(options?.emailEnabled || options?.wechatMiniProgram) } }),
    [network, login.user, login.status, options, service],
  );
}

function useVisualViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => root.style.setProperty('--web-viewport-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      root.style.removeProperty('--web-viewport-height');
    };
  }, []);
}

function unavailableReason(reason: string) {
  return (
    {
      'feature-off': '该功能尚未开放。',
      'session-loading': '会话仍在恢复，请稍后重试。',
      offline: '当前离线，无法发起远程操作。',
      maintenance: '服务维护中，请稍后重试。',
      outdated: '客户端版本已过期，请更新后重试。',
    }[reason] ?? '当前无法完成此操作。'
  );
}

function MatchRoute({ context }: { context: NavigationContext }) {
  const { matchId } = useParams();
  const [search] = useSearchParams();
  const candidate = matchId
    ? { page: 'match', mode: search.get('mode'), matchId }
    : { page: 'match', mode: search.get('mode') };
  const decision = resolveNavigation(candidate, context);
  const navigate = useNavigate();

  if (decision.kind === 'invalid') return <Navigate to="/" replace />;
  if (decision.kind === 'login') return <Navigate to="/login" replace state={{ resume: decision.resume }} />;
  if (decision.kind === 'blocked') return <UnavailableScreen reason={unavailableReason(decision.reason)} onBack={() => navigate('/')} />;
  if (decision.target.page !== 'match') return <Navigate to="/" replace />;
  if (decision.target.mode === 'practice' && context.network === 'offline' && !practiceScreenLoaded()) return <UnavailableScreen reason="练习资源尚未载入，请联网后先进入一次练习。" onBack={() => navigate('/')} />;
  return decision.target.mode === 'practice' ? (
    <Suspense fallback={<p className={styles.matchLoading}>正在载入练习赛…</p>}>
      <PracticeMatchScreen />
    </Suspense>
  ) : (
    <UnavailableScreen reason="该对局需要有效的服务端比赛凭证。" onBack={() => navigate('/')} />
  );
}

function FutureRoute({ context, target, title, detail }: { context: NavigationContext; target: NavigationTarget; title: string; detail: string }) {
  const decision = resolveNavigation(target, context);
  const navigate = useNavigate();

  if (decision.kind === 'show') return <PlaceholderScreen title={title} detail={detail} />;
  if (decision.kind === 'login') return <Navigate to="/login" replace state={{ resume: decision.resume }} />;
  if (decision.kind === 'invalid') return <Navigate to="/" replace />;
  return <UnavailableScreen reason={unavailableReason(decision.reason)} onBack={() => navigate('/')} />;
}

function Shell({ context }: { context: NavigationContext }) {
  const { login } = useAccount();
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(null);
  const onNavigate = useCallback<NavigateTarget>(
    (target) => {
      const decision = resolveNavigation(target, context);
      if (decision.kind === 'show') {
        setNotice(null);
        navigate(toWebPath(decision.target), decision.target.page === 'login' ? { state: { resume: { page: 'lobby' } } } : undefined);
      } else if (decision.kind === 'login') {
        setNotice(null);
        navigate('/login', { state: { resume: decision.resume } });
      } else if (decision.kind === 'blocked') setNotice(unavailableReason(decision.reason));
      else setNotice('无效的页面入口。');
    },
    [context, navigate],
  );

  const activePage =
    location.pathname === '/lineup'
      ? 'lineup'
      : location.pathname === '/growth'
        ? 'growth'
        : location.pathname === '/club'
          ? 'club'
          : location.pathname.startsWith('/profile') || location.pathname === '/settings' || location.pathname === '/login' || location.pathname.startsWith('/account/')
            ? 'profile'
            : 'lobby';

  return (
    <main className={`${styles.application} pz-ui`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>碰撞全明星</p>
          <strong>{login.user?.profile?.nickname ?? (login.user ? '已登录账号' : '访客')}</strong>
        </div>
        <p role="status">{context.network === 'online' ? '本地练习可用' : '离线模式'}</p>
      </header>
      <div className={styles.noticeSlot}>
        {notice && (
          <div className={styles.notice} role="status">
            <span>{notice}</span>
            <button aria-label="关闭提示" type="button" onClick={() => setNotice(null)}>
              关闭
            </button>
          </div>
        )}
      </div>
      <div className={styles.content}>
        <Routes>
          <Route path="/" element={<LobbyScreen context={context} onNavigate={onNavigate} />} />
          <Route path="/match/:matchId?" element={<MatchRoute context={context} />} />
          <Route path="/login" element={<Suspense fallback={<p role="status">正在载入账号页面…</p>}><AccountScreen context={context} /></Suspense>} />
          <Route path="/account/*" element={<Suspense fallback={<p role="status">正在载入账号页面…</p>}><AccountScreen context={context} /></Suspense>} />
          <Route path="/lineup" element={<Suspense fallback={<p role="status">正在载入阵容页面…</p>}><InventoryScreen context={context} /></Suspense>} />
          <Route path="/growth" element={<FutureRoute context={context} target={{ page: 'growth' }} title="成长" detail="成长内容将在资产与运营任务完成后开放。" />} />
          <Route path="/club" element={<FutureRoute context={context} target={{ page: 'club' }} title="俱乐部" detail="俱乐部功能尚未接入服务端。" />} />
          <Route path="/profile" element={<Suspense fallback={<p role="status">正在载入账号页面…</p>}><AccountScreen context={context} /></Suspense>} />
          <Route path="/settings" element={<PlaceholderScreen title="设置" detail="画质和音频在比赛菜单中调整；安全凭据不会写入普通本地偏好。" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <nav className={styles.mainNav} aria-label="主导航">
        {MAIN_NAV.map((item) => (
          <button
            aria-current={activePage === item.page ? 'page' : undefined}
            className={activePage === item.page ? styles.activeNav : undefined}
            key={item.page}
            type="button"
            onClick={() => onNavigate({ page: item.page })}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </main>
  );
}

function ConnectedApp() {
  useVisualViewportHeight();
  return <Shell context={useNavigationContext()} />;
}
export function WebApp() { return <AccountProvider><PublicLobbyProvider><ConnectedApp /></PublicLobbyProvider></AccountProvider>; }
