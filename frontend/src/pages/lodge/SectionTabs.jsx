import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './SectionTabs.css';

// One strip of chips standing in for a "which group am I looking at" dropdown.
//
// A select has to be opened before it can be read, which costs a tap and hides
// the sizes of every group you didn't pick. At ten sections or eight store
// cupboard headings the whole list fits on one line, so it is shown.
//
// Shared by the Menu and Inventory tabs deliberately: they are the same
// decision made twice, and two copies would drift the first time either is
// touched.
//
// tabs: [{ id, name, count, flagged, flagTitle, dimmed }]
//   flagged — something in this group needs attention. Drawn as a dot rather
//     than a number: it answers "is anything wrong in here" from across the
//     strip, and the count is one tap away and rarely the question.
//   dimmed  — the group is switched off but still has to be reachable, because
//     reaching it is how it gets switched back on.
//
// Motion: the underline used by the finance tabs (Expenses, Income, Assets) is one
// shared element that slides from the old tab to the new one, and a tab's count
// pops when it changes. The sliding element is drawn only inside .finance-tabs
// (see FinanceTabs.css); in the pill look, selection is still the tinted pill.
export default function SectionTabs({ tabs, activeId, onChange, ariaLabel }) {
  const reduce = useReducedMotion();
  const inkId = `ink-${useId()}`;
  return (
    <div className="tabstrip" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const on = String(tab.id) === String(activeId);
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`tabstrip__tab${on ? ' tabstrip__tab--on' : ''}${
              tab.dimmed ? ' tabstrip__tab--dim' : ''
            }`}
            onClick={() => onChange(tab.id)}
          >
            <span className="tabstrip__name">{tab.name}</span>
            <motion.span
              key={tab.count}
              className="tabstrip__count"
              initial={reduce ? false : { scale: 0.7 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 16 }}
            >
              {tab.count}
            </motion.span>
            {tab.flagged && <span className="tabstrip__flag" title={tab.flagTitle} />}
            {on && (
              <motion.span
                layoutId={inkId}
                className="tabstrip__ink"
                aria-hidden="true"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 36 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
