import { useLanguage } from '../i18n';
import {
  Utensils, House, ShoppingBag, Car, Zap, Film, Wallet, Briefcase, TrendingUp,
  HeartPulse, GraduationCap, Plane, Gift, Dumbbell, Laptop, Coffee, PawPrint,
  Music, PiggyBank, Smartphone, Bus, Tag,
} from 'lucide-react';

export const categoryIcons = {
  Utensils: { icon: Utensils, label: 'Food & dining', tone: 'text-ai bg-ai/10' },
  Home: { icon: House, label: 'Housing', tone: 'text-brand bg-brand/10' },
  ShoppingBag: { icon: ShoppingBag, label: 'Shopping', tone: 'text-brand bg-brand/10' },
  Car: { icon: Car, label: 'Driving', tone: 'text-chart-tertiary bg-chart-tertiary/10' },
  Zap: { icon: Zap, label: 'Utilities', tone: 'text-brand bg-brand/10' },
  Film: { icon: Film, label: 'Entertainment', tone: 'text-ai bg-ai/10' },
  Wallet: { icon: Wallet, label: 'Wallet', tone: 'text-muted bg-line/55' },
  Briefcase: { icon: Briefcase, label: 'Salary', tone: 'text-positive bg-positive/10' },
  TrendingUp: { icon: TrendingUp, label: 'Investments', tone: 'text-positive bg-positive/10' },
  HeartPulse: { icon: HeartPulse, label: 'Health', tone: 'text-negative bg-negative/10' },
  GraduationCap: { icon: GraduationCap, label: 'Education', tone: 'text-chart-tertiary bg-chart-tertiary/10' },
  Plane: { icon: Plane, label: 'Travel', tone: 'text-chart-tertiary bg-chart-tertiary/10' },
  Gift: { icon: Gift, label: 'Gifts', tone: 'text-brand bg-brand/10' },
  Dumbbell: { icon: Dumbbell, label: 'Fitness', tone: 'text-positive bg-positive/10' },
  Laptop: { icon: Laptop, label: 'Tech & work', tone: 'text-chart-tertiary bg-chart-tertiary/10' },
  Coffee: { icon: Coffee, label: 'Coffee', tone: 'text-ai bg-ai/10' },
  PawPrint: { icon: PawPrint, label: 'Pets', tone: 'text-brand bg-brand/10' },
  Music: { icon: Music, label: 'Music', tone: 'text-ai bg-ai/10' },
  PiggyBank: { icon: PiggyBank, label: 'Savings', tone: 'text-positive bg-positive/10' },
  Smartphone: { icon: Smartphone, label: 'Mobile', tone: 'text-chart-tertiary bg-chart-tertiary/10' },
  Bus: { icon: Bus, label: 'Transit', tone: 'text-chart-tertiary bg-chart-tertiary/10' },
  Tag: { icon: Tag, label: 'Other', tone: 'text-muted bg-line/55' },
};
export type CategoryIconId = keyof typeof categoryIcons;
const defaults: Record<string, CategoryIconId> = {
  'ăn uống': 'Utensils', 'mua sắm': 'ShoppingBag', 'di chuyển': 'Car',
  'nhà ở': 'Home', 'hóa đơn': 'Zap', 'giải trí': 'Film', 'lương': 'Briefcase',
  'đầu tư': 'TrendingUp', 'khác': 'Wallet', 'sức khỏe': 'HeartPulse',
  'giáo dục': 'GraduationCap', 'du lịch': 'Plane', 'quà tặng': 'Gift',
  'thể thao': 'Dumbbell', 'thú cưng': 'PawPrint', 'tiết kiệm': 'PiggyBank',
};
const iconIds = Object.keys(categoryIcons) as CategoryIconId[];

// Icon names the backend seeds for its system categories.
const serverIcons: Record<string, CategoryIconId> = {
  utensils: 'Utensils', car: 'Car', home: 'Home', receipt: 'Zap', 'shopping-bag': 'ShoppingBag',
  'gamepad-2': 'Film', 'heart-pulse': 'HeartPulse', 'graduation-cap': 'GraduationCap', plane: 'Plane',
  gift: 'Gift', ellipsis: 'Tag', wallet: 'Wallet', award: 'Briefcase', 'trending-up': 'TrendingUp', briefcase: 'Briefcase',
};
export function getCategoryIcon(name: string, icon?: string): CategoryIconId {
  if (icon && Object.prototype.hasOwnProperty.call(categoryIcons, icon)) return icon as CategoryIconId;
  if (icon && Object.prototype.hasOwnProperty.call(serverIcons, icon)) return serverIcons[icon];
  const suggested = defaults[name.trim().toLowerCase()];
  return iconIds.includes(suggested) ? suggested : 'Tag';
}

export function CategoryIcon({ name, icon, small = false }: { name: string; icon?: string; small?: boolean }) {
  const { icon: Icon, tone } = categoryIcons[getCategoryIcon(name, icon)];
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-lg ${small ? 'size-7' : 'size-9'} ${tone}`}><Icon className={small ? 'size-3.5' : 'size-4'} /></span>;
}

export function CategoryIconPicker({ value, onChange }: { value: CategoryIconId; onChange: (icon: CategoryIconId) => void }) {
  const { t } = useLanguage();
  return <fieldset className="min-w-0">
    <legend className="mb-2 text-sm font-medium">{t("Category icon")}</legend>
    <div className="grid grid-cols-5 gap-2 rounded-xl border border-line bg-base p-3 sm:grid-cols-8">
      {iconIds.map(id => <label key={id} title={t(categoryIcons[id].label)} className="relative cursor-pointer">
        <input type="radio" name="category-icon" value={id} checked={value === id} onChange={() => onChange(id)} aria-label={t(categoryIcons[id].label)} className="peer sr-only" />
        <span className="flex h-10 items-center justify-center rounded-lg border border-transparent transition-colors hover:bg-line/60 peer-checked:border-brand peer-checked:bg-brand/10 peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
          <CategoryIcon name="" icon={id} small />
        </span>
      </label>)}
    </div>
    <p className="mt-2 text-xs text-muted">{t("Selected:") + ' '}{t(categoryIcons[value].label)}</p>
  </fieldset>;
}
