// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { makeSession, mockNetwork } from '../test/helpers';
import { setSession } from '../services/session';
import { AccountSecurity } from './AccountSecurity';

beforeEach(() => { setSession(null); });

function setup(options: { hasPassword?: boolean; role?: 'USER' | 'ADMIN'; signedIn?: boolean } = {}) {
  const { hasPassword, role = 'USER', signedIn = true } = options;
  if (signedIn) {
    const base = makeSession();
    setSession({ ...base, user: { ...base.user, email: 'an@x.com', ...(hasPassword === undefined ? {} : { hasPassword }) } });
  }
  renderApp(<AccountSecurity role={role} />);
  return setupUser();
}

const dialog = () => screen.getByRole('dialog');

describe('AccountSecurity', () => {
  it('shows the role badge and the read-only note', () => {
    setup({ role: 'ADMIN' });
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByText('Your role is read-only. Users cannot grant themselves administrator access.')).toBeInTheDocument();
  });

  it('offers to change the password or request a reset link', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('treats sessions saved before the hasPassword field existed as having a password', () => {
    setup({ hasPassword: undefined });
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
  });

  it('hides both actions for an account that signs in with Google', () => {
    setup({ hasPassword: false });
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
    expect(screen.getByText('You sign in with Google, so this account has no password to change or reset.')).toBeInTheDocument();
  });

  it('starts without a dialog or a notice', () => {
    setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('changing the password', () => {
  async function openAndFill(user: ReturnType<typeof setupUser>, values: { current?: string; next?: string; confirm?: string } = {}) {
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const d = within(dialog());
    await user.type(d.getByLabelText('Current password'), values.current ?? 'OldPassword1');
    await user.type(d.getByLabelText('New password (8 or more characters)'), values.next ?? 'NewPassword1');
    await user.type(d.getByLabelText('Confirm new password'), values.confirm ?? 'NewPassword1');
    return d;
  }

  it('opens a dialog with three password fields', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const d = within(dialog());
    expect(d.getByLabelText('Current password')).toHaveAttribute('type', 'password');
    expect(d.getByLabelText('New password (8 or more characters)')).toHaveAttribute('minlength', '8');
    expect(d.getByLabelText('Confirm new password')).toBeRequired();
  });

  it('sends the passwords to the server and thanks the user', async () => {
    const calls = mockNetwork(() => ({ data: { message: 'ok' } }));
    const user = setup();
    const d = await openAndFill(user);
    await user.click(d.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your password has been changed.');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/users/me/password', data: { currentPassword: 'OldPassword1', newPassword: 'NewPassword1' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses mismatching new passwords without calling the server', async () => {
    const calls = mockNetwork(() => ({ data: {} }));
    const user = setup();
    const d = await openAndFill(user, { confirm: 'Different123' });
    await user.click(d.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The new passwords do not match.');
    expect(calls).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the server message and keeps the dialog open', async () => {
    mockNetwork(() => ({ status: 400, data: { detail: 'Mật khẩu hiện tại không đúng.' } }));
    const user = setup();
    const d = await openAndFill(user);
    await user.click(d.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu hiện tại không đúng.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains an unreachable server', async () => {
    mockNetwork(() => new (class extends Error { code = 'ERR_NETWORK'; })());
    const user = setup();
    const d = await openAndFill(user);
    await user.click(d.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('can be cancelled', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears an old error when reopened', async () => {
    mockNetwork(() => ({ status: 400, data: { detail: 'Wrong password' } }));
    const user = setup();
    const d = await openAndFill(user);
    await user.click(d.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('alert');
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('removes the previous success notice when another dialog is opened', async () => {
    mockNetwork(() => ({ data: { message: 'ok' } }));
    const user = setup();
    const d = await openAndFill(user);
    await user.click(d.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('requesting a reset link', () => {
  it('shows the address the link will be sent to', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(within(dialog()).getByText('We will send a password reset link to an@x.com.')).toBeInTheDocument();
  });

  it('asks the server to send the link and confirms', async () => {
    const calls = mockNetwork(() => ({ data: { message: 'ok' } }));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If the email exists, a reset link has been sent.');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/auth/forgot-password', data: { email: 'an@x.com' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error and keeps the dialog open when sending fails', async () => {
    mockNetwork(() => ({ status: 429, data: {} }));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a moment and try again.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('can be cancelled', async () => {
    const calls = mockNetwork(() => ({ data: {} }));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('cannot send a link when signed out', async () => {
    const user = setup({ signedIn: false });
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(within(dialog()).getByRole('button', { name: 'Send reset link' })).toBeDisabled();
  });
});
