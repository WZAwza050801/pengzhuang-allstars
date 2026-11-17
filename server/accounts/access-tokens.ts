import { createHmac, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { ApiError } from '../api/http';

export const ACCESS_SECONDS = 15 * 60;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface Principal {
  userId: string;
  sessionId: string;
}

export class AccessTokens {
  private readonly key: Buffer;
  constructor(
    secret: string,
    private readonly issuer: string,
  ) {
    this.key = createHmac('sha256', secret).update('access-signing-v1').digest();
  }
  issue(userId: string, sessionId: string, sessionExpiry: Date): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience('pengzhuang-api')
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(Math.min(now + ACCESS_SECONDS, Math.floor(sessionExpiry.getTime() / 1000)))
      .sign(this.key);
  }
  async verify(token: string): Promise<Principal> {
    try {
      if (token.length > 2048) throw new Error();
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        typ: 'at+jwt',
        issuer: this.issuer,
        audience: 'pengzhuang-api',
        requiredClaims: ['sub', 'sid', 'jti', 'iat', 'exp'],
        maxTokenAge: ACCESS_SECONDS,
      });
      if (
        typeof payload.sub !== 'string' ||
        !UUID.test(payload.sub) ||
        typeof payload.sid !== 'string' ||
        !UUID.test(payload.sid) ||
        typeof payload.jti !== 'string' ||
        !UUID.test(payload.jti) ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp) ||
        payload.exp! <= payload.iat! ||
        payload.exp! - payload.iat! > ACCESS_SECONDS
      )
        throw new Error();
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw new ApiError('UNAUTHENTICATED', 401);
    }
  }
}
