// The icons and the corner wave for the tinted summary cards (kpi-card--tone in
// AnalyticsCharts.css). They take their colour from the card, so one card's blue
// is another's navy without changing anything here: the icons use currentColor,
// and the calendar's pale inner window uses --tone-inner.
//
// Each glyph has a class (kpi-glyph--cal, --pie, --funnel) and the pie's pieces
// have their own, so the hover motion in AnalyticsCharts.css can move them: the
// calendar wiggles, the pie's wedges spread apart, the funnel dips.

// Rounded body, two rounded tabs, a pale window with dots in it.
export function KpiCalendar() {
  return (
    <svg className="kpi-glyph kpi-glyph--cal" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4.4" width="18" height="16.8" rx="3.2" fill="currentColor" />
      <rect x="7" y="2" width="2.3" height="4.2" rx="1.15" fill="currentColor" />
      <rect x="14.7" y="2" width="2.3" height="4.2" rx="1.15" fill="currentColor" />
      <rect x="5.9" y="9.3" width="12.2" height="9.2" rx="1.5" fill="var(--tone-inner)" />
      <g fill="currentColor">
        <circle cx="9" cy="12.5" r="1.3" />
        <circle cx="12.3" cy="12.5" r="1.3" />
        <circle cx="15.3" cy="12.5" r="1.05" />
        <circle cx="9" cy="15.8" r="1.3" />
        <path d="M11.4 14.7l4 1.2-4 1.3z" />
      </g>
    </svg>
  );
}

// A large piece and two separate wedges, with gaps between them. The small
// offsets that make the gaps are in CSS (not here) so they can animate.
export function KpiPie() {
  return (
    <svg className="kpi-glyph kpi-glyph--pie" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path className="kpi-pie__a" d="M11.4 13.2 L18.1 19.9 A9.5 9.5 0 1 1 11.4 3.7 Z" />
      <path className="kpi-pie__b" d="M12.6 11.7 L12.6 2.2 A9.5 9.5 0 0 1 22.1 11.7 Z" />
      <path className="kpi-pie__c" d="M13.1 13.1 L22.4 13.1 A9.5 9.5 0 0 1 19.6 19.8 Z" />
    </svg>
  );
}

// A wide rounded top, a taper, and a stem with a rounded end.
export function KpiFunnel() {
  return (
    <svg className="kpi-glyph kpi-glyph--funnel" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.2H19L13.7 12.6V19.4H10.3V12.6Z" fill="currentColor" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

// One long wave sweeping up to the right, in two layers. It stretches with the
// card's width, so it looks the same on a narrow tile and a wide one.
export function KpiWave() {
  return (
    <span className="kpi-card__wave" aria-hidden="true">
      <svg viewBox="0 0 160 46" preserveAspectRatio="none">
        <path d="M0 46V43C30 43 62 37 92 25C114 16 138 10 160 5V46Z" fill="var(--tone-wave)" opacity="0.62" />
        <path d="M0 46V45C44 45 88 41 120 33C138 28 150 24 160 19V46Z" fill="var(--tone-wave)" opacity="0.95" />
      </svg>
    </span>
  );
}

// A tick in a rounded square, for "confirmed".
export function KpiCheck() {
  return (
    <svg className="kpi-glyph kpi-glyph--check" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
      <path d="M7.6 12.4l3 3 5.8-6.2" fill="none" stroke="var(--tone-inner)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A rupee on a disc, for money billed.
export function KpiRupee() {
  return (
    <svg className="kpi-glyph kpi-glyph--rupee" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path d="M8.2 7.6h7.6M8.2 10.6h7.6M10 7.6c3.2 0 3.2 5 0 5H8.6l5.2 4" fill="none" stroke="var(--tone-inner)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A clock, for money still waiting to be billed.
export function KpiClock() {
  return (
    <svg className="kpi-glyph kpi-glyph--clock" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path d="M12 6.8V12l3.6 2.2" fill="none" stroke="var(--tone-inner)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A star, for ratings.
export function KpiStar() {
  return (
    <svg className="kpi-glyph kpi-glyph--star" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.7l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
