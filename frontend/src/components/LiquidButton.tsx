import { useRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { m, useMotionValue, useSpring, type Variants } from 'framer-motion';

const EASE = [0.76, 0, 0.24, 1] as const;

// Liquid circle rises from the bottom edge, directly under the pointer, and grows until it covers the pill.
const fillVariants: Variants = {
  rest: { y: '100%', scale: 1, transition: { duration: 0.55, ease: EASE } },
  hover: { y: '0%', scale: 1.5, transition: { duration: 0.65, ease: EASE } },
};
// Two stacked copies of the content: the column slides up by one line (50% of its own height).
const rollVariants: Variants = {
  rest: { y: '0%', transition: { duration: 0.55, ease: EASE } },
  hover: { y: '-50%', transition: { duration: 0.65, ease: EASE } },
};

const base = 'relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-60';
const variants = {
  /** Dark pill with fixed colours. */
  dark: 'border border-[#27272a] bg-[#18181b] px-7 py-3.5 text-[#fafafa]',
  /** App primary button. */
  primary: 'min-h-11 bg-gradient-to-br from-accent to-accent-2 px-5 font-semibold text-on-accent shadow-lg shadow-accent/25',
  /** App secondary button (glass). */
  secondary: 'glass min-h-11 px-5 font-semibold text-ink',
  /** Square icon button. */
  icon: 'h-11 w-11 shrink-0 text-muted',
} as const;

export type LiquidVariant = keyof typeof variants;

type LiquidButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>,
  'style' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'children'> & {
  /** Button content. Rendered twice for the vertical roll, so keep it presentational. */
  children?: ReactNode;
  /** Shortcut for plain-text content. */
  label?: string;
  variant?: LiquidVariant;
};

export function LiquidButton({ label, children, variant = 'dark', className = '', onMouseEnter, onMouseMove, ...props }: LiquidButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const disabled = !!props.disabled;
  const content = children ?? label;

  // Horizontal origin of the liquid fill (px from the button's left edge), smoothed so it glides with the cursor.
  const fillX = useSpring(useMotionValue(0), { stiffness: 260, damping: 28, mass: 0.2 });
  const offset = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  };

  const row = 'flex h-6 items-center justify-center gap-2 whitespace-nowrap leading-6';
  return <m.button
    {...props}
    ref={buttonRef}
    initial="rest" animate="rest" whileHover={disabled ? undefined : 'hover'} whileTap={disabled ? undefined : { scale: 0.96 }}
    onMouseEnter={event => { fillX.jump(offset(event)); onMouseEnter?.(event); }}
    onMouseMove={event => { if (!disabled) fillX.set(offset(event)); onMouseMove?.(event); }}
    className={`${base} ${variants[variant]} ${className}`}
  >
    <m.span
      aria-hidden="true" variants={fillVariants} style={{ left: fillX }}
      className="pointer-events-none absolute top-1/2 aspect-square w-[150%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-accent to-accent-2"
    />
    <span className="relative z-10 block">
      <span className="block h-6 overflow-hidden">
        <m.span variants={rollVariants} className="flex flex-col">
          <span className={row}>{content}</span>
          <span aria-hidden="true" className={`${row} !text-on-accent`}>{content}</span>
        </m.span>
      </span>
    </span>
  </m.button>;
}
