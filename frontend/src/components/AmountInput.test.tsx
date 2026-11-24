// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { vi as dictionary } from '../i18n/vi';
import { AmountInput } from './AmountInput';

const vietnamese = (text: string) => dictionary[text] ?? text;

function setup(props: Partial<React.ComponentProps<typeof AmountInput>> = {}, language: 'en' | 'vi' = 'vi') {
  const { container } = renderApp(<form><AmountInput name="amount" {...props} /></form>, { language });
  const input = screen.getByRole('textbox') as HTMLInputElement;
  const hidden = () => (container.querySelector('input[name=amount]') as HTMLInputElement).value;
  return { input, hidden, user: setupUser() };
}

describe('AmountInput in dong', () => {
  it('starts empty', () => {
    const { input, hidden } = setup();
    expect(input).toHaveValue('');
    expect(hidden()).toBe('');
  });

  it('groups digits as you type and submits the plain number', async () => {
    const { input, hidden, user } = setup();
    await user.type(input, '1234567');
    expect(input).toHaveValue('1.234.567');
    expect(hidden()).toBe('1234567');
  });

  it.each([
    ['5', '5'],
    ['999', '999'],
    ['1000', '1.000'],
    ['100000000', '100.000.000'],
  ])('shows %s as %s', async (typed, shown) => {
    const { input, user } = setup();
    await user.type(input, typed);
    expect(input).toHaveValue(shown);
  });

  it('refuses letters, shows a message and keeps the digits', async () => {
    const { input, hidden, user } = setup();
    await user.type(input, '12abc3');
    expect(input).toHaveValue('123');
    expect(hidden()).toBe('123');
    expect(screen.getByRole('alert')).toHaveTextContent(vietnamese('Only numbers can be entered here.'));
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses the letter e', async () => {
    const { input, user } = setup();
    await user.type(input, '1e5');
    expect(input).toHaveValue('15');
  });

  it('does not warn for valid input', async () => {
    const { input, user } = setup();
    await user.type(input, '1500');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('accepts typed separators but regroups them', async () => {
    const { input, hidden, user } = setup();
    await user.type(input, '1,000');
    expect(input).toHaveValue('1.000');
    expect(hidden()).toBe('1000');
  });

  it('has no decimals in dong', async () => {
    const { input, hidden, user } = setup();
    await user.type(input, '12.5');
    expect(input).toHaveValue('125');
    expect(hidden()).toBe('125');
  });

  it('strips leading zeros', async () => {
    const { input, hidden, user } = setup();
    await user.type(input, '007');
    expect(input).toHaveValue('7');
    expect(hidden()).toBe('7');
  });

  it('allows at most 12 digits', async () => {
    const { input, user } = setup();
    await user.type(input, '1234567890123456');
    expect(input).toHaveValue('123.456.789.012');
  });

  it('can be cleared', async () => {
    const { input, hidden, user } = setup();
    await user.type(input, '500');
    await user.clear(input);
    expect(input).toHaveValue('');
    expect(hidden()).toBe('');
  });

  it('shows the default value, grouped, and submits it unchanged', () => {
    const { input, hidden } = setup({ defaultValue: 1_500_000 });
    expect(input).toHaveValue('1.500.000');
    expect(hidden()).toBe('1500000');
  });

  it('shows a VND badge', () => {
    setup();
    expect(screen.getByText('VND')).toBeInTheDocument();
  });

  it('uses the numeric keyboard on phones', () => {
    const { input } = setup();
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('type', 'text');
  });

  it('is required when asked', () => {
    const { input } = setup({ required: true });
    expect(input).toBeRequired();
  });

  it('accepts a placeholder', () => {
    const { input } = setup({ placeholder: 'Amount' });
    expect(input).toHaveAttribute('placeholder', 'Amount');
  });

  it('defaults the placeholder to 0', () => {
    const { input } = setup();
    expect(input).toHaveAttribute('placeholder', '0');
  });

  it('marks a zero amount as invalid with a message', async () => {
    const { input, user } = setup();
    await user.type(input, '0');
    expect(input.validity.customError).toBe(true);
    expect(input.validationMessage).toBe(vietnamese('Enter an amount greater than 0.'));
  });

  it('accepts an amount at or above the minimum', async () => {
    const { input, user } = setup({ minVnd: 1000 });
    await user.type(input, '999');
    expect(input.validity.customError).toBe(true);
    await user.clear(input);
    await user.type(input, '1000');
    expect(input.validity.customError).toBe(false);
  });

  it('does not complain about an empty box (required handles that)', () => {
    const { input } = setup();
    expect(input.validity.customError).toBe(false);
  });

  it('is part of the form data under its name', () => {
    const { container } = renderApp(<form data-testid="f"><AmountInput name="price" defaultValue={42000} /></form>, { language: 'vi' });
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(Number(data.get('price'))).toBe(42000);
  });
});

describe('AmountInput in US dollars', () => {
  it('shows a USD badge and a decimal keyboard', () => {
    const { input } = setup({}, 'en');
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('placeholder', '0.00');
  });

  it('groups with commas and submits the amount in dong', async () => {
    const { input, hidden, user } = setup({}, 'en');
    await user.type(input, '1234.56');
    expect(input).toHaveValue('1,234.56');
    expect(hidden()).toBe(String(Math.round(1234.56 * 26000)));
  });

  it('limits decimals to two places', async () => {
    const { input, user } = setup({}, 'en');
    await user.type(input, '1.239');
    expect(input).toHaveValue('1.23');
  });

  it('accepts only one decimal point', async () => {
    const { input, user } = setup({}, 'en');
    await user.type(input, '1.2.3');
    expect(input).toHaveValue('1.23');
  });

  it('shows a lone decimal point as 0.', async () => {
    const { input, user } = setup({}, 'en');
    await user.type(input, '.');
    expect(input).toHaveValue('0.');
  });

  // KNOWN BUG: after "." becomes "0." the caret is put before the dot, so the next digit lands in front of it
  // ("5." instead of "0.5"). Remove `.fails` once AmountInput keeps the caret after the dot.
  it.fails('keeps typing after a leading decimal point (".5" should give "0.5")', async () => {
    const { input, user } = setup({}, 'en');
    await user.type(input, '.5');
    expect(input).toHaveValue('0.5');
  });

  it('converts dollars to dong with the current rate', async () => {
    const { input, hidden, user } = setup({}, 'en');
    await user.type(input, '2');
    expect(hidden()).toBe('52000');
  });

  it('shows a dong default value in dollars but submits it unchanged until edited', () => {
    const { input, hidden } = setup({ defaultValue: 26_000 }, 'en');
    expect(input).toHaveValue('1.00');
    expect(hidden()).toBe('26000');
  });
});
