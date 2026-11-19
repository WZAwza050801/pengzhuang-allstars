import type { PublicManifest } from '../../contracts/src/lobby';
import { ACCOUNT_PROTOCOL_VERSION } from '../../../shared/protocol';
export function lobbyService(manifest: PublicManifest): 'ready' | 'maintenance' | 'outdated' {
  return !manifest.protocolVersions.includes(ACCOUNT_PROTOCOL_VERSION)
    ? 'outdated'
    : manifest.maintenance
      ? 'maintenance'
      : 'ready';
}
export function formatLobbyMoney(value: string): string {
  return BigInt(value).toLocaleString('zh-CN');
}
