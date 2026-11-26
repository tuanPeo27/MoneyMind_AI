import { describe, expect, it } from 'vitest';
import { vi } from './vi';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const entries = Object.entries(vi);

describe('Vietnamese dictionary', () => {
  it('is a sizeable dictionary', () => {
    expect(entries.length).toBeGreaterThan(500);
  });

  it('has no empty keys or translations', () => {
    const empty = entries.filter(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim()).map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('keeps every placeholder name identical between the English key and the Vietnamese text', () => {
    const mismatched = entries
      .filter(([key, value]) => placeholders(key).join() !== placeholders(value).join())
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('has no stray whitespace around translations', () => {
    const untrimmed = entries.filter(([, value]) => value !== value.trim()).map(([key]) => key);
    expect(untrimmed).toEqual([]);
  });

  it('does not contain unbalanced braces', () => {
    const bad = entries.filter(([key, value]) => {
      const count = (text: string) => [(text.match(/\{/g) ?? []).length, (text.match(/\}/g) ?? []).length];
      const [ko, kc] = count(key), [vo, vc] = count(value);
      return ko !== kc || vo !== vc;
    }).map(([key]) => key);
    expect(bad).toEqual([]);
  });

  it('translates the common placeholder messages', () => {
    expect(vi['Edit {name}']).toBe('Sửa {name}');
    expect(vi['Delete {name}']).toBe('Xóa {name}');
    expect(vi['Showing {count} of {total} transactions']).toBe('Hiển thị {count}/{total} giao dịch');
  });

  it('translates the phone validation messages', () => {
    expect(vi['A phone number can only contain digits, spaces and + ( ) . -']).toBeTruthy();
    expect(vi['Enter a valid phone number, e.g. 0901 234 567 or +84 901 234 567.']).toContain('0901 234 567');
  });

  it('has Vietnamese text (not a copy of the English key) for most entries', () => {
    const unchanged = entries.filter(([key, value]) => key === value).length;
    expect(unchanged / entries.length).toBeLessThan(0.1);
  });
});
