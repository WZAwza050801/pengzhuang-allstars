import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_DATA as data } from '../shared/data';
import { levelAttrs, pieceStats, launchSpeed, canonicalJson } from '../packages/game-core/src';
const rows = [];
for (const player of Object.values(data.players))
  for (let level = 1; level <= data.rules.levels.max; level++) {
    const points = levelAttrs(data, player.id, level),
      normal = pieceStats(data, player.id, level),
      bad = pieceStats(data, player.id, level, 1 - data.rules.condition.badPenalty);
    const values = (s: typeof normal) => ({
      massMultiplier: s.massMul,
      speedMultiplier: s.speedMul,
      curveMultiplier: s.curveMul,
      aimFraction: s.aimAssist,
      baseMassKg: data.physics.disc.mass * s.massMul,
      baseFullPowerSpeedMps: launchSpeed(data.physics, 1, s.speedMul),
      skillId: s.skill?.id ?? null,
      skillLevel: s.skillLevel,
    });
    rows.push({
      playerId: player.id,
      level,
      source: player.srcId ? 'source-level-table' : 'rebuilt-growth',
      points,
      normal: values(normal),
      badCondition: values(bad),
    });
  }
const payload = {
  schemaVersion: 1,
  dataVersion: data.version,
  conditionPenalty: data.rules.condition.badPenalty,
  rows,
};
const sha256 = createHash('sha256').update(canonicalJson(payload)).digest('hex');
const next = { ...payload, sha256 };
const target = new URL('../docs/productization/reports/balance-mapping.json', import.meta.url),
  output = JSON.stringify(next, null, 2) + '\n';
if (process.argv.includes('--write')) {
  const old = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
  if (old && old.dataVersion === data.version && old.sha256 !== sha256)
    throw new Error('Bump the relevant numeric/rule component version before changing the frozen mapping');
  writeFileSync(target, output);
} else if (!existsSync(target) || readFileSync(target, 'utf8') !== output)
  throw new Error('Balance mapping snapshot differs; review numeric/rule versions before exporting');
console.log(`Balance mapping frozen: ${rows.length} card/level rows, normal and bad-condition, SHA256=${sha256}`);
