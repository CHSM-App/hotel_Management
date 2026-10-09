import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import IconButton from '../../components/IconButton';
import { EditIcon, TrashIcon } from '../../components/ActionIcons';
import Req from '../../components/RequiredMark';
import { Modal } from './HousekeepingParts';
import './forms.css';
import './chartSections.css';
import './MenuPanel.css';
import PageLoader from '../../components/PageLoader';

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyCategoryForm = { name: '', basePrice: '', tapeOrder: '' };
const emptyChargeForm = { name: '', chargePerNight: '', isCounter: false };
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

// Each inline-add form (categories, extras, seasons) is its own independent
// error state below its own list — a list long enough to push the form and
// its banner off the bottom of the screen, especially while editing a row
// near the top. This factory gives each section the same failOn/fieldErr/
// invalid/reportError shape the rest of the app's forms use, without three
// hand-copied blocks that could drift apart.
function useSectionErrors(setError) {
  const [fieldError, setFieldError] = useState(null);
  const errorRef = useRef(null);
  const reportError = (message) => {
    setError(message);
    setFieldError(null);
    requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };
  // Field-only: the message sits under the box that caused it, so it must not
  // also go into the banner above — that was showing the same line twice.
  const failOn = (id, message) => {
    setFieldError({ id, message });
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const fieldErr = (id) =>
    id && fieldError?.id === id ? <p className="field__error">{fieldError.message}</p> : null;
  const invalid = (id) => Boolean(id) && fieldError?.id === id;
  const clear = () => setFieldError(null);
  // The ref is returned separately from the rest: bundling it into the same
  // object as the render-time helpers below (fieldErr, invalid) trips
  // react-hooks/refs, which treats any object carrying a ref as unsafe to
  // touch during render — even though these two never read errorRef.current.
  return [errorRef, { reportError, failOn, fieldErr, invalid, clear }];
}

export default function PriceChartPanel() {
  const session = getSession();
  const [categories, setCategories] = useState(() => readCache('/categories'));
  const [switchableCharges, setSwitchableCharges] = useState(() => readCache('/switchable-charges'));
  const [seasons, setSeasons] = useState(() => readCache('/seasons'));
  const [error, setError] = useState('');

  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [categoryError, setCategoryError] = useState('');
  const [categoryErrorRef, categoryErrors] = useSectionErrors(setCategoryError);
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  // The category popup, for adding one and for editing one.
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [deleteModalCategory, setDeleteModalCategory] = useState(null);
  const [deleteModalCategoryError, setDeleteModalCategoryError] = useState('');
  const [deleteModalCategoryBusy, setDeleteModalCategoryBusy] = useState(false);

  const [chargeForm, setChargeForm] = useState(emptyChargeForm);
  const [chargeError, setChargeError] = useState('');
  const [chargeErrorRef, chargeErrors] = useSectionErrors(setChargeError);
  const [chargeSubmitting, setChargeSubmitting] = useState(false);
  const [editingChargeId, setEditingChargeId] = useState(null);
  const [chargeModalOpen, setChargeModalOpen] = useState(false);
  const [deleteModalCharge, setDeleteModalCharge] = useState(null);
  const [deleteModalChargeError, setDeleteModalChargeError] = useState('');
  const [deleteModalChargeBusy, setDeleteModalChargeBusy] = useState(false);

  const [seasonForm, setSeasonForm] = useState(emptySeasonForm);
  const [seasonError, setSeasonError] = useState('');
  const [seasonErrorRef, seasonErrors] = useSectionErrors(setSeasonError);
  const [seasonSubmitting, setSeasonSubmitting] = useState(false);
  const [editingSeasonId, setEditingSeasonId] = useState(null);
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
  const [seasonDeletingId, setSeasonDeletingId] = useState(null);
  const [confirmDeleteSeasonId, setConfirmDeleteSeasonId] = useState(null);

  const loadAll = () => {
    Promise.all([
      apiGet('/categories', { token: session?.token }),
      apiGet('/switchable-charges', { token: session?.token }),
      apiGet('/seasons', { token: session?.token }),
    ])
      .then(([categoriesData, chargesData, seasonsData]) => {
        setCategories(writeCache('/categories', categoriesData.categories));
        setSwitchableCharges(writeCache('/switchable-charges', chargesData.switchableCharges));
        setSeasons(writeCache('/seasons', seasonsData.seasons));
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
  const openAddCategory = () => {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryError('');
    categoryErrors.clear();
    setCategoryModalOpen(true);
  };

  const openEditCategory = (c) => {
    setEditingCategoryId(c.id);
    setCategoryForm({ name: c.name, basePrice: String(c.basePrice), tapeOrder: c.tapeOrder ? String(c.tapeOrder) : '' });
    setCategoryError('');
    categoryErrors.clear();
    setCategoryModalOpen(true);
  };

  const closeCategoryModal = () => {
    if (categorySubmitting) return;
    setCategoryModalOpen(false);
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryError('');
    categoryErrors.clear();
  };

  const handleSubmitCategory = async (e) => {
    e.preventDefault();
    setCategoryError('');
    categoryErrors.clear();
    if (!categoryForm.name.trim()) {
      categoryErrors.failOn('categoryName', 'Enter a category name.');
      return;
    }
    if (!categoryForm.basePrice || Number(categoryForm.basePrice) <= 0) {
      categoryErrors.failOn('categoryBasePrice', 'Enter a base price greater than 0.');
      return;
    }
    setCategorySubmitting(true);
    try {
      const body = {
        name: categoryForm.name.trim(),
        basePrice: Number(categoryForm.basePrice),
        tapeOrder: categoryForm.tapeOrder ? Number(categoryForm.tapeOrder) : null,
      };
      if (editingCategoryId) {
        await apiPatch(`/categories/${editingCategoryId}`, body, { token: session?.token });
      } else {
        await apiPost('/categories', body, { token: session?.token });
      }
      setCategoryModalOpen(false);
      setEditingCategoryId(null);
      setCategoryForm(emptyCategoryForm);
      loadAll();
    } catch (err) {
      if (err instanceof ApiError && err.field && document.getElementById(err.field)) {
        categoryErrors.failOn(err.field, err.message);
      } else {
        categoryErrors.reportError(
          err instanceof ApiError ? err.message : `Could not ${editingCategoryId ? 'save' : 'add'} the category.`
        );
      }
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
  const openAddCharge = () => {
    setEditingChargeId(null);
    setChargeForm(emptyChargeForm);
    setChargeError('');
    chargeErrors.clear();
    setChargeModalOpen(true);
  };

  const openEditCharge = (c) => {
    setEditingChargeId(c.id);
    setChargeForm({ name: c.name, chargePerNight: String(c.chargePerNight), isCounter: Boolean(c.isCounter) });
    setChargeError('');
    chargeErrors.clear();
    setChargeModalOpen(true);
  };

  const closeChargeModal = () => {
    if (chargeSubmitting) return;
    setChargeModalOpen(false);
    setEditingChargeId(null);
    setChargeForm(emptyChargeForm);
    setChargeError('');
    chargeErrors.clear();
  };

  const handleSubmitCharge = async (e) => {
    e.preventDefault();
    setChargeError('');
    chargeErrors.clear();
    if (!chargeForm.name.trim()) {
      chargeErrors.failOn('chargeName', 'Enter a charge name.');
      return;
    }
    if (!chargeForm.chargePerNight || Number(chargeForm.chargePerNight) <= 0) {
      chargeErrors.failOn('chargeAmount', 'Enter an amount greater than 0.');
      return;
    }
    setChargeSubmitting(true);
    try {
      const body = { name: chargeForm.name.trim(), chargePerNight: Number(chargeForm.chargePerNight), isCounter: chargeForm.isCounter };
      if (editingChargeId) {
        await apiPatch(`/switchable-charges/${editingChargeId}`, body, { token: session?.token });
      } else {
        await apiPost('/switchable-charges', body, { token: session?.token });
      }
      setChargeModalOpen(false);
      setEditingChargeId(null);
      setChargeForm(emptyChargeForm);
      loadAll();
    } catch (err) {
      if (err instanceof ApiError && err.field && document.getElementById(err.field)) {
        chargeErrors.failOn(err.field, err.message);
      } else {
        chargeErrors.reportError(
          err instanceof ApiError ? err.message : `Could not ${editingChargeId ? 'save' : 'add'} the extra.`
        );
      }
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
    seasonErrors.clear();
    setSeasonModalOpen(true);
  };

  const openAddSeason = () => {
    setEditingSeasonId(null);
    setSeasonForm(emptySeasonForm());
    setSeasonError('');
    seasonErrors.clear();
    setSeasonModalOpen(true);
  };

  const closeSeasonModal = () => {
    if (seasonSubmitting) return;
    setSeasonModalOpen(false);
    setEditingSeasonId(null);
    setSeasonForm(emptySeasonForm());
    setSeasonError('');
    seasonErrors.clear();
  };

  const handleSubmitSeason = async (e) => {
    e.preventDefault();
    setSeasonError('');
    seasonErrors.clear();
    if (!seasonForm.name.trim()) {
      seasonErrors.failOn('seasonName', 'Enter a season name.');
      return;
    }
    if (seasonForm.adjustmentPercent === '') {
      seasonErrors.failOn('seasonAdjustment', 'Enter an adjustment percentage.');
      return;
    }
    if (seasonForm.endDate < seasonForm.startDate) {
      seasonErrors.failOn('seasonEndDate', 'End date must be on or after the start date.');
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
      setSeasonModalOpen(false);
      setEditingSeasonId(null);
      setSeasonForm(emptySeasonForm());
      loadAll();
    } catch (err) {
      if (err instanceof ApiError && err.field && document.getElementById(err.field)) {
        seasonErrors.failOn(err.field, err.message);
      } else {
        seasonErrors.reportError(
          err instanceof ApiError ? err.message : `Could not ${editingSeasonId ? 'save' : 'add'} the season.`
        );
      }
    } finally {
      setSeasonSubmitting(false);
    }
  };

  const handleDeleteSeason = async (s) => {
    setSeasonError('');
    seasonErrors.clear();
    setSeasonDeletingId(s.id);
    try {
      await apiDelete(`/seasons/${s.id}`, { token: session?.token });
      setConfirmDeleteSeasonId(null);
      loadAll();
    } catch (err) {
      seasonErrors.reportError(err instanceof ApiError ? err.message : 'Could not delete this season.');
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
        <PageLoader inline label="Loading the price chart" />
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
                  {c.isDormitory ? '/bed/night' : '/night'}
                  <span className="chart-row__actions">
                    <IconButton
                      label={`Edit ${c.name}`}
                      icon={<EditIcon />}
                      onClick={() => openEditCategory(c)}
                    />
                    <IconButton
                      label={`Delete ${c.name}`}
                      icon={<TrashIcon />}
                      tone="danger"
                      onClick={() => {
                        setDeleteModalCategory(c);
                        setDeleteModalCategoryError('');
                      }}
                    />
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="chart-section__add">
          <button type="button" className="btn-accent" onClick={openAddCategory}>
            + Add New Category
          </button>
        </div>
      </ChartSection>

      {categoryModalOpen && (
        <Modal
          title={editingCategoryId ? 'Edit category' : 'Add new category'}
          sub="Base price is the cheapest version of that room, per night."
          busy={categorySubmitting}
          onClose={closeCategoryModal}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={closeCategoryModal} disabled={categorySubmitting}>
                Cancel
              </button>
              <button type="submit" form="categoryForm" className="btn-accent" disabled={categorySubmitting}>
                {categorySubmitting ? 'Saving…' : editingCategoryId ? 'Save changes' : 'Add category'}
              </button>
            </>
          }
        >
          <form id="categoryForm" onSubmit={handleSubmitCategory}>
            {categoryError && (
              <div ref={categoryErrorRef} className="form-banner form-banner--error form-banner--flash">
                {categoryError}
              </div>
            )}
            <div className="field">
              <label htmlFor="categoryName">
                Category name
                <Req />
              </label>
              <input
                id="categoryName"
                aria-invalid={categoryErrors.invalid('categoryName')}
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Deluxe"
                autoFocus
              />
              {categoryErrors.fieldErr('categoryName')}
            </div>
            <div className="field">
              <label htmlFor="categoryBasePrice">
                {categories.find((c) => c.id === editingCategoryId)?.isDormitory ? 'Base price per bed, per night (₹)' : 'Base price per night (₹)'}
                <Req />
              </label>
              <input
                id="categoryBasePrice"
                type="number"
                min="1"
                aria-invalid={categoryErrors.invalid('categoryBasePrice')}
                value={categoryForm.basePrice}
                onChange={(e) => setCategoryForm((f) => ({ ...f, basePrice: e.target.value }))}
                placeholder="e.g. 1500"
              />
              {categoryErrors.fieldErr('categoryBasePrice')}
            </div>
            <div className="field">
              <label htmlFor="categoryTapeOrder">Position on the room chart (optional)</label>
              <input
                id="categoryTapeOrder"
                type="number"
                min="1"
                value={categoryForm.tapeOrder}
                onChange={(e) => setCategoryForm((f) => ({ ...f, tapeOrder: e.target.value }))}
                placeholder="e.g. 1 for first"
              />
              <small className="chart-section__field-hint">The other categories shift to make room. Leave blank to place it last.</small>
            </div>
          </form>
        </Modal>
      )}

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
                  {formatPrice(c.chargePerNight)}
                  {c.isCounter ? ' per unit/night' : '/night'}
                  <span className="chart-row__actions">
                    <IconButton
                      label={`Edit ${c.name}`}
                      icon={<EditIcon />}
                      onClick={() => openEditCharge(c)}
                    />
                    <IconButton
                      label={`Delete ${c.name}`}
                      icon={<TrashIcon />}
                      tone="danger"
                      onClick={() => {
                        setDeleteModalCharge(c);
                        setDeleteModalChargeError('');
                      }}
                    />
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="chart-section__add">
          <button type="button" className="btn-accent" onClick={openAddCharge}>
            + Add New Extra
          </button>
        </div>
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
                        <IconButton
                          label={`Edit ${s.name}`}
                          icon={<EditIcon />}
                          onClick={() => openEditSeason(s)}
                        />
                        <IconButton
                          label={`Delete ${s.name}`}
                          icon={<TrashIcon />}
                          tone="danger"
                          onClick={() => setConfirmDeleteSeasonId(s.id)}
                        />
                      </>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="chart-section__add">
          <button type="button" className="btn-accent" onClick={openAddSeason}>
            + Add New Season
          </button>
        </div>
      </ChartSection>

      {chargeModalOpen && (
        <Modal
          title={editingChargeId ? 'Edit booking extra' : 'Add new booking extra'}
          sub="An optional add-on staff can tick for a guest at booking time."
          busy={chargeSubmitting}
          onClose={closeChargeModal}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={closeChargeModal} disabled={chargeSubmitting}>
                Cancel
              </button>
              <button type="submit" form="chargeForm" className="btn-accent" disabled={chargeSubmitting}>
                {chargeSubmitting ? 'Saving…' : editingChargeId ? 'Save changes' : 'Add extra'}
              </button>
            </>
          }
        >
          <form id="chargeForm" onSubmit={handleSubmitCharge}>
            {chargeError && (
              <div ref={chargeErrorRef} className="form-banner form-banner--error form-banner--flash">
                {chargeError}
              </div>
            )}
            <div className="field">
              <label htmlFor="chargeName">
                Name
                <Req />
              </label>
              <input
                id="chargeName"
                aria-invalid={chargeErrors.invalid('chargeName')}
                value={chargeForm.name}
                onChange={(e) => setChargeForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. AC, Extra bed"
                autoFocus
              />
              {chargeErrors.fieldErr('chargeName')}
            </div>
            <div className="field">
              <label htmlFor="chargeAmount">
                {chargeForm.isCounter ? 'Amount per unit, per night (₹)' : 'Amount per night (₹)'}
                <Req />
              </label>
              <input
                id="chargeAmount"
                type="number"
                min="1"
                aria-invalid={chargeErrors.invalid('chargeAmount')}
                value={chargeForm.chargePerNight}
                onChange={(e) => setChargeForm((f) => ({ ...f, chargePerNight: e.target.value }))}
                placeholder="e.g. 200"
              />
              {chargeErrors.fieldErr('chargeAmount')}
            </div>
            {/* For an extra a guest can take more than one of. Booking then asks
                how many, and the amount is multiplied by that count. */}
            <label className="inline-add-form__check">
              <input
                type="checkbox"
                checked={chargeForm.isCounter}
                onChange={(e) => setChargeForm((f) => ({ ...f, isCounter: e.target.checked }))}
              />
              <span>
                Charge per unit
                <small>Tick if a guest can take more than one (like extra beds); the amount is multiplied by the quantity entered at booking.</small>
              </span>
            </label>
          </form>
        </Modal>
      )}

      {seasonModalOpen && (
        <Modal
          title={editingSeasonId ? 'Edit season' : 'Add new season'}
          sub="Raise or lower every room rate for a festival, a weekend or an off-season."
          busy={seasonSubmitting}
          onClose={closeSeasonModal}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={closeSeasonModal} disabled={seasonSubmitting}>
                Cancel
              </button>
              <button type="submit" form="seasonForm" className="btn-accent" disabled={seasonSubmitting}>
                {seasonSubmitting ? 'Saving…' : editingSeasonId ? 'Save changes' : 'Add season'}
              </button>
            </>
          }
        >
          <form id="seasonForm" onSubmit={handleSubmitSeason}>
            {seasonError && (
              <div ref={seasonErrorRef} className="form-banner form-banner--error form-banner--flash">
                {seasonError}
              </div>
            )}
            <div className="field">
              <label htmlFor="seasonName">
                Season name
                <Req />
              </label>
              <input
                id="seasonName"
                aria-invalid={seasonErrors.invalid('seasonName')}
                value={seasonForm.name}
                onChange={(e) => setSeasonForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Diwali"
                autoFocus
              />
              {seasonErrors.fieldErr('seasonName')}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="seasonStartDate">From</label>
                <input
                  id="seasonStartDate"
                  type="date"
                  value={seasonForm.startDate}
                  onChange={(e) => setSeasonForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="seasonEndDate">To</label>
                <input
                  id="seasonEndDate"
                  type="date"
                  aria-invalid={seasonErrors.invalid('seasonEndDate')}
                  value={seasonForm.endDate}
                  onChange={(e) => setSeasonForm((f) => ({ ...f, endDate: e.target.value }))}
                />
                {seasonErrors.fieldErr('seasonEndDate')}
              </div>
            </div>
            <div className="field">
              <label htmlFor="seasonAdjustment">
                Price change (%)
                <Req />
              </label>
              <input
                id="seasonAdjustment"
                type="number"
                aria-invalid={seasonErrors.invalid('seasonAdjustment')}
                value={seasonForm.adjustmentPercent}
                onChange={(e) => setSeasonForm((f) => ({ ...f, adjustmentPercent: e.target.value }))}
                placeholder="e.g. 20"
              />
              {seasonErrors.fieldErr('seasonAdjustment')}
              <small className="chart-section__field-hint">20 raises rates by 20%. Use a minus, like -10, to lower them.</small>
            </div>
          </form>
        </Modal>
      )}

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
