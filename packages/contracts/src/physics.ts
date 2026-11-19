import { z } from 'zod';
const positive = () => z.number().positive();
const nonnegative = () => z.number().nonnegative();
const body = () =>
  z.strictObject({ radius: positive(), mass: positive(), linDamp: nonnegative(), coulomb: nonnegative() });
export const PhysicsConfigSchema = z
  .strictObject({
    version: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    hz: z.number().int().positive(),
    velocityIterations: z.number().int().positive(),
    positionIterations: z.number().int().positive(),
    velocityThreshold: nonnegative(),
    disc: body(),
    ball: body(),
    restitution: z.strictObject({
      discDisc: nonnegative(),
      discBall: nonnegative(),
      discWall: nonnegative(),
      ballWall: nonnegative(),
      net: nonnegative(),
      post: nonnegative(),
    }),
    friction: z.strictObject({ discDisc: nonnegative(), discBall: nonnegative(), wall: nonnegative() }),
    shot: z.strictObject({ vmax: positive(), gamma: positive(), minPower: z.number().min(0).max(1) }),
    curve: z.strictObject({ turnRate: nonnegative(), maxTurnDeg: nonnegative() }),
    spring: z.strictObject({
      restitution: nonnegative(),
      boost: nonnegative(),
      minSpeed: nonnegative(),
      maxSpeed: positive(),
    }),
    stopSpeed: nonnegative(),
    maxSimSeconds: positive(),
    postGoalSeconds: nonnegative(),
    maxBallSpeed: positive(),
    recordHz: z.number().int().positive(),
  })
  .superRefine((p, ctx) => {
    if (p.recordHz > p.hz || p.hz % p.recordHz !== 0)
      ctx.addIssue({ code: 'custom', message: 'Recording rate must divide the fixed physics rate' });
    if (p.spring.minSpeed > p.spring.maxSpeed || p.stopSpeed >= p.maxBallSpeed || p.postGoalSeconds > p.maxSimSeconds)
      ctx.addIssue({ code: 'custom', message: 'Inconsistent simulation limits' });
  });
