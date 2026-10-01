import { useLoadingHold } from '../lib/loading';

// A screen that is waiting for data renders this in place of its content. It
// draws nothing itself: mounting it puts the whole app into the loading state,
// and GlobalLoader shows the one full-page overlay. It only keeps the panel from
// collapsing to nothing while the overlay is up.
export default function PageLoader({ label = 'Loading', inline = false }) {
  useLoadingHold(label);
  return <div className="page-hold" aria-hidden="true" style={{ minHeight: inline ? 120 : 240 }} />;
}
