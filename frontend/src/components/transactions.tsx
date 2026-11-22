import { useLanguage } from '../i18n';
import { accountLabel, categoryLabel } from '../i18n/labels';
import { useId, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Pencil, Trash2, ArrowDownUp, Sparkles, Wallet } from 'lucide-react';
import { type Transaction, type Category, money, dateLabel, today } from '../data';
import { Badge, Button, Empty, Field, IconButton, Modal, fieldClass } from './ui';
import { CategoryIcon } from './CategoryIcon';
import { Select } from './Select';

type TableProps = {
  rows: Transaction[];
  categories: Category[];
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
  compact?: boolean;
  onSort?: (key: string) => void;
};
export function TransactionTable({ rows, categories, onEdit, onDelete, compact: small = false, onSort }: TableProps) {
  const { t, locale, language } = useLanguage();
  return <div className="overflow-x-auto">
    <table className="w-full whitespace-nowrap text-left text-sm">
      <thead className="border-y border-line bg-base/50 text-xs text-muted">
        <tr>
          <th className="px-5 py-4 font-medium">{t('Transaction')}</th>
          <th className="px-4 py-4 font-medium">{t('Category')}</th>
          {!small && <th className="px-4 py-4 font-medium">{t('Account')}</th>}
          <th className="px-4 py-2 font-medium">{onSort
            ? <button className="inline-flex min-h-11 items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-brand" onClick={() => onSort('date')}>{t('Date')}<ArrowDownUp aria-hidden="true" className="size-3.5" /></button>
            : t('Date')}</th>
          {!small && <th className="px-4 py-4 font-medium">{t('Type')}</th>}
          <th className="px-5 py-2 text-right font-medium">{onSort
            ? <button className="inline-flex min-h-11 items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-brand" onClick={() => onSort('amount')}>{t('Amount')}<ArrowDownUp aria-hidden="true" className="size-3.5" /></button>
            : t('Amount')}</th>
          {!small && <th className="px-3 py-4"><span className="sr-only">{t('Actions')}</span></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-line/80">
        {rows.map(row => <tr key={row.id} className="transition-colors hover:bg-base/55">
          <td className="max-w-[290px] px-5 py-2.5">
            <button className="flex min-h-11 max-w-full items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-brand" onClick={() => onEdit(row)}>
              <CategoryIcon name={row.category} icon={categories.find(c => c.name === row.category)?.icon} />
              <span className="truncate font-medium">{row.description}</span>
            </button>
          </td>
          <td className="px-4 py-3"><Badge>{categoryLabel(row.category, language)}</Badge></td>
          {!small && <td className="px-4 py-3 text-muted">{accountLabel(row.account, language)}</td>}
          <td className="px-4 py-3 text-muted">{dateLabel(row.date, locale)}</td>
          {!small && <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs ${row.type === 'Income' ? 'text-positive' : 'text-muted'}`}>
            {row.type === 'Income' ? <ArrowDownLeft aria-hidden="true" className="size-3.5" /> : <ArrowUpRight aria-hidden="true" className="size-3.5" />}
            {t(row.type)}
          </span></td>}
          <td className={`px-5 py-3 text-right font-medium tabular-nums ${row.type === 'Income' ? 'text-positive' : 'text-ink'}`}>{row.type === 'Income' ? '+' : '−'}{money(row.amount)}</td>
          {!small && <td className="px-2 py-2.5"><div className="flex justify-end">
            <IconButton label={t('Edit {name}', { name: row.description })} icon={Pencil} onClick={() => onEdit(row)} />
            <IconButton label={t('Delete {name}', { name: row.description })} icon={Trash2} onClick={() => onDelete(row)} />
          </div></td>}
        </tr>)}
      </tbody>
    </table>
    {!rows.length && <Empty title={t('No transactions found')} />}
  </div>;
}

export function TransactionForm({ transaction, categories, onSave, onClose, onAnalyze }: {
  transaction?: Transaction; categories: Category[];
  onSave: (transaction: Transaction) => void; onClose: () => void; onAnalyze?: () => void;
}) {
  const { t, language } = useLanguage();
  const formId = useId();
  const [type, setType] = useState<Transaction['type']>(transaction?.type || 'Expense');
  const [category, setCategory] = useState(transaction?.category || categories.find(c => c.type === type)?.name || '');
  const [account, setAccount] = useState(transaction?.account || 'Vietcombank');
  const [error, setError] = useState('');
  const accountNames = [...new Set(['Vietcombank', 'MoMo', 'Tiền mặt', ...(transaction ? [transaction.account] : [])])];
  const available = categories.filter(item => item.type === type);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const description = String(data.get('description')).trim();
    if (!description) { setError('Please enter a description.'); return; }
    if (!available.some(item => item.name === category)) { setError('Choose a category to continue.'); return; }
    onSave({
      id: transaction?.id || crypto.randomUUID(), description,
      amount: Number(data.get('amount')), type, category, account,
      date: String(data.get('date')), notes: String(data.get('notes')).trim(),
    });
  }
  return <Modal wide title={t(transaction ? 'Edit transaction' : 'Add transaction')} onClose={onClose} footer={
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-xs text-muted"><span className="size-1.5 rounded-full bg-positive" />{t('Saved locally on this browser')}</span>
      <div className="flex items-center gap-2.5">
        <Button type="button" secondary onClick={onClose}>{t('Cancel')}</Button>
        <Button type="submit" form={formId} disabled={!available.length}>{t('Save transaction')}</Button>
      </div>
    </div>
  }>
    <form id={formId} onSubmit={submit} className="space-y-5">
      <Field label={t('Description')}>
        <input required maxLength={150} name="description" defaultValue={transaction?.description} placeholder={t('e.g. Lunch at Phuc Long')} className={`${fieldClass} placeholder:text-muted/75`} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Amount (VND)')}>
          <span className="relative block">
            <input required name="amount" type="number" inputMode="numeric" min="1" max="999999999999" step="1" defaultValue={transaction?.amount} placeholder="0" className={`${fieldClass} pr-14 tabular-nums`} />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted">VND</span>
          </span>
        </Field>
        <Field label={t('Transaction type')}>
          <Select label={t('Transaction type')} value={type} onChange={value => {
            const next = value as Transaction['type'];
            setType(next);
            setCategory(categories.find(item => item.type === next)?.name || '');
            setError('');
          }} options={[
            { value: 'Expense', label: t('Expense'), icon: <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-negative" /> },
            { value: 'Income', label: t('Income'), icon: <ArrowDownLeft aria-hidden="true" className="size-4 shrink-0 text-positive" /> },
          ]} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Category')}>
          <Select label={t('Category')} value={category} onChange={setCategory} placeholder={t('No categories available')} options={available.map(item => ({
            value: item.name, label: categoryLabel(item.name, language),
            icon: <CategoryIcon name={item.name} icon={item.icon} small />,
          }))} />
        </Field>
        <Field label={t('Account')}>
          <Select label={t('Account')} value={account} onChange={setAccount} options={accountNames.map(name => ({
            value: name, label: accountLabel(name, language),
            icon: <Wallet aria-hidden="true" className="size-4 shrink-0 text-muted" />,
          }))} />
        </Field>
      </div>
      <Field label={t('Date')}><input required name="date" type="date" lang={language} defaultValue={transaction?.date || today} className={fieldClass} /></Field>
      <Field label={t('Notes (optional)')}>
        <textarea name="notes" rows={2} maxLength={500} defaultValue={transaction?.notes} placeholder={t('Add a note...')} className={`${fieldClass} block min-h-[80px] resize-none py-3 placeholder:text-muted/75`} />
      </Field>
      {error && <p role="alert" className="text-sm text-negative">{t(error)}</p>}
      {onAnalyze && <button type="button" onClick={onAnalyze} className="flex min-h-11 items-center gap-2 rounded-lg text-sm text-ai focus-visible:ring-2 focus-visible:ring-ai"><Sparkles aria-hidden="true" className="size-4" />{t('Analyze this transaction with AI')}</button>}
    </form>
  </Modal>;
}
