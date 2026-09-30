import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/api';
import './LoginSplash.css';

// Shown once, right after signing in: the property's logo and name arriving on a
// warm full-screen ground, the way an app opens. It holds for a beat (so it is
// seen even on a fast connection), waits for the lodge details if they are slow
// (never longer than the cap), then fades away over the dashboard.
// MIN_MS counts from the moment the logo is on screen, so it is always seen for
// that long; CAP_MS is the outer limit if the details or image never arrive.
const MIN_MS = 2200;
const CAP_MS = 5000;
const FADE_MS = 500;

export default function LoginSplash({ lodge, onDone }) {
  const [minDone, setMinDone] = useState(false);
  const [capped, setCapped] = useState(false);
  const [gone, setGone] = useState(false);
  // 'loading' until the logo image has arrived (or failed), so the hotel's own
  // logo is what fades in — never the placeholder that would swap out a moment later.
  const [logoState, setLogoState] = useState('loading');
  const logoPending = Boolean(lodge?.logoUrl) && logoState === 'loading';
  const ready = Boolean(lodge) && !logoPending;
  const leaving = capped || (minDone && ready);

  useEffect(() => {
    const b = setTimeout(() => setCapped(true), CAP_MS);
    return () => clearTimeout(b);
  }, []);

  // The hold starts once the logo is showing, not when the page opened.
  useEffect(() => {
    if (!ready) return undefined;
    const a = setTimeout(() => setMinDone(true), MIN_MS);
    return () => clearTimeout(a);
  }, [ready]);

  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(() => {
      setGone(true);
      onDone?.();
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, onDone]);

  if (gone) return null;

  return (
    <div className={`login-splash${ready || capped ? ' login-splash--go' : ''}${leaving ? ' login-splash--out' : ''}`} role="status" aria-live="polite" aria-label="Opening your dashboard">
      <div className="login-splash__inner">
        <div className="login-splash__mark">
          <svg className="login-splash__ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="54" fill="none" strokeWidth="2.5" />
          </svg>
          <div className="login-splash__logo">
            {lodge?.logoUrl && logoState !== 'failed' ? (
              <img
                src={`${API_BASE}${lodge.logoUrl}`}
                alt=""
                onLoad={() => setLogoState('ready')}
                onError={() => setLogoState('failed')}
              />
            ) : lodge ? (
              <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="24" cy="26" r="11" />
                <circle cx="24" cy="26" r="6" />
                <path d="M6 10v10a3 3 0 0 0 3 3v15M9 10v9M12 10v10a3 3 0 0 1-3 3M42 10c-3 2-4 7-4 12h4v16" />
              </svg>
            ) : null}
          </div>
        </div>
        <h1 className="login-splash__name">{lodge?.name || 'Hotel Management'}</h1>
        <p className="login-splash__tag">Setting the table…</p>
        <div className="login-splash__bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
