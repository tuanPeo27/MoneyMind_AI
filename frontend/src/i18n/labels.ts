import type { Language } from './index';

const categoryNames: Record<string, string> = {
  'Ăn uống': 'Food & dining',
  'Nhà ở': 'Housing',
  'Mua sắm': 'Shopping',
  'Di chuyển': 'Transportation',
  'Hóa đơn': 'Bills & utilities',
  'Giải trí': 'Entertainment',
  'Khác': 'Other',
  'Lương': 'Salary',
  'Đầu tư': 'Investments',
  'Sức khỏe': 'Health',
  'Giáo dục': 'Education',
  'Du lịch': 'Travel',
  'Quà tặng': 'Gifts',
  'Thể thao': 'Fitness',
  'Thú cưng': 'Pets',
  'Tiết kiệm': 'Savings',
};

// Display aliases only: stored names, filters and relationships remain unchanged.
export function categoryLabel(name: string, language: Language) {
  return language === 'en' && Object.prototype.hasOwnProperty.call(categoryNames, name)
    ? categoryNames[name]
    : name;
}

export function accountLabel(name: string, language: Language) {
  if (language === 'en' && name === 'Tiền mặt') return 'Cash';
  if (language === 'vi' && name === 'Cash') return 'Tiền mặt';
  return name; // Bank and wallet brand names are not translated.
}
