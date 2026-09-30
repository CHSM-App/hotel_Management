import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLoadingState } from '../lib/loading';
import { useBrandLogo } from '../lib/brand';
import './GlobalLoader.css';

// The single loading screen: a translucent, blurred veil with the spinner on it.
// On the dashboard it covers only the page area (.dash-main), so the top bar and
// the side panel stay usable; anywhere else (login, public pages) it covers the
// whole window. Light theme only, whatever the system uses.
//
// Two timers keep it from flickering: it waits SHOW_AFTER_MS before appearing
// (a fast load never shows it) and, once up, stays at least MIN_MS.
const SHOW_AFTER_MS = 120;
const MIN_MS = 350;

export default function GlobalLoader() {
  const { loading, label } = useLoadingState();
  const [visible, setVisible] = useState(false);
  const [shownAt, setShownAt] = useState(0);
  const logo = useBrandLogo();
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    if (loading && !visible) {
      const t = setTimeout(() => {
        setShownAt(Date.now());
        setVisible(true);
      }, SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    if (!loading && visible) {
      const wait = Math.max(0, MIN_MS - (Date.now() - shownAt));
      const t = setTimeout(() => setVisible(false), wait);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [loading, visible, shownAt]);

  if (!visible) return null;

  const host = document.querySelector('.dash-main');
  const node = (
    <div className={`global-loader${host ? ' global-loader--scoped' : ''}${loading ? '' : ' global-loader--out'}`} role="status" aria-live="polite" aria-busy={loading}>
      <div className="global-loader__box">
        <div className="global-loader__mark">
          <svg className="global-loader__spin" viewBox="0 0 84 84" aria-hidden="true">
            <circle className="track" cx="42" cy="42" r="38" />
            <circle className="arc" cx="42" cy="42" r="38" transform="rotate(-90 42 42)" />
          </svg>
{logo && !logoFailed ? (
            <img className="global-loader__logo" src={logo} alt="" onError={() => setLogoFailed(true)} />
          ) : (
          <svg className="global-loader__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="24" cy="26" r="11" />
            <circle cx="24" cy="26" r="6" />
            <path d="M6 10v10a3 3 0 0 0 3 3v15M9 10v9M12 10v10a3 3 0 0 1-3 3M42 10c-3 2-4 7-4 12h4v16" />
          </svg>
          )}
        </div>
        <span className="global-loader__text">{label}…</span>
      </div>
    </div>
  );
  return host ? createPortal(node, host) : node;
}
