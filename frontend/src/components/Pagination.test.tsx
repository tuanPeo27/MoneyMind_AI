// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { Pagination, usePagination } from './Pagination';

function Harness({ n, size, resetKey = '' }: { n: number; size?: number; resetKey?: string }) {
  const list = Array.from({ length: n }, (_, i) => i + 1);
  const pager = usePagination(list, size, resetKey);
  return <>
    <ul>{pager.items.map(i => <li key={i}>{`item-${i}`}</li>)}</ul>
    <Pagination pager={pager} />
  </>;
}

const items = () => screen.queryAllByRole('listitem').map(li => li.textContent);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `item-${from + i}`);

describe('Pagination', () => {
  it('shows the first page and a summary', () => {
    renderApp(<Harness n={25} />);
    expect(items()).toEqual(range(1, 10));
    expect(screen.getByText('Showing 1–10 of 25')).toBeInTheDocument();
  });

  it('moves to the next and previous page', async () => {
    renderApp(<Harness n={25} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(items()).toEqual(range(11, 20));
    expect(screen.getByText('Showing 11–20 of 25')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(items()).toEqual(range(1, 10));
  });

  it('shows a shorter last page', async () => {
    renderApp(<Harness n={25} />);
    await setupUser().click(screen.getByRole('button', { name: 'Page 3' }));
    expect(items()).toEqual(range(21, 25));
    expect(screen.getByText('Showing 21–25 of 25')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', async () => {
    renderApp(<Harness n={25} />);
    const user = setupUser();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('marks the current page', async () => {
    renderApp(<Harness n={25} />);
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 2' })).not.toHaveAttribute('aria-current');
    await setupUser().click(screen.getByRole('button', { name: 'Page 2' }));
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  });

  it('changes the page size', async () => {
    renderApp(<Harness n={25} />);
    const user = setupUser();
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await user.click(screen.getByRole('option', { name: '20 / page' }));
    expect(items()).toEqual(range(1, 20));
    expect(screen.getByText('Showing 1–20 of 25')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 3' })).not.toBeInTheDocument();
  });

  it('goes back to page one when the page size changes', async () => {
    renderApp(<Harness n={60} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await user.click(screen.getByRole('option', { name: '50 / page' }));
    expect(screen.getByText('Showing 1–50 of 60')).toBeInTheDocument();
  });

  it('goes back to page one when the filter key changes', async () => {
    const { rerender } = renderApp(<Harness n={25} resetKey="a" />);
    await setupUser().click(screen.getByRole('button', { name: 'Page 2' }));
    expect(items()).toEqual(range(11, 20));
    rerender(<Harness n={25} resetKey="b" />);
    expect(items()).toEqual(range(1, 10));
  });

  it('keeps the page when the key does not change', async () => {
    const { rerender } = renderApp(<Harness n={25} resetKey="a" />);
    await setupUser().click(screen.getByRole('button', { name: 'Page 2' }));
    rerender(<Harness n={25} resetKey="a" />);
    expect(items()).toEqual(range(11, 20));
  });

  it('lands on the new last page when the list shrinks', async () => {
    const { rerender } = renderApp(<Harness n={25} />);
    await setupUser().click(screen.getByRole('button', { name: 'Page 3' }));
    rerender(<Harness n={15} />);
    expect(items()).toEqual(range(11, 15));
    expect(screen.getByText('Showing 11–15 of 15')).toBeInTheDocument();
  });

  it('honors a custom default page size', () => {
    renderApp(<Harness n={25} size={5} />);
    expect(items()).toEqual(range(1, 5));
    expect(screen.getByText('Showing 1–5 of 25')).toBeInTheDocument();
  });
});

describe('Pagination visibility', () => {
  it.each([0, 1, 10])('is hidden for %i items', n => {
    renderApp(<Harness n={n} />);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('appears from 11 items', () => {
    renderApp(<Harness n={11} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('stays visible for a short list when the page size is small', () => {
    renderApp(<Harness n={7} size={5} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });
});

describe('Pagination page buttons', () => {
  it('lists every page when there are seven or fewer', () => {
    renderApp(<Harness n={70} />);
    expect(screen.getAllByRole('button', { name: /^Page \d+$/ })).toHaveLength(7);
  });

  it('collapses the middle of a long list into gaps', () => {
    renderApp(<Harness n={100} />);
    const labels = screen.getAllByRole('button', { name: /^Page \d+$/ }).map(b => b.textContent);
    expect(labels).toEqual(['1', '2', '3', '4', '10']);
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('shows neighbours of a page in the middle', async () => {
    renderApp(<Harness n={100} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Page 4' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    const labels = screen.getAllByRole('button', { name: /^Page \d+$/ }).map(b => b.textContent);
    expect(labels).toEqual(['1', '5', '6', '7', '10']);
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('shows the last pages when near the end', async () => {
    renderApp(<Harness n={100} />);
    await setupUser().click(screen.getByRole('button', { name: 'Page 10' }));
    const labels = screen.getAllByRole('button', { name: /^Page \d+$/ }).map(b => b.textContent);
    expect(labels).toEqual(['1', '7', '8', '9', '10']);
  });
});

describe('usePagination via the page size menu', () => {
  it('offers 10, 20 and 50 rows per page', async () => {
    renderApp(<Harness n={100} />);
    await setupUser().click(screen.getByRole('combobox', { name: 'Rows per page' }));
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['10 / page', '20 / page', '50 / page']);
  });

  it('translates the summary into Vietnamese', () => {
    renderApp(<Harness n={25} />, { language: 'vi' });
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
