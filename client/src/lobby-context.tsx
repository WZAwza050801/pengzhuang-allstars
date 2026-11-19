import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicManifest, LobbyContent } from '../../packages/contracts/src/lobby';
import type { ResourceView, NavigationContext } from '@pengzhuang/client-model';
import { lobbyService } from '../../packages/client-model/src/lobby';
import { useAccount } from './accounts/context';

interface PublicLobby {
  manifest: ResourceView<PublicManifest>;
  announcements: ResourceView<LobbyContent>;
  service: NavigationContext['service'];
  refresh(): Promise<void>;
}
const Context = createContext<PublicLobby>({
  manifest: { tag: 'loading' },
  announcements: { tag: 'loading' },
  service: 'ready',
  async refresh() {},
});
export const usePublicLobby = () => useContext(Context);
export function PublicLobbyProvider({ children }: { children: ReactNode }) {
  const { services } = useAccount();
  const [manifest, setManifest] = useState<ResourceView<PublicManifest>>({ tag: 'loading' });
  const [announcements, setAnnouncements] = useState<ResourceView<LobbyContent>>({ tag: 'loading' });
  const [service, setService] = useState<NavigationContext['service']>('ready');
  const generation = useRef(0);
  const flight = useRef<{ request: number; promise: Promise<void> } | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (!services) return Promise.resolve();
    if (flight.current?.request === generation.current) return flight.current.promise;
    const request = ++generation.current;
    setManifest({ tag: 'loading' });
    setAnnouncements({ tag: 'loading' });
    const promise = Promise.all([services.api.manifest(), services.api.announcements()])
      .then(([config, feed]) => {
        if (request !== generation.current) return;
        if (config.ok) {
          setManifest({ tag: 'ready', data: config.data });
          setService(lobbyService(config.data));
        } else setManifest({ tag: 'error', message: '模式配置暂时无法读取。', retryable: config.error.retryable });
        if (feed.ok) setAnnouncements({ tag: 'ready', data: feed.data });
        else setAnnouncements({ tag: 'error', message: '公告暂时无法读取。', retryable: feed.error.retryable });
      })
      .finally(() => {
        if (flight.current?.request === request) flight.current = null;
      });
    flight.current = { request, promise };
    return promise;
  }, [services]);
  useEffect(() => {
    const update = () => {
      if (!document.hidden && navigator.onLine) void refresh();
    };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      generation.current++;
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refresh]);
  return <Context value={{ manifest, announcements, service, refresh }}>{children}</Context>;
}
