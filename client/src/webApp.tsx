import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_FEATURES,
  MAIN_NAV,
  resolveNavigation,
  toWebPath,
  type NavigationContext,
  type NavigationTarget,
} from '@pengzhuang/client-model';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { PracticeMatchScreen } from './matchScreen';
import { LobbyScreen, PlaceholderScreen, UnavailableScreen, type NavigateTarget } from './webScreens';
import styles from './webShell.module.css';

function useNavigationContext(): NavigationContext {
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
    () => ({ session: 'anonymous', network, service: 'ready', features: DEFAULT_FEATURES }),
    [network],
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
  return decision.target.mode === 'practice' ? (
    <PracticeMatchScreen />
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
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(null);
  const onNavigate = useCallback<NavigateTarget>(
    (target) => {
      const decision = resolveNavigation(target, context);
      if (decision.kind === 'show') {
        setNotice(null);
        navigate(toWebPath(decision.target));
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
          : location.pathname.startsWith('/profile') || location.pathname === '/settings'
            ? 'profile'
            : 'lobby';

  return (
    <main className={`${styles.application} pz-ui`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Web 页面壳</p>
          <strong>访客</strong>
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
          <Route path="/login" element={<FutureRoute context={context} target={{ page: 'login' }} title="登录" detail="账号服务将在 ACC 系列任务接入；当前不会创建模拟会话。" />} />
          <Route path="/lineup" element={<FutureRoute context={context} target={{ page: 'lineup' }} title="阵容" detail="持有卡与阵容保存依赖云存档，接入后显示真实数据。" />} />
          <Route path="/growth" element={<FutureRoute context={context} target={{ page: 'growth' }} title="成长" detail="成长内容将在资产与运营任务完成后开放。" />} />
          <Route path="/club" element={<FutureRoute context={context} target={{ page: 'club' }} title="俱乐部" detail="俱乐部功能尚未接入服务端。" />} />
          <Route path="/profile" element={<PlaceholderScreen title="我的" detail="游客可修改本地偏好；账号资料与设备会话随后接入。" />} />
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

export function WebApp() {
  useVisualViewportHeight();
  return <Shell context={useNavigationContext()} />;
}
