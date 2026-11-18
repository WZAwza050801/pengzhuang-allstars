import { z } from 'zod';
import { MoneySchema, SignedMoneySchema } from '../../packages/contracts/src/money';
import { fingerprint } from './snapshot';
import { ApiError } from '../api/http';

const base = {
  caseId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_:./-]{0,99}$/)
    .transform((value) => value.toUpperCase()),
  reason: z.string().trim().min(1).max(500),
};
const owner = { userId: z.uuid().transform((value) => value.toLowerCase()), currency: z.enum(['coins', 'fragments']) };
export const RepairCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, ...owner, kind: z.literal('restore-wallet') }),
  z.strictObject({
    ...base,
    ...owner,
    kind: z.literal('compensate'),
    delta: SignedMoneySchema.refine((value) => value !== '0'),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('retry-settlement'),
    matchId: z.uuid().transform((value) => value.toLowerCase()),
  }),
]);
const revision = z.number().int().min(0).max(2147483647);
export const WalletRepairPreviewSchema = z.strictObject({
  type: z.literal('wallet'),
  beforeBalance: MoneySchema,
  afterBalance: MoneySchema,
  beforeRevision: revision,
  afterRevision: revision,
  adjustmentDelta: SignedMoneySchema,
  ledgerDelta: SignedMoneySchema,
});
export const SettlementRepairPreviewSchema = z.strictObject({
  type: z.literal('settlement'),
  eventId: z.uuid(),
  beforeAttempts: revision,
  afterAttempts: z.literal(0),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const RepairPlanSchema = z
  .strictObject({
    format: z.literal(1),
    id: z.uuid(),
    database: z.string().min(1).max(128),
    createdAt: z.iso.datetime(),
    command: RepairCommandSchema,
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    preview: z.discriminatedUnion('type', [WalletRepairPreviewSchema, SettlementRepairPreviewSchema]),
  })
  .refine((plan) => (plan.command.kind === 'retry-settlement') === (plan.preview.type === 'settlement'));
export type RepairCommand = z.infer<typeof RepairCommandSchema>;
export type WalletRepairCommand = Exclude<RepairCommand, { kind: 'retry-settlement' }>;
export type WalletRepairPreview = z.infer<typeof WalletRepairPreviewSchema>;
export type SettlementRepairPreview = z.infer<typeof SettlementRepairPreviewSchema>;
export type RepairPlan = z.infer<typeof RepairPlanSchema>;
export function parseMaintenance<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError('INVALID_REQUEST', 400);
  return parsed.data;
}
export const repairHash = (value: unknown) => fingerprint(parseMaintenance(RepairPlanSchema, value));
