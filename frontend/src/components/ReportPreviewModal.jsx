import { useEffect } from 'react';
import './ReportPreviewModal.css';

// The built PDF, shown full-screen in the browser's own viewer rather than
// inline in the page — it used to sit in a strip under the report's action
// row, pushing the table below it down every time it opened. A modal keeps
// the report underneath exactly where it was.
//
// The backdrop dismisses (unlike ConfirmDialog's): this is a look, not a
// decision, so there is nothing a stray click could answer wrongly.
export default function ReportPreviewModal({ title, url, onClose }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="glass-backdrop report-preview-modal__backdrop" onClick={onClose}>
      <div
        className="glass-panel report-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="report-preview-modal__head">
          <h3>{title}</h3>
          <button type="button" className="report-preview-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <iframe className="report-preview-modal__frame" src={url} title={title} />
      </div>
    </div>
  );
}
