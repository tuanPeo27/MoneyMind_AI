import { useState } from 'react';
import { Check, Download, Languages } from 'lucide-react';
import { Button, Card, Field, SectionHead, fieldClass } from '../components/ui';
import { type Profile } from '../components/layout/UserLayout';
import { type DemoRole } from '../routing';
import { themeOptions, type Theme } from '../hooks/useTheme';
import { useLanguage } from '../i18n';
import { AccountSecurity } from '../components/AccountSecurity';

export default function SettingsPage({ profile, onSave, onExport, role, theme, setTheme }: {
  profile: Profile; onSave: (p: Profile) => void; onExport: () => void;
  role: DemoRole;
  theme: Theme; setTheme: (theme: Theme) => void;
}) {
  const [notifications, setNotifications] = useState(profile.notifications);
  const [insights, setInsights] = useState(profile.insights);
  const { language, setLanguage, t } = useLanguage();
  return <div className="mx-auto max-w-4xl space-y-5">
    <Card className="p-6">
      <SectionHead title={t('Language')} subtitle={t('Choose the language for your workspace.')} action={<Languages aria-hidden="true" className="size-4 text-brand" />} />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t('Language')}</legend>
        {([['vi', 'Tiếng Việt'], ['en', 'English']] as const).map(([value, label]) => <label key={value} className="cursor-pointer">
          <input type="radio" name="language" value={value} checked={language === value} onChange={() => setLanguage(value)} className="peer sr-only" />
          <span className="inline-flex min-h-11 min-w-32 items-center justify-between gap-3 rounded-lg border border-line px-3 peer-checked:border-brand peer-checked:bg-brand/10 peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
            <span lang={value}>{label}</span>{value === language && <Check aria-hidden="true" className="size-4 text-brand" />}
          </span>
        </label>)}
      </fieldset>
    </Card>
    <Card className="p-6">
      <SectionHead title={t("Appearance")} subtitle={t("Choose how MoneyMind looks on this device.")} />
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="sr-only">{t("Color theme")}</legend>
        {themeOptions.map(({ value, label, description, icon: Icon }) => <label key={value} className="relative cursor-pointer">
          <input type="radio" name="appearance" value={value} checked={theme === value} onChange={() => setTheme(value)} className="peer sr-only" />
          <span className="flex h-full min-h-[84px] items-start gap-3 rounded-lg border border-line bg-base/55 p-3.5 transition-colors hover:border-brand/50 peer-checked:border-brand peer-checked:bg-brand/10 peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="flex-1"><span className="block font-medium">{t(label)}</span><span className="mt-1 block text-xs leading-5 text-muted">{t(description)}</span></span>
            {theme === value && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />}
          </span>
        </label>)}
      </fieldset>
    </Card>
    <form className="space-y-5" onSubmit={e => {
      e.preventDefault();
      onSave({ ...profile, notifications, insights });
    }}>
      
      <Card className="p-6"><SectionHead title={t("Preferences")} />
        {[
          { title: 'Notification indicator', description: 'Show unread indicators for demo budget notifications.', value: notifications, set: setNotifications },
          { title: 'Dashboard insights', description: 'Show the contextual spending insight on your dashboard.', value: insights, set: setInsights },
        ].map(p => <div key={t(p.title)} className="flex items-center justify-between gap-5 border-t border-line py-5">
          <div><p className="text-sm font-medium">{t(p.title)}</p><p className="mt-1 text-sm leading-6 text-muted">{t(p.description)}</p></div>
          <button type="button" role="switch" aria-checked={p.value} aria-label={t(p.title)} onClick={() => p.set(!p.value)} className="flex min-h-11 min-w-11 shrink-0 items-center focus-visible:ring-2 focus-visible:ring-brand"><span className={`flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${p.value ? 'bg-brand' : 'bg-line'}`}><span className={`h-5 w-5 rounded-full transition-transform motion-reduce:transition-none ${p.value ? 'translate-x-5 bg-on-brand' : 'bg-muted'}`} /></span></button>
        </div>)}
      </Card>
      <div className="flex justify-end"><Button type="submit">{t("Save changes")}</Button></div>
    </form>
    <AccountSecurity role={role} />
    <Card className="p-6"><SectionHead title={t("Your data belongs to you")} subtitle={t("Saved in this browser’s local storage. No bank or AI provider is connected.")} /><div className="flex flex-wrap items-center justify-between gap-4"><p className="max-w-lg text-sm leading-6 text-muted">{t("Export your transactions at any time. Clearing browser storage removes locally saved data and conversations.")}</p><Button secondary onClick={onExport}><Download className="h-4 w-4" />{t("Export transactions")}</Button></div></Card>
  </div>;
}
