import { describe, expect, it } from 'vitest';
import { formatPhone, hasInvalidPhoneChars, normalizePhone } from './phone';

describe('normalizePhone: Vietnamese mobile numbers', () => {
  it.each(['03', '05', '07', '08', '09'])('accepts the %s prefix', prefix => {
    expect(normalizePhone(`${prefix}12345678`)).toBe(`${prefix}12345678`);
  });

  it.each(['01', '02', '04', '06'])('rejects the mobile-style prefix %s followed by 8 digits', prefix => {
    const number = `${prefix}12345678`;
    // 02 + 8 digits is too short for a landline (needs 9 after 02), the others are not mobile prefixes.
    expect(normalizePhone(number)).toBeNull();
  });

  it.each([
    ['0901-234-567', '0901234567'],
    ['0901.234.567', '0901234567'],
    ['(0901) 234 567', '0901234567'],
    ['  0901234567  ', '0901234567'],
    ['0901 234\t567', '0901234567'],
  ])('ignores separators in %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['+84901234567', '0901234567'],
    ['+84 90 123 4567', '0901234567'],
    ['0084901234567', '0901234567'],
    ['84901234567', '0901234567'],
    ['+84-901-234-567', '0901234567'],
  ])('converts the country-code form %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['090123456', '09012345678', '0901234', '0'])('rejects the wrong length %j', input => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('rejects a bare 84 prefix that is too short or too long', () => {
    expect(normalizePhone('8490123456')).toBeNull();
    expect(normalizePhone('849012345678')).toBeNull();
  });
});

describe('normalizePhone: Vietnamese landlines', () => {
  it.each([
    ['02438261234', '02438261234'],
    ['0243 826 1234', '02438261234'],
    ['+842438261234', '02438261234'],
    ['02838123456', '02838123456'],
  ])('accepts %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['0243826123', '024382612345'])('rejects the wrong length %j', input => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('normalizePhone: international numbers', () => {
  it.each([
    '+12025550123',
    '+442071838750',
    '+81312345678',
    '+49 30 901820',
    '+1 (202) 555-0123',
  ])('accepts %j', input => {
    expect(normalizePhone(input)).toBe(input.replace(/[\s.\-()]/g, ''));
  });

  it.each([
    '+1234567',        // 7 digits: too short
    '+1234567890123456', // 16 digits: too long
    '+0123456789',     // country code cannot start with 0
    '12025550123',     // missing +
    '+',
  ])('rejects %j', input => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('accepts the shortest and longest E.164 lengths', () => {
    expect(normalizePhone('+12345678')).toBe('+12345678');
    expect(normalizePhone('+123456789012345')).toBe('+123456789012345');
  });

  it('never returns a +84 number in international form', () => {
    expect(normalizePhone('+84123456789')).toBeNull();
    expect(normalizePhone('+84 24 3826 1234')).toBe('02438261234');
  });
});

describe('normalizePhone: junk', () => {
  it.each([
    '', '   ', 'abc', '0901 234 56a', '0901234567x', '09012#4567', '++84901234567', '0901 234 567 ext 5',
  ])('rejects %j', input => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('is idempotent', () => {
    for (const input of ['0901 234 567', '+84 901 234 567', '024 3826 1234', '+1 202 555 0123']) {
      const once = normalizePhone(input)!;
      expect(normalizePhone(once)).toBe(once);
    }
  });
});

describe('hasInvalidPhoneChars', () => {
  it.each(['0901234567', '+84 901 234 567', '(024) 3826-1234', '0901.234.567', '', '   '])('allows %j', input => {
    expect(hasInvalidPhoneChars(input)).toBe(false);
  });

  it.each(['0901a', 'abc', '0901#', '0901_234', '09/01', '0901e5', '😀'])('flags %j', input => {
    expect(hasInvalidPhoneChars(input)).toBe(true);
  });
});

describe('formatPhone', () => {
  it.each([
    ['0901234567', '0901 234 567'],
    ['0351234567', '0351 234 567'],
    ['02438261234', '024 3826 1234'],
    ['02838123456', '028 3812 3456'],
  ])('groups %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });

  it.each(['+12025550123', '123', '', '0901 234 567', 'abc'])('returns %j unchanged', input => {
    expect(formatPhone(input)).toBe(input);
  });

  it('round-trips with normalizePhone', () => {
    const formatted = formatPhone(normalizePhone('+84 901 234 567')!);
    expect(formatted).toBe('0901 234 567');
    expect(normalizePhone(formatted)).toBe('0901234567');
  });
});
