import { z } from 'zod';
import { SKILL_EFFECT_POLICIES } from '../../game-core/src/skill-policy';
import { VersionIdSchema } from './configuration';
import { FieldGeometrySchema } from './field';
import { PhysicsConfigSchema } from './physics';
const source = z.string().min(1),
  positive = () => z.number().positive(),
  integer = () => z.number().int().positive();
const points = () => z.number().int().nonnegative();
const pair = () => z.tuple([positive(), positive()]).refine((v) => v[1] >= v[0], 'Multiplier range reversed');
const five = (item: z.ZodNumber) => z.tuple([item, item, item, item, item]);
export const PlayerDefinitionSchema = z.strictObject({
  id: z.string().regex(/^p[0-9]{2,4}$/),
  name: source,
  nameSource: source,
  position: z.enum(['FW', 'MF', 'DF', 'GK']),
  quality: z.enum(['white', 'green', 'blue', 'purple', 'orange']),
  attrs: five(points()),
  growth: five(z.number()),
  skill: source,
  srcId: z
    .string()
    .regex(/^[0-9]+$/)
    .nullable(),
  srcPosition: z.enum(['ST', 'CM', 'DC']).nullable(),
  rarity: integer().max(9).nullable(),
  aliases: z.array(source),
  srcSkill: source.nullable(),
});
const buff = z
  .strictObject({
    type: z.literal('shooterBuff'),
    massMul: positive().optional(),
    speedMul: positive().optional(),
    curveMul: positive().optional(),
  })
  .refine((b) => b.massMul !== undefined || b.speedMul !== undefined || b.curveMul !== undefined, 'Empty buff');
export const SkillDefinitionSchema = z.strictObject({
  id: VersionIdSchema,
  name: source,
  nameSource: source,
  trigger: z.enum(['preturn', 'onShot', 'defense', 'passive']),
  triggerSource: source,
  probability: z.array(z.number().min(0).max(1)).min(1),
  probabilitySource: source,
  durationTurns: z.number().int().nonnegative(),
  durationSource: source.optional(),
  effect: z.union([
    buff,
    z.strictObject({ type: z.literal('ballBoost'), ballSpeedMul: positive(), requireInBox: z.boolean() }),
    z.strictObject({ type: z.literal('sendOffOnHit') }),
    z.strictObject({ type: z.literal('freezeOnHit') }),
    z.strictObject({ type: z.literal('halfMassAura'), massMul: z.array(positive()).min(1) }),
    z.strictObject({ type: z.literal('anchor') }),
    z.strictObject({ type: z.literal('extraAction') }),
  ]),
  effectText: source,
  effectSource: source,
  unlockLevel: integer(),
  unlockSource: source.optional(),
});
export const AttributeMappingSchema = z
  .strictObject({
    version: VersionIdSchema,
    note: source,
    attrMin: z.number(),
    attrMax: z.number(),
    domainSource: source,
    fromAttr: z.strictObject({
      massMul: z.literal('weight'),
      speedMul: z.literal('power'),
      curveMul: z.literal('radian'),
      aimAssist: z.literal('precision'),
      condition: z.literal('mind'),
    }),
    massMul: pair(),
    speedMul: pair(),
    curveMul: pair(),
    aimAssist: pair(),
    rangeSource: source,
    calibration: source,
  })
  .refine((m) => m.attrMax > m.attrMin, 'Attribute domain must have nonzero positive width');
