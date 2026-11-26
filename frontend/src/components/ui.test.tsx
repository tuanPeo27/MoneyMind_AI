// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { Badge, Button, Card, Change, Empty, Field, IconButton, Modal, Progress, SectionHead, fieldClass } from './ui';
import { Pencil } from 'lucide-react';

describe('Button', () => {
  it('renders its label as a button', () => {
    renderApp(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    renderApp(<Button onClick={onClick}>Save</Button>);
    await setupUser().click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', async () => {
    const onClick = vi.fn();
    renderApp(<Button disabled onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    await setupUser().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('passes the type through so it can submit a form', () => {
    const onSubmit = vi.fn(e => e.preventDefault());
    renderApp(<form onSubmit={onSubmit}><Button type="submit">Go</Button></form>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('uses a different style for secondary buttons', () => {
    renderApp(<><Button>Primary</Button><Button secondary>Secondary</Button></>);
    expect(screen.getByRole('button', { name: 'Primary' }).className).toContain('from-accent');
    expect(screen.getByRole('button', { name: 'Secondary' }).className).toContain('glass');
  });

  it('adds extra class names', () => {
    renderApp(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole('button', { name: 'Wide' })).toHaveClass('w-full');
  });
});

describe('IconButton', () => {
  it('labels the icon-only button for screen readers', () => {
    renderApp(<IconButton icon={Pencil} label="Edit item" />);
    const button = screen.getByRole('button', { name: 'Edit item' });
    expect(button).toHaveAttribute('title', 'Edit item');
  });

  it('translates the label', () => {
    renderApp(<IconButton icon={Pencil} label="Edit {name}" />, { language: 'vi' });
    expect(screen.getByRole('button', { name: 'Sửa {name}' })).toBeInTheDocument();
  });

  it('hides the icon from assistive technology', () => {
    const { container } = renderApp(<IconButton icon={Pencil} label="Edit item" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    renderApp(<IconButton icon={Pencil} label="Edit item" onClick={onClick} />);
    await setupUser().click(screen.getByRole('button', { name: 'Edit item' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it.each([
    ['positive', 'text-positive'],
    ['negative', 'text-negative'],
    ['neutral', 'text-muted'],
    ['blue', 'text-brand'],
  ] as const)('shows the %s tone', (tone, className) => {
    renderApp(<Badge tone={tone}>Label</Badge>);
    expect(screen.getByText('Label')).toHaveClass(className);
  });

  it('defaults to neutral', () => {
    renderApp(<Badge>Label</Badge>);
    expect(screen.getByText('Label')).toHaveClass('text-muted');
  });
});

describe('Change', () => {
  it('shows an increase in green with one decimal', () => {
    renderApp(<Change value={5.26} />);
    const change = screen.getByText('5.3%');
    expect(change).toHaveClass('text-positive');
  });

  it('shows a decrease in red without the minus sign', () => {
    renderApp(<Change value={-3.04} />);
    expect(screen.getByText('3.0%')).toHaveClass('text-negative');
  });

  it('treats zero as non-negative', () => {
    renderApp(<Change value={0} />);
    expect(screen.getByText('0.0%')).toHaveClass('text-positive');
  });

  it('can invert the colours for things where lower is better', () => {
    const { rerender } = renderApp(<Change value={-4} inverse />);
    expect(screen.getByText('4.0%')).toHaveClass('text-positive');
    rerender(<Change value={4} inverse />);
    expect(screen.getByText('4.0%')).toHaveClass('text-negative');
  });
});

describe('Progress', () => {
  it('exposes its value to assistive technology', () => {
    renderApp(<Progress value={42} label="Budget used" />);
    const bar = screen.getByRole('progressbar', { name: 'Budget used' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it.each([
    [150, '100', '100%'],
    [-20, '0', '0%'],
    [49.6, '50', '49.6%'],
    [0, '0', '0%'],
    [100, '100', '100%'],
  ])('clamps %f', (value, now, width) => {
    const { container } = renderApp(<Progress value={value} label="p" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', now);
    expect((container.querySelector('[role=progressbar] > div') as HTMLElement).style.width).toBe(width);
  });

  it('uses the given colour', () => {
    const { container } = renderApp(<Progress value={10} label="p" color="rgb(1, 2, 3)" />);
    expect((container.querySelector('[role=progressbar] > div') as HTMLElement).style.backgroundColor).toBe('rgb(1, 2, 3)');
  });
});

describe('Empty', () => {
  it('shows the default message', () => {
    renderApp(<Empty />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('Try a different filter or add your first item.')).toBeInTheDocument();
  });

  it('shows a custom message', () => {
    renderApp(<Empty title="No budgets" text="Create one." />);
    expect(screen.getByText('No budgets')).toBeInTheDocument();
    expect(screen.getByText('Create one.')).toBeInTheDocument();
  });
});

describe('SectionHead and Card', () => {
  it('shows the title, subtitle and action', () => {
    renderApp(<SectionHead title="Budgets" subtitle="This month" action={<button>Add</button>} />);
    expect(screen.getByRole('heading', { name: 'Budgets' })).toBeInTheDocument();
    expect(screen.getByText('This month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('works without a subtitle', () => {
    renderApp(<SectionHead title="Budgets" />);
    expect(screen.getByRole('heading', { name: 'Budgets' })).toBeInTheDocument();
  });

  it('translates the title', () => {
    renderApp(<SectionHead title="Edit {name}" />, { language: 'vi' });
    expect(screen.getByRole('heading', { name: 'Sửa {name}' })).toBeInTheDocument();
  });

  it('Card wraps its children in a section', () => {
    renderApp(<Card className="p-6"><p>inside</p></Card>);
    expect(screen.getByText('inside').closest('section')).toHaveClass('p-6');
  });
});

describe('Field', () => {
  it('links the label to its input', () => {
    renderApp(<Field label="Description"><input /></Field>);
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('exports the shared input styling', () => {
    expect(fieldClass).toContain('min-h-11');
  });
});

describe('Modal', () => {
  function Harness({ onClose = () => undefined, withInput = true }: { onClose?: () => void; withInput?: boolean }) {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Modal title="Edit thing" onClose={() => { onClose(); setOpen(false); }} footer={<span>footer text</span>}>
        {withInput && <input aria-label="name" />}
        <button>Inside</button>
      </Modal>}
    </>;
  }

  it('is a labelled modal dialog rendered into the page body', async () => {
    renderApp(<Harness />);
    await setupUser().click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.closest('body')).toBe(document.body);
  });

  it('shows the content and the footer', async () => {
    renderApp(<Harness />);
    await setupUser().click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument();
    expect(screen.getByText('footer text')).toBeInTheDocument();
  });

  it('focuses the first input when it opens', async () => {
    renderApp(<Harness />);
    await setupUser().click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByLabelText('name')).toHaveFocus();
  });

  it('focuses the first focusable element when there is no input', async () => {
    renderApp(<Harness withInput={false} />);
    await setupUser().click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('closes with the close button', async () => {
    const onClose = vi.fn();
    renderApp(<Harness onClose={onClose} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes with Escape', async () => {
    const onClose = vi.fn();
    renderApp(<Harness onClose={onClose} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is pressed but not when the dialog itself is', async () => {
    const onClose = vi.fn();
    renderApp(<Harness onClose={onClose} />);
    await setupUser().click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab focus inside the dialog', async () => {
    renderApp(<Harness />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Inside' })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('keeps Shift+Tab focus inside the dialog', async () => {
    renderApp(<Harness withInput={false} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    // Focus starts on the close button (the first focusable), so Shift+Tab wraps to the last one.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
  });

  it('locks page scrolling while open and restores it afterwards', async () => {
    renderApp(<Harness />);
    const user = setupUser();
    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('returns focus to the control that opened it', async () => {
    renderApp(<Harness />);
    const user = setupUser();
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('uses a wider panel when asked', () => {
    renderApp(<Modal wide title="Wide" onClose={() => undefined}>x</Modal>);
    expect(screen.getByRole('dialog')).toHaveClass('max-w-xl');
  });

  it('translates the title and the close label', () => {
    renderApp(<Modal title="Edit {name}" onClose={() => undefined}>x</Modal>, { language: 'vi' });
    expect(screen.getByRole('dialog', { name: 'Sửa {name}' })).toBeInTheDocument();
  });
});
