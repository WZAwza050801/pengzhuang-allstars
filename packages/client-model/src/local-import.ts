import { LocalImportCommandSchema, type LocalImportCommand } from '../../contracts/src/local-import';
import { parseNickname, parseSkin, isRecord } from '../../contracts/src/game-validation';
import { DEFAULT_DATA } from '../../../shared/data';

/** Reads only supported legacy preferences. Asset, credential and server keys are never copied. */
export function inspectLegacyStorage(storage: { getItem(key: string): string | null }): {
  command: LocalImportCommand | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const read = (key: string) => {
    try {
      const value = storage.getItem(key);
      if (value !== null && value.length > 20000) {
        warnings.push('一项旧设置过大，已跳过。');
        return null;
      }
      return value;
    } catch {
      warnings.push('无法读取一项本地设置，请检查浏览器存储权限。');
      return null;
    }
  };
  const settings: LocalImportCommand['settings'] = {};
  const skin = read('pz_skin');
  if (skin !== null) {
    if (parseSkin(skin).ok) settings.skinId = skin;
    else warnings.push('旧球场设置无效，已跳过。');
  }
  const muted = read('pz_muted');
  if (muted === '0' || muted === '1') settings.muted = muted === '1';
  else if (muted !== null) warnings.push('旧声音设置无效，已跳过。');
  const rawNickname = read('pz_nick');
  const nickname = rawNickname === null ? null : parseNickname(rawNickname);
  if (nickname && !nickname.ok) warnings.push('旧昵称无效，已跳过。');
  const lineups: LocalImportCommand['lineups'] = [];
  let activeLineup: number | null = null;
  const raw = read('pz_lineups');
  if (raw !== null) {
    try {
      const old: unknown = JSON.parse(raw);
      if (!isRecord(old) || !Array.isArray(old.sets) || old.sets.length > 3) throw new Error('Invalid sets');
      for (const [slot, ids] of old.sets.entries()) {
        if (
          Array.isArray(ids) &&
          ids.length === 5 &&
          new Set(ids).size === 5 &&
          ids.every((id) => typeof id === 'string' && Object.hasOwn(DEFAULT_DATA.players, id))
        )
          lineups.push({ slot, playerDefIds: [...ids] });
        else warnings.push('一套旧阵容格式或球员无效，已跳过。');
      }
      if (typeof old.active === 'number' && lineups.some((set) => set.slot === old.active)) activeLineup = old.active;
    } catch {
      warnings.push('旧阵容存档损坏，已跳过。');
    }
  }
  const command = LocalImportCommandSchema.safeParse({
    version: 'pz-local-v1',
    settings,
    nicknameDraft: nickname?.ok ? nickname.value : null,
    lineups,
    activeLineup,
  });
  return { command: command.success ? command.data : null, warnings };
}
