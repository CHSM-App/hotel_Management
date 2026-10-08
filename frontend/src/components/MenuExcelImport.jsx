import { useRef, useState } from 'react';
import { readSheet } from 'read-excel-file/browser';
import { apiPost, ApiError } from '../lib/api';
import './MenuExcelImport.css';

// Column headings the sheet must use, read case/space-insensitively so
// "Food Type" and "food type" both work. Matches what menu.schema.js's
// menuImportRowSchema validates row-by-row on the server.
const SCHEMA = {
  section: { column: 'Section', type: String },
  name: { column: 'Item Name', type: String },
  description: { column: 'Description', type: String, required: false },
  price: { column: 'Price', type: Number },
  foodType: {
    column: 'Type',
    type: String,
    required: false,
    // Accepts "Veg"/"Non-Veg"/"NON_VEG"/blank the way a hotelier would type
    // it, not just the exact enum menu.schema.js stores.
    parse: (value) => (/non/i.test(value || '') ? 'NON_VEG' : 'VEG'),
  },
};

const TEMPLATE_HEADERS = ['Section', 'Item Name', 'Description', 'Price', 'Type'];
const TEMPLATE_EXAMPLE = ['Starters', 'Veg Manchurian', 'Crispy vegetable balls in tangy sauce', '180', 'Veg'];

// .xlsx, not .csv — the only format readSheet() below can parse, so the file
// downloaded here has to be the same one the picker accepts. Built with
// write-excel-file, already a project dependency for the report downloads
// elsewhere in lodge/*ReportFile.js.
async function downloadTemplate() {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const row = (cells) => cells.map((value) => ({ type: String, value }));
  const workbook = await writeXlsxFile([row(TEMPLATE_HEADERS), row(TEMPLATE_EXAMPLE)], {
    sheet: 'Menu',
  });
  const url = URL.createObjectURL(await workbook.toBlob());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'menu-import-template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

// Drawn rather than imported, same reasoning as the search glyphs elsewhere
// in the app: two or three strokes is fewer bytes than an icon font or an
// SVG request, and currentColor keeps it in step with whatever state is
// colouring the text around it.
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

// One button + modal that both the hotel's own MenuPanel and the superadmin's
// LodgeDetail screen mount, pointed at their own import endpoint — the parse
// and the result screen are identical, only where the rows get POSTed differs.
export default function MenuExcelImport({ importPath, token, onImported }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // Only for display — readSheet and the file input both still work off the
  // file object itself. A name on screen is what tells someone who just
  // picked the wrong workbook before they wait on the upload to find out.
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  const reset = () => {
    setError('');
    setResult(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const { rows, errors } = await readSheet(file, { schema: SCHEMA });
      if (errors && errors.length > 0) {
        const first = errors[0];
        throw new Error(
          `Row ${first.row}, column "${first.column}": couldn't read that value. Fix it and try again.`
        );
      }
      if (!rows || rows.length === 0) {
        throw new Error('That file has no rows to import.');
      }

      const outcome = await apiPost(importPath, { rows }, { token });
      setResult(outcome);
      if (outcome.created + outcome.updated > 0) onImported?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err.message || 'Could not import that file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        Import from Excel
      </button>

      {open && (
        <div className="glass-backdrop menu-panel__backdrop" onClick={close}>
          <div
            className="glass-panel menu-panel__modal menu-panel__modal--fixed modal-form__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="menuImportTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-form">
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3 id="menuImportTitle">Import menu from Excel</h3>
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={close}
                    disabled={busy}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">
                  Columns: <strong>Section, Item Name, Description, Price, Type</strong> (Veg / Non-Veg).
                  A section or item that already exists by name is updated, not duplicated — safe to
                  re-upload after fixing a mistake.
                </p>
              </div>

              <div className="modal-form__body modal-form__body--fixed">
                <button type="button" className="menu-import-template" onClick={downloadTemplate}>
                  <DownloadIcon />
                  Download a template
                </button>

                <label
                  className={`menu-import-drop${busy ? ' menu-import-drop--busy' : ''}`}
                  htmlFor="menuImportFile"
                >
                  <span className="menu-import-drop__icon" aria-hidden="true">
                    <UploadIcon />
                  </span>
                  <span className="menu-import-drop__text">
                    <strong>{fileName || 'Choose a file to import'}</strong>
                    <span>.xlsx — the sheet downloaded above, filled in</span>
                  </span>
                  <input
                    ref={fileRef}
                    id="menuImportFile"
                    type="file"
                    accept=".xlsx"
                    onChange={onFile}
                    disabled={busy}
                  />
                </label>

                {busy && (
                  <p className="menu-import-status">
                    <span className="menu-import-spinner" aria-hidden="true" />
                    Importing…
                  </p>
                )}

                {error && <div className="form-banner form-banner--error">{error}</div>}

                {result && (
                  <div className="menu-import-result">
                    <div className="menu-import-result__row">
                      <span className="menu-import-result__stat menu-import-result__stat--added">
                        <strong>{result.created}</strong> added
                      </span>
                      <span className="menu-import-result__stat menu-import-result__stat--updated">
                        <strong>{result.updated}</strong> updated
                      </span>
                      {result.failed > 0 && (
                        <span className="menu-import-result__stat menu-import-result__stat--failed">
                          <strong>{result.failed}</strong> failed
                        </span>
                      )}
                    </div>
                    {result.errors?.length > 0 && (
                      <ul className="menu-import-errors">
                        {result.errors.map((e) => (
                          <li key={e.row}>
                            Row {e.row}
                            {e.name ? ` (${e.name})` : ''}: {e.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={close} disabled={busy}>
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
