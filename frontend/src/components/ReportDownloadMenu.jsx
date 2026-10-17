import { useEffect, useRef, useState } from 'react';
import './ReportDownloadMenu.css';

// One button standing in for what used to be three sitting side by side
// (Preview, Excel, PDF) on every report tab that offers all three. Same
// open/close pattern as the other dropdowns in the app (ProfileMenu,
// StaffAlertsBell): a root ref, click-outside and Escape both close it.
export default function ReportDownloadMenu({ onPreview, onExcel, onPdf, previewBusy, excelBusy, pdfBusy }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const anyBusy = Boolean(previewBusy || excelBusy || pdfBusy);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const choose = (action) => {
    setOpen(false);
    action();
  };

  return (
    <div className="report-download-menu" ref={rootRef}>
      <button
        type="button"
        className="btn-secondary reports-panel__compact-btn report-download-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
        {anyBusy ? 'Working…' : 'Download'}
        <svg className="report-download-menu__chevron" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="report-download-menu__panel" role="menu">
          <button
            type="button"
            className="report-download-menu__item"
            disabled={previewBusy}
            onClick={() => choose(onPreview)}
          >
            {previewBusy ? 'Building…' : 'Preview'}
          </button>
          <button
            type="button"
            className="report-download-menu__item"
            disabled={excelBusy}
            onClick={() => choose(onExcel)}
          >
            {excelBusy ? 'Preparing…' : 'Excel'}
          </button>
          <button
            type="button"
            className="report-download-menu__item"
            disabled={pdfBusy}
            onClick={() => choose(onPdf)}
          >
            {pdfBusy ? 'Preparing…' : 'PDF'}
          </button>
        </div>
      )}
    </div>
  );
}
