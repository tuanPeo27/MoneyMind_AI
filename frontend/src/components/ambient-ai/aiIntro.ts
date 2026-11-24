/**
 * Entrance timeline of the AI page, built with GSAP. GSAP is imported on demand, so it stays out of the first
 * bundle: it starts downloading when the pointer reaches the AI button, or when the page opens.
 *
 * The animated elements carry `data-ai-intro="<part>"`. While the root has the class `ai-intro-pending` (see
 * index.css) they stay hidden; the timeline sets their start state and removes the class in the same frame.
 * If GSAP cannot load in time, the class is removed anyway, so the page never stays blank.
 *
 * Main-thread cost matters here: the timeline is built while the page surface is growing out of the button.
 * So every tween is a fromTo() with both ends given (GSAP then never reads computed styles to find an end value),
 * all transform caches are read in one pass before the first write (one style recalculation, not one per element),
 * and only transform / opacity are animated (no filter, no layout properties).
 */
type Gsap = typeof import('gsap')['gsap'];

let loading: Promise<Gsap> | null = null;
/** Starts (once) the download of GSAP. Safe to call on hover, focus or open. */
export function preloadAiIntro() {
  // With reduced motion the intro never plays: do not download GSAP for nothing.
  if (!loading && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.reject(new Error('reduced motion'));
  loading ??= import('gsap').then(core => core.gsap);
  return loading;
}

export const INTRO_PENDING = 'ai-intro-pending';
const FALLBACK_MS = 1500;

/**
 * Plays the intro inside `root`. `delay` lines it up with the page's own fade-in (the surface first grows out of the
 * button). Returns a cleanup that stops the timeline and removes every inline style it wrote.
 */
export function playAiIntro(root: HTMLElement, delay: number): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => undefined;
  root.classList.add(INTRO_PENDING);
  let disposed = false;
  let revert = () => undefined as void;
  const flyers: Element[] = []; // nodes added outside `root` (the flying icon): removed on cleanup
  const reveal = () => root.classList.remove(INTRO_PENDING);
  const fallback = window.setTimeout(reveal, FALLBACK_MS);

  preloadAiIntro().then(gsap => {
    if (disposed) return;
    const ctx = gsap.context(() => {
      const all = <T extends Element>(selector: string) => Array.from(root.querySelectorAll<T>(selector));
      const part = (name: string) => all<HTMLElement>(`[data-ai-intro="${name}"]`);
      const targets = {
        header: part('header'), context: part('context'), icon: part('icon'), iconSvg: all<SVGElement>('[data-ai-intro="icon"] svg'),
        kicker: part('kicker'), lines: part('title-line'), subtitle: part('subtitle'), input: part('input'),
        chips: all<HTMLElement>('[data-ai-intro="chips"] button'), footer: part('footer'),
      };
      // Read pass: parse every target's transform now, before any tween writes a style. The two icon boxes for the
      // flight below are read in the same pass.
      Object.values(targets).flat().forEach(el => gsap.getProperty(el, 'x'));
      const fabIcon = document.querySelector<SVGElement>('[data-ai-trigger] svg');
      const from = fabIcon?.getBoundingClientRect();
      const to = targets.iconSvg[0]?.getBoundingClientRect();
      const tileColor = targets.iconSvg[0] ? getComputedStyle(targets.iconSvg[0]).color : '#fff';

      const shown = { autoAlpha: 1, x: 0, y: 0, scale: 1, scaleX: 1, rotate: 0 };
      const tl = gsap.timeline({ delay, defaults: { ease: 'power3.out', duration: 0.45 } });
      const rise = (els: Element[], from: gsap.TweenVars, at: number, to: gsap.TweenVars = {}) =>
        els.length && tl.fromTo(els, { autoAlpha: 0, ...from }, { ...shown, ...to }, at);
      // Absolute start times (seconds after `delay`): everything is on screen within ~1.1s, the input by ~1s.
      rise(targets.header, { y: -10 }, 0, { duration: 0.4 });
      rise(targets.context, { y: -6 }, 0.05, { duration: 0.35 });
      // The sparkle tile pops in with a little turn.
      rise(targets.icon, { scale: 0.55, rotate: -14 }, 0.08, { duration: 0.6, ease: 'back.out(1.9)' });
      // The sparkle flies out of the AI button into the tile while the surface grows, so the button visibly becomes
      // the page. A copy of the button's icon travels on a fixed layer (the page content is still transparent then);
      // when it lands, the tile's own icon takes over and the copy is removed.
      if (fabIcon && from?.width && to?.width && targets.iconSvg.length) {
        const flyer = fabIcon.cloneNode(true) as SVGElement;
        flyer.removeAttribute('class');
        Object.assign(flyer.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`,
          height: `${from.height}px`, color: '#fff', zIndex: '85', pointerEvents: 'none', filter: 'drop-shadow(0 0 10px rgba(168, 85, 247, 0.8))' });
        flyer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(flyer);
        flyers.push(flyer);
        const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
        gsap.set(targets.iconSvg, { autoAlpha: 0 });
        gsap.timeline()
          .fromTo(flyer, { x: 0, y: 0, scale: 1, rotate: 0 }, { x: dx, y: dy, scale: to.width / from.width, rotate: 180, duration: 0.62, ease: 'power3.inOut' })
          // Its colour fades from the button's white to the tile's violet as it lands.
          .to(flyer, { color: tileColor, duration: 0.25 }, 0.37)
          .set(targets.iconSvg, { autoAlpha: 1 })
          .to(flyer, { autoAlpha: 0, duration: 0.15, onComplete: () => flyer.remove() });
      }
      // The kicker widens into place (scaleX: a transform, so no layout shift).
      rise(targets.kicker, { scaleX: 1.18 }, 0.18, { duration: 0.5 });
      // The two title lines rise one after the other.
      rise(targets.lines, { y: 22 }, 0.22, { duration: 0.55, stagger: 0.08 });
      rise(targets.subtitle, { y: 8 }, 0.4);
      // The input box lifts in, then the suggestions follow one by one.
      rise(targets.input, { y: 16, scale: 0.975 }, 0.48, { duration: 0.5 });
      rise(targets.chips, { y: 10 }, 0.58, { duration: 0.4, stagger: 0.05 });
      rise(targets.footer, {}, 0.7, { duration: 0.4 });
      // fromTo() renders the start state immediately, so it is safe to reveal in this frame.
      reveal();
    }, root);
    revert = () => ctx.revert();
  }).catch(reveal).finally(() => window.clearTimeout(fallback));

  return () => {
    disposed = true;
    window.clearTimeout(fallback);
    revert();
    flyers.forEach(node => node.remove());
    reveal();
  };
}
