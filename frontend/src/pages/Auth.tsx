import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ChartNoAxesCombined, Eye, EyeOff, Loader2, Mail, Lock, User, AlertCircle, CheckCircle2, ShieldCheck, Sparkles, PiggyBank, ArrowLeft, MailCheck } from 'lucide-react';
import { useLanguage } from '../i18n';
import { Button, fieldClass } from '../components/ui';
import { ApiError, forgotPassword, login, loginWithGoogle, register, resetPassword } from '../lib/auth';
import { GoogleButton, googleSignInEnabled } from '../components/GoogleButton';

export const authPaths = ['/login', '/register', '/forgot-password', '/reset-password'];
type Navigate = (path: string, replace?: boolean) => void;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useErrorText() {
  const { t } = useLanguage();
  return (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 0) return t('Cannot reach the server. Check your connection and try again.');
      if (error.status === 429) return t('Too many attempts. Please wait a moment and try again.');
      if (error.status >= 500) return t('Something went wrong on our side. Please try again later.');
      return error.message;
    }
    return t('Something went wrong. Please try again.');
  };
}

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  const { t, language, setLanguage } = useLanguage();
  const perks = [
    { icon: PiggyBank, text: 'Track spending and budgets in one place' },
    { icon: Sparkles, text: 'AI insights that explain where your money goes' },
    { icon: ShieldCheck, text: 'Your data stays protected and private' },
  ];
  return <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#7b2457] via-[#9b326f] to-[#5b2a86] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-[#ec4899]/25 blur-3xl" aria-hidden="true" />
      <a href="/" className="relative flex items-center gap-3 text-xl font-semibold tracking-tight">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><ChartNoAxesCombined className="h-5 w-5" aria-hidden="true" /></span>MoneyMind AI
      </a>
      <div className="relative max-w-md">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight">{t('A clearer picture of your money.')}</h2>
        <p className="mt-4 text-[1rem] leading-7 text-white/80">{t('Personal finance, budgets and smart insights in one friendly workspace.')}</p>
        <ul className="mt-10 space-y-4">{perks.map(({ icon: Icon, text }) => <li key={text} className="flex items-center gap-3 text-sm text-white/90">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20"><Icon className="h-4 w-4" aria-hidden="true" /></span>{t(text)}
        </li>)}</ul>
      </div>
      <p className="relative text-xs text-white/60">{t('MoneyMind AI · Make room for what matters.')}</p>
    </aside>
    <main className="flex flex-col px-5 py-6 sm:px-10">
      <div className="flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight lg:invisible">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand"><ChartNoAxesCombined className="h-4 w-4 text-on-brand" aria-hidden="true" /></span>MoneyMind AI
        </a>
        <div role="group" aria-label={t('Language')} className="flex rounded-lg border border-line bg-surface p-0.5 text-xs font-medium">
          {(['vi', 'en'] as const).map(code => <button key={code} type="button" aria-pressed={language === code} onClick={() => setLanguage(code)}
            className={`min-h-9 min-w-11 rounded-md px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${language === code ? 'bg-brand text-on-brand' : 'text-muted hover:text-ink'}`}>{code.toUpperCase()}</button>)}
        </div>
      </div>
      <div className="glass-strong mx-auto my-auto flex w-full max-w-[460px] flex-col justify-center rounded-3xl p-7 sm:p-10">
        <h1 className="text-[28px] font-semibold tracking-[-0.04em]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-8 text-center text-sm text-muted">{footer}</div>}
      </div>
    </main>
  </div>;
}

