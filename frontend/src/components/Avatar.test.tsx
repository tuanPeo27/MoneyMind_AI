// @vitest-environment jsdom
import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/dom';
import { Avatar, demoAvatar, initialsOf } from './Avatar';
import { BrandLogo, LOGO_SRC } from './BrandLogo';

describe('initialsOf', () => {
  it.each([
    ['Nguyen Van An', 'VA'],
    ['An', 'A'],
    ['an nguyen', 'AN'],
    ['  Tran   Minh  ', 'TM'],
    ['', ''],
    ['   ', ''],
    ['Le Thi Thu Ha', 'TH'],
  ])('%j -> %j', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});

describe('demoAvatar', () => {
  const decode = (uri: string) => decodeURIComponent(uri.replace('data:image/svg+xml;charset=utf-8,', ''));

  it('returns an SVG data URI generated locally', () => {
    const uri = demoAvatar('an@x.com');
    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decode(uri)).toContain('<svg');
    expect(decode(uri)).toContain('</svg>');
  });

  it('is stable for the same seed', () => {
    expect(demoAvatar('an@x.com')).toBe(demoAvatar('an@x.com'));
  });

  it('differs between seeds', () => {
    const uris = new Set(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'].map(demoAvatar));
    expect(uris.size).toBeGreaterThan(3);
  });

  it('uses a default seed for an empty value', () => {
    expect(demoAvatar('')).toBe(demoAvatar(''));
    expect(demoAvatar('')).toContain('svg');
  });

  it('only uses colours from the app palette (valid hex values)', () => {
    const colours = decode(demoAvatar('seed')).match(/#[0-9A-Fa-f]{6}/g) ?? [];
    expect(colours.length).toBeGreaterThanOrEqual(3);
  });

  it('never sends anything to a third party', () => {
    expect(decode(demoAvatar('seed'))).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});

describe('Avatar', () => {
  it('shows the photo when there is one', () => {
    const { container } = renderApp(<Avatar name="An" src="https://cdn.x.com/a.png" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.x.com/a.png');
  });

  it('falls back to a generated avatar without a photo', () => {
    const { container } = renderApp(<Avatar name="An Nguyen" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(demoAvatar('An Nguyen'));
  });

  it('uses the seed instead of the name when given', () => {
    const { container } = renderApp(<Avatar name="An" seed="an@x.com" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(demoAvatar('an@x.com'));
  });

  it('falls back when the photo fails to load', () => {
    const { container } = renderApp(<Avatar name="An" src="https://cdn.x.com/broken.png" />);
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(demoAvatar('An'));
  });

  it('tries a new photo again after the link changes', () => {
    const { container, rerender } = renderApp(<Avatar name="An" src="https://cdn.x.com/broken.png" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    rerender(<Avatar name="An" src="https://cdn.x.com/new.png" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.x.com/new.png');
  });

  it('is decorative for screen readers and shows initials as a tooltip', () => {
    const { container } = renderApp(<Avatar name="Tran Minh" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toHaveAttribute('title', 'TM');
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('does not leak the referrer to the photo host', () => {
    const { container } = renderApp(<Avatar name="An" src="https://cdn.x.com/a.png" />);
    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('accepts custom sizing classes', () => {
    const { container } = renderApp(<Avatar name="An" className="size-20" />);
    expect(container.firstElementChild).toHaveClass('size-20');
  });

  it('has no tooltip for an empty name', () => {
    const { container } = renderApp(<Avatar name="" />);
    expect(container.firstElementChild).not.toHaveAttribute('title');
  });
});

describe('BrandLogo', () => {
  it('shows the logo image', () => {
    const { container } = renderApp(<BrandLogo />);
    expect(LOGO_SRC).toBe('/logo-96.png');
    expect(container.querySelector('img')).toHaveAttribute('src', '/logo-96.png');
  });

  it('is decorative', () => {
    const { container } = renderApp(<BrandLogo />);
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the chart icon when the image is missing', () => {
    const { container } = renderApp(<BrandLogo />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('applies the requested size and corner style to both versions', () => {
    const { container } = renderApp(<BrandLogo className="size-12" rounded="rounded-full" />);
    expect(container.querySelector('img')).toHaveClass('size-12', 'rounded-full');
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.firstElementChild).toHaveClass('size-12', 'rounded-full');
  });
});
