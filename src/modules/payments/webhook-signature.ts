// HMAC-SHA256 підпис вебхука над сирим тілом запиту. Порівняння timing-safe, щоб не витікала довжина збігу.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhook(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(rawBody: Buffer | string, signatureHex: string | undefined, secret: string): boolean {
  if (!signatureHex || !/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const expected = Buffer.from(signWebhook(rawBody, secret), 'hex');
  const given = Buffer.from(signatureHex, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
