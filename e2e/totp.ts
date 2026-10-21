import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

// Authenticator-app codes for tests (RFC 6238: 6 digits, 30-second steps, SHA-1).

function base32(s: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Turn on two-step sign-in from My account. Returns the setup key and backup codes. */
export async function enableTwoStep(page: Page, password: string) {
  await page.goto('/account');
  await page.getByLabel('Password to set up two-step sign-in').fill(password);
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  const secret = (await page.getByLabel('Setup key').textContent())!.trim();
  const codes = (await page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem').allTextContents()).map((c) => c.trim());
  await page.getByLabel('Code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('Two-step sign-in is on')).toBeVisible();
  return { secret, codes };
}
