import { z } from 'zod';

export const PageLimitSchema = z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/);
export const OpaqueCursorQuerySchema = z.strictObject({
  limit: PageLimitSchema.optional(),
  cursor: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export const ChronologicalCursorSchema = z.strictObject({
  createdAt: z.iso.datetime().refine((value) => !value.startsWith('0000-'), 'PostgreSQL has no year zero'),
  id: z.uuid(),
});
