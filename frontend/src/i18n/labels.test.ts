import { describe, expect, it } from 'vitest';
import { accountLabel, categoryLabel } from './labels';

describe('categoryLabel', () => {
  it.each([
    ['Ăn uống', 'Food & dining'],
    ['Nhà ở', 'Housing'],
    ['Mua sắm', 'Shopping'],
    ['Di chuyển', 'Transportation'],
    ['Hóa đơn', 'Bills & utilities'],
    ['Hóa đơn & tiện ích', 'Bills & utilities'],
    ['Giải trí', 'Entertainment'],
    ['Khác', 'Other'],
    ['Chi tiêu khác', 'Other expenses'],
    ['Lương', 'Salary'],
    ['Thưởng', 'Bonus'],
    ['Đầu tư', 'Investments'],
    ['Kinh doanh', 'Business'],
    ['Được tặng', 'Gifts received'],
    ['Thu nhập khác', 'Other income'],
    ['Quà tặng & từ thiện', 'Gifts & charity'],
    ['Sức khỏe', 'Health'],
    ['Giáo dục', 'Education'],
    ['Du lịch', 'Travel'],
    ['Thể thao', 'Fitness'],
    ['Thú cưng', 'Pets'],
    ['Tiết kiệm', 'Savings'],
  ])('translates %s to %s in English', (name, english) => {
    expect(categoryLabel(name, 'en')).toBe(english);
  });

  it('never changes the Vietnamese name in Vietnamese', () => {
    for (const name of ['Ăn uống', 'Lương', 'Custom', '']) expect(categoryLabel(name, 'vi')).toBe(name);
  });

  it('leaves user-created names alone', () => {
    expect(categoryLabel('Cafe với bạn', 'en')).toBe('Cafe với bạn');
    expect(categoryLabel('', 'en')).toBe('');
  });

  it('is case and accent sensitive, so near matches are not translated', () => {
    expect(categoryLabel('ăn uống', 'en')).toBe('ăn uống');
    expect(categoryLabel('An uong', 'en')).toBe('An uong');
  });

  it('does not treat object prototype names as translations', () => {
    expect(categoryLabel('constructor', 'en')).toBe('constructor');
    expect(categoryLabel('toString', 'en')).toBe('toString');
    expect(categoryLabel('__proto__', 'en')).toBe('__proto__');
  });
});

describe('accountLabel', () => {
  it('translates the default cash wallet both ways', () => {
    expect(accountLabel('Tiền mặt', 'en')).toBe('Cash');
    expect(accountLabel('Cash', 'vi')).toBe('Tiền mặt');
  });

  it('keeps the names as they are in their own language', () => {
    expect(accountLabel('Tiền mặt', 'vi')).toBe('Tiền mặt');
    expect(accountLabel('Cash', 'en')).toBe('Cash');
  });

  it.each(['Vietcombank', 'MoMo', 'Techcombank', 'Ví của tôi', ''])('does not translate %j', name => {
    expect(accountLabel(name, 'en')).toBe(name);
    expect(accountLabel(name, 'vi')).toBe(name);
  });
});
