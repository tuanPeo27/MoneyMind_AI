import { describe, expect, it } from 'vitest';
import { formatPhone, hasInvalidPhoneChars, normalizePhone } from './phone';

describe('phone validation', () => {
  it.each([
    ['0901234567', '0901234567'],
    ['0901 234 567', '0901234567'],
    ['+84 901 234 567', '0901234567'],
    ['84 901 234 567', '0901234567'],
    ['0084901234567', '0901234567'],
    ['02438261234', '02438261234'],
    ['024 3826 1234', '02438261234'],
    ['+1 202 555 0123', '+12025550123'],
    ['', null],
    ['   ', null],
    ['091234567', null],
    ['0612345678', null],
    ['023456789', null],
    ['+84123456789', null],
    ['090123456a', null],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('formats Vietnamese mobile and landline numbers', () => {
    expect(formatPhone('0901234567')).toBe('0901 234 567');
    expect(formatPhone('02438261234')).toBe('024 3826 1234');
  });

  it('rejects letters and symbols while typing', () => {
    expect(hasInvalidPhoneChars('0901abc')).toBe(true);
    expect(hasInvalidPhoneChars('0901-234')).toBe(false);
  });
});