const row = z.strictObject({
  weight: points(),
  power: points(),
  mind: points(),
  radian: points(),
  precision: points(),
});
export const RuntimeLevelTableSchema = z.record(
  z.string().regex(/^[0-9]+$/),
  z.record(z.string().regex(/^(?:[1-9]|10)$/), row),
);
export const RulesDefinitionSchema = z.strictObject({
  version: VersionIdSchema,
  goalsToWin: integer(),
  goalsToWinSource: source,
  matchSeconds: positive(),
  matchSecondsSource: source,
  maxShots: integer(),
  maxShotsNote: source,
  turnSeconds: positive(),
  reconnectSeconds: positive(),
  goalRule: source,
  behindGoalRule: source,
  kickoff: source,
  formationSource: source,
  formation: z
    .array(
      z.strictObject({
        slot: z.number().int().min(0).max(4),
        label: source,
        role: z.enum(['ST', 'CM', 'DC']),
        x: z.number(),
        y: z.number(),
      }),
    )
    .length(5),
  lineDepth: z.strictObject({ DC: positive(), CM: positive(), ST: positive() }),
  originalFormations: z.array(
    z.strictObject({ id: source, name: source, reqLevel: integer(), positions: z.array(source).length(5) }),
  ),
  originalFormationsSource: source,
  defaultLineup: z
    .array(source)
    .length(5)
    .refine((v) => new Set(v).size === v.length, 'Duplicate default player'),
  levels: z.strictObject({
    max: z.literal(10),
    uniformLevel: integer().max(10),
    skillLevelAt: z.array(integer().max(10)).min(1),
  }),
  levelSource: source,
  condition: z.strictObject({
    enabledByDefault: z.boolean(),
    badChanceBase: z.number().min(0).max(1),
    badPenalty: z.number().min(0).max(1),
    penaltySource: source,
  }),
});
const legacyMapping = z.strictObject({
  note: source,
  massMul: pair(),
  speedMul: pair(),
  curveMul: pair(),
  aimAssist: pair(),
  attrMin: z.number(),
  attrMax: z.number(),
});
export const GameDefinitionsSchema = z
  .strictObject({
    geometry: FieldGeometrySchema,
    physics: PhysicsConfigSchema,
    players: z.strictObject({
      version: VersionIdSchema,
      note: source,
      attributes: z.strictObject({ weight: source, power: source, curve: source, accuracy: source, mental: source }),
      attributesSource: source,
      players: z.array(PlayerDefinitionSchema).min(5),
      mapping: legacyMapping,
    }),
    skills: z.strictObject({
      version: VersionIdSchema,
      legend: z.strictObject({ recovered: source, observed: source, rebuilt: source }),
      triggers: z.strictObject({ preturn: source, onShot: source, defense: source, passive: source }),
      skills: z.array(SkillDefinitionSchema),
    }),
    rules: RulesDefinitionSchema,
    mapping: AttributeMappingSchema,
    levels: z.strictObject({ version: VersionIdSchema, players: RuntimeLevelTableSchema }),
  })
  .superRefine((data, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      data.physics.ball.radius * 2 >= data.geometry.goalWidth - 2 * data.geometry.postRadius ||
      data.physics.ball.radius * 2 >= data.geometry.goalDepth ||
      data.physics.disc.radius * 2 >= data.geometry.width
    )
      fail('Collision body cannot fit in field or goal');
    const players = data.players.players,
      skills = data.skills.skills,
      ids = new Set(players.map((p) => p.id)),
      skillIds = new Set(skills.map((s) => s.id)),
      sourceIds = players.flatMap((p) => (p.srcId ? [p.srcId] : []));
    if (ids.size !== players.length || skillIds.size !== skills.length || new Set(sourceIds).size !== sourceIds.length)
      fail('Duplicate player/skill/source ID');
    const { attrMin, attrMax } = data.mapping;
    const inDomain = (n: number) => n >= attrMin && n <= attrMax;
    for (const p of players) {
      if (!skillIds.has(p.skill) && !['none', 'unimplemented'].includes(p.skill)) fail(`Unknown skill for ${p.id}`);
      if (p.skill === 'unimplemented' && (!p.srcSkill || !p.srcId)) fail(`Missing explicit source skill for ${p.id}`);
      if (p.skill === 'none' && p.srcSkill !== null) fail(`Contradictory no-skill marker for ${p.id}`);
      if (!p.attrs.every(inDomain)) fail(`Player attribute outside domain: ${p.id}`);
      if (p.srcId) {
        if (!p.srcPosition || !p.rarity || !data.levels.players[p.srcId])
          fail(`Missing source table or metadata: ${p.id}`);
      } else {
        if (p.srcPosition !== null || p.rarity !== null || p.srcSkill !== null)
          fail(`Rebuilt player claims unsupported source: ${p.id}`);
        for (let level = 1; level <= data.rules.levels.max; level++)
          if (!p.attrs.every((v, i) => inDomain(v + p.growth[i] * (level - 1))))
            fail(`Rebuilt growth outside domain: ${p.id}/${level}`);
      }
    }
    for (const [id, table] of Object.entries(data.levels.players)) {
      if (!sourceIds.includes(id)) fail(`Orphan runtime level table: ${id}`);
      for (let level = 1; level <= data.rules.levels.max; level++) {
        const value = table[String(level)];
        if (!value || !Object.values(value).every(inDomain)) fail(`Missing/out-of-range level row: ${id}/${level}`);
      }
    }
    for (const id of data.rules.defaultLineup) if (!ids.has(id)) fail(`Unknown default player: ${id}`);
    const order = data.rules.levels.skillLevelAt;
    if (order.some((n, i) => i > 0 && n <= order[i - 1])) fail('Skill level thresholds must be strictly increasing');
    for (const s of skills) {
      if (s.unlockLevel > data.rules.levels.max || s.probability.length !== order.length)
        fail(`Invalid skill levels: ${s.id}`);
      if (SKILL_EFFECT_POLICIES[s.effect.type].trigger !== s.trigger) fail(`Unsupported trigger/effect: ${s.id}`);
      if (s.trigger === 'passive' && (s.durationTurns !== 0 || s.probability.some((p) => p !== 1)))
        fail(`Invalid passive semantics: ${s.id}`);
      if (s.trigger !== 'passive' && s.durationTurns < 1) fail(`Invalid active duration: ${s.id}`);
      if (s.effect.type === 'halfMassAura' && s.effect.massMul.length !== order.length)
        fail(`Invalid aura levels: ${s.id}`);
    }
    if (new Set(data.rules.formation.map((p) => p.slot)).size !== 5) fail('Formation slots must be unique');
    for (const p of data.rules.formation)
      if (
        Math.abs(p.x) + data.physics.disc.radius > data.geometry.width / 2 ||
        Math.abs(p.y) + data.physics.disc.radius > data.geometry.length / 2
      )
        fail('Formation outside field');
  });
