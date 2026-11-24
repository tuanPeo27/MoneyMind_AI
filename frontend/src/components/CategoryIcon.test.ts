import { describe, expect, it } from 'vitest';
import { categoryIcons, getCategoryIcon } from './CategoryIcon';

describe('categoryIcons', () => {
  it('offers 22 icons, each with a label and colour classes', () => {
    const entries = Object.entries(categoryIcons);
    expect(entries).toHaveLength(22);
    for (const [id, entry] of entries) {
      expect(entry.icon, id).toBeDefined();
      expect(entry.label, id).toBeTruthy();
      expect(entry.tone, id).toMatch(/text-\S+ bg-\S+/);
    }
  });

  it('has unique labels', () => {
    const labels = Object.values(categoryIcons).map(i => i.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('getCategoryIcon: explicit icon', () => {
  it.each(Object.keys(categoryIcons))('keeps the known icon id %s', id => {
    expect(getCategoryIcon('anything', id)).toBe(id);
  });

  it('prefers the icon over the name', () => {
    expect(getCategoryIcon('Ăn uống', 'Plane')).toBe('Plane');
  });
});

describe('getCategoryIcon: icons seeded by the backend', () => {
  it.each([
    ['utensils', 'Utensils'],
    ['car', 'Car'],
    ['home', 'Home'],
    ['receipt', 'Zap'],
    ['shopping-bag', 'ShoppingBag'],
    ['gamepad-2', 'Film'],
    ['heart-pulse', 'HeartPulse'],
    ['graduation-cap', 'GraduationCap'],
    ['plane', 'Plane'],
    ['gift', 'Gift'],
    ['ellipsis', 'Tag'],
    ['wallet', 'Wallet'],
    ['award', 'Briefcase'],
    ['trending-up', 'TrendingUp'],
    ['briefcase', 'Briefcase'],
  ])('maps %s to %s', (serverIcon, expected) => {
    expect(getCategoryIcon('', serverIcon)).toBe(expected);
  });

  it('maps every icon name the backend seeds', () => {
    const seeded = ['utensils', 'car', 'home', 'receipt', 'shopping-bag', 'gamepad-2', 'heart-pulse', 'graduation-cap',
      'plane', 'gift', 'ellipsis', 'wallet', 'award', 'trending-up', 'briefcase'];
    for (const name of seeded) expect(Object.keys(categoryIcons)).toContain(getCategoryIcon('', name));
  });
});

describe('getCategoryIcon: guessed from the category name', () => {
  it.each([
    ['Ăn uống', 'Utensils'],
    ['Mua sắm', 'ShoppingBag'],
    ['Di chuyển', 'Car'],
    ['Nhà ở', 'Home'],
    ['Hóa đơn', 'Zap'],
    ['Giải trí', 'Film'],
    ['Lương', 'Briefcase'],
    ['Đầu tư', 'TrendingUp'],
    ['Khác', 'Wallet'],
    ['Sức khỏe', 'HeartPulse'],
    ['Giáo dục', 'GraduationCap'],
    ['Du lịch', 'Plane'],
    ['Quà tặng', 'Gift'],
    ['Thể thao', 'Dumbbell'],
    ['Thú cưng', 'PawPrint'],
    ['Tiết kiệm', 'PiggyBank'],
  ])('maps %s to %s', (name, expected) => {
    expect(getCategoryIcon(name)).toBe(expected);
  });

  it('ignores case and surrounding spaces', () => {
    expect(getCategoryIcon('  ĂN UỐNG  ')).toBe('Utensils');
    expect(getCategoryIcon('lương')).toBe('Briefcase');
  });

  it('falls back to the generic tag for unknown names', () => {
    expect(getCategoryIcon('Something new')).toBe('Tag');
    expect(getCategoryIcon('')).toBe('Tag');
  });

  it('falls back to the name when the icon is unknown', () => {
    expect(getCategoryIcon('Lương', 'not-an-icon')).toBe('Briefcase');
    expect(getCategoryIcon('Unknown', 'not-an-icon')).toBe('Tag');
  });

  it('is not fooled by object prototype property names', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(getCategoryIcon(name)).toBe('Tag');
      expect(getCategoryIcon('x', name)).toBe('Tag');
    }
  });

  it('always returns an icon that exists', () => {
    for (const name of ['Ăn uống', 'Lương', 'zzz', '', 'constructor']) {
      expect(Object.keys(categoryIcons)).toContain(getCategoryIcon(name));
    }
  });
});
