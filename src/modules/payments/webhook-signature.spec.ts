import { signWebhook, verifyWebhookSignature } from './webhook-signature';

describe('webhook signature', () => {
  const body = Buffer.from('{"eventId":"evt_1","orderId":"o1"}');

  it('приймає правильний підпис', () => {
    expect(verifyWebhookSignature(body, signWebhook(body, 's3cret'), 's3cret')).toBe(true);
  });

  it('відхиляє підпис іншим секретом і змінене тіло', () => {
    expect(verifyWebhookSignature(body, signWebhook(body, 'other'), 's3cret')).toBe(false);
    expect(verifyWebhookSignature(Buffer.from('{"eventId":"evt_2"}'), signWebhook(body, 's3cret'), 's3cret')).toBe(false);
  });

  it('відхиляє порожній або не-hex підпис без винятку', () => {
    expect(verifyWebhookSignature(body, undefined, 's3cret')).toBe(false);
    expect(verifyWebhookSignature(body, 'zz', 's3cret')).toBe(false);
  });
});
