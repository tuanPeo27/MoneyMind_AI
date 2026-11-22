import { useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n';
import type { DemoRole } from '../routing';
import { authApi, usersApi, useSession } from '../services';
import { useErrorText } from '../pages/Auth';
import { Badge, Button, Card, Field, Modal, SectionHead, fieldClass } from './ui';

export function AccountSecurity({ role }: { role: DemoRole }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const { session } = useSession();
  const [mode, setMode] = useState<'change' | 'recover' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const changeMode = (next: typeof mode) => { setError(''); setMode(next); };

  async function run(action: () => Promise<string>) {
    setBusy(true); setError('');
    try { setNotice(await action()); setMode(null); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return <Card className="p-6">
    <SectionHead title={t('Account security')} subtitle={t('Change your password or request a reset link by email.')} action={<Badge>{role}</Badge>} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Button secondary onClick={() => { setNotice(''); changeMode('change'); }}><KeyRound className="size-4" />{t('Change password')}</Button>
      <Button secondary onClick={() => { setNotice(''); changeMode('recover'); }}><Mail className="size-4" />{t('Forgot password?')}</Button>
    </div>
    <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />{t('Your role is read-only. Users cannot grant themselves administrator access.')}</p>
    {notice && <p role="status" className="mt-3 text-sm text-positive">{t(notice)}</p>}
    {mode === 'recover' && <Modal title={t('Forgot password?')} onClose={() => changeMode(null)}>
      <p className="text-sm leading-6 text-muted">{t('We will send a password reset link to {email}.', { email: session?.user.email ?? '' })}</p>
      {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button secondary onClick={() => changeMode(null)}>{t('Cancel')}</Button>
        <Button disabled={busy || !session} onClick={() => run(async () => { await authApi.forgotPassword(session!.user.email); return 'If the email exists, a reset link has been sent.'; })}>{t('Send reset link')}</Button>
      </div>
    </Modal>}
    {mode === 'change' && <Modal title={t('Change password')} onClose={() => changeMode(null)}>
      <form className="space-y-4" autoComplete="off" onSubmit={e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (data.get('next') !== data.get('confirm')) { setError(t('The new passwords do not match.')); return; }
        void run(async () => {
          await usersApi.changePassword({ currentPassword: String(data.get('current')), newPassword: String(data.get('next')) });
          return 'Your password has been changed.';
        });
      }}>
        <Field label={t('Current password')}><input name="current" type="password" autoComplete="current-password" required className={fieldClass} /></Field>
        <Field label={t('New password (8 or more characters)')}><input name="next" type="password" autoComplete="new-password" minLength={8} required className={fieldClass} /></Field>
        <Field label={t('Confirm new password')}><input name="confirm" type="password" autoComplete="new-password" minLength={8} required className={fieldClass} /></Field>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" secondary onClick={() => changeMode(null)}>{t('Cancel')}</Button><Button type="submit" disabled={busy}>{t('Change password')}</Button></div>
      </form>
    </Modal>}
  </Card>;
}
