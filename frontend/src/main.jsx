import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// A focused <input type="number"> treats the mouse wheel as a value control, so
// scrolling a form with the cursor resting on a price silently changes it — the
// desk finds out when the bill is wrong. Blocked once here rather than at all
// 33 number inputs, which also covers every one added later.
//
// Only while the input actually has focus: hovering one and scrolling the page
// is left alone, so the dead zone is the box the user is already editing.
// passive:false because a passive listener may not call preventDefault.
window.addEventListener(
  'wheel',
  (event) => {
    const el = event.target;
    if (el instanceof HTMLInputElement && el.type === 'number' && el === document.activeElement) {
      event.preventDefault();
    }
  },
  { passive: false }
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
