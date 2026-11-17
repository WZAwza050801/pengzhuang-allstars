import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { beginViewRequest, cancelViewRequest, completeViewRequest, createViewRequestState, type ViewRequestState } from '@pengzhuang/client-model';
import { createHostBridge } from '@pengzhuang/platform';
import { DEFAULT_DATA, FIELD_SKINS } from '../../shared/data';
import { GameView, type GameOptions } from './game';
import { activeLineup, randomLineup } from './lineup';
import { LocalHost } from './localHost';
import styles from './webShell.module.css';

function playerName() {
  return localStorage.getItem('pz_nick')?.trim() || '我';
}

function cardLevels() {
  const stored = Number(localStorage.getItem('pz_card_level'));
  const { max, uniformLevel } = DEFAULT_DATA.rules.levels;
  const level = Number.isInteger(stored) && stored >= 1 && stored <= max ? stored : uniformLevel;
  return new Array<number>(DEFAULT_DATA.rules.formation.length).fill(level);
}

function skinId() {
  const saved = localStorage.getItem('pz_skin');
  return FIELD_SKINS.some((skin) => skin.id === saved) ? saved! : FIELD_SKINS[0].id;
}

export function PracticeMatchScreen() {
  const root = useRef<HTMLDivElement>(null);
  const lifecycle = useRef<ViewRequestState>(createViewRequestState());
  const [request, setRequest] = useState<ViewRequestState>(lifecycle.current);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const hostRoot = root.current;
    if (!hostRoot) return;

    const started = beginViewRequest(lifecycle.current);
    lifecycle.current = started.state;
    setRequest(started.state);
    let active = true;
    const lineup = activeLineup();
    const host = new LocalHost({
      mode: 'bot',
      level: 'normal',
      names: [playerName(), '电脑'],
      lineups: [lineup, randomLineup(lineup)],
      levels: [cardLevels(), null],
      timer: true,
    });
    const bridge = createHostBridge<HTMLElement, { host: LocalHost; options: GameOptions }>(
      (mountRoot, context) => new GameView(mountRoot, context.host, context.options),
    );

    void bridge
      .mount(hostRoot, {
        host,
        options: { skinId: skinId(), onExit: () => navigate('/') },
      })
      .then(() => {
        if (!active) return;
        lifecycle.current = completeViewRequest(lifecycle.current, started.id, { kind: 'ready' });
        setRequest(lifecycle.current);
      })
      .catch((error: unknown) => {
        if (!active) return;
        hostRoot.replaceChildren();
        lifecycle.current = completeViewRequest(lifecycle.current, started.id, {
          kind: 'error',
          message: error instanceof Error ? error.message : '比赛视图无法启动',
        });
        setRequest(lifecycle.current);
      });

    return () => {
      active = false;
      lifecycle.current = cancelViewRequest(lifecycle.current, started.id);
      void bridge.dispose();
    };
  }, [attempt, navigate]);

  return (
    <section className={styles.matchPage} aria-busy={request.status === 'pending'}>
      {request.status === 'error' ? (
      <section className={styles.matchFallback} aria-live="assertive">
        <h1>无法进入练习赛</h1>
        <p>{request.message}</p>
        <div>
          <button className="pz-button pz-primary" type="button" onClick={() => setAttempt((value) => value + 1)}>
            重试
          </button>
          <button className="pz-button" type="button" onClick={() => navigate('/')}>
            返回大厅
          </button>
        </div>
      </section>
      ) : request.status === 'pending' ? (
        <p className={styles.matchLoading}>正在载入练习赛…</p>
      ) : null}
      <div ref={root} className={styles.matchHost} />
    </section>
  );
}
