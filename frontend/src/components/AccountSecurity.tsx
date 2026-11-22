import { useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n';
import type { DemoRole } from '../routing';
import { Badge, Button, Card, Field, Modal, SectionHead, fieldClass } from './ui';

export function AccountSecurity({ role }: { role: DemoRole }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'change' | 'recover' | 'reset' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changeMode = (next: typeof mode) => { setError(''); setMode(next); };
  return <Card className="p-6">
    <SectionHead title={t('Account security')} subtitle={t('Password actions are previews. No authentication or email service is connected.')} action={<Badge>{role}</Badge>} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Button secondary onClick={() => { setNotice(''); changeMode('change'); }}><KeyRound className="size-4" />{t('Change password')}</Button>
      <Button secondary onClick={() => { setNotice(''); changeMode('recover'); }}><Mail className="size-4" />{t('Forgot password?')}</Button>
    </div>
    <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />{t('Your role is read-only. Users cannot grant themselves administrator access.')}</p>
    {notice && <p role="status" className="mt-3 text-sm text-positive">{t(notice)}</p>}
    {mode === 'recover' && <Modal title={t('Forgot password?')} onClose={() => changeMode(null)}>
      <p className="text-sm leading-6 text-muted">{t('In a connected account, a reset link would go to your registered email. This preview does not send an email or verify an account.')}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2"><Button secondary onClick={() => changeMode(null)}>{t('Cancel')}</Button><Button onClick={() => changeMode('reset')}>{t('Preview reset form')}</Button></div>
    </Modal>}
    {(mode === 'change' || mode === 'reset') && <Modal title={t(mode === 'change' ? 'Change password' : 'Reset password preview')} onClose={() => changeMode(null)}>
      <form key={mode} className="space-y-4" autoComplete="off" onSubmit={e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (mode === 'change' && data.get('current') !== 'MoneyMind-demo') { setError('Use the sample current password shown above.'); return; }
        if (data.get('next') !== data.get('confirm')) { setError('The new passwords do not match.'); return; }
        changeMode(null);
        setNotice('Preview complete. No password was saved or changed.');
      }}>
        <p className="text-sm leading-6 text-muted">{t('Use a sample password only. Do not enter your real password.')}</p>
        {mode === 'change' && <Field label={t('Current sample password (MoneyMind-demo)')}><input name="current" type="password" autoComplete="off" required className={fieldClass} /></Field>}
        <Field label={t('New sample password (8 or more characters)')}><input name="next" type="password" autoComplete="off" minLength={8} required className={fieldClass} /></Field>
        <Field label={t('Confirm sample password')}><input name="confirm" type="password" autoComplete="off" minLength={8} required className={fieldClass} /></Field>
        {error && <p role="alert" className="text-sm text-negative">{t(error)}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" secondary onClick={() => changeMode(null)}>{t('Cancel')}</Button><Button type="submit">{t('Complete preview')}</Button></div>
      </form>
    </Modal>}
  </Card>;
}
