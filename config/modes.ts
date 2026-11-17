import policy from './mode-policy.json';
import archivedPolicy from './mode-archive/modes-1.json';
import { ModePolicySchema, ModeRulesSchema, type ModeId, type ModeRules } from '../packages/contracts/src/modes';
import { canonicalJson, freezeSnapshot } from '../packages/game-core/src/snapshot';
import type { GameData } from '../shared/data';

export const MODE_POLICY = freezeSnapshot(ModePolicySchema.parse(policy));
const archives = new Map([[archivedPolicy.version, freezeSnapshot(ModePolicySchema.parse(archivedPolicy))]]);
if (
  archives.has(MODE_POLICY.version) &&
  canonicalJson(archives.get(MODE_POLICY.version)) !== canonicalJson(MODE_POLICY)
)
  throw new Error('Mode archive version conflict');
archives.set(MODE_POLICY.version, MODE_POLICY);
export function rulesForMode(data: GameData, mode: ModeId, modesVersion = MODE_POLICY.version): ModeRules {
  const selected = archives.get(modesVersion);
  if (!selected) throw new Error('Mode archive unavailable');
  return freezeSnapshot(
    ModeRulesSchema.parse({
      ...selected.modes[mode],
      schemaVersion: 1,
      modesVersion: selected.version,
      mode,
      gameDataVersion: data.version,
      minLevel: 1,
      maxLevel: data.rules.levels.max,
      skillVersion: data.version.split('/')[3],
      skillLevelAt: data.rules.levels.skillLevelAt,
      conditionMode: false,
      goalsToWin: data.rules.goalsToWin,
      matchSeconds: data.rules.matchSeconds,
      turnSeconds: data.rules.turnSeconds,
      reconnectSeconds: data.rules.reconnectSeconds,
      disconnectPolicy: 'finish-shot-clocks-continue',
      bothDisconnected: 'void',
      serverFault: 'void',
      shotLimit: 'void',
    }),
  );
}
export function verifyModeRules(data: GameData, input: unknown): ModeRules {
  const parsed = ModeRulesSchema.parse(input);
  const expected = rulesForMode(data, parsed.mode, parsed.modesVersion);
  if (canonicalJson(expected) !== canonicalJson(parsed)) throw new Error('Mode rules mismatch');
  return expected;
}
export function describeModeRules(rules: ModeRules): string {
  const levels =
    rules.fixedLevel === null
      ? rules.levelPolicy === 'owned'
        ? '持有等级'
        : '自由等级'
      : `统一 Lv${rules.fixedLevel}`;
  return `${rules.label} · ${levels} · ${rules.matchSeconds}秒 / 先进${rules.goalsToWin}球 · 回合${rules.turnSeconds}秒 · 重连${rules.reconnectSeconds}秒 · ${rules.ratingScope ?? '不计排位'} · ${rules.rewardScope ? '服务端结算奖励' : '无正式奖励'}`;
}
