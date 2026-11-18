import type { NavigationContext, NavigationTarget } from '@pengzhuang/client-model';
import styles from './webShell.module.css';
import { useState } from 'react';
import type { ModeId } from '../../packages/contracts/src/modes';
import { describeModeRules } from '../../config/modes';
import { usePublicLobby } from './lobby-context';
import { LobbyAccountPanel } from './lobby-account';
import { practiceScreenLoaded } from './practice-entry';

export interface NavigateTarget {
  (target: NavigationTarget): void;
}

export function LobbyScreen({ context, onNavigate }: { context: NavigationContext; onNavigate: NavigateTarget }) {
  const lobby = usePublicLobby();
  const [selected, setSelected] = useState<ModeId>('practice');
  const manifest = lobby.manifest.tag === 'ready' ? lobby.manifest.data : null;
  const rules = manifest?.modes.find((mode) => mode.mode === selected);
  return (
    <section className={styles.lobby} aria-labelledby="lobby-title">
      {(context.service !== 'ready' || context.network === 'offline') && <section className={styles.infoCard} role="status">
        <h2>{context.service === 'outdated' ? '客户端版本过旧' : context.service === 'maintenance' ? '服务维护中' : '当前离线'}</h2>
        <p>{context.service === 'outdated' ? '当前客户端不兼容服务端协议，请刷新获取新版本。' : context.service === 'maintenance' ? '正式服务暂时维护，本地练习仍然可用。' : '云端余额和公告可能无法更新，本地练习仍然可用。'}</p>
        <button className="pz-button" onClick={() => { if (context.service === 'outdated') window.location.reload(); else void lobby.refresh(); }}>{context.service === 'outdated' ? '刷新客户端' : '重新检查服务'}</button>
      </section>}
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
            <button className="pz-button pz-primary" type="button" disabled={context.network === 'offline' && !practiceScreenLoaded()} onClick={() => onNavigate({ page: 'match', mode: 'practice' })}>
              开始练习
            </button>
            <button className="pz-button" type="button" onClick={() => onNavigate({ page: 'room' })}>
              好友约战
            </button>
            {context.features.matchmaking && (
              <button className="pz-button" type="button" disabled={context.session === 'loading'} onClick={() => onNavigate({ page: 'queue', mode: 'friend' })}>
                匹配对手
              </button>
            )}
          </div>
          {context.network === 'offline' && !practiceScreenLoaded() && <p>练习资源尚未载入，请联网后先进入一次练习。</p>}
          {lobby.manifest.tag === 'loading' && <p role="status">正在读取服务端模式规则…</p>}
          {lobby.manifest.tag === 'error' && <p role="status">{lobby.manifest.message}<button className="pz-button" onClick={() => void lobby.refresh()}>重读模式规则</button></p>}
          {manifest && <>
            <div className={styles.actions} role="group" aria-label="比赛模式">
              {manifest.modes.map((mode) => <button className="pz-button" key={mode.mode} aria-pressed={selected === mode.mode} onClick={() => setSelected(mode.mode)}>{mode.label}</button>)}
            </div>
            {rules && <p data-mode-summary="true">{describeModeRules(rules)}</p>}
            {selected !== 'practice' && <p role="status">该正式模式尚未开放，已保留当前选择供查看规则。可先开始练习。</p>}
          </>}
        </div>
        <aside className={styles.lobbyAside} data-lobby-aside="true" aria-label="大厅辅助信息">
          <section className={styles.asideCard}>
            <h2>本地规则</h2>
            <p>拖拽己方球员后松开即可出手；电脑为普通难度。</p>
          </section>
          <section className={styles.asideCard}>
            <h2>账号安全</h2>
            <p>可在“我的”查看登录设备、管理绑定和导入旧偏好。</p>
          </section>
        </aside>
      </div>
      <LobbyAccountPanel onNavigate={onNavigate} />
      <section className={styles.infoCard} aria-labelledby="announcements-title">
        <h2 id="announcements-title">公告</h2>
        {lobby.announcements.tag === 'loading' && <p role="status">正在读取公告…</p>}
        {lobby.announcements.tag === 'error' && <><p role="status">{lobby.announcements.message}</p><button className="pz-button" onClick={() => void lobby.refresh()}>重新读取公告</button></>}
        {lobby.announcements.tag === 'ready' && (lobby.announcements.data.announcements.length ? lobby.announcements.data.announcements.map((item) => <article key={item.id}><h3>{item.title}</h3><p className={styles.announcementBody}>{item.body}</p><time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleString('zh-CN')}</time></article>) : <p>暂无公告。</p>)}
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
