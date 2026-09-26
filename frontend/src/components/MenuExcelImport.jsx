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

// One button + modal that both the hotel's own MenuPanel and the superadmin's
// LodgeDetail screen mount, pointed at their own import endpoint — the parse
// and the result screen are identical, only where the rows get POSTed differs.
export default function MenuExcelImport({ importPath, token, onImported }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const reset = () => {
    setError('');
    setResult(null);
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
    reset();
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
        <div className="menu-import-overlay" role="dialog" aria-modal="true">
          <div className="menu-import-card">
            <div className="menu-import-card__head">
              <h3>Import menu from Excel</h3>
              <button type="button" className="menu-import-close" onClick={close} aria-label="Close">
                ×
              </button>
            </div>

            <p className="menu-import-hint">
              Columns: <strong>Section, Item Name, Description, Price, Type</strong> (Veg / Non-Veg).
              A section or item that already exists by name is updated, not duplicated — safe to
              re-upload after fixing a mistake.{' '}
              <button type="button" className="menu-import-link" onClick={downloadTemplate}>
                Download a template
              </button>
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={onFile}
              disabled={busy}
            />

            {busy && <p className="menu-import-status">Importing…</p>}
            {error && <p className="menu-import-error">{error}</p>}

            {result && (
              <div className="menu-import-result">
                <p>
                  <strong>{result.created}</strong> added, <strong>{result.updated}</strong> updated
                  {result.failed > 0 && (
                    <>
                      , <strong>{result.failed}</strong> failed
                    </>
                  )}
                  .
                </p>
                {result.errors?.length > 0 && (
                  <ul className="menu-import-errors">
                    {result.errors.map((e) => (
                      <li key={e.row}>
                        Row {e.row}{e.name ? ` (${e.name})` : ''}: {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="menu-import-card__actions">
              <button type="button" className="btn-secondary" onClick={close}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
