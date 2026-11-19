import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, type JWTPayload } from 'jose';
import { expect, test } from 'vitest';
import { AccessTokens } from '../server/accounts/access-tokens';

test('access tokens verify signatures, mandatory claims, issuer, audience, type, algorithm and expiration', async () => {
  const secret = randomBytes(32).toString('base64url');
  const issuer = 'https://game.example.test';
  const tokens = new AccessTokens(secret, issuer);
  const sub = randomUUID();
  const sid = randomUUID();
  const token = await tokens.issue(sub, sid, new Date(Date.now() + 86_400_000));
  expect(await tokens.verify(token)).toEqual({ userId: sub, sessionId: sid });
  const key = createHmac('sha256', secret).update('access-signing-v1').digest();
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: 'pengzhuang-api', sub, sid, jti: randomUUID(), iat: now, exp: now + 900 };
  for (const change of [
    { exp: now - 1 },
    { aud: 'another-api' },
    { iss: 'https://attacker.example' },
    { sid: undefined },
    { sub: 123 },
    { jti: undefined },
    { iat: now + 60 },
    { exp: now + 901 },
  ]) {
    const invalid = await new SignJWT({ ...claims, ...change } as unknown as JWTPayload)
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .sign(key);
    await expect(tokens.verify(invalid)).rejects.toMatchObject({ status: 401 });
  }
  for (const header of [
    { alg: 'HS384', typ: 'at+jwt' },
    { alg: 'HS256', typ: 'JWT' },
  ]) {
    const invalid = await new SignJWT(claims)
      .setProtectedHeader(header)
      .sign(header.alg === 'HS384' ? Buffer.concat([key, key]) : key);
    await expect(tokens.verify(invalid)).rejects.toMatchObject({ status: 401 });
  }
  const forged = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).sign(randomBytes(32));
  const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  for (const invalid of [forged, unsigned, 'malformed', `${token}extra`])
    await expect(tokens.verify(invalid)).rejects.toMatchObject({ status: 401 });
});
