// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { FormSelect, Select, type SelectOption } from './Select';

const options: SelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

const trigger = () => screen.getByRole('combobox', { name: 'Letter' });
const listbox = () => screen.getByRole('listbox', { name: 'Letter' });

function setup(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = vi.fn();
  renderApp(<Select label="Letter" value="a" options={options} onChange={onChange} {...props} />);
  return { onChange, user: setupUser() };
}

describe('Select (closed)', () => {
  it('shows the selected option label', () => {
    setup({ value: 'b' });
    expect(trigger()).toHaveTextContent('Beta');
  });

  it('shows the placeholder when nothing matches', () => {
    setup({ value: 'zzz', placeholder: 'Pick one' });
    expect(trigger()).toHaveTextContent('Pick one');
  });

  it('uses a dash as the default placeholder', () => {
    setup({ value: '' });
    expect(trigger()).toHaveTextContent('—');
  });

  it('starts collapsed', () => {
    setup();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('is disabled when asked', () => {
    setup({ disabled: true });
    expect(trigger()).toBeDisabled();
  });

  it('is disabled when there are no options', () => {
    setup({ options: [] });
    expect(trigger()).toBeDisabled();
  });

  it('does not open when disabled', async () => {
    const { user } = setup({ disabled: true });
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('submits its value through a hidden input when it has a name', () => {
    const { container } = renderApp(<Select label="Letter" name="letter" value="b" options={options} onChange={() => undefined} />);
    expect(container.querySelector('input[type=hidden][name=letter]')).toHaveValue('b');
  });

  it('has no hidden input without a name', () => {
    const { container } = renderApp(<Select label="Letter" value="b" options={options} onChange={() => undefined} />);
    expect(container.querySelector('input[type=hidden]')).toBeNull();
  });

  it('shows an option icon next to the label', () => {
    setup({ options: [{ value: 'a', label: 'Alpha', icon: <span data-testid="icon" /> }] });
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});

describe('Select (mouse)', () => {
  it('opens a listbox with every option', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const items = within(listbox()).getAllByRole('option');
    expect(items.map(i => i.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('marks the current value as selected', async () => {
    const { user } = setup({ value: 'b' });
    await user.click(trigger());
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
  });

  it('highlights the current value first', async () => {
    const { user } = setup({ value: 'c' });
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Gamma' }).id);
  });

  it('chooses an option on click, closes, and returns focus to the trigger', async () => {
    const { onChange, user } = setup();
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('can choose the already selected option', async () => {
    const { onChange, user } = setup();
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('closes when the trigger is clicked again', async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes when the user presses somewhere else', async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.click(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes when the page scrolls outside the list', async () => {
    const { user } = setup();
    await user.click(trigger());
    fireEvent.scroll(document);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes when the window is resized', async () => {
    const { user } = setup();
    await user.click(trigger());
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the check mark only on the selected option', async () => {
    const { user } = setup({ value: 'b' });
    await user.click(trigger());
    expect(within(screen.getByRole('option', { name: 'Beta' })).queryByRole('img', { hidden: true }) ?? screen.getByRole('option', { name: 'Beta' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Alpha' }).querySelector('svg')).toBeNull();
  });
});

describe('Select (keyboard)', () => {
  it('opens with ArrowDown', async () => {
    const { user } = setup();
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it.each(['{Enter}', ' ', '{ArrowUp}'])('opens with %j', async key => {
    const { user } = setup();
    trigger().focus();
    await user.keyboard(key);
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves the highlight with the arrow keys and wraps around', async () => {
    const { user } = setup();
    trigger().focus();
    await user.keyboard('{ArrowDown}');          // opens on Alpha
    const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant')!)!.textContent;
    expect(active()).toBe('Alpha');
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe('Beta');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(active()).toBe('Alpha');              // wrapped past Gamma
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe('Gamma');              // wrapped backwards
  });

  it('jumps with Home and End', async () => {
    const { user } = setup({ value: 'b' });
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant')!)!.textContent;
    await user.keyboard('{End}');
    expect(active()).toBe('Gamma');
    await user.keyboard('{Home}');
    expect(active()).toBe('Alpha');
  });

  it('chooses the highlighted option with Enter', async () => {
    const { onChange, user } = setup();
    trigger().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('chooses the highlighted option with Space', async () => {
    const { onChange, user } = setup();
    trigger().focus();
    await user.keyboard('{ArrowDown}{ArrowDown} ');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('closes with Escape without choosing', async () => {
    const { onChange, user } = setup();
    trigger().focus();
    await user.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps Escape from closing a dialog around an open list', async () => {
    const outer = vi.fn();
    renderApp(<div onKeyDown={outer}><Select label="Letter" value="a" options={options} onChange={() => undefined} /></div>);
    const user = setupUser();
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    outer.mockClear();
    await user.keyboard('{Escape}');
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes when Tab moves on', async () => {
    const { user } = setup();
    trigger().focus();
    await user.keyboard('{ArrowDown}{Tab}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('jumps to an option by typing its first letters', async () => {
    const { onChange, user } = setup();
    trigger().focus();
    await user.keyboard('g');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('type-ahead ignores letter case and ignores keys with no match', async () => {
    const { onChange, user } = setup();
    trigger().focus();
    await user.keyboard('B');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('type-ahead combines quick key presses', async () => {
    const many: SelectOption[] = [{ value: '1', label: 'Beta' }, { value: '2', label: 'Bravo' }, { value: '3', label: 'Brave' }];
    const onChange = vi.fn();
    renderApp(<Select label="Letter" value="1" options={many} onChange={onChange} />);
    const user = setupUser();
    trigger().focus();
    await user.keyboard('bra');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('2');
  });
});

describe('FormSelect', () => {
  it('starts at its default value', () => {
    renderApp(<FormSelect label="Letter" name="letter" defaultValue="b" options={options} />);
    expect(trigger()).toHaveTextContent('Beta');
  });

  it('starts at the first option when no default is given', () => {
    renderApp(<FormSelect label="Letter" name="letter" options={options} />);
    expect(trigger()).toHaveTextContent('Alpha');
  });

  it('updates itself and tells the caller', async () => {
    const onChange = vi.fn();
    renderApp(<FormSelect label="Letter" name="letter" options={options} onChange={onChange} />);
    const user = setupUser();
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(trigger()).toHaveTextContent('Gamma');
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('is submitted with the surrounding form', async () => {
    renderApp(<form data-testid="form"><FormSelect label="Letter" name="letter" defaultValue="a" options={options} /></form>);
    const user = setupUser();
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Beta' }));
    const data = new FormData(screen.getByTestId('form') as HTMLFormElement);
    expect(data.get('letter')).toBe('b');
  });
});
