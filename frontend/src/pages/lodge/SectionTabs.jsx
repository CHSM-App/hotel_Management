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
export default function SectionTabs({ tabs, activeId, onChange, ariaLabel }) {
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
            <span className="tabstrip__count">{tab.count}</span>
            {tab.flagged && <span className="tabstrip__flag" title={tab.flagTitle} />}
          </button>
        );
      })}
    </div>
  );
}
