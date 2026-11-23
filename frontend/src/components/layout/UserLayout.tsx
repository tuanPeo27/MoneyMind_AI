import { useLanguage } from '../../i18n';
import { type ReactNode } from 'react';
import { ChartNoAxesCombined, CreditCard, LayoutDashboard, ArrowLeftRight, Wallet, Shapes, ChartColumn, Lightbulb, PanelLeftClose, PanelLeftOpen, Plus, Settings, ChevronRight, ChevronDown, Search, Bell, Menu, Eye, EyeOff, Download, LogIn, LogOut, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { type Page, type Transaction, type Category } from '../../data';
import { type DemoRole, pagePaths } from '../../routing';
import { Badge, IconButton } from '../ui';
import { Avatar } from '../Avatar';
import { LiquidButton } from '../LiquidButton';
import { ThemeIcon } from '../ThemeIcon';
import { SearchBox } from './SearchBox';
import { themeOptions, type Theme } from '../../hooks/useTheme';
import { useLocal } from '../../hooks/useLocal';
import { displayCurrency } from '../../lib/currency';
import { DropdownMenu, MenuHeader, MenuItem, MenuLabel, MenuRadioItem, MenuSeparator } from '../DropdownMenu';

export type Profile = { name: string; email: string; phone?: string; avatar?: string; notifications: boolean; insights: boolean };
const groups = [
  { label: 'WORKSPACE', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Accounts', icon: CreditCard }, { name: 'Transactions', icon: ArrowLeftRight }, { name: 'Budgets', icon: Wallet }, { name: 'Categories', icon: Shapes }, { name: 'Reports', icon: ChartColumn }] },
  { label: 'INTELLIGENCE', items: [{ name: 'Smart Insights', icon: Lightbulb }] },
] as const;
const mini = 'md:group-data-[mini=true]/side:hidden';
const navItem = 'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand md:group-data-[mini=true]/side:justify-center md:group-data-[mini=true]/side:px-0';
export function UserLayout({ page, profile, onNavigate, search, setSearch, transactions, categories, onAdd, onExport, role, onAdmin, theme, setTheme, signedIn, onSignIn, onSignOut, unreadCount = 0, children }: {
  page: Page; profile: Profile; onNavigate: (page: Page) => void;
  search: string; setSearch: (s: string) => void; transactions: Transaction[]; categories: Category[]; onAdd: () => void; onExport: () => void;
  role: DemoRole; onAdmin: () => void; children: ReactNode;
  theme: Theme; setTheme: (value: Theme) => void;
  signedIn: boolean; onSignIn: () => void; onSignOut: () => void; unreadCount?: number;
}) {
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useLocal('mm-sidebar-collapsed-v1', false);
  const themeOption = themeOptions.find(option => option.value === theme) ?? themeOptions[0];
  function go(next: Page) { onNavigate(next); }
  return <div className="min-h-screen overflow-x-clip" style={{ '--sidebar-w': collapsed ? '76px' : '220px' } as React.CSSProperties}>
    <aside data-mini={collapsed} className={`group/side fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col border-r border-white/60 bg-surface backdrop-blur-2xl no-dark-blur transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:border-white/10 md:flex md:w-[var(--sidebar-w)]`}>
      <a href="/" title="MoneyMind AI" onClick={e => { e.preventDefault(); go('Overview'); }} className="flex h-[76px] shrink-0 items-center gap-2.5 px-5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand md:group-data-[mini=true]/side:justify-center md:group-data-[mini=true]/side:px-0">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand"><ChartNoAxesCombined className="h-5 w-5 text-on-brand" aria-hidden="true" /></span>
        <span className={`whitespace-nowrap text-[19px] font-semibold tracking-[-0.045em] ${mini}`}>MoneyMind<span className="ml-1.5 text-xs font-medium tracking-normal text-muted">AI</span></span>
      </a>

      <nav aria-label={t("Main navigation")} className="flex-1 space-y-7 overflow-y-auto overflow-x-hidden px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{groups.map(group => <div key={group.label}>
        <p className={`mb-2.5 px-3 text-xs font-medium tracking-[0.13em] text-muted ${mini}`}>{t(group.label)}</p>
        <div className="space-y-1">{group.items.map(({ name, icon: Icon }) => <a href={pagePaths[name]} key={name} title={t(name)} onClick={e => { e.preventDefault(); go(name); }} aria-current={page === name ? 'page' : undefined} className={`${navItem} ${page === name ? 'bg-brand/12 font-medium text-brand shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-brand)_22%,transparent)]' : 'text-muted hover:bg-line/70 hover:text-ink'}`}>
          <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /><span className={`flex-1 whitespace-nowrap ${mini}`}>{t(name)}</span>
        </a>)}</div>
      </div>)}
      </nav>
      {/* Same placement and style as the administration sidebar. Collapsed sidebar: icon only. */}
      {signedIn && <button type="button" onClick={onSignOut} title={t('Sign out')} aria-label={t('Sign out')}
        className="mx-4 mb-4 flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted transition-colors hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-brand md:group-data-[mini=true]/side:mx-auto md:group-data-[mini=true]/side:w-11 md:group-data-[mini=true]/side:justify-center md:group-data-[mini=true]/side:px-0">
        <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={`whitespace-nowrap ${mini}`}>{t('Sign out')}</span>
      </button>}
      <button onClick={() => go('Workspace')} title={profile.name} className="flex min-h-[78px] items-center gap-3 border-t border-line px-5 text-left hover:bg-line/40 focus-visible:ring-2 focus-visible:ring-brand md:group-data-[mini=true]/side:justify-center md:group-data-[mini=true]/side:px-0"><Avatar name={profile.name} src={profile.avatar} seed={profile.email} /><span className={`min-w-0 flex-1 ${mini}`}><span className="block truncate text-sm font-medium">{profile.name}</span><span className="mt-1 block truncate text-xs text-muted">{t("Personal account")}</span></span><ChevronRight className={`h-3.5 w-3.5 text-muted ${mini}`} /></button>
    </aside>
    <div className="min-w-0 transition-[margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:ml-[var(--sidebar-w)]">
      <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-5 lg:px-8">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 border-b border-white/60 bg-surface backdrop-blur-xl dark:border-white/10" />
        <div className="flex min-w-0 items-center gap-3"><button type="button" aria-label="MoneyMind" onClick={() => go('Overview')} className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#EC4899] text-white shadow-md shadow-[#8B5CF6]/30 focus-visible:ring-2 focus-visible:ring-brand md:hidden"><ChartNoAxesCombined className="size-5" aria-hidden="true" /></button><span className="hidden md:block"><IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} /></span><span className="hidden text-sm text-muted lg:block">{t("Personal workspace")}</span><ChevronRight className="hidden h-3.5 w-3.5 text-muted lg:block" /><span className="truncate text-sm font-medium">{t(page === 'AI Financial Assistant' ? 'AI Assistant' : page)}</span></div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <SearchBox value={search} onChange={setSearch} onSubmit={() => go('Transactions')} transactions={transactions} categories={categories} />
          
          <DropdownMenu label={t('Appearance options')} width={220} trigger={props =>
            <LiquidButton id="appearance-toggle" variant="icon" className="theme-btn" aria-label={`${t('Appearance')}: ${t(themeOption.label)}`} title={`${t('Appearance')}: ${t(themeOption.label)}`} {...props}><ThemeIcon value={theme} /></LiquidButton>}>
            <MenuLabel>{t('Appearance')}</MenuLabel>
            {themeOptions.map(({ value, label }) => <MenuRadioItem key={value} className="theme-btn" checked={theme === value} onSelect={() => setTheme(value)}
              icon={<ThemeIcon value={value} className="size-[18px]" />}>{t(label)}</MenuRadioItem>)}
          </DropdownMenu>
          <LiquidButton variant="icon" className="bell-btn relative" aria-label={t("Notifications")} title={t("Notifications")} aria-current={page === 'Notifications' ? 'page' : undefined} onClick={() => go('Notifications')}><Bell className="bell-icon h-[18px] w-[18px]" />{unreadCount > 0 && <span aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-on-brand ring-2 ring-base">{unreadCount > 9 ? '9+' : unreadCount}</span>}</LiquidButton>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
          <DropdownMenu label={t('Open profile menu')} width={285} trigger={props =>
            <button type="button" aria-label={t('Open profile menu')} className="flex min-h-11 items-center gap-2 rounded-lg px-1 focus-visible:ring-2 focus-visible:ring-brand" {...props}>
              <Avatar name={profile.name} src={profile.avatar} seed={profile.email} className="size-8 text-xs" /><ChevronDown className="h-3 w-3 text-muted" aria-hidden="true" />
            </button>}>
            <MenuHeader><p className="truncate font-medium text-ink">{profile.name}</p><p className="mt-1 truncate text-xs text-muted">{profile.email}</p><div className="mt-2"><Badge>{signedIn ? role : `${role} · ${t('Demo session')}`}</Badge></div></MenuHeader>
            <MenuItem icon={<Wallet className="h-4 w-4" />} onSelect={() => go('Workspace')}>{t('Personal workspace')}</MenuItem>
            <MenuItem className="md:hidden" icon={<Lightbulb className="h-4 w-4" />} onSelect={() => go('Smart Insights')}>{t('Smart Insights')}</MenuItem>
            <MenuItem icon={<Settings className="h-4 w-4" />} onSelect={() => go('Settings')}>{t('Settings')}</MenuItem>
            <MenuItem icon={<Download className="h-4 w-4" />} onSelect={onExport}>{t('Export my data')}</MenuItem>
            {role === 'ADMIN' && <MenuItem icon={<ShieldCheck className="h-4 w-4" />} trailing={<ArrowUpRight className="h-3.5 w-3.5" />} onSelect={onAdmin}>{t('Open administration')}</MenuItem>}
            <MenuSeparator />
            {signedIn
              ? <MenuItem icon={<LogOut className="h-4 w-4" />} onSelect={onSignOut}>{t('Sign out')}</MenuItem>
              : <MenuItem icon={<LogIn className="h-4 w-4" />} onSelect={onSignIn}>{t('Sign in')}</MenuItem>}
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-[1640px] px-4 pb-28 pt-5 sm:px-5 md:pb-12 md:pt-7 lg:px-8">{children}<footer className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{t("MoneyMind AI · Make room for what matters.")}</span><span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />{t("Local demo · {currency}", { currency: displayCurrency() })}</span></footer></main>
    </div>
    <BottomBar page={page} onNavigate={go} />  </div>;
}

const barItems = [
  { page: 'Overview', icon: LayoutDashboard, label: 'Overview' },
  { page: 'Accounts', icon: CreditCard, label: 'Accounts' },
  { page: 'Budgets', icon: Wallet, label: 'Budgets' },
  { page: 'Reports', icon: ChartColumn, label: 'Reports' },
] as const;
/**
 * Phone-only taskbar: Overview and Accounts on the left, Transactions in the middle, Budgets and Reports on the
 * right. Categories is reached from the Transactions page. Adding a transaction stays on the Transactions page
 * and the Overview header.
 */
function BottomBar({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  const { t } = useLanguage();
  const item = (entry: typeof barItems[number]) => {
    const Icon = entry.icon, current = page === entry.page;
    return <button key={entry.page} type="button" aria-current={current ? 'page' : undefined} onClick={() => onNavigate(entry.page)}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${current ? 'text-brand' : 'text-muted'}`}>
      <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${current ? 'bg-brand/15' : ''}`}><Icon className="size-[19px]" aria-hidden="true" /></span>
      <span className="max-w-full truncate px-0.5">{t(entry.label)}</span>
    </button>;
  };
  const onTransactions = page === 'Transactions' || page === 'Categories';
  return <nav aria-label={t('Quick navigation')} className="glass-strong fixed inset-x-3 bottom-3 z-40 flex items-center rounded-3xl px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 md:hidden">
    {item(barItems[0])}{item(barItems[1])}
    <div className="flex flex-1 flex-col items-center">
      <button type="button" onClick={() => onNavigate('Transactions')} aria-label={t('Transactions')} title={t('Transactions')} aria-current={page === 'Transactions' ? 'page' : undefined}
        className={`-mt-7 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#EC4899] text-white shadow-[0_10px_28px_-6px_rgba(139,92,246,0.8)] ring-4 transition-transform duration-300 active:scale-90 focus-visible:outline-none focus-visible:ring-brand ${onTransactions ? 'ring-brand/35' : 'ring-[var(--color-base)]'}`}>
        <ArrowLeftRight className="size-6" aria-hidden="true" />
      </button>
      <span className={`mt-1 max-w-full truncate px-0.5 text-[10px] font-medium leading-none ${onTransactions ? 'text-brand' : 'text-muted'}`}>{t('Transactions')}</span>
    </div>
    {item(barItems[2])}{item(barItems[3])}
  </nav>;
}