function TextField({ label, icon: Icon, error, hint, right, ...props }: {
  label: string; icon: typeof Mail; error?: string; hint?: string; right?: ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return <div>
    <label htmlFor={id} className="mb-2 block text-sm font-medium">{label}</label>
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input id={id} {...props} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        className={`${fieldClass} !bg-surface pl-10 ${right ? 'pr-12' : ''} ${error ? '!border-negative focus:!ring-negative/20' : ''}`} />
      {right}
    </div>
    {error ? <p id={`${id}-err`} className="mt-1.5 text-xs text-negative">{error}</p> : hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
  </div>;
}

function PasswordField({ label, error, hint, ...props }: { label: string; error?: string; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return <TextField {...props} label={label} error={error} hint={hint} icon={Lock} type={visible ? 'text' : 'password'}
    right={<button type="button" onClick={() => setVisible(v => !v)} aria-pressed={visible} aria-label={visible ? t('Hide password') : t('Show password')}
      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"><Icon className="h-4 w-4" aria-hidden="true" /></button>} />;
}

function Strength({ password }: { password: string }) {
  const { t } = useLanguage();
  const score = useMemo(() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password) || password.length >= 14) s++;
    return s;
  }, [password]);
  if (!password) return null;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['bg-negative', 'bg-negative', 'bg-[#d89614]', 'bg-positive', 'bg-positive'];
  return <div className="-mt-1" aria-live="polite">
    <div className="flex gap-1.5" aria-hidden="true">{[1, 2, 3, 4].map(i => <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= score ? colors[score] : 'bg-line'}`} />)}</div>
    <p className="mt-1.5 text-xs text-muted">{t('Password strength')}: <span className="font-medium text-ink">{t(labels[score])}</span></p>
  </div>;
}

function FormAlert({ children }: { children: ReactNode }) {
  return <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-negative/30 bg-negative/10 p-3 text-sm text-negative"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{children}</span></div>;
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <Button type="submit" disabled={busy} className="w-full !min-h-12 shadow-sm shadow-brand/20">{busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{children}</Button>;
}

/** or divider + Google button. Signs in or creates the account, then routes admins to /admin. */
function GoogleSignIn({ navigate, context, onError }: { navigate: Navigate; context: 'signin' | 'signup'; onError: (message: string) => void }) {
  const { t, language } = useLanguage();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  if (!googleSignInEnabled) return null;
  const root = document.documentElement.dataset.theme;
  const theme = root === 'dark' || (!root && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  return <div className={busy ? 'pointer-events-none opacity-60' : ''} aria-busy={busy}>
    <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />{t('or')}<span className="h-px flex-1 bg-line" /></div>
    <GoogleButton context={context} theme={theme} locale={language === 'vi' ? 'vi' : 'en'} onCredential={async idToken => {
      setBusy(true); onError('');
      try { const session = await loginWithGoogle(idToken); navigate(session.user.roles.includes('Admin') ? '/admin' : '/', true); }
      catch (error) { onError(errorText(error)); setBusy(false); }
    }} />
  </div>;
}

function AuthLink({ to, navigate, children }: { to: string; navigate: Navigate; children: ReactNode }) {
  return <a href={to} onClick={e => { e.preventDefault(); navigate(to); }} className="rounded font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{children}</a>;
}

export function LoginPage({ navigate }: { navigate: Navigate }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      email: emailPattern.test(email.trim()) ? undefined : t('Enter a valid email address.'),
      password: password ? undefined : t('Enter your password.'),
    };
    setErrors(next); setFormError('');
    if (next.email || next.password) return;
    setBusy(true);
    try { const session = await login(email.trim(), password); navigate(session.user.roles.includes('Admin') ? '/admin' : '/', true); }
    catch (error) { setFormError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <AuthShell title={t('Welcome back')} subtitle={t('Sign in to continue managing your money.')}
    footer={<>{t("Don't have an account?")} <AuthLink to="/register" navigate={navigate}>{t('Create account')}</AuthLink></>}>
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}
      <TextField label={t('Email')} icon={Mail} type="email" name="email" autoComplete="email" inputMode="email" placeholder="ban@example.com" autoFocus
        value={email} onChange={e => setEmail(e.target.value)} error={errors.email} />
      <div>
        <PasswordField label={t('Password')} name="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} error={errors.password} />
        <div className="mt-2 text-right text-sm"><AuthLink to="/forgot-password" navigate={navigate}>{t('Forgot password?')}</AuthLink></div>
      </div>
      <Submit busy={busy}>{busy ? t('Signing in...') : t('Sign in')}</Submit>
    </form>
    <GoogleSignIn navigate={navigate} context="signin" onError={setFormError} />
  </AuthShell>;
}

export function RegisterPage({ navigate }: { navigate: Navigate }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      name: name.trim() ? undefined : t('Enter your full name.'),
      email: emailPattern.test(email.trim()) ? undefined : t('Enter a valid email address.'),
      password: password.length >= 8 ? undefined : t('Use at least 8 characters.'),
      confirm: confirm === password ? undefined : t('Passwords do not match.'),
    };
    setErrors(next); setFormError('');
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    try { await register(name.trim(), email.trim(), password); navigate('/', true); }
    catch (error) { setFormError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <AuthShell title={t('Create your account')} subtitle={t('Start tracking your finances in less than a minute.')}
    footer={<>{t('Already have an account?')} <AuthLink to="/login" navigate={navigate}>{t('Sign in')}</AuthLink></>}>
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}
      <TextField label={t('Full name')} icon={User} name="name" autoComplete="name" placeholder="Nguyễn Văn A" autoFocus value={name} onChange={e => setName(e.target.value)} error={errors.name} />
      <TextField label={t('Email')} icon={Mail} type="email" name="email" autoComplete="email" inputMode="email" placeholder="ban@example.com" value={email} onChange={e => setEmail(e.target.value)} error={errors.email} />
      <PasswordField label={t('Password')} name="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} error={errors.password} hint={t('At least 8 characters.')} />
      <Strength password={password} />
      <PasswordField label={t('Confirm password')} name="confirm" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} error={errors.confirm} />
      <Submit busy={busy}>{busy ? t('Creating account...') : t('Create account')}</Submit>
    </form>
    <GoogleSignIn navigate={navigate} context="signup" onError={setFormError} />
  </AuthShell>;
}

export function ForgotPasswordPage({ navigate }: { navigate: Navigate }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [email, setEmail] = useState(''), [error, setError] = useState(''), [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!emailPattern.test(email.trim())) { setError(t('Enter a valid email address.')); return; }
    setError(''); setBusy(true);
    try { await forgotPassword(email.trim()); setSent(true); }
    catch (err) { setFormError(errorText(err)); }
    finally { setBusy(false); }
  }
  const back = <AuthLink to="/login" navigate={navigate}><span className="inline-flex items-center gap-1.5"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('Back to sign in')}</span></AuthLink>;
  if (sent) return <AuthShell title={t('Check your email')} subtitle={t('If an account exists for {email}, we have sent instructions to reset your password.', { email: email.trim() })} footer={back}>
    <div role="status" className="rounded-xl border border-line bg-surface p-6 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-positive/10 text-positive"><MailCheck className="h-7 w-7" aria-hidden="true" /></span>
      <p className="mt-4 text-sm leading-6 text-muted">{t("The link expires soon. If you don't see the email, check your spam folder.")}</p>
      <Button secondary className="mt-5 w-full" onClick={() => setSent(false)}>{t('Use a different email')}</Button>
    </div>
  </AuthShell>;
  return <AuthShell title={t('Forgot your password?')} subtitle={t("Enter your email and we'll send you a link to reset it.")} footer={back}>
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}
      <TextField label={t('Email')} icon={Mail} type="email" name="email" autoComplete="email" inputMode="email" placeholder="ban@example.com" autoFocus value={email} onChange={e => setEmail(e.target.value)} error={error} />
      <Submit busy={busy}>{busy ? t('Sending...') : t('Send reset link')}</Submit>
    </form>
  </AuthShell>;
}

export function ResetPasswordPage({ navigate }: { navigate: Navigate }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', []);
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      password: password.length >= 8 ? undefined : t('Use at least 8 characters.'),
      confirm: confirm === password ? undefined : t('Passwords do not match.'),
    };
    setErrors(next); setFormError('');
    if (next.password || next.confirm) return;
    setBusy(true);
    try { await resetPassword(token, password); setDone(true); }
    catch (err) { setFormError(errorText(err)); }
    finally { setBusy(false); }
  }
  if (done) return <AuthShell title={t('Password updated')} subtitle={t('Your password has been reset. You can now sign in with the new password.')}>
    <div role="status" className="rounded-xl border border-line bg-surface p-6 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-positive/10 text-positive"><CheckCircle2 className="h-7 w-7" aria-hidden="true" /></span>
      <Button className="mt-5 w-full" onClick={() => navigate('/login', true)}>{t('Go to sign in')}</Button>
    </div>
  </AuthShell>;
  if (!token) return <AuthShell title={t('Invalid reset link')} subtitle={t('This link is missing or incomplete. Request a new one to continue.')}>
    <Button className="w-full" onClick={() => navigate('/forgot-password')}>{t('Request a new link')}</Button>
  </AuthShell>;
  return <AuthShell title={t('Set a new password')} subtitle={t('Choose a strong password you have not used before.')}
    footer={<AuthLink to="/login" navigate={navigate}>{t('Back to sign in')}</AuthLink>}>
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}
      <PasswordField label={t('New password')} name="password" autoComplete="new-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} error={errors.password} hint={t('At least 8 characters.')} />
      <Strength password={password} />
      <PasswordField label={t('Confirm password')} name="confirm" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} error={errors.confirm} />
      <Submit busy={busy}>{busy ? t('Saving...') : t('Reset password')}</Submit>
    </form>
  </AuthShell>;
}

export function AuthPages({ path, navigate }: { path: string; navigate: Navigate }) {
  if (path === '/register') return <RegisterPage navigate={navigate} />;
  if (path === '/forgot-password') return <ForgotPasswordPage navigate={navigate} />;
  if (path === '/reset-password') return <ResetPasswordPage navigate={navigate} />;
  return <LoginPage navigate={navigate} />;
}
