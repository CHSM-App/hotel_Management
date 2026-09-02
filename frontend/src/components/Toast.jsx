import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import './Toast.css';

// A short line saying what just happened, over whatever the user was doing.
//
// This exists for actions whose result is not visible on the screen that
// started them. Sending a bill to a guest is the first: the desk presses
// WhatsApp, the message goes from the server, and nothing on the bill changes
// to show for it. Without something that says so, the only feedback is the
// absence of an error — which is indistinguishable from nothing having
// happened at all.
//
// Deliberately not a replacement for the form banners. A banner belongs to a
// field or a form and stays until the problem is fixed; a toast belongs to an
// action that is already over and takes itself away.

const ToastContext = createContext(null);

// Long enough to read a sentence twice, short enough not to sit over the
// screen. Errors get longer: they are the ones worth reading carefully, and
// they often carry a provider's own wording that is not guessable from memory.
const DURATION = { success: 4000, error: 7000, info: 4500 };

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Timers are cleared on unmount, so a toast raised by the last action before
  // a navigation cannot call setState on a component that is gone.
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message, tone = 'success') => {
      if (!message) return undefined;
      const id = nextId++;
      setToasts((list) => [...list, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION[tone] ?? DURATION.info)
      );
      return id;
    },
    [dismiss]
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    []
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live so the message reaches a screen reader too: the whole point
          of this is feedback for something that left no visible trace, and a
          user who cannot see the toast needs it most. Polite rather than
          assertive — it must not cut across what is being read. */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <span className="toast__message">{toast.message}</span>
            <button
              type="button"
              className="toast__dismiss"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Returns { show, dismiss }. Falls back to a no-op outside a provider rather
// than throwing: a missing toast is a missing notification, and taking a whole
// screen down over one would be a worse failure than the one it reports.
export function useToast() {
  return useContext(ToastContext) ?? { show: () => undefined, dismiss: () => {} };
}
