// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { makeSession, mockNetwork } from '../test/helpers';
import { getSession, setSession } from '../services/session';
import SettingsPage from './Settings';
import type { Profile } from '../components/layout/UserLayout';
import type { Theme } from '../hooks/useTheme';

const profile: Profile = { name: 'An', email: 'an@x.com', notifications: true, insights: false };

beforeEach(() => {
  const base = makeSession();
  setSession({ ...base, user: { ...base.user, email: 'an@x.com', timeZoneId: 'Asia/Tokyo' } });
});

function setup(props: Partial<React.ComponentProps<typeof SettingsPage>> = {}) {
  const onSave = vi.fn(), onExport = vi.fn(), setTheme = vi.fn();
  renderApp(<SettingsPage profile={profile} onSave={onSave} onExport={onExport} role="USER" theme={'system' as Theme} setTheme={setTheme} {...props} />);
  return { onSave, onExport, setTheme, user: setupUser() };
}

describe('SettingsPage language', () => {
  it('offers Vietnamese and English with the current one selected', () => {
    setup();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Tiếng Việt' })).not.toBeChecked();
  });

  it('switches the language and remembers it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Tiếng Việt' }));
    expect(screen.getByRole('radio', { name: 'Tiếng Việt' })).toBeChecked();
    expect(localStorage.getItem('mm-language-v1')).toBe('"vi"');
  });
});

describe('SettingsPage appearance', () => {
  it('offers system, light and dark with the current theme selected', () => {
    setup({ theme: 'dark' });
    expect(screen.getByRole('radio', { name: /System/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Light/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Dark/ })).toBeChecked();
  });

  it.each([['Light', 'light'], ['Dark', 'dark'], ['System', 'system']])('choosing %s sets the %s theme', async (label, value) => {
    const { setTheme, user } = setup({ theme: value === 'system' ? 'light' : 'system' });
    await user.click(screen.getByRole('radio', { name: new RegExp(label) }));
    expect(setTheme).toHaveBeenCalledWith(value);
  });
});

describe('SettingsPage preferences', () => {
  it('shows the current switches', () => {
    setup();
    expect(screen.getByRole('switch', { name: 'Notification indicator' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Dashboard insights' })).not.toBeChecked();
  });

  it('toggles a switch', async () => {
    const { user } = setup();
    const toggle = screen.getByRole('switch', { name: 'Dashboard insights' });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it('saves the profile with the new switches', async () => {
    const { onSave, user } = setup();
    await user.click(screen.getByRole('switch', { name: 'Notification indicator' }));
    await user.click(screen.getByRole('switch', { name: 'Dashboard insights' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith({ ...profile, notifications: false, insights: true });
  });

  it('saves unchanged switches as they were', async () => {
    const { onSave, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith(profile);
  });
});

describe('SettingsPage time zone', () => {
  const zone = () => screen.getByRole('combobox', { name: 'Time zone' });
  const save = () => screen.getByRole('button', { name: 'Save time zone' });

  it('shows the time zone of the account', () => {
    setup();
    expect(zone()).toHaveTextContent('Tokyo (UTC+9)');
  });

  it('keeps a saved zone that is not in the short list selectable', () => {
    const base = makeSession();
    setSession({ ...base, user: { ...base.user, timeZoneId: 'Pacific/Auckland' } });
    setup();
    expect(zone()).toHaveTextContent('Pacific/Auckland');
  });

  it('only allows saving after a change', async () => {
    const { user } = setup();
    expect(save()).toBeDisabled();
    await user.click(zone());
    await user.click(screen.getByRole('option', { name: 'London' }));
    expect(save()).toBeEnabled();
  });

  it('saves the chosen time zone on the server and in the session', async () => {
    const calls = mockNetwork(call => call.url === '/users/me/time-zone'
      ? { data: { id: 'u1', fullName: 'An', email: 'an@x.com', timeZoneId: 'Europe/London', roles: ['User'] } }
      : { data: {} });
    const { user } = setup();
    await user.click(zone());
    await user.click(screen.getByRole('option', { name: 'London' }));
    await user.click(save());
    expect(await screen.findByText('Time zone saved.')).toBeInTheDocument();
    expect(calls.find(c => c.url === '/users/me/time-zone')).toMatchObject({ method: 'PUT', data: { timeZoneId: 'Europe/London' } });
    expect(getSession()?.user.timeZoneId).toBe('Europe/London');
  });

  it('says so when saving fails', async () => {
    mockNetwork(() => ({ status: 500, data: {} }));
    const { user } = setup();
    await user.click(zone());
    await user.click(screen.getByRole('option', { name: 'London' }));
    await user.click(save());
    const notice = await screen.findByText('Could not save the time zone.');
    expect(notice).toHaveClass('text-negative');
  });

  it('clears the notice when another zone is picked', async () => {
    mockNetwork(call => call.url === '/users/me/time-zone' ? { data: { timeZoneId: 'Europe/London', id: 'u', fullName: 'a', email: 'a@x.com', roles: [] } } : { data: {} });
    const { user } = setup();
    await user.click(zone());
    await user.click(screen.getByRole('option', { name: 'London' }));
    await user.click(save());
    await screen.findByText('Time zone saved.');
    await user.click(zone());
    await user.click(screen.getByRole('option', { name: 'Sydney' }));
    expect(screen.queryByText('Time zone saved.')).not.toBeInTheDocument();
  });
});

describe('SettingsPage other sections', () => {
  it('exports transactions', async () => {
    const { onExport, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Export transactions' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('includes the account security section with the role', () => {
    setup({ role: 'ADMIN' });
    expect(screen.getByText('Account security')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
  });

  it('lists every section', () => {
    setup();
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    for (const title of ['Language', 'Time zone', 'Appearance', 'Preferences', 'Account security', 'Your data belongs to you']) {
      expect(headings).toContain(title);
    }
  });

  it('can be shown in Vietnamese', () => {
    renderApp(<SettingsPage profile={profile} onSave={() => undefined} onExport={() => undefined} role="USER" theme="system" setTheme={() => undefined} />, { language: 'vi' });
    expect(screen.getByRole('radio', { name: 'Tiếng Việt' })).toBeChecked();
    expect(within(document.body).queryByText('Appearance')).not.toBeInTheDocument();
  });
});
