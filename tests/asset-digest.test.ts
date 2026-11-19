import { test, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assetDigest } from '../client/src/assets';
test('LAN fallback computes exactly the same SHA-256 as the native implementation', async () => {
  for (const bytes of [new Uint8Array(), new TextEncoder().encode('abc'), new Uint8Array(1024 * 1024).fill(97)]) {
    const expected = createHash('sha256').update(bytes).digest('hex');
    try {
      vi.stubGlobal('crypto', undefined);
      expect(await assetDigest(bytes)).toBe(expected);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await assetDigest(bytes)).toBe(expected);
  }
});
