import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Mail, Phone, ShieldCheck, Trash2, User } from 'lucide-react';
import { useLanguage } from '../i18n';
import { Badge, Button, Card, SectionHead, fieldClass } from '../components/ui';
import { Avatar } from '../components/Avatar';
import { type Profile } from '../components/layout/UserLayout';
import { type DemoRole } from '../routing';
import { SummaryCards, type Totals } from './Overview';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9+\s().-]{7,20}$/;
const MAX_AVATAR_BYTES = 1024 * 1024; // 1 MB keeps the data URL small enough for localStorage.

/** Personal workspace: who you are (editable, with avatar) and the four headline numbers. */
export default function WorkspacePage({ profile, onSave, totals, previous, hidden, setHidden, signedIn, role }: {
  profile: Profile; onSave: (profile: Profile) => void | Promise<void>; totals: Totals; previous: Totals;
  hidden: boolean; setHidden: (value: boolean) => void; signedIn: boolean; role: DemoRole;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(profile.name), [email, setEmail] = useState(profile.email), [phone, setPhone] = useState(profile.phone ?? ''), [avatar, setAvatar] = useState(profile.avatar);
  const [errors, setErrors] = useState<{ name?: string; email?: string; phone?: string; avatar?: string }>({});
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(profile.name); setEmail(profile.email); setPhone(profile.phone ?? ''); setAvatar(profile.avatar); }, [profile.name, profile.email, profile.phone, profile.avatar]);
  const changed = name.trim() !== profile.name || email.trim() !== profile.email || phone.trim() !== (profile.phone ?? '') || avatar !== profile.avatar;

  function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErrors(e => ({ ...e, avatar: t('Choose an image file.') })); return; }
    if (file.size > MAX_AVATAR_BYTES) { setErrors(e => ({ ...e, avatar: t('Image must be under 1 MB.') })); return; }
    const reader = new FileReader();
    reader.onload = () => { setAvatar(String(reader.result)); setErrors(e => ({ ...e, avatar: undefined })); };
    reader.readAsDataURL(file);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      name: name.trim() ? undefined : t('Enter your full name.'),
      email: emailPattern.test(email.trim()) ? undefined : t('Enter a valid email address.'),
      phone: !phone.trim() || phonePattern.test(phone.trim()) ? undefined : t('Enter a valid phone number.'),
      avatar: errors.avatar,
    };
    setErrors(next);
    if (next.name || next.email || next.phone || next.avatar) return;
    onSave({ ...profile, name: name.trim(), email: email.trim(), phone: phone.trim(), avatar });
  }
  const field = (label: string, icon: typeof User, error: string | undefined, input: (cls: string) => React.ReactNode) => {
    const Icon = icon;
    return <label className="block text-sm font-medium">
      <span className="mb-2 block">{label}</span>
      <span className="relative block"><Icon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />{input(`${fieldClass} pl-10 ${error ? '!border-negative' : ''}`)}</span>
      {error && <span role="alert" className="mt-1.5 block text-xs font-normal text-negative">{error}</span>}
    </label>;
  };
  return <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <Card className="p-5 sm:p-6">
      <SectionHead title={t('Personal information')} subtitle={t('Update how you appear in your workspace.')} />
      <div className="mb-6 flex items-center gap-4">
        <div className="group relative shrink-0">
          <Avatar name={name} src={avatar} seed={profile.email} className="size-[72px] text-2xl" />
          <button type="button" onClick={() => fileRef.current?.click()} aria-label={t('Change photo')}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"><Camera className="size-5" aria-hidden="true" /></button>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={e => { pickAvatar(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[1.1rem] font-semibold tracking-tight">{profile.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => fileRef.current?.click()} className="text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{t('Change photo')}</button>
            {avatar && <button type="button" onClick={() => { setAvatar(undefined); setErrors(e => ({ ...e, avatar: undefined })); }} className="inline-flex items-center gap-1 text-sm text-muted hover:text-negative"><Trash2 className="size-3.5" aria-hidden="true" />{t('Remove')}</button>}
          </div>
          <div className="mt-2"><Badge tone="blue"><ShieldCheck className="size-3" aria-hidden="true" />{role}{signedIn ? '' : ` · ${t('Demo session')}`}</Badge></div>
        </div>
      </div>
      {errors.avatar && <p role="alert" className="mb-4 text-xs text-negative">{errors.avatar}</p>}
      <form onSubmit={submit} noValidate className="space-y-4">
        {field(t('Full name'), User, errors.name, cls => <input name="name" autoComplete="name" maxLength={100} value={name} onChange={e => setName(e.target.value)} className={cls} />)}
        {field(t('Email address'), Mail, errors.email, cls => <input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} readOnly={signedIn} className={cls} />)}
        {field(t('Phone number'), Phone, errors.phone, cls => <input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="0901 234 567" value={phone} onChange={e => setPhone(e.target.value)} className={cls} />)}
        {signedIn && <p className="text-xs text-muted">{t('Your email comes from your signed-in account.')}</p>}
        <div className="flex justify-end pt-1"><Button type="submit" disabled={!changed}>{t('Save changes')}</Button></div>
      </form>
    </Card>
    <div className="min-w-0">
      <div className="mb-4"><h2 className="text-[1rem] font-semibold tracking-tight">{t('Account summary')}</h2><p className="mt-1 text-sm text-muted">{t('For the period selected above. Tap the eye to hide amounts.')}</p></div>
      <SummaryCards totals={totals} previous={previous} hidden={hidden} onToggleHidden={setHidden} layout="grid" />
    </div>
  </div>;
}
