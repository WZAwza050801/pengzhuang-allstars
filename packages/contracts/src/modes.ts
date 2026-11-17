import { z } from 'zod';
import { VersionIdSchema } from './configuration';

export const ModeIdSchema = z.enum(['practice', 'friend', 'growth', 'ranked']);
export type ModeId = z.infer<typeof ModeIdSchema>;
export type GuestMode = Extract<ModeId, 'practice' | 'friend'>;
const scope = z.enum(['ranked', 'growth']).nullable();
const level = z.number().int().min(1).max(10);
export const ModeDefinitionSchema = z.strictObject({
  label: z.string().min(1).max(40),
  levelPolicy: z.enum(['selectable', 'uniform', 'owned']),
  fixedLevel: level.nullable(),
  requiresOwnership: z.boolean(),
  supportedSkillsOnly: z.boolean(),
  ratingScope: scope,
  rewardScope: scope,
});
export const ModePolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: VersionIdSchema,
    status: z.literal('engineering-default'),
    modes: z.strictObject({
      practice: ModeDefinitionSchema,
      friend: ModeDefinitionSchema,
      growth: ModeDefinitionSchema,
      ranked: ModeDefinitionSchema,
    }),
  })
  .superRefine((policy, ctx) => {
    for (const [id, mode] of Object.entries(policy.modes)) {
      const official = id === 'ranked' || id === 'growth';
      if ((mode.levelPolicy === 'uniform') !== (mode.fixedLevel !== null))
        ctx.addIssue({ code: 'custom', message: `${id}: inconsistent level policy` });
      if (mode.ratingScope !== (official ? id : null) || mode.rewardScope !== (official ? id : null))
        ctx.addIssue({ code: 'custom', message: `${id}: scopes must remain separate` });
      if (official && (!mode.requiresOwnership || !mode.supportedSkillsOnly))
        ctx.addIssue({ code: 'custom', message: `${id}: official cards require ownership and implemented skills` });
    }
  });
export type ModePolicy = z.infer<typeof ModePolicySchema>;

export const ModeRulesSchema = ModeDefinitionSchema.extend({
  schemaVersion: z.literal(1),
  modesVersion: VersionIdSchema,
  mode: ModeIdSchema,
  gameDataVersion: z.string().min(1).max(1024),
  minLevel: z.literal(1),
  maxLevel: z.literal(10),
  skillVersion: VersionIdSchema,
  skillLevelAt: z.tuple([level, level, level]),
  conditionMode: z.literal(false),
  goalsToWin: z.number().int().positive(),
  matchSeconds: z.number().int().positive(),
  turnSeconds: z.number().int().positive(),
  reconnectSeconds: z.number().int().positive(),
  disconnectPolicy: z.literal('finish-shot-clocks-continue'),
  bothDisconnected: z.literal('void'),
  serverFault: z.literal('void'),
  shotLimit: z.literal('void'),
});
export type ModeRules = z.infer<typeof ModeRulesSchema>;
export const ModeOutcomeSchema = z.strictObject({
  mode: ModeIdSchema,
  modesVersion: VersionIdSchema,
  gameDataVersion: z.string().min(1).max(1024),
  verdict: z.enum(['completed', 'forfeit', 'void', 'untrusted']),
  reason: z.string().min(1).max(100),
  winner: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  ratingScope: scope,
  rewardScope: scope,
});
export type ModeOutcome = z.infer<typeof ModeOutcomeSchema>;
