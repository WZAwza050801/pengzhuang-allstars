export type LifecycleState = 'active' | 'background';
export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  input: 'fine' | 'coarse';
}
export interface AudioService {
  unlock(): Promise<void>;
  play(id: string, value?: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}
export interface CredentialService {
  refreshSession(): Promise<{ accessToken: string; expiresAt: number }>;
  clearSession(): Promise<void>;
}
export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Readonly<Record<string, string>>;
}
export interface SocketHandlers {
  open(): void;
  message(data: string | ArrayBuffer): void;
  error(code: string): void;
  close(code: number): void;
}
export interface NetworkAdapter {
  request(url: string, options?: HttpRequest): Promise<{ status: number; body: unknown }>;
  socket(url: string, handlers: SocketHandlers): { send(data: string | ArrayBuffer): void; dispose(): void };
}
export interface PlatformServices {
  kind: 'web' | 'wechat-game' | 'android' | 'ios';
  storage: {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  /** Account provider is explicitly absent before ACC; no mock token is minted. */
  credentials: CredentialService | null;
  lifecycle: { onChange(fn: (state: LifecycleState) => void): () => void };
  viewport: { read(): Viewport; subscribe(fn: (v: Viewport) => void): () => void };
  audio: AudioService;
  network: NetworkAdapter;
  dispose(): void;
}
export interface HostedView {
  resize(viewport: Viewport): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}
