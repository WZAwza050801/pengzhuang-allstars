import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { WechatProvider } from '../server/accounts/wechat-provider';

const credentials = { appId: 'wx0000000000000001', secret: 'private-test-secret' };
test('server code exchange fixes the upstream scope and returns only the verified OpenID', async () => {
  const provider = new WechatProvider(credentials, async (input, init) => {
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe('https://api.weixin.qq.com/sns/jscode2session');
    expect(url.searchParams.get('appid')).toBe(credentials.appId);
    expect(url.searchParams.get('secret')).toBe(credentials.secret);
    expect(url.searchParams.get('js_code')).toBe("code'&appid=attacker");
    expect(url.searchParams.get('grant_type')).toBe('authorization_code');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeDefined();
    return Response.json({
      openid: 'verified-openid',
      session_key: 'never-send-this-key',
      unionid: 'not-qualified-for-merging',
      errcode: 0,
    });
  });
  expect(await provider.exchange("code'&appid=attacker")).toEqual({ openId: 'verified-openid' });
});

test('official failures and malformed upstream responses are bounded and never echo provider details', async () => {
  for (const [body, status] of [
    [{ errcode: 40029, errmsg: credentials.secret }, 401],
    [{ errcode: 40226, errmsg: credentials.secret }, 403],
    [{ errcode: 45011, errmsg: credentials.secret }, 429],
    [{ errcode: -1, errmsg: credentials.secret }, 503],
    [{ errcode: 40013, errmsg: credentials.secret }, 503],
    [{ openid: 123, session_key: 'private' }, 503],
    [{ openid: 'missing-session-key' }, 503],
    [{ openid: 'bad\nidentity', session_key: 'private' }, 503],
  ] as const) {
    const provider = new WechatProvider(credentials, async () => Response.json(body));
    try {
      await provider.exchange('code');
      throw new Error('Expected provider refusal');
    } catch (error) {
      expect(error).toMatchObject({ status });
      expect(String(error)).not.toContain(credentials.secret);
    }
  }
  for (const response of [
    new Response('x'.repeat(8193)),
    new Response('not JSON'),
    new Response('', { status: 302 }),
    new Response('', { status: 500 }),
  ]) {
    await expect(new WechatProvider(credentials, async () => response).exchange('code')).rejects.toMatchObject({
      status: 503,
    });
  }
  await expect(
    new WechatProvider(credentials, async () => {
      throw new Error(`https://upstream/?secret=${credentials.secret}`);
    }).exchange('code'),
  ).rejects.toMatchObject({ message: 'Service unavailable' });
});

test('timeout covers a stalled real HTTP response body and aborts the connection', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const provider = new WechatProvider(
    credentials,
    (_input, init) => fetch(`http://127.0.0.1:${address.port}`, init),
    50,
  );
  try {
    await expect(provider.exchange('code')).rejects.toMatchObject({ status: 503 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
