let incoming: { kind: 'verify' | 'reset' | 'link'; token: string } | null = null;
/** Run before loading the application. Fragments never enter query strings or storage. */
export function captureAccountLink() {
  const match = /^\/account\/(verify|reset|link)$/.exec(location.pathname);
  if (!match) return;
  const token = location.hash.slice(1);
  incoming = { kind: match[1] as 'verify' | 'reset' | 'link', token: /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '' };
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
}
export const readAccountLink = () => incoming;
export function clearAccountLink() {
  incoming = null;
}
