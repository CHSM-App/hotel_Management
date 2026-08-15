import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { UNITS, UNIT_LABEL, CATEGORIES, REASON_LABEL, formatQty, groupByCategory } from './inventoryUnits';
import SectionTabs from './SectionTabs';
import RowMenu from './RowMenu';
import './forms.css';
import './InventoryPanel.css';

// OTHER rather than a guess. A material filed under the wrong heading is worse
// than one visibly waiting to be filed — the second sorts to the bottom where
// somebody will notice it.
const emptyMaterialForm = { name: '', unit: 'KG', category: 'OTHER', quantity: '', lowStockThreshold: '' };
const emptyAdjustForm = { mode: 'ADD', quantity: '', note: '' };

function validateMaterial(form, isEditing) {
  const errors = {};

  if (!form.name.trim()) errors.name = 'Material name is required.';

  const threshold = String(form.lowStockThreshold).trim();
  if (threshold !== '') {
    const value = Number(threshold);
    if (!Number.isFinite(value)) errors.lowStockThreshold = 'That needs to be a number.';
    else if (value < 0) errors.lowStockThreshold = 'The low-stock level can’t be negative.';
  }

  if (!isEditing) {
    const opening = String(form.quantity).trim();
    if (opening !== '') {
      const value = Number(opening);
      if (!Number.isFinite(value)) errors.quantity = 'That needs to be a number.';
      else if (value < 0) errors.quantity = 'Opening stock can’t be negative.';
    }
  }

  return errors;
}

