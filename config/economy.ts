import raw from '../data/economy.json';
import { createHash } from 'node:crypto';
import manifest from './bundled-economy-manifest.json';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import { VersionedRegistry, makeConfigPackage } from './versioned';
import { EconomyBundleManifestSchema, EconomyPolicySchema } from '../packages/contracts/src/economy';
import { economyPricingSnapshot, validateEconomyReferences } from '../packages/game-core/src/economy';
import { freezeSnapshot } from '../packages/game-core/src/snapshot';
import { DEFAULT_DATA } from '../shared/data';
export const ECONOMY_POLICY = freezeSnapshot(EconomyPolicySchema.parse(raw));
validateEconomyReferences(ECONOMY_POLICY, DEFAULT_DATA);

/** Server/tool loader. HTTP clients receive quotes, never a trusted local wallet. */
export function createBundledEconomyConfiguration() {
  const receipt = EconomyBundleManifestSchema.parse(manifest);
  if (
    receipt.economyVersion !== ECONOMY_POLICY.version ||
    receipt.gameDataVersion !== DEFAULT_DATA.version ||
    receipt.sha256 !== createHash('sha256').update(canonicalJson(ECONOMY_POLICY)).digest('hex') ||
    receipt.pricingSha256 !==
      createHash('sha256')
        .update(canonicalJson(economyPricingSnapshot(ECONOMY_POLICY, DEFAULT_DATA)))
        .digest('hex')
  )
    throw new Error('Bundled economy manifest mismatch');
  const registry = new VersionedRegistry(EconomyPolicySchema);
  registry.register(makeConfigPackage(ECONOMY_POLICY.version, ECONOMY_POLICY));
  registry.activate(ECONOMY_POLICY.version);
  return { registry, policy: registry.get() };
}
