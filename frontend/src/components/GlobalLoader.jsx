import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLoadingState } from '../lib/loading';
import { useBrandLogo } from '../lib/brand';
import './GlobalLoader.css';

// The single loading screen: a blurred veil with a branded mark (gold arc orbiting
// the property logo / bed glyph, soft pulsing halo) and a label with travelling dots.
// On the dashboard it covers only .dash-main so the top bar and side panel stay
// usable; elsewhere it covers the window. Light theme only.
//
// Two timers prevent flicker: wait SHOW_AFTER_MS before appearing (fast loads never
// show it) and, once up, stay at least MIN_MS.
const SHOW_AFTER_MS = 120;
const MIN_MS = 350;
const EASE = [0.22, 1, 0.36, 1];

export default function GlobalLoader() {
  const { loading, label } = useLoadingState();
  const [visible, setVisible] = useState(false);
  const [shownAt, setShownAt] = useState(0);
  const logo = useBrandLogo();
  const [logoFailed, setLogoFailed] = useState(false);
  const still = useReducedMotion();

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

  const host = document.querySelector('.dash-main');
  const node = (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="global-loader"
          className={`global-loader${host ? ' global-loader--scoped' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy={loading}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.22 } }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="global-loader__box"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.18 } }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <div className="global-loader__mark">
              {!still && (
                <motion.span
                  className="global-loader__halo"
                  animate={{ scale: [0.82, 1.18], opacity: [0.5, 0] }}
                  transition={{ duration: 1.8, ease: 'easeOut', repeat: Infinity }}
                />
              )}
              <svg className="global-loader__ring" viewBox="0 0 84 84" aria-hidden="true">
                <circle className="track" cx="42" cy="42" r="38" />
                <motion.g
                  style={{ originX: '42px', originY: '42px' }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: still ? 4 : 1.15, ease: 'linear', repeat: Infinity }}
                >
                  <circle className="arc" cx="42" cy="42" r="38" transform="rotate(-90 42 42)" />
                </motion.g>
              </svg>
              <motion.div
                className="global-loader__center"
                animate={still ? undefined : { scale: [1, 1.07, 1] }}
                transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
              >
                {logo && !logoFailed ? (
                  <img className="global-loader__logo" src={logo} alt="" onError={() => setLogoFailed(true)} />
                ) : (
                  <svg className="global-loader__icon" viewBox="0 0 48 48" fill="currentColor" stroke="none" aria-hidden="true">
                    <rect x="4" y="13" width="5" height="19" rx="2" />
                    <rect x="10.5" y="16" width="10" height="8" rx="3" />
                    <rect x="10.5" y="24" width="33.5" height="6" rx="2.5" />
                    <rect x="11" y="30" width="3" height="6" rx="1" />
                    <rect x="41" y="30" width="3" height="6" rx="1" />
                  </svg>
                )}
              </motion.div>
            </div>
            <span className="global-loader__text">
              {label}
              <span className="global-loader__dots" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <motion.i
                    key={i}
                    animate={still ? { opacity: 0.6 } : { opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
                  />
                ))}
              </span>
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return host ? createPortal(node, host) : node;
}
