// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';

vi.mock('../lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth')>('../lib/auth');
  return {
    ...actual,
    login: vi.fn(), register: vi.fn(), forgotPassword: vi.fn(), resetPassword: vi.fn(), loginWithGoogle: vi.fn(),
  };
});

// Google sign-in depends on VITE_GOOGLE_CLIENT_ID, read when GoogleButton is imported. A developer's
// frontend/.env.local usually sets it, so fix it here: these tests run as "no client id configured" everywhere.
vi.mock('../components/GoogleButton', () => ({ googleSignInEnabled: false, GoogleButton: () => null }));
import * as auth from '../lib/auth';
import { AuthPages, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, authPaths } from './Auth';

const api = auth as unknown as Record<'login' | 'register' | 'forgotPassword' | 'resetPassword', ReturnType<typeof vi.fn>>;
const session = (roles: string[] = ['User']) => ({ user: { roles } });

beforeEach(() => {
  for (const name of ['login', 'register', 'forgotPassword', 'resetPassword'] as const) api[name].mockReset();
  window.history.pushState({}, '', '/');
});

const submit = (name: RegExp | string) => screen.getByRole('button', { name });

describe('authPaths', () => {
  it('lists the four public pages', () => {
    expect(authPaths).toEqual(['/login', '/register', '/forgot-password', '/reset-password']);
  });
});

