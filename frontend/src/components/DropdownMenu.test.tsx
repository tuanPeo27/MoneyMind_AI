// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { DropdownMenu, MenuHeader, MenuItem, MenuLabel, MenuRadioItem, MenuSeparator } from './DropdownMenu';
import { ThemeIcon } from './ThemeIcon';

beforeEach(() => {
  // jsdom has no layout, so every element reports no client rects and would count as hidden.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});

function setup(extra: Partial<React.ComponentProps<typeof DropdownMenu>> = {}) {
  const one = vi.fn(), two = vi.fn(), three = vi.fn(), radio = vi.fn();
  renderApp(<>
    <button>before</button>
    <DropdownMenu label="Profile menu" trigger={p => <button {...p}>Open</button>} {...extra}>
      <MenuHeader><p>Header text</p></MenuHeader>
      <MenuLabel>Section</MenuLabel>
      <MenuItem onSelect={one}>Alpha</MenuItem>
      <MenuItem onSelect={two} disabled>Beta</MenuItem>
      <MenuItem onSelect={three} keepOpen>Gamma</MenuItem>
      <MenuSeparator />
      <MenuRadioItem checked onSelect={radio}>Light</MenuRadioItem>
      <MenuRadioItem checked={false} onSelect={radio}>Dark</MenuRadioItem>
    </DropdownMenu>
  </>);
  return { one, two, three, radio, user: setupUser() };
}

const trigger = () => screen.getByRole('button', { name: 'Open' });
const menu = () => screen.getByRole('menu', { name: 'Profile menu' });

describe('DropdownMenu', () => {
  it('starts closed', () => {
    setup();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('opens on click and lists its items', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(menu()).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(screen.getAllByRole('menuitemradio').map(i => i.textContent)).toEqual(['Light', 'Dark']);
  });

  it('is rendered into the page body so nothing can clip it', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(menu().parentElement).toBe(document.body);
  });

  it('links the trigger to the menu while open', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-controls', menu().id);
  });

  it('shows header, label and separator content', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(screen.getByText('Header text')).toBeInTheDocument();
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('focuses the checked radio item first', async () => {
    const { user } = setup();
    await user.click(trigger());
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus());
  });

  it('focuses the first item when nothing is checked', async () => {
    renderApp(<DropdownMenu label="Plain" trigger={p => <button {...p}>Open plain</button>}>
      <MenuItem onSelect={() => undefined}>First</MenuItem>
      <MenuItem onSelect={() => undefined}>Second</MenuItem>
    </DropdownMenu>);
    await setupUser().click(screen.getByRole('button', { name: 'Open plain' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus());
  });

  it('closes when the trigger is clicked again', async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.click(trigger());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('runs an action and closes', async () => {
    const { one, user } = setup();
    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: 'Alpha' }));
    expect(one).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('can keep the menu open after an action', async () => {
    const { three, user } = setup();
    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: 'Gamma' }));
    expect(three).toHaveBeenCalledTimes(1);
    expect(menu()).toBeInTheDocument();
  });

  it('ignores disabled items', async () => {
    const { two, user } = setup();
    await user.click(trigger());
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Beta' }));
    expect(two).not.toHaveBeenCalled();
  });

  it('marks the radio choice', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
  });

  it('selects a radio option and closes', async () => {
    const { radio, user } = setup();
    await user.click(trigger());
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(radio).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside press', async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'before' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes when the page scrolls or the window resizes', async () => {
    const { user } = setup();
    await user.click(trigger());
    fireEvent.scroll(document);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(trigger());
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not close when the menu itself scrolls', async () => {
    const { user } = setup();
    await user.click(trigger());
    fireEvent.scroll(menu());
    expect(menu()).toBeInTheDocument();
  });

  describe('keyboard', () => {
    it('opens with ArrowDown on the trigger', async () => {
      const { user } = setup();
      trigger().focus();
      await user.keyboard('{ArrowDown}');
      expect(menu()).toBeInTheDocument();
    });

    // The menu opens on the checked item (Light). Order of enabled items: Alpha, Gamma, Light, Dark (Beta is disabled).
    async function openOnLight() {
      const { user, ...rest } = setup();
      await user.click(trigger());
      await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus());
      return { user, ...rest };
    }

    it('moves between enabled items and wraps around', async () => {
      const { user } = await openOnLight();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();   // wrapped to the start
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveFocus();   // Beta is disabled, so it is skipped
      await user.keyboard('{ArrowUp}{ArrowUp}');
      expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus(); // wrapped to the end
    });

    it('jumps with Home and End', async () => {
      const { user } = await openOnLight();
      await user.keyboard('{End}');
      expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus();
      await user.keyboard('{Home}');
      expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    });

    it('jumps to an item by typing its first letter', async () => {
      const { user } = await openOnLight();
      await user.keyboard('d');
      expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus();
      await user.keyboard('G');
      expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveFocus();
    });

    it('closes with Escape and returns focus to the trigger', async () => {
      const { user } = setup();
      await user.click(trigger());
      await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus());
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      await waitFor(() => expect(trigger()).toHaveFocus());
    });

    it('closes when Tab moves on', async () => {
      const { user } = setup();
      await user.click(trigger());
      await user.keyboard('{Tab}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('activates the focused item with Enter', async () => {
      const { one, user } = setup();
      await user.click(trigger());
      await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus());
      await user.keyboard('{Home}{Enter}');
      expect(one).toHaveBeenCalled();
    });
  });

  it('accepts a class name and alignment', () => {
    renderApp(<DropdownMenu label="m" align="start" className="custom" trigger={p => <button {...p}>Open</button>}><MenuItem onSelect={() => undefined}>x</MenuItem></DropdownMenu>);
    expect(screen.getByRole('button', { name: 'Open' }).parentElement).toHaveClass('custom');
  });
});

describe('ThemeIcon', () => {
  it.each(['light', 'dark', 'system'] as const)('draws the %s icon as decorative artwork', value => {
    const { container } = renderApp(<ThemeIcon value={value} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector(`.theme-${value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'system'}`)).toBeInTheDocument();
  });

  it('draws eight sun rays', () => {
    const { container } = renderApp(<ThemeIcon value="light" />);
    expect(container.querySelectorAll('.theme-sun-rays line')).toHaveLength(8);
  });

  it('gives each instance its own gradient ids so icons never clash', () => {
    const { container } = renderApp(<><ThemeIcon value="dark" /><ThemeIcon value="dark" /></>);
    const ids = [...container.querySelectorAll('linearGradient')].map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('applies a custom size', () => {
    const { container } = renderApp(<ThemeIcon value="light" className="size-10" />);
    expect(container.querySelector('svg')).toHaveClass('size-10');
  });
});
