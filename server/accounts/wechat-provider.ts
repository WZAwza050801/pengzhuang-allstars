import { z } from 'zod';
import { ApiError } from '../api/http';

const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      !/\s/u.test(value) && Array.from(value).every((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127),
  );
const responseSchema = z.object({
  errcode: z.number().int().optional(),
  openid: opaqueId.optional(),
  session_key: z.string().min(1).max(1024).optional(),
});

/** Official code2Session: https://developers.weixin.qq.com/minigame/dev/api-backend/login/api_code2session.html */
export class WechatProvider {
  readonly appId: string;
  readonly #secret: string;
  constructor(
    credentials: { appId: string; secret: string },
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {
    this.appId = credentials.appId;
    this.#secret = credentials.secret;
  }
  async exchange(code: string): Promise<{ openId: string }> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.search = new URLSearchParams({
        appid: this.appId,
        secret: this.#secret,
        js_code: code,
        grant_type: 'authorization_code',
      }).toString();
      const response = await this.request(url, {
        method: 'GET',
        redirect: 'error',
        signal: abort.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok || Number(response.headers.get('content-length')) > 8192) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let length = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 8192) throw new Error();
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const decoded = responseSchema.safeParse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
      );
      if (!decoded.success) throw new Error();
      const data = decoded.data;
      if (data.errcode === 40029) throw new ApiError('UNAUTHENTICATED', 401);
      if (data.errcode === 40226) throw new ApiError('FORBIDDEN', 403);
      if (data.errcode === 45011) throw new ApiError('RATE_LIMITED', 429, true);
      if ((data.errcode !== undefined && data.errcode !== 0) || !data.openid || !data.session_key) throw new Error();
      // session_key stays server-side. UnionID is deliberately not used without verified platform membership.
      return { openId: data.openid };
    } catch (error) {
      abort.abort();
      if (error instanceof ApiError) throw error;
      // Fetch errors may contain the complete URL (including secret/code); never retain their cause.
      throw new ApiError('UNAVAILABLE', 503, true);
    } finally {
      clearTimeout(timer);
    }
  }
}