describe('LoginPage', () => {
  function setup() {
    const navigate = vi.fn();
    renderApp(<LoginPage navigate={navigate} />);
    return { navigate, user: setupUser() };
  }

  it('shows the sign-in form', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(submit('Sign in')).toBeInTheDocument();
  });

  it('asks for a valid email and a password before calling the server', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(submit('Sign in'));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.login).not.toHaveBeenCalled();
  });

  it.each(['', 'a@b', '@b.com', 'a b@c.com', 'a@b .com'])('rejects the email %j', async email => {
    const { user } = setup();
    if (email) await user.type(screen.getByLabelText('Email'), email);
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(submit('Sign in'));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('signs in with a trimmed email and goes to the dashboard', async () => {
    api.login.mockResolvedValue(session());
    const { navigate, user } = setup();
    await user.type(screen.getByLabelText('Email'), '  an@x.com ');
    await user.type(screen.getByLabelText('Password'), 'Secret123');
    await user.click(submit('Sign in'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', true));
    expect(api.login).toHaveBeenCalledWith('an@x.com', 'Secret123');
  });

  it('sends administrators to the admin area', async () => {
    api.login.mockResolvedValue(session(['Admin']));
    const { navigate, user } = setup();
    await user.type(screen.getByLabelText('Email'), 'admin@x.com');
    await user.type(screen.getByLabelText('Password'), 'Secret123');
    await user.click(submit('Sign in'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin', true));
  });

  it('shows a busy state while signing in', async () => {
    let finish!: (value: unknown) => void;
    api.login.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { user } = setup();
    await user.type(screen.getByLabelText('Email'), 'an@x.com');
    await user.type(screen.getByLabelText('Password'), 'Secret123');
    await user.click(submit('Sign in'));
    expect(await screen.findByRole('button', { name: 'Signing in...' })).toBeDisabled();
    finish(session());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
  });

  describe.each([
    ['unreachable server', () => new auth.ApiError('NETWORK', 0), 'Cannot reach the server. Check your connection and try again.'],
    ['rate limiting', () => new auth.ApiError('x', 429), 'Too many attempts. Please wait a moment and try again.'],
    ['server error', () => new auth.ApiError('x', 500), 'Something went wrong on our side. Please try again later.'],
    ['bad gateway', () => new auth.ApiError('x', 502), 'Something went wrong on our side. Please try again later.'],
    ['missing endpoint', () => new auth.ApiError('REQUEST_FAILED', 404), 'This feature is not available on the server yet. Restart or update the backend.'],
    ['internal code', () => new auth.ApiError('TIMEOUT', 400), 'Something went wrong. Please try again.'],
    ['readable message', () => new auth.ApiError('Mật khẩu không đúng.', 401), 'Mật khẩu không đúng.'],
    ['readable 404', () => new auth.ApiError('Tài khoản này không tồn tại.', 404), 'Tài khoản này không tồn tại.'],
    ['unexpected error', () => new Error('boom'), 'Something went wrong. Please try again.'],
  ])('when the server fails with %s', (_name, makeError, message) => {
    it(`shows "${message}"`, async () => {
      api.login.mockRejectedValue(makeError());
      const { navigate, user } = setup();
      await user.type(screen.getByLabelText('Email'), 'an@x.com');
      await user.type(screen.getByLabelText('Password'), 'Secret123');
      await user.click(submit('Sign in'));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    });
  });

  it('shows and hides the password', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('links to registration and to password recovery', async () => {
    const { navigate, user } = setup();
    await user.click(screen.getByRole('link', { name: 'Create account' }));
    expect(navigate).toHaveBeenLastCalledWith('/register');
    await user.click(screen.getByRole('link', { name: 'Forgot password?' }));
    expect(navigate).toHaveBeenLastCalledWith('/forgot-password');
  });

  it('switches the language and remembers it', async () => {
    const { user } = setup();
    const group = screen.getByRole('group', { name: 'Language' });
    expect(group).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'VI' }));
    expect(screen.getByRole('button', { name: 'VI' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('mm-language-v1')).toBe('"vi"');
  });

  it('does not show the Google button without a configured client id', () => {
    setup();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });
});

describe('RegisterPage', () => {
  function setup() {
    const navigate = vi.fn();
    renderApp(<RegisterPage navigate={navigate} />);
    return { navigate, user: setupUser() };
  }
  const fill = async (user: ReturnType<typeof setupUser>, values: { name?: string; email?: string; password?: string; confirm?: string }) => {
    if (values.name) await user.type(screen.getByLabelText('Full name'), values.name);
    if (values.email) await user.type(screen.getByLabelText('Email'), values.email);
    if (values.password) await user.type(screen.getByLabelText('Password'), values.password);
    if (values.confirm) await user.type(screen.getByLabelText('Confirm password'), values.confirm);
  };

  it('shows the registration form', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
  });

  it('reports every problem at once', async () => {
    const { user } = setup();
    await user.click(submit('Create account'));
    expect(screen.getByText('Enter your full name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('rejects a name of only spaces', async () => {
    const { user } = setup();
    await fill(user, { name: '   ', email: 'a@b.com', password: 'Password1', confirm: 'Password1' });
    await user.click(submit('Create account'));
    expect(screen.getByText('Enter your full name.')).toBeInTheDocument();
  });

  it('rejects a password shorter than 8 characters', async () => {
    const { user } = setup();
    await fill(user, { name: 'An', email: 'a@b.com', password: 'Short1', confirm: 'Short1' });
    await user.click(submit('Create account'));
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('accepts a password of exactly 8 characters', async () => {
    api.register.mockResolvedValue(session());
    const { navigate, user } = setup();
    await fill(user, { name: 'An', email: 'a@b.com', password: 'Abcdef12', confirm: 'Abcdef12' });
    await user.click(submit('Create account'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', true));
  });

  it('rejects mismatching passwords', async () => {
    const { user } = setup();
    await fill(user, { name: 'An', email: 'a@b.com', password: 'Password1', confirm: 'Password2' });
    await user.click(submit('Create account'));
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('registers with trimmed values and goes to the dashboard', async () => {
    api.register.mockResolvedValue(session());
    const { navigate, user } = setup();
    await fill(user, { name: '  An Nguyen ', email: ' an@x.com ', password: 'Password1', confirm: 'Password1' });
    await user.click(submit('Create account'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', true));
    expect(api.register).toHaveBeenCalledWith('An Nguyen', 'an@x.com', 'Password1');
  });

  it('shows the server message when the email is already taken', async () => {
    api.register.mockRejectedValue(new auth.ApiError('Email đã được sử dụng.', 409));
    const { navigate, user } = setup();
    await fill(user, { name: 'An', email: 'an@x.com', password: 'Password1', confirm: 'Password1' });
    await user.click(submit('Create account'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email đã được sử dụng.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('links back to sign in', async () => {
    const { navigate, user } = setup();
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  describe('password strength meter', () => {
    it.each([
      ['a', 'Too weak'],
      ['abcdefgh', 'Weak'],
      ['abcd1234', 'Fair'],
      ['Abcdefg1', 'Good'],
      ['Abcdefg1!', 'Strong'],
      ['Abcdefghijklmn1', 'Strong'],
    ])('rates %j as %s', async (password, label) => {
      const { user } = setup();
      await user.type(screen.getByLabelText('Password'), password);
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('is hidden until something is typed', () => {
      setup();
      expect(screen.queryByText(/Password strength/)).not.toBeInTheDocument();
    });
  });
});

describe('ForgotPasswordPage', () => {
  function setup() {
    const navigate = vi.fn();
    renderApp(<ForgotPasswordPage navigate={navigate} />);
    return { navigate, user: setupUser() };
  }

  it('asks for a valid email', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.click(submit('Send reset link'));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.forgotPassword).not.toHaveBeenCalled();
  });

  it('confirms without revealing whether the account exists', async () => {
    api.forgotPassword.mockResolvedValue({ message: 'ok' });
    const { user } = setup();
    await user.type(screen.getByLabelText('Email'), ' an@x.com ');
    await user.click(submit('Send reset link'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    expect(api.forgotPassword).toHaveBeenCalledWith('an@x.com');
    expect(screen.getByText(/If an account exists for an@x.com/)).toBeInTheDocument();
  });

  it('lets the user try a different email', async () => {
    api.forgotPassword.mockResolvedValue({ message: 'ok' });
    const { user } = setup();
    await user.type(screen.getByLabelText('Email'), 'an@x.com');
    await user.click(submit('Send reset link'));
    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Forgot your password?' })).toBeInTheDocument();
  });

  it('shows an error when sending fails', async () => {
    api.forgotPassword.mockRejectedValue(new auth.ApiError('x', 500));
    const { user } = setup();
    await user.type(screen.getByLabelText('Email'), 'an@x.com');
    await user.click(submit('Send reset link'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
  });

  it('links back to sign in', async () => {
    const { navigate, user } = setup();
    await user.click(screen.getByRole('link', { name: /Back to sign in/ }));
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});

describe('ResetPasswordPage', () => {
  function setup(query = '?token=abc123') {
    window.history.pushState({}, '', `/reset-password${query}`);
    const navigate = vi.fn();
    renderApp(<ResetPasswordPage navigate={navigate} />);
    return { navigate, user: setupUser() };
  }

  it('explains a missing token and offers a new link', async () => {
    const { navigate, user } = setup('');
    expect(screen.getByRole('heading', { level: 1, name: 'Invalid reset link' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request a new link' }));
    expect(navigate).toHaveBeenCalledWith('/forgot-password');
  });

  it('validates the new password', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(submit('Reset password'));
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('sends the token from the link with the new password', async () => {
    api.resetPassword.mockResolvedValue({ message: 'ok' });
    const { user } = setup('?token=tok-xyz');
    await user.type(screen.getByLabelText('New password'), 'NewPassword1');
    await user.type(screen.getByLabelText('Confirm password'), 'NewPassword1');
    await user.click(submit('Reset password'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Password updated' })).toBeInTheDocument();
    expect(api.resetPassword).toHaveBeenCalledWith('tok-xyz', 'NewPassword1');
  });

  it('goes to sign in afterwards', async () => {
    api.resetPassword.mockResolvedValue({ message: 'ok' });
    const { navigate, user } = setup();
    await user.type(screen.getByLabelText('New password'), 'NewPassword1');
    await user.type(screen.getByLabelText('Confirm password'), 'NewPassword1');
    await user.click(submit('Reset password'));
    await user.click(await screen.findByRole('button', { name: 'Go to sign in' }));
    expect(navigate).toHaveBeenCalledWith('/login', true);
  });

  it('shows the server message when the link has expired', async () => {
    api.resetPassword.mockRejectedValue(new auth.ApiError('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.', 400));
    const { user } = setup();
    await user.type(screen.getByLabelText('New password'), 'NewPassword1');
    await user.type(screen.getByLabelText('Confirm password'), 'NewPassword1');
    await user.click(submit('Reset password'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
  });
});

describe('AuthPages', () => {
  const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

  it.each([
    ['/login', 'Welcome back'],
    ['/register', 'Create your account'],
    ['/forgot-password', 'Forgot your password?'],
    ['/reset-password', 'Invalid reset link'],
    ['/something-else', 'Welcome back'],
    ['/', 'Welcome back'],
  ])('shows the right page for %s', (path, title) => {
    window.history.pushState({}, '', path);
    renderApp(<AuthPages path={path} navigate={() => undefined} />);
    expect(heading()).toBe(title);
  });
});
