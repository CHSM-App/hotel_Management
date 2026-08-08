import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import './forms.css';
import './chartSections.css';

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyCategoryForm = { name: '', basePrice: '' };
const emptyChargeForm = { name: '', chargePerNight: '' };
const emptySeasonForm = () => ({ name: '', startDate: todayIso(), endDate: todayIso(), adjustmentPercent: '' });

function ChartSection({ title, hint, children }) {
  return (
    <div className="dash-card chart-section">
      <div className="chart-section__header">
        <h3>{title}</h3>
        {hint && <span className="chart-section__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// Shared by categories and booking extras — both can be deactivated or
// permanently deleted (blocked server-side once something references them),
// so a single "Delete" action opens this chooser instead of two buttons.
function DeleteOptionsModal({ title, isActive, error, busy, onDeactivate, onDelete, onClose }) {
  return (
    <div className="glass-backdrop chart-delete-modal__backdrop" onClick={onClose}>
      <div className="glass-panel chart-delete-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Delete {title}</h3>
        <p className="chart-delete-modal__hint">Choose how you want to remove this.</p>

        {error && <div className="form-banner form-banner--error">{error}</div>}

        <div className="chart-delete-modal__options">
          <button type="button" className="chart-delete-modal__option" onClick={onDeactivate} disabled={busy}>
            <strong>{isActive ? 'Deactivate' : 'Activate'}</strong>
            <span>
              {isActive
                ? 'Hide it from new bookings/rooms, but keep its history.'
                : 'Make it available again.'}
            </span>
          </button>
          <button
            type="button"
            className="chart-delete-modal__option chart-delete-modal__option--danger"
            onClick={onDelete}
            disabled={busy}
          >
            <strong>Permanently delete</strong>
            <span>Remove it completely. This can&apos;t be undone, and only works if it&apos;s unused.</span>
          </button>
        </div>

        <div className="chart-delete-modal__actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PriceChartPanel() {
  const session = getSession();
  const [categories, setCategories] = useState(null);
  const [switchableCharges, setSwitchableCharges] = useState(null);
  const [seasons, setSeasons] = useState(null);
  const [error, setError] = useState('');

  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [categoryError, setCategoryError] = useState('');
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [deleteModalCategory, setDeleteModalCategory] = useState(null);
  const [deleteModalCategoryError, setDeleteModalCategoryError] = useState('');
  const [deleteModalCategoryBusy, setDeleteModalCategoryBusy] = useState(false);

  const [chargeForm, setChargeForm] = useState(emptyChargeForm);
  const [chargeError, setChargeError] = useState('');
  const [chargeSubmitting, setChargeSubmitting] = useState(false);
  const [editingChargeId, setEditingChargeId] = useState(null);
  const [deleteModalCharge, setDeleteModalCharge] = useState(null);
  const [deleteModalChargeError, setDeleteModalChargeError] = useState('');
  const [deleteModalChargeBusy, setDeleteModalChargeBusy] = useState(false);

  const [seasonForm, setSeasonForm] = useState(emptySeasonForm);
  const [seasonError, setSeasonError] = useState('');
  const [seasonSubmitting, setSeasonSubmitting] = useState(false);
  const [editingSeasonId, setEditingSeasonId] = useState(null);
  const [seasonDeletingId, setSeasonDeletingId] = useState(null);
  const [confirmDeleteSeasonId, setConfirmDeleteSeasonId] = useState(null);

  const loadAll = () => {
    Promise.all([
      apiGet('/categories', { token: session?.token }),
      apiGet('/switchable-charges', { token: session?.token }),
      apiGet('/seasons', { token: session?.token }),
    ])
      .then(([categoriesData, chargesData, seasonsData]) => {
        setCategories(categoriesData.categories);
        setSwitchableCharges(chargesData.switchableCharges);
        setSeasons(seasonsData.seasons);
        setError('');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load the price chart.');
      });
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Categories
  const openEditCategory = (c) => {
    setEditingCategoryId(c.id);
    setCategoryForm({ name: c.name, basePrice: String(c.basePrice) });
    setCategoryError('');
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryError('');
  };

  const handleSubmitCategory = async (e) => {
    e.preventDefault();
    setCategoryError('');
    if (!categoryForm.name.trim() || !categoryForm.basePrice || Number(categoryForm.basePrice) <= 0) {
      setCategoryError('Enter a name and a base price greater than 0.');
      return;
    }
    setCategorySubmitting(true);
    try {
      const body = { name: categoryForm.name.trim(), basePrice: Number(categoryForm.basePrice) };
      if (editingCategoryId) {
        await apiPatch(`/categories/${editingCategoryId}`, body, { token: session?.token });
      } else {
        await apiPost('/categories', body, { token: session?.token });
      }
      setEditingCategoryId(null);
      setCategoryForm(emptyCategoryForm);
      loadAll();
    } catch (err) {
      setCategoryError(
        err instanceof ApiError ? err.message : `Could not ${editingCategoryId ? 'save' : 'add'} the category.`
      );
    } finally {
      setCategorySubmitting(false);
    }
  };

  const closeCategoryDeleteModal = () => {
    if (deleteModalCategoryBusy) return;
    setDeleteModalCategory(null);
  };

  const handleDeactivateOrActivateCategory = async () => {
    setDeleteModalCategoryError('');
    setDeleteModalCategoryBusy(true);
    try {
      await apiPatch(
        `/categories/${deleteModalCategory.id}/status`,
        { isActive: !deleteModalCategory.isActive },
        { token: session?.token }
      );
      setDeleteModalCategory(null);
      loadAll();
    } catch (err) {
      setDeleteModalCategoryError(err instanceof ApiError ? err.message : 'Could not update this category.');
    } finally {
      setDeleteModalCategoryBusy(false);
    }
  };

  const handlePermanentDeleteCategory = async () => {
    setDeleteModalCategoryError('');
    setDeleteModalCategoryBusy(true);
    try {
      await apiDelete(`/categories/${deleteModalCategory.id}`, { token: session?.token });
      setDeleteModalCategory(null);
      loadAll();
    } catch (err) {
      setDeleteModalCategoryError(err instanceof ApiError ? err.message : 'Could not delete this category.');
    } finally {
      setDeleteModalCategoryBusy(false);
    }
  };

  // Booking extras (switchable charges)
  const openEditCharge = (c) => {
    setEditingChargeId(c.id);
    setChargeForm({ name: c.name, chargePerNight: String(c.chargePerNight) });
    setChargeError('');
  };

  const cancelEditCharge = () => {
    setEditingChargeId(null);
    setChargeForm(emptyChargeForm);
    setChargeError('');
  };

  const handleSubmitCharge = async (e) => {
    e.preventDefault();
    setChargeError('');
    if (!chargeForm.name.trim() || !chargeForm.chargePerNight || Number(chargeForm.chargePerNight) <= 0) {
      setChargeError('Enter a name and an amount greater than 0.');
      return;
    }
    setChargeSubmitting(true);
    try {
      const body = { name: chargeForm.name.trim(), chargePerNight: Number(chargeForm.chargePerNight) };
      if (editingChargeId) {
        await apiPatch(`/switchable-charges/${editingChargeId}`, body, { token: session?.token });
      } else {
        await apiPost('/switchable-charges', body, { token: session?.token });
      }
      setEditingChargeId(null);
      setChargeForm(emptyChargeForm);
      loadAll();
    } catch (err) {
      setChargeError(
        err instanceof ApiError ? err.message : `Could not ${editingChargeId ? 'save' : 'add'} the extra.`
      );
    } finally {
      setChargeSubmitting(false);
    }
  };

  const closeChargeDeleteModal = () => {
    if (deleteModalChargeBusy) return;
    setDeleteModalCharge(null);
  };

  const handleDeactivateOrActivateCharge = async () => {
    setDeleteModalChargeError('');
    setDeleteModalChargeBusy(true);
    try {
      await apiPatch(
        `/switchable-charges/${deleteModalCharge.id}/status`,
        { isActive: !deleteModalCharge.isActive },
        { token: session?.token }
      );
      setDeleteModalCharge(null);
      loadAll();
    } catch (err) {
      setDeleteModalChargeError(err instanceof ApiError ? err.message : 'Could not update this extra.');
    } finally {
      setDeleteModalChargeBusy(false);
    }
  };

  const handlePermanentDeleteCharge = async () => {
    setDeleteModalChargeError('');
    setDeleteModalChargeBusy(true);
    try {
      await apiDelete(`/switchable-charges/${deleteModalCharge.id}`, { token: session?.token });
      setDeleteModalCharge(null);
      loadAll();
    } catch (err) {
      setDeleteModalChargeError(err instanceof ApiError ? err.message : 'Could not delete this extra.');
    } finally {
      setDeleteModalChargeBusy(false);
    }
  };

  // Seasons — nothing else references a season by id, so delete is permanent
  // rather than a deactivate toggle; a lightweight inline confirm guards it.
  const openEditSeason = (s) => {
    setEditingSeasonId(s.id);
    setSeasonForm({
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      adjustmentPercent: String(s.adjustmentPercent),
    });
    setSeasonError('');
  };

  const cancelEditSeason = () => {
    setEditingSeasonId(null);
    setSeasonForm(emptySeasonForm());
    setSeasonError('');
  };

  const handleSubmitSeason = async (e) => {
    e.preventDefault();
    setSeasonError('');
    if (!seasonForm.name.trim() || seasonForm.adjustmentPercent === '') {
      setSeasonError('Enter a name and an adjustment percentage.');
      return;
    }
    if (seasonForm.endDate < seasonForm.startDate) {
      setSeasonError('End date must be on or after the start date.');
      return;
    }
    setSeasonSubmitting(true);
    try {
      const body = {
        name: seasonForm.name.trim(),
        startDate: seasonForm.startDate,
        endDate: seasonForm.endDate,
        adjustmentPercent: Number(seasonForm.adjustmentPercent),
      };
      if (editingSeasonId) {
        await apiPatch(`/seasons/${editingSeasonId}`, body, { token: session?.token });
      } else {
        await apiPost('/seasons', body, { token: session?.token });
      }
      setEditingSeasonId(null);
      setSeasonForm(emptySeasonForm());
      loadAll();
    } catch (err) {
      setSeasonError(
        err instanceof ApiError ? err.message : `Could not ${editingSeasonId ? 'save' : 'add'} the season.`
      );
    } finally {
      setSeasonSubmitting(false);
    }
  };

  const handleDeleteSeason = async (s) => {
    setSeasonError('');
    setSeasonDeletingId(s.id);
    try {
      await apiDelete(`/seasons/${s.id}`, { token: session?.token });
      setConfirmDeleteSeasonId(null);
      loadAll();
    } catch (err) {
      setSeasonError(err instanceof ApiError ? err.message : 'Could not delete this season.');
    } finally {
      setSeasonDeletingId(null);
    }
  };

  if (error) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }

  const loading = !categories || !switchableCharges || !seasons;
  if (loading) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading the price chart…</div>
      </div>
    );
  }

  return (
    <div className="price-chart">
      <ChartSection title="Categories" hint="Base price is the cheapest version of that room">
        {categories.length > 0 && (
          <div className="chart-list">
            {categories.map((c) => (
              <div className="chart-row" key={c.id}>
                <span className="chart-row__name">
                  {c.name}
                  {!c.isActive && <span className="badge badge--off chart-row__badge">Inactive</span>}
                </span>
                <span className="chart-row__value">
                  {formatPrice(c.basePrice)}
                  <span className="chart-row__actions">
                    <button type="button" className="chart-row__link-btn" onClick={() => openEditCategory(c)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="chart-row__link-btn chart-row__link-btn--danger"
                      onClick={() => {
                        setDeleteModalCategory(c);
                        setDeleteModalCategoryError('');
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <form className="inline-add-form" onSubmit={handleSubmitCategory}>
          {categoryError && <div className="form-banner form-banner--error">{categoryError}</div>}
          <div className="inline-add-form__row">
            <input
              value={categoryForm.name}
              onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Deluxe"
            />
            <input
              type="number"
              min="1"
              value={categoryForm.basePrice}
              onChange={(e) => setCategoryForm((f) => ({ ...f, basePrice: e.target.value }))}
              placeholder="Base price ₹"
            />
            {editingCategoryId && (
              <button type="button" className="btn-secondary" onClick={cancelEditCategory} disabled={categorySubmitting}>
                Cancel
              </button>
            )}
            <button className="btn-accent" type="submit" disabled={categorySubmitting}>
              {editingCategoryId
                ? categorySubmitting
                  ? 'Saving…'
                  : 'Save'
                : categorySubmitting
                  ? 'Adding…'
                  : 'Add'}
            </button>
          </div>
        </form>
      </ChartSection>

      <ChartSection title="Booking extras" hint="Optional add-ons staff can check off for a guest at booking time">
        {switchableCharges.length > 0 && (
          <div className="chart-list">
            {switchableCharges.map((c) => (
              <div className="chart-row" key={c.id}>
                <span className="chart-row__name">
                  {c.name}
                  {!c.isActive && <span className="badge badge--off chart-row__badge">Inactive</span>}
                </span>
                <span className="chart-row__value">
                  {formatPrice(c.chargePerNight)}/night
                  <span className="chart-row__actions">
                    <button type="button" className="chart-row__link-btn" onClick={() => openEditCharge(c)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="chart-row__link-btn chart-row__link-btn--danger"
                      onClick={() => {
                        setDeleteModalCharge(c);
                        setDeleteModalChargeError('');
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <form className="inline-add-form" onSubmit={handleSubmitCharge}>
          {chargeError && <div className="form-banner form-banner--error">{chargeError}</div>}
          <div className="inline-add-form__row">
            <input
              value={chargeForm.name}
              onChange={(e) => setChargeForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="AC"
            />
            <input
              type="number"
              min="1"
              value={chargeForm.chargePerNight}
              onChange={(e) => setChargeForm((f) => ({ ...f, chargePerNight: e.target.value }))}
              placeholder="Amount ₹/night"
            />
            {editingChargeId && (
              <button type="button" className="btn-secondary" onClick={cancelEditCharge} disabled={chargeSubmitting}>
                Cancel
              </button>
            )}
            <button className="btn-accent" type="submit" disabled={chargeSubmitting}>
              {editingChargeId
                ? chargeSubmitting
                  ? 'Saving…'
                  : 'Save'
                : chargeSubmitting
                  ? 'Adding…'
                  : 'Add'}
            </button>
          </div>
        </form>
      </ChartSection>

      <ChartSection title="Seasons" hint="Paint festivals and weekends onto the calendar">
        {seasons.length > 0 && (
          <div className="chart-list">
            {seasons.map((s) => (
              <div className="chart-row" key={s.id}>
                <span className="chart-row__name">
                  {s.name}
                  <span className="chart-row__dates">
                    {s.startDate} → {s.endDate}
                  </span>
                </span>
                <span className="chart-row__value">
                  {s.adjustmentPercent > 0 ? '+' : ''}
                  {s.adjustmentPercent}%
                  <span className="chart-row__actions">
                    {confirmDeleteSeasonId === s.id ? (
                      <>
                        <span className="chart-row__confirm-text">Delete?</span>
                        <button
                          type="button"
                          className="chart-row__link-btn chart-row__link-btn--danger"
                          onClick={() => handleDeleteSeason(s)}
                          disabled={seasonDeletingId === s.id}
                        >
                          {seasonDeletingId === s.id ? '…' : 'Yes'}
                        </button>
                        <button
                          type="button"
                          className="chart-row__link-btn"
                          onClick={() => setConfirmDeleteSeasonId(null)}
                          disabled={seasonDeletingId === s.id}
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="chart-row__link-btn" onClick={() => openEditSeason(s)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="chart-row__link-btn chart-row__link-btn--danger"
                          onClick={() => setConfirmDeleteSeasonId(s.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <form className="inline-add-form" onSubmit={handleSubmitSeason}>
          {seasonError && <div className="form-banner form-banner--error">{seasonError}</div>}
          <div className="inline-add-form__row inline-add-form__row--seasons">
            <input
              value={seasonForm.name}
              onChange={(e) => setSeasonForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Diwali"
            />
            <input
              type="date"
              value={seasonForm.startDate}
              onChange={(e) => setSeasonForm((f) => ({ ...f, startDate: e.target.value }))}
            />
            <input
              type="date"
              value={seasonForm.endDate}
              onChange={(e) => setSeasonForm((f) => ({ ...f, endDate: e.target.value }))}
            />
            <input
              type="number"
              value={seasonForm.adjustmentPercent}
              onChange={(e) => setSeasonForm((f) => ({ ...f, adjustmentPercent: e.target.value }))}
              placeholder="+% "
            />
            {editingSeasonId && (
              <button type="button" className="btn-secondary" onClick={cancelEditSeason} disabled={seasonSubmitting}>
                Cancel
              </button>
            )}
            <button className="btn-accent" type="submit" disabled={seasonSubmitting}>
              {editingSeasonId
                ? seasonSubmitting
                  ? 'Saving…'
                  : 'Save'
                : seasonSubmitting
                  ? 'Adding…'
                  : 'Add'}
            </button>
          </div>
        </form>
      </ChartSection>

      {deleteModalCategory && (
        <DeleteOptionsModal
          title={deleteModalCategory.name}
          isActive={deleteModalCategory.isActive}
          error={deleteModalCategoryError}
          busy={deleteModalCategoryBusy}
          onDeactivate={handleDeactivateOrActivateCategory}
          onDelete={handlePermanentDeleteCategory}
          onClose={closeCategoryDeleteModal}
        />
      )}

      {deleteModalCharge && (
        <DeleteOptionsModal
          title={deleteModalCharge.name}
          isActive={deleteModalCharge.isActive}
          error={deleteModalChargeError}
          busy={deleteModalChargeBusy}
          onDeactivate={handleDeactivateOrActivateCharge}
          onDelete={handlePermanentDeleteCharge}
          onClose={closeChargeDeleteModal}
        />
      )}
    </div>
  );
}
