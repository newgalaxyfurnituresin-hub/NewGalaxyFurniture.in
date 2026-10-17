import { pbkdf2Sync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from '@/lib/auth/password';

afterEach(() => vi.restoreAllMocks());

function productionCap(): void {
  vi.spyOn(crypto.subtle, 'deriveBits').mockRejectedValue(
    new DOMException(
      'Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).',
      'NotSupportedError',
    ),
  );
}

describe('password compatibility with the hosted Workers native iteration cap', () => {
  it(
    'verifies an existing 600,000-round Node hash without changing its format or work factor',
    { timeout: 20_000 },
    async () => {
      const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
      const password = 'Synthetic 🛋️ compatibility passphrase';
      const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
      const stored = `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
      productionCap();
      expect(await verifyPassword(password, stored)).toBe(true);
      expect(await verifyPassword(`${password}!`, stored)).toBe(false);
    },
  );

  it('creates a full-strength hash that the independent Node PBKDF2 implementation verifies', async () => {
    productionCap();
    const password = 'Synthetic provisioning compatibility';
    const stored = await hashPassword(password);
    const [, , rounds, salt, key] = stored.split('$');
    expect(Number(rounds)).toBe(600_000);
    const expected = pbkdf2Sync(
      password,
      Buffer.from(salt!, 'base64'),
      Number(rounds),
      32,
      'sha256',
    );
    expect(key).toBe(expected.toString('base64'));
  });

  it('does not hide unrelated native crypto failures', async () => {
    vi.spyOn(crypto.subtle, 'deriveBits').mockRejectedValue(new Error('Native crypto unavailable'));
    await expect(hashPassword('Synthetic failure passphrase')).rejects.toThrow(
      'Native crypto unavailable',
    );
  });
});