export default function InventoryPanel() {
  const session = getSession();
  const [materials, setMaterials] = useState(() => readCache('/inventory/materials'));
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);
  // One group on screen at a time, picked from the strip above it — the same
  // shape the Menu tab uses for its sections. Seventy-three materials stacked
  // under eight headings is a scroll nobody finds anything in.
  const [activeCategory, setActiveCategory] = useState(null);

  const [form, setForm] = useState(emptyMaterialForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [adjusting, setAdjusting] = useState(null);
  const [adjustForm, setAdjustForm] = useState(emptyAdjustForm);

  const [history, setHistory] = useState(null);
  const [movements, setMovements] = useState(null);

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () =>
    apiGet('/inventory/materials', { token: session?.token })
      .then((data) => {
        setMaterials(writeCache('/inventory/materials', data.materials));
        setError('');
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the store cupboard.')
      );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    if (!materials) return [];
    const needle = query.trim().toLowerCase();
    return materials.filter((m) => {
      if (!showRetired && !m.isActive) return false;
      if (lowOnly && !m.isLow && !m.isNegative) return false;
      if (needle && !m.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [materials, query, showRetired, lowOnly]);

  // Every group that has something in it, whatever the search says — this is
  // what the strip is drawn from, so a heading doesn't vanish mid-typing.
  const allGroups = useMemo(
    () => groupByCategory((materials || []).filter((m) => showRetired || m.isActive)),
    [materials, showRetired]
  );

  // Resolved at render rather than corrected in an effect: before the first
  // load there is no selection, and a group can empty out from under the one
  // that is stored. Both fall back to the first group, without the extra
  // render an effect would cost.
  const activeGroup =
    allGroups.find((g) => g.key === activeCategory) ?? allGroups[0] ?? null;

  const searching = query.trim() !== '' || lowOnly;

  // Searching is a question about the whole cupboard, not the group on screen,
  // so it steps over the strip and returns every group with a hit — the same
  // rule the menu search follows.
  const groups = useMemo(() => {
    const filtered = groupByCategory(visible);
    if (searching) return filtered;
    return filtered.filter((g) => g.key === activeGroup?.key);
  }, [visible, searching, activeGroup]);

  const shownCount = groups.reduce((sum, g) => sum + g.materials.length, 0);

  // Counted off the live list rather than the filtered one — the point of the
  // number is to be worth clicking when the filter is off.
  const tally = useMemo(() => {
    const live = (materials || []).filter((m) => m.isActive);
    return {
      total: live.length,
      low: live.filter((m) => m.isLow).length,
      negative: live.filter((m) => m.isNegative).length,
    };
  }, [materials]);

  const openForm = (material) => {
    setEditingId(material?.id ?? null);
    setForm(
      material
        ? {
            name: material.name,
            unit: material.unit,
            category: material.category || 'OTHER',
            quantity: '',
            lowStockThreshold: material.lowStockThreshold ? String(material.lowStockThreshold) : '',
          }
        : emptyMaterialForm
    );
    setFieldErrors({});
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validateMaterial(form, editingId !== null);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setFormError('');
    try {
      const body = {
        name: form.name.trim(),
        category: form.category,
        lowStockThreshold: String(form.lowStockThreshold).trim() === '' ? 0 : Number(form.lowStockThreshold),
      };

      if (editingId) {
        await apiPatch(`/inventory/materials/${editingId}`, body, { token: session?.token });
      } else {
        await apiPost(
          '/inventory/materials',
          {
            ...body,
            unit: form.unit,
            quantity: String(form.quantity).trim() === '' ? 0 : Number(form.quantity),
          },
          { token: session?.token }
        );
      }

      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save that. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const openAdjust = (material) => {
    setAdjusting(material);
    setAdjustForm(emptyAdjustForm);
    setFormError('');
  };

  const handleAdjust = async (e) => {
    e.preventDefault();
    const raw = String(adjustForm.quantity).trim();
    if (raw === '' || !Number.isFinite(Number(raw))) {
      setFormError('Enter a quantity.');
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await apiPost(
        `/inventory/materials/${adjusting.id}/adjust`,
        { mode: adjustForm.mode, quantity: Number(raw), note: adjustForm.note.trim() },
        { token: session?.token }
      );
      setAdjusting(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not record that. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const openHistory = async (material) => {
    setHistory(material);
    setMovements(null);
    try {
      const data = await apiGet(`/inventory/movements?materialId=${material.id}&limit=100`, {
        token: session?.token,
      });
      setMovements(data.movements);
    } catch {
      setMovements([]);
    }
  };

  const toggleRetired = async (material) => {
    try {
      await apiPatch(
        `/inventory/materials/${material.id}/status`,
        { isActive: !material.isActive },
        { token: session?.token }
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that material.');
    }
  };

  const handleDelete = async (material) => {
    const warning =
      material.usedByDishes > 0
        ? `“${material.name}” is used by ${material.usedByDishes} ${
            material.usedByDishes === 1 ? 'dish' : 'dishes'
          } and can’t be deleted. Retire it instead?`
        : `Delete “${material.name}” and its stock history? Retiring it keeps the history.`;

    if (!window.confirm(warning)) return;

    if (material.usedByDishes > 0) {
      await toggleRetired(material);
      return;
    }

    try {
      await apiDelete(`/inventory/materials/${material.id}`, { token: session?.token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that material.');
    }
  };

  if (error && !materials) {
    return <div className="form-banner form-banner--error">{error}</div>;
  }

  if (!materials) {
    return <p className="inv-panel__hint">Loading the store cupboard…</p>;
  }

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div className="inv-bar">
        <div className="inv-bar__row">
          <div className="inv-search">
            <span className="inv-search__icon" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search raw materials"
              aria-label="Search raw materials"
            />
          </div>
          <div className="inv-bar__actions">
            <button type="button" className="btn-accent" onClick={() => openForm(null)}>
              Add material
            </button>
          </div>
        </div>

        <div className="inv-bar__row inv-bar__row--stats">
          <div className="inv-stats">
            <span className="inv-stat">
              {tally.total} {tally.total === 1 ? 'material' : 'materials'}
            </span>
            <button
              type="button"
              className={`inv-stat inv-stat--btn${lowOnly ? ' inv-stat--on' : ''}`}
              onClick={() => setLowOnly((v) => !v)}
            >
              {tally.low} running low
            </button>
            {tally.negative > 0 && (
              <span className="inv-stat inv-stat--bad">{tally.negative} below zero</span>
            )}
          </div>

          <label className="checkbox-inline">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
            Show retired
          </label>
        </div>

        {searching && (
          <div className="inv-bar__row inv-bar__searching">
            <span>
              {shownCount} match{shownCount === 1 ? '' : 'es'} across {groups.length} group
              {groups.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="inv-linkbtn"
              onClick={() => {
                setQuery('');
                setLowOnly(false);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Hidden while searching, when the results decide what's shown. */}
      {!searching && allGroups.length > 0 && (
        <SectionTabs
          ariaLabel="Store cupboard groups"
          activeId={activeGroup?.key}
          onChange={setActiveCategory}
          tabs={allGroups.map((group) => {
            const bad = group.materials.filter((m) => m.isNegative || m.isLow).length;
            return {
              id: group.key,
              name: group.label,
              count: group.materials.length,
              // Which shelf needs attention, readable before you open it.
              flagged: bad > 0,
              flagTitle: `${bad} running low or below zero`,
            };
          })}
        />
      )}

      {tally.negative > 0 && (
        <div className="form-banner form-banner--error inv-negative-note">
          Something has been cooked more than the books say you bought. A material below zero means the
          count has drifted — open it, choose <strong>Correct to a counted total</strong>, and put in what
          is actually on the shelf.
        </div>
      )}

      {visible.length === 0 ? (
        <p className="inv-panel__hint">
          {materials.length === 0
            ? 'Nothing in the store cupboard yet. Add the things you buy — rice, oil, paneer — then set what each dish takes out of them on the Recipes tab.'
            : 'No material matches that.'}
        </p>
      ) : (
        groups.map((group) => (
        <div key={group.key} className="inv-section">
          <div className="inv-section__head">
            <h3 className="inv-section__title">{group.label}</h3>
            <span className="inv-section__tally">{group.materials.length}</span>
            {/* Counted within the group so a heading carries its own warning —
                the point of the split is not having to scan the whole list. */}
            {group.materials.some((m) => m.isNegative) && (
              <span className="inv-tag inv-tag--bad">
                {group.materials.filter((m) => m.isNegative).length} below zero
              </span>
            )}
            {group.materials.some((m) => m.isLow) && (
              <span className="inv-tag inv-tag--low">
                {group.materials.filter((m) => m.isLow).length} low
              </span>
            )}
          </div>

        <ul className="inv-list">
          {group.materials.map((material) => (
            <li
              key={material.id}
              className={`inv-item${material.isActive ? '' : ' inv-item--off'}${
                material.isNegative ? ' inv-item--bad' : material.isLow ? ' inv-item--low' : ''
              }`}
            >
              <div className="inv-item__body">
                <div className="inv-item__name">
                  {material.name}
                  {!material.isActive && <span className="inv-tag">Retired</span>}
                  {material.isNegative && <span className="inv-tag inv-tag--bad">Below zero</span>}
                  {!material.isNegative && material.isLow && <span className="inv-tag inv-tag--low">Low</span>}
                </div>
                <div className="inv-item__meta">
                  {material.lowStockThreshold > 0
                    ? `Warn at ${formatQty(material.lowStockThreshold)} ${UNIT_LABEL[material.unit]}`
                    : 'No low-stock warning set'}
                  {material.usedByDishes > 0 && (
                    <>
                      {' · '}
                      {material.usedByDishes} {material.usedByDishes === 1 ? 'dish' : 'dishes'}
                    </>
                  )}
                </div>
              </div>

              <div className="inv-item__qty">
                <span className="inv-item__number">{formatQty(material.quantity)}</span>
                <span className="inv-item__unit">{UNIT_LABEL[material.unit]}</span>
              </div>

              {/* Recording stock is the one thing anyone does here twice in a
                  day, so it stays in the open. The other four were seventy-odd
                  rows' worth of buttons drowning the quantities. */}
              <div className="inv-item__actions">
                <button type="button" className="btn-secondary" onClick={() => openAdjust(material)}>
                  Stock
                </button>
                <RowMenu label={`More actions for ${material.name}`}>
                  <button type="button" onClick={() => openHistory(material)}>
                    History
                  </button>
                  <button type="button" onClick={() => openForm(material)}>
                    Edit material
                  </button>
                  <button type="button" onClick={() => toggleRetired(material)}>
                    {material.isActive ? 'Retire' : 'Restore'}
                  </button>
                  <button type="button" className="inv-danger" onClick={() => handleDelete(material)}>
                    Delete material
                  </button>
                </RowMenu>
              </div>
            </li>
          ))}
        </ul>
        </div>
        ))
      )}

      {showForm && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setShowForm(false)}>
          <div
            className="glass-panel inv-panel__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="materialModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inv-modal__head">
              <h3 id="materialModalTitle">{editingId ? 'Edit material' : 'New raw material'}</h3>
              <button
                type="button"
                className="inv-modal__close"
                onClick={() => setShowForm(false)}
                disabled={submitting}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form className="inv-modal__body" onSubmit={handleSubmit} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              <div className="field">
                <label htmlFor="materialName">Material name</label>
                <input
                  id="materialName"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Basmati rice"
                  autoFocus
                />
                {fieldErrors.name && <span className="field__error">{fieldErrors.name}</span>}
              </div>

              {/* Editable even after stock exists, unlike the unit below:
                  nothing computes with the group, so moving rice from one
                  heading to another only changes where it appears. */}
              <div className="field">
                <label htmlFor="materialCategory">Group</label>
                <select
                  id="materialCategory"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="field__hint">Decides which heading it sits under on this screen.</span>
              </div>

              {editingId ? (
                // The unit is fixed once anything has been counted in it. 500 is
                // a different fact in grams than in kilos, and nothing on the
                // old movements says which one they meant.
                <p className="field__hint inv-modal__note">
                  Counted in <strong>{UNITS.find((u) => u.key === form.unit)?.name}</strong>. The unit can’t
                  be changed once stock has been recorded — retire this and add a new material instead.
                </p>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="materialUnit">Counted in</label>
                    <select
                      id="materialUnit"
                      value={form.unit}
                      onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                    >
                      {UNITS.map((u) => (
                        <option key={u.key} value={u.key}>
                          {u.name} ({u.label})
                        </option>
                      ))}
                    </select>
                    <span className="field__hint">
                      Count stock the way it is bought — rice by the kilo, oil by the litre. Recipes
                      are written in the smaller unit and converted for you, so a dish takes
                      180&nbsp;g of a material stocked in kg.
                    </span>
                  </div>

                  <div className="field">
                    <label htmlFor="materialQty">
                      Stock on hand <span className="field__optional">optional</span>
                    </label>
                    <input
                      id="materialQty"
                      type="number"
                      step="0.001"
                      value={form.quantity}
                      onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                      placeholder="0"
                    />
                    {fieldErrors.quantity && <span className="field__error">{fieldErrors.quantity}</span>}
                  </div>
                </>
              )}

              <div className="field">
                <label htmlFor="materialLow">
                  Warn me below <span className="field__optional">optional</span>
                </label>
                <input
                  id="materialLow"
                  type="number"
                  step="0.001"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm((f) => ({ ...f, lowStockThreshold: e.target.value }))}
                  placeholder="0"
                />
                <span className="field__hint">Leave empty for no warning.</span>
                {fieldErrors.lowStockThreshold && (
                  <span className="field__error">{fieldErrors.lowStockThreshold}</span>
                )}
              </div>

              <div className="inv-panel__modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowForm(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-accent" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {adjusting && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setAdjusting(null)}>
          <div
            className="glass-panel inv-panel__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjustModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inv-modal__head">
              <div>
                <h3 id="adjustModalTitle">{adjusting.name}</h3>
                <p className="inv-modal__sub">
                  {formatQty(adjusting.quantity)} {UNIT_LABEL[adjusting.unit]} on the books
                </p>
              </div>
              <button
                type="button"
                className="inv-modal__close"
                onClick={() => setAdjusting(null)}
                disabled={submitting}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form className="inv-modal__body" onSubmit={handleAdjust} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              <div className="inv-mode">
                <button
                  type="button"
                  className={`inv-mode__option${adjustForm.mode === 'ADD' ? ' inv-mode__option--on' : ''}`}
                  onClick={() => setAdjustForm((f) => ({ ...f, mode: 'ADD' }))}
                >
                  <strong>Stock came in</strong>
                  <span>Add to what’s there</span>
                </button>
                <button
                  type="button"
                  className={`inv-mode__option${adjustForm.mode === 'SET' ? ' inv-mode__option--on' : ''}`}
                  onClick={() => setAdjustForm((f) => ({ ...f, mode: 'SET' }))}
                >
                  <strong>Correct to a counted total</strong>
                  <span>Replace with what you counted</span>
                </button>
              </div>

              <div className="field">
                <label htmlFor="adjustQty">
                  {adjustForm.mode === 'ADD'
                    ? `How much came in (${UNIT_LABEL[adjusting.unit]})`
                    : `Counted on the shelf (${UNIT_LABEL[adjusting.unit]})`}
                </label>
                <input
                  id="adjustQty"
                  type="number"
                  step="0.001"
                  value={adjustForm.quantity}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
                  placeholder="0"
                  autoFocus
                />
                <span className="field__hint">
                  {adjustForm.mode === 'ADD'
                    ? 'A negative number records waste or spillage.'
                    : 'The difference is worked out for you and written to the history.'}
                </span>
              </div>

              <div className="field">
                <label htmlFor="adjustNote">
                  Note <span className="field__optional">optional</span>
                </label>
                <input
                  id="adjustNote"
                  value={adjustForm.note}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder={adjustForm.mode === 'ADD' ? 'Monday delivery' : 'End of month count'}
                  maxLength={200}
                />
              </div>

              <div className="inv-panel__modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAdjusting(null)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-accent" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {history && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => setHistory(null)}>
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="historyModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inv-modal__head">
              <div>
                <h3 id="historyModalTitle">{history.name}</h3>
                <p className="inv-modal__sub">Every movement, newest first</p>
              </div>
              <button
                type="button"
                className="inv-modal__close"
                onClick={() => setHistory(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="inv-modal__body">
              {movements === null ? (
                <p className="inv-panel__hint">Loading…</p>
              ) : movements.length === 0 ? (
                <p className="inv-panel__hint">Nothing has moved yet.</p>
              ) : (
                <ul className="inv-ledger">
                  {movements.map((m) => (
                    <li key={m.id} className="inv-ledger__row">
                      <div className="inv-ledger__what">
                        <span className={`inv-ledger__reason inv-ledger__reason--${m.reason.toLowerCase()}`}>
                          {REASON_LABEL[m.reason] || m.reason}
                        </span>
                        <span className="inv-ledger__detail">
                          {m.orderNumber != null
                            ? `Order #${m.orderNumber}${m.itemName ? ` · ${m.itemName}` : ''}`
                            : m.note || (m.byName ? `by ${m.byName}` : '—')}
                        </span>
                      </div>
                      <div
                        className={`inv-ledger__change${
                          m.changeQty < 0 ? ' inv-ledger__change--out' : ' inv-ledger__change--in'
                        }`}
                      >
                        {m.changeQty > 0 ? '+' : ''}
                        {formatQty(m.changeQty)}
                      </div>
                      <div className="inv-ledger__balance">
                        {formatQty(m.balanceAfter)} {UNIT_LABEL[m.unit]}
                      </div>
                      <div className="inv-ledger__when">
                        {new Date(m.createdAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
