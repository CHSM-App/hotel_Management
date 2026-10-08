import { useMemo, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import IconButton from '../../components/IconButton';
import { EditIcon, TrashIcon } from '../../components/ActionIcons';
import RowMenu from './RowMenu';

// The Vendors tab, as Expenses and Asset inventory both show it: a cards/table
// toggle, the list itself, and the "are you sure" before a delete. Each panel
// keeps its own vendors (dbo.vendors is split by kind) and its own add/edit
// form; this is only the directory they are listed in, so the two can't drift
// into looking like different features.
//
// Styled by .vendor-card* and .asset-table* in InventoryPanel.css.

// Up to two letters for a card's avatar: the first letters of the first two
// words, so "Sai Electricals" is SE and a one-word name is its first two.
function vendorInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

const FACT_PATHS = {
  person: 'M10 10a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 10 10Zm-6 6.4c0-2.6 2.7-4.2 6-4.2s6 1.6 6 4.2',
  phone:
    'M5.2 3.2h2.2l1.1 3-1.5 1.1a8.6 8.6 0 0 0 4.7 4.7l1.1-1.5 3 1.1v2.2a1.4 1.4 0 0 1-1.5 1.4A12.4 12.4 0 0 1 3.8 4.7a1.4 1.4 0 0 1 1.4-1.5Z',
  email: 'M3 5.5h14v9H3v-9Zm0 .6 7 5 7-5',
};

// The small line icon in front of each contact detail on a card.
function FactIcon({ kind }) {
  return (
    <svg className="vendor-card__icon" viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true">
      <path d={FACT_PATHS[kind]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function phonesOf(vendor) {
  return [vendor.phone, vendor.altPhone].filter(Boolean);
}

// The table's columns, in order, and what each one sorts by.
const SORT_COLUMNS = [
  ['name', 'Vendor'],
  ['specialty', 'Specialty'],
  ['contactPerson', 'Contact person'],
  ['phone', 'Phone'],
  ['email', 'Email'],
];

const SORT_ACCESSORS = {
  name: (v) => v.name || '',
  specialty: (v) => v.specialty || '',
  contactPerson: (v) => v.contactPerson || '',
  phone: (v) => phonesOf(v)[0] || '',
  email: (v) => v.email || '',
};

export default function VendorDirectory({
  vendors,
  emptyHint,
  // What the confirmation says is kept — the records that still name a vendor
  // differ between the two panels.
  deleteNote,
  onAdd,
  onEdit,
  // Resolves once the vendor is gone (or the panel has reported why not); the
  // dialog stays up, disabled, until then.
  onDelete,
}) {
  const [view, setView] = useState('cards');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  // The vendor a delete has been asked for, held until the dialog is answered.
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(toDelete);
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  // Same three-step cycle as the expense and asset tables: ascending,
  // descending, then back to the order the list arrived in.
  const toggleSort = (key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  const list = useMemo(() => vendors || [], [vendors]);
  const sorted = useMemo(() => {
    const accessor = SORT_ACCESSORS[sort.key];
    if (!accessor) return list;
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      // Blanks go last whichever way the column runs — a vendor with no email
      // is not what anyone sorting by email is looking for.
      if (!av || !bv) return av ? -1 : bv ? 1 : 0;
      return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * dir;
    });
  }, [list, sort]);

  return (
    <div>
      <div className="inv-bar">
        <div className="inv-bar__row">
          <div />
          <div className="inv-bar__actions">
            <div className="toggle-group asset-view-toggle" role="group" aria-label="Vendor list view">
              <button
                type="button"
                className="asset-view-toggle__btn"
                aria-pressed={view === 'cards'}
                aria-label="Cards view"
                title="Cards view"
                onClick={() => setView('cards')}
              >
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="11" y="2.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="11" y="11" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
              <button
                type="button"
                className="asset-view-toggle__btn"
                aria-pressed={view === 'table'}
                aria-label="Table view"
                title="Table view"
                onClick={() => setView('table')}
              >
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                  <rect x="2.5" y="3.5" width="15" height="13" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
                  <line x1="2.5" y1="8" x2="17.5" y2="8" stroke="currentColor" strokeWidth="1.6" />
                  <line x1="2.5" y1="12.3" x2="17.5" y2="12.3" stroke="currentColor" strokeWidth="1.6" />
                  <line x1="7.3" y1="3.5" x2="7.3" y2="16.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
            </div>
            <button type="button" className="btn-accent" onClick={onAdd}>
              Add vendor
            </button>
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="inv-panel__hint">{emptyHint}</p>
      ) : view === 'table' ? (
        <div className="asset-table-wrap">
          <table className="asset-table">
            <thead>
              <tr>
                {SORT_COLUMNS.map(([key, label]) => (
                  <th key={key}>
                    <button
                      type="button"
                      className="asset-table__sort-btn"
                      aria-sort={sort.key === key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === key ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                ))}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((vendor) => (
                <tr key={vendor.id} onClick={() => onEdit(vendor)}>
                  <td className="asset-table__name">{vendor.name}</td>
                  <td className={vendor.specialty ? '' : 'asset-table__muted'}>{vendor.specialty || '—'}</td>
                  <td className={vendor.contactPerson ? '' : 'asset-table__muted'}>{vendor.contactPerson || '—'}</td>
                  <td className={phonesOf(vendor).length ? '' : 'asset-table__muted'}>
                    {phonesOf(vendor).join(' / ') || '—'}
                  </td>
                  <td className={vendor.email ? '' : 'asset-table__muted'}>{vendor.email || '—'}</td>
                  <td className="asset-table__actions" onClick={(e) => e.stopPropagation()}>
                    <RowMenu label={`More actions for ${vendor.name}`}>
                      <button type="button" onClick={() => onEdit(vendor)}>
                        Edit vendor
                      </button>
                      <button type="button" className="inv-danger" onClick={() => setToDelete(vendor)}>
                        Delete vendor
                      </button>
                    </RowMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="vendor-cards">
          {list.map((vendor) => (
            <li key={vendor.id} className="vendor-card">
              <div className="vendor-card__head">
                <span className="vendor-card__avatar" aria-hidden="true">
                  {vendorInitials(vendor.name)}
                </span>
                <div className="vendor-card__title">
                  <div className="vendor-card__name">{vendor.name}</div>
                  <div className="vendor-card__specialty">{vendor.specialty || 'No specialty set'}</div>
                </div>
                <div className="vendor-card__actions">
                  <IconButton label={`Edit ${vendor.name}`} icon={<EditIcon />} onClick={() => onEdit(vendor)} />
                  <IconButton
                    label={`Delete ${vendor.name}`}
                    icon={<TrashIcon />}
                    tone="danger"
                    onClick={() => setToDelete(vendor)}
                  />
                </div>
              </div>
              <ul className="vendor-card__facts">
                {/* Skipped when it only repeats the name above it. */}
                {vendor.contactPerson && vendor.contactPerson.trim().toLowerCase() !== vendor.name.trim().toLowerCase() && (
                  <li>
                    <FactIcon kind="person" />
                    <span>{vendor.contactPerson}</span>
                  </li>
                )}
                <li>
                  <FactIcon kind="phone" />
                  {phonesOf(vendor).length > 0 ? (
                    <span>
                      {phonesOf(vendor).map((number, i) => (
                        <span key={number}>
                          {i > 0 && ' / '}
                          <a href={`tel:${number}`}>{number}</a>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="vendor-card__missing">No phone added</span>
                  )}
                </li>
                {vendor.email && (
                  <li>
                    <FactIcon kind="email" />
                    <a href={`mailto:${vendor.email}`}>{vendor.email}</a>
                  </li>
                )}
              </ul>
              {vendor.notes && <p className="vendor-card__notes">{vendor.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`Delete ${toDelete.name}?`}
          message={`This vendor will be removed from your vendor list. ${deleteNote}`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete vendor'}
          danger
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
