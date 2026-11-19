import { Component, useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

export class ViewBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  override render() {
    return this.state.failed ? <ViewFailure /> : this.props.children;
  }
}
function ViewFailure() {
  const location = useLocation();
  useEffect(() => {
    document.getElementById('view-failure-title')?.focus();
  }, []);
  return (
    <main className="pz-ui pz-view-failure">
      <h1 id="view-failure-title" tabIndex={-1}>
        页面暂时未能显示
      </h1>
      <p role="alert">可以返回大厅，或联网后重新加载。账号资料和已保存的比赛结果不会被清除。</p>
      <p>进行中的比赛可能仍在计时，请从大厅检查原比赛。</p>
      <div>
        <button className="pz-button" onClick={() => window.location.reload()}>
          重新加载页面
        </button>
        <Link className="pz-button" to="/">
          返回大厅
        </Link>
        <Link className="pz-button" to="/help" state={{ from: location.pathname }}>
          问题与反馈
        </Link>
      </div>
    </main>
  );
}
export function PageFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    const content = document.getElementById('page-content') ?? document.querySelector('main');
    if (!content) return;
    content.scrollTop = 0;
    content.scrollLeft = 0;
    let done = false;
    const focus = () => {
      if (done) return;
      const title = content.querySelector<HTMLElement>('h1');
      if (title) {
        done = true;
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(focus);
    observer.observe(content, { childList: true, subtree: true });
    focus();
    return () => {
      done = true;
      observer.disconnect();
    };
  }, [pathname]);
  return null;
}
