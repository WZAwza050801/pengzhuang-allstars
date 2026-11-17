import type { NavigationContext, NavigationTarget } from '@pengzhuang/client-model';
import styles from './webShell.module.css';

export interface NavigateTarget {
  (target: NavigationTarget): void;
}

export function LobbyScreen({ context, onNavigate }: { context: NavigationContext; onNavigate: NavigateTarget }) {
  return (
    <section className={styles.lobby} aria-labelledby="lobby-title">
      <div className={styles.lobbyLayout}>
        <div className={styles.hero}>
          <p className={styles.eyebrow}>游客可用 · 本地练习</p>
          <h1 id="lobby-title">碰撞全明星</h1>
          <p>5v5 回合制弹射足球。练习模式直接进入对战，不读取或写入账号资产。</p>
          {context.network === 'offline' && <p className={styles.warning}>当前离线：仍可进行本地练习。</p>}
          <div className={styles.stadiumPreview} data-stadium-preview="true" role="img" aria-label="本地练习赛球场展示">
            <div>
              <strong>本地练习</strong>
              <span>3 分钟 · 先进 3 球</span>
            </div>
          </div>
          <div className={styles.actions}>
            <button className="pz-button pz-primary" type="button" onClick={() => onNavigate({ page: 'match', mode: 'practice' })}>
              开始练习
            </button>
            <button className="pz-button" type="button" onClick={() => onNavigate({ page: 'room' })}>
              好友约战
            </button>
          </div>
        </div>
        <aside className={styles.lobbyAside} data-lobby-aside="true" aria-label="大厅辅助信息">
          <section className={styles.asideCard}>
            <h2>本地规则</h2>
            <p>拖拽己方球员后松开即可出手；电脑为普通难度。</p>
          </section>
          <section className={styles.asideCard}>
            <h2>云端内容</h2>
            <p>公告、任务、邮件和真实阵容会在相应服务接入后显示，不以本地示例替代。</p>
          </section>
        </aside>
      </div>
      <section className={styles.infoCard} aria-labelledby="account-title">
        <h2 id="account-title">账号与资产</h2>
        <p>{context.session === 'authenticated' ? '账号已登录，可在“我的”管理设备与账号安全。云端阵容和余额尚未开放。' : '在“我的”登录或注册账号，也可以继续本地练习。云端阵容和余额尚未开放。'}</p>
      </section>
      <section className={styles.infoCard} aria-labelledby="rules-title">
        <h2 id="rules-title">练习规则</h2>
        <p>3 分钟对局，先进 3 球获胜。拖拽己方球员后松开即可出手；电脑为普通难度。</p>
      </section>
    </section>
  );
}

export function PlaceholderScreen({ title, detail }: { title: string; detail: string }) {
  return (
    <section className={styles.placeholder} aria-labelledby="placeholder-title">
      <p className={styles.eyebrow}>页面壳已就绪</p>
      <h1 id="placeholder-title">{title}</h1>
      <p>{detail}</p>
    </section>
  );
}

export function UnavailableScreen({ reason, onBack }: { reason: string; onBack: () => void }) {
  return (
    <section className={styles.placeholder} aria-live="polite">
      <h1>暂时无法进入</h1>
      <p>{reason}</p>
      <button className="pz-button" type="button" onClick={onBack}>
        返回比赛入口
      </button>
    </section>
  );
}
