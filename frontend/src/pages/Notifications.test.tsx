// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import NotificationsPage from './Notifications';
import type { AppNotification } from '../hooks/useNotifications';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const DAY = 24 * 60;

const item = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1', kind: 'system', message: 'Hello there', time: ago(0), read: false, ...overrides,
});

function setup(items: AppNotification[]) {
  const handlers = { onMarkAllRead: vi.fn(), onMarkRead: vi.fn(), onRemove: vi.fn(), onClear: vi.fn() };
  renderApp(<NotificationsPage items={items} {...handlers} />);
  return { ...handlers, user: setupUser() };
}

describe('NotificationsPage summary', () => {
  it('shows an empty state', () => {
    setup([]);
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.getByText('Activity in your workspace will show up here.')).toBeInTheDocument();
    expect(screen.getByText('You are all caught up.')).toBeInTheDocument();
  });

  it('counts unread notifications', () => {
    setup([item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c', read: true })]);
    expect(screen.getByText('2 unread')).toBeInTheDocument();
  });

  it('says everything is read when nothing is unread', () => {
    setup([item({ read: true })]);
    expect(screen.getByText('You are all caught up.')).toBeInTheDocument();
  });
});

describe('NotificationsPage toolbar', () => {
  it('disables both actions when there is nothing to do', () => {
    setup([]);
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled();
  });

  it('disables mark-all when everything is read but allows clearing', () => {
    setup([item({ read: true })]);
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeEnabled();
  });

  it('marks everything as read', async () => {
    const { onMarkAllRead, user } = setup([item()]);
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it('clears everything', async () => {
    const { onClear, user } = setup([item()]);
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsPage groups', () => {
  it('splits today from earlier', () => {
    setup([item({ id: 'a', message: 'Fresh', time: ago(1) }), item({ id: 'b', message: 'Old news', time: ago(3 * DAY) })]);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Earlier' })).toBeInTheDocument();
  });

  it('hides a group that has no items', () => {
    setup([item({ id: 'b', time: ago(3 * DAY) })]);
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Earlier' })).toBeInTheDocument();
  });

  it('shows Today first', () => {
    setup([item({ id: 'b', time: ago(3 * DAY) }), item({ id: 'a', time: ago(1) })]);
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Today', 'Earlier']);
  });
});

describe('NotificationsPage items', () => {
  it('shows a title with the message below it', () => {
    setup([item({ title: 'Budget alert', message: 'You spent 80%' })]);
    expect(screen.getByText('Budget alert')).toBeInTheDocument();
    expect(screen.getByText('You spent 80%')).toBeInTheDocument();
  });

  it('shows only the message when there is no title', () => {
    setup([item({ message: 'Just text' })]);
    expect(screen.getByText('Just text')).toBeInTheDocument();
  });

  it('fills placeholders in the message', () => {
    setup([item({ message: 'Exported {count} rows', values: { count: 12 } })]);
    expect(screen.getByText('Exported 12 rows')).toBeInTheDocument();
  });

  it('marks unread items with a dot and read items without', () => {
    setup([item({ id: 'a', message: 'Unread one' }), item({ id: 'b', message: 'Read one', read: true })]);
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1);
  });

  it('marks an item read when it is pressed', async () => {
    const { onMarkRead, user } = setup([item({ id: 'abc', message: 'Press me' })]);
    await user.click(screen.getByRole('button', { name: /Press me/ }));
    expect(onMarkRead).toHaveBeenCalledWith('abc');
  });

  it('dismisses one item', async () => {
    const { onRemove, user } = setup([item({ id: 'abc' })]);
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onRemove).toHaveBeenCalledWith('abc');
  });

  it.each(['transaction', 'budget', 'goal', 'category', 'system', 'data'] as const)('renders a %s notification', kind => {
    setup([item({ kind, message: `kind-${kind}` })]);
    expect(screen.getByText(`kind-${kind}`)).toBeInTheDocument();
  });

  it('falls back to the system look for an unknown kind', () => {
    setup([item({ kind: 'mystery' as never, message: 'odd one' })]);
    expect(screen.getByText('odd one')).toBeInTheDocument();
  });
});

describe('NotificationsPage relative time', () => {
  it.each([
    [0, 'Just now'],
    [5, '5 min ago'],
    [59, '59 min ago'],
    [120, '2h ago'],
    [23 * 60, '23h ago'],
    [3 * DAY, '3d ago'],
  ])('shows %i minutes as %s', (minutes, text) => {
    setup([item({ time: ago(minutes) })]);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows a calendar date after a week', () => {
    setup([item({ time: ago(30 * DAY) })]);
    const row = screen.getByText('Hello there').closest('div') as HTMLElement;
    expect(within(row.parentElement as HTMLElement).queryByText(/ago|Just now/)).not.toBeInTheDocument();
  });
});
