import { useEffect, useRef, useState } from 'react';

// Minimal typing for the parts of Google Identity Services (https://accounts.google.com/gsi/client) used here.
type GoogleId = {
  initialize: (options: { client_id: string; callback: (response: { credential: string }) => void; ux_mode?: 'popup'; context?: string }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
};
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<void> | null = null;

/** Loads the GIS script once per page; later calls reuse the same promise. */
function loadScript() {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const script = document.createElement('script');
    script.src = SCRIPT_SRC; script.async = true; script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => { scriptPromise = null; reject(new Error('Could not load Google sign-in.')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export const googleSignInEnabled = Boolean(CLIENT_ID);

/**
 * The official "Sign in with Google" button. Google hands back an ID token (JWT) that the backend verifies at
 * POST /api/auth/google. Renders nothing when VITE_GOOGLE_CLIENT_ID is not set.
 */
export function GoogleButton({ onCredential, context = 'signin', theme, locale }: {
  onCredential: (idToken: string) => void; context?: 'signin' | 'signup'; theme: 'light' | 'dark'; locale: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  // Google renders a fixed-width iframe, so measure the container and re-render when it changes size.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(Math.min(400, Math.max(200, entry.contentRect.width)))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!CLIENT_ID || !width) return;
    let cancelled = false;
    loadScript().then(() => {
      const el = host.current, google = window.google;
      if (cancelled || !el || !google) return;
      google.accounts.id.initialize({ client_id: CLIENT_ID, callback: r => callback.current(r.credential), ux_mode: 'popup', context });
      el.replaceChildren();
      google.accounts.id.renderButton(el, {
        type: 'standard', theme: theme === 'dark' ? 'filled_black' : 'outline', size: 'large', shape: 'pill',
        text: context === 'signup' ? 'signup_with' : 'continue_with', logo_alignment: 'center', width, locale,
      });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [width, theme, locale, context]);

  if (!CLIENT_ID) return null;
  return <div>
    <div ref={host} className="flex min-h-11 w-full justify-center" />
    {failed && <p role="alert" className="mt-2 text-center text-xs text-negative">Could not load Google sign-in. Check your connection or ad blocker.</p>}
  </div>;
}
