import { useRef, type CSSProperties } from 'react';
import { Card } from './ui';

/**
 * A placeholder block with a shimmer (styles in index.css; still under prefers-reduced-motion). Give it the size of
 * the element it stands for, so nothing moves when the real content arrives.
 */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={`skeleton rounded-md ${className}`} style={style} />;
}

/** A line of text: an outer box with the text's line height and a thinner bar inside, like the glyphs. */
export function SkeletonText({ className = '', bar = 'h-3', width = 'w-24' }: { className?: string; bar?: string; width?: string }) {
  return <span aria-hidden="true" className={`flex items-center ${className}`}><Skeleton className={`${bar} ${width}`} /></span>;
}

/**
 * Class for content that replaces a skeleton: 'fade-in' once loading has ended, but only if this component did show
 * the skeleton. Opening a page whose data is already loaded draws it at once, without fading.
 */
export function useFadeIn(loading: boolean): string {
  const shownSkeleton = useRef(loading);
  if (loading) shownSkeleton.current = true;
  return !loading && shownSkeleton.current ? 'fade-in' : '';
}

/** Announces the loading state to screen readers; the skeleton blocks themselves are aria-hidden. */
export function LoadingStatus({ label }: { label: string }) {
  return <span role="status" className="sr-only">{label}</span>;
}

/** Fallback while a page's code chunk downloads: stat cards and a list card, the shape most pages share. */
export function PageSkeleton({ label }: { label: string }) {
  return <div className="min-h-[60vh] space-y-5">
    <LoadingStatus label={label} />
    <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map(i => <Card key={i} className="p-5">
      <SkeletonText className="h-5" width="w-24" />
      <SkeletonText className="mt-3 h-8" bar="h-6" width="w-36" />
    </Card>)}</div>
    <Card className="p-5">
      <SkeletonText className="h-6" bar="h-4" width="w-40" />
      <div className="mt-4 divide-y divide-line/80">{[0, 1, 2, 3, 4].map(i => <div key={i} className="flex min-h-[64px] items-center gap-3 py-2.5">
        <Skeleton className="size-9 shrink-0 !rounded-lg" />
        <span className="min-w-0 flex-1"><SkeletonText className="h-5" width={i % 2 ? 'w-32' : 'w-44'} /></span>
        <SkeletonText className="h-5" width="w-20" />
      </div>)}</div>
    </Card>
  </div>;
}
