import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import SectionTabs from './SectionTabs';
import RowMenu from './RowMenu';
import './forms.css';
import './MenuPanel.css';

// Ordered the way an Indian menu is read and the way a kitchen board is written
// — veg, then egg, then non-veg. The groups inside a section and the Type
// dropdown on the item form both walk this list, so the two can't disagree.
const FOOD_TYPES = [
  { key: 'VEG', label: 'Veg' },
  { key: 'EGG', label: 'Egg' },
  { key: 'NON_VEG', label: 'Non-veg' },
];

// Matches menu_items.description in schema.sql and the zod rule guarding it —
// the counter in the form should run out at the same place the API would.
const MAX_DESCRIPTION = 300;

const emptySectionForm = { name: '', sortOrder: '' };
const emptyItemForm = {
  categoryId: '',
  name: '',
  description: '',
  price: '',
  foodType: 'VEG',
  sortOrder: '',
};

// Checked here so a typo comes back against the field that caused it, rather
// than as one banner at the top of the form. The server validates the same
// things again — this is about where the message lands, not about trusting it.
function validateItem(form, portionRows) {
  const errors = {};

  if (!form.categoryId) errors.categoryId = 'Choose a menu section.';
  if (!form.name.trim()) errors.name = 'Item name is required.';
  if (form.description.length > MAX_DESCRIPTION) {
    errors.description = `Keep it under ${MAX_DESCRIPTION} characters.`;
  }

  // With sizes on, the single price is never charged, so it isn't asked for —
  // each size is priced instead, and every named one has to be.
  const named = portionRows.filter((r) => r.label.trim() !== '');
  if (named.length > 0) {
    const seen = new Set();
    for (const row of named) {
      const key = row.label.trim().toLowerCase();
      if (seen.has(key)) {
        errors.portions = `“${row.label.trim()}” is listed twice.`;
        break;
      }
      seen.add(key);

      const value = Number(row.price);
      if (String(row.price).trim() === '' || !Number.isFinite(value) || value < 0) {
        errors.portions = `“${row.label.trim()}” needs a price of 0 or more.`;
        break;
      }
    }
  } else if (String(form.price).trim() === '') {
    errors.price = 'Price is required.';
  } else if (!Number.isFinite(Number(form.price))) {
    errors.price = 'Price must be a number.';
  } else if (Number(form.price) < 0) {
    errors.price = 'Price can’t be negative.';
  }

  const sort = String(form.sortOrder).trim();
  if (sort !== '' && (!Number.isInteger(Number(sort)) || Number(sort) < 0)) {
    errors.sortOrder = 'Whole numbers from 0 up.';
  }

  return errors;
}

// The veg/non-veg mark is the first thing an Indian diner looks for, so it's a
// shape and colour rather than a word — readable before the name is.
function FoodTypeMark({ type }) {
  const className = `food-mark food-mark--${type.toLowerCase().replace('_', '-')}`;
  const label = FOOD_TYPES.find((t) => t.key === type)?.label || type;
  return <span className={className} title={label} aria-label={label} />;
}


// Matched against the name and the description both — an owner looking for the
// paneer dishes shouldn't have to remember which ones are named for it.
function matchesFilters(item, needle, outOnly) {
  if (outOnly && item.isAvailable) return false;
  if (!needle) return true;
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.description || '').toLowerCase().includes(needle)
  );
}

function groupByType(items) {
  return FOOD_TYPES.map((type) => ({
    ...type,
    items: items.filter((item) => item.foodType === type.key),
  })).filter((group) => group.items.length > 0);
}

export default function MenuPanel() {
  const session = getSession();
  const [sections, setSections] = useState(null);
  const [error, setError] = useState('');

  // One section on screen at a time, chosen from the picker above it. A full à
  // la carte menu runs past a hundred dishes; showing all ten sections at once
  // is a scroll nobody can find anything in.
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [query, setQuery] = useState('');
  const [outOnly, setOutOnly] = useState(false);

  const [sectionForm, setSectionForm] = useState(emptySectionForm);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [showSectionForm, setShowSectionForm] = useState(false);

  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [editingItemId, setEditingItemId] = useState(null);
  const [showItemForm, setShowItemForm] = useState(false);

  const [formError, setFormError] = useState('');
  const [itemErrors, setItemErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // A dish's sizes, typed on the dish. Empty means one price and nothing to
  // choose, which is what every dish looks like until a size is added.
  const [portionRows, setPortionRows] = useState([]);

  const load = () => {
    apiGet('/menu', { token: session?.token })
      .then((data) => {
        setSections(data.sections);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the menu.'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSectionForm = (section) => {
    setEditingSectionId(section?.id ?? null);
    setSectionForm(
      section ? { name: section.name, sortOrder: String(section.sortOrder ?? '') } : emptySectionForm
    );
    setFormError('');
    setShowSectionForm(true);
  };

  const openItemForm = (item, categoryId) => {
    setEditingItemId(item?.id ?? null);
    setItemForm(
      item
        ? {
            categoryId: String(item.categoryId),
            name: item.name,
            description: item.description || '',
            price: String(item.price),
            foodType: item.foodType,
            sortOrder: String(item.sortOrder ?? ''),
          }
        : { ...emptyItemForm, categoryId: categoryId ? String(categoryId) : '' }
    );
    setPortionRows((item?.portions ?? []).map((p) => ({ label: p.label, price: String(p.price) })));

    setFormError('');
    setItemErrors({});
    setShowItemForm(true);
  };

  // Escape closes whichever form is open, but never mid-save — a dialog that
  // vanishes while the request is in flight leaves the owner unsure whether
  // the dish was added.
  useEffect(() => {
    if (!showItemForm && !showSectionForm) return undefined;

    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || submitting) return;
      setShowItemForm(false);
      setShowSectionForm(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showItemForm, showSectionForm, submitting]);

  const handleSectionSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const body = { name: sectionForm.name, sortOrder: sectionForm.sortOrder || 0 };
      if (editingSectionId) {
        await apiPatch(`/menu/categories/${editingSectionId}`, body, { token: session?.token });
      } else {
        await apiPost('/menu/categories', body, { token: session?.token });
      }
      setShowSectionForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the section.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleItemSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const errors = validateItem(itemForm, portionRows);
    setItemErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const portions = portionRows
      .filter((r) => r.label.trim() !== '')
      .map((r) => ({ label: r.label.trim(), price: Number(r.price) }));

    setSubmitting(true);
    try {
      const body = {
        categoryId: itemForm.categoryId,
        name: itemForm.name,
        description: itemForm.description,
        // menu_items.price is NOT NULL and stays the dish's own price. With
        // portions on, nothing is ever charged at it — the cheapest portion is
        // written here so anything reading a single price still reads a real
        // one rather than a stale figure from before the sizes existed.
        price: portions.length > 0 ? Math.min(...portions.map((p) => p.price)) : itemForm.price,
        foodType: itemForm.foodType,
        sortOrder: itemForm.sortOrder || 0,
      };

      const saved = editingItemId
        ? await apiPatch(`/menu/items/${editingItemId}`, body, { token: session?.token })
        : await apiPost('/menu/items', body, { token: session?.token });

      // Second call on purpose: the dish has to exist before its portions can
      // point at it, and a new dish only gets an id from the response above.
      const savedId = editingItemId || saved.id;
      await apiPut(`/menu/items/${savedId}/portions`, { portions }, { token: session?.token });

      setShowItemForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the item.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAvailability = async (item) => {
    try {
      await apiPatch(
        `/menu/items/${item.id}/availability`,
        { isAvailable: !item.isAvailable },
        { token: session?.token }
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the item.');
    }
  };

  // Marking a section out is the one bulk write here, and it's asked about
  // first — it takes a whole course off the guest's menu, and it's reached by
  // one tap on a phone in a busy kitchen.
  const setSectionAvailability = async (section, isAvailable) => {
    if (!isAvailable) {
      const on = section.items.filter((i) => i.isAvailable).length;
      if (on === 0) return;
      if (!window.confirm(`Mark all ${on} dish${on === 1 ? '' : 'es'} in “${section.name}” out of stock?`)) {
        return;
      }
    }

    try {
      await apiPatch(
        `/menu/categories/${section.id}/availability`,
        { isAvailable },
        { token: session?.token }
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the section.');
    }
  };

  const toggleSectionActive = async (section) => {
    try {
      await apiPatch(
        `/menu/categories/${section.id}/status`,
        { isActive: !section.isActive },
        { token: session?.token }
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the section.');
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(`Remove “${item.name}” from the menu?`)) return;
    try {
      await apiDelete(`/menu/items/${item.id}`, { token: session?.token });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the item.');
    }
  };

  const deleteSection = async (section) => {
    if (!window.confirm(`Delete the “${section.name}” section?`)) return;
    try {
      await apiDelete(`/menu/categories/${section.id}`, { token: session?.token });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the section.');
    }
  };

  // Resolved at render rather than corrected in an effect: before the first
  // load there is no selection, and deleting the section on screen leaves the
  // stored id pointing at nothing. Both fall back to the first section here,
  // without the extra render an effect would cost.
  const activeSection =
    sections?.find((s) => s.id === activeSectionId) ?? sections?.[0] ?? null;

  const needle = query.trim().toLowerCase();
  const searching = needle !== '' || outOnly;

  const itemCount = sections?.reduce((sum, s) => sum + s.items.length, 0) ?? 0;
  const outOfStock =
    sections?.reduce((sum, s) => sum + s.items.filter((i) => !i.isAvailable).length, 0) ?? 0;

  // Searching is a question about the whole menu, not the section on screen, so
  // it steps over the picker and returns every section that has a hit.
  const shownSections = useMemo(() => {
    if (!sections) return null;
    if (!searching) return activeSection ? [activeSection] : [];
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => matchesFilters(item, needle, outOnly)),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, activeSection, needle, outOnly, searching]);

  const shownCount = shownSections?.reduce((sum, s) => sum + s.items.length, 0) ?? 0;

  const clearSearch = () => {
    setQuery('');
    setOutOnly(false);
  };

  // Named in the dialog header so "Add a dish" says where it's going without
  // the owner having to read the Section field back.
  const itemSection = sections?.find((s) => String(s.id) === String(itemForm.categoryId)) ?? null;
  // A row counts once it has a name; a named row with no price is an error
  // rather than something to quietly drop, so it isn't filtered out here.
  const namedPortions = portionRows.filter((r) => r.label.trim() !== '');
  const hasSizes = namedPortions.length > 0;

  return (
    <div className="menu-panel">
      <div className="menu-bar">
        <div className="menu-bar__row">
          <div className="menu-search">
            <span className="menu-search__icon" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search every section…"
              aria-label="Search the menu by dish name or description"
            />
          </div>
          <div className="menu-bar__actions">
            <button type="button" className="btn-secondary" onClick={() => openSectionForm(null)}>
              + Section
            </button>
            <button
              type="button"
              className="btn-accent"
              onClick={() => openItemForm(null, activeSection?.id)}
              disabled={!sections || sections.length === 0}
            >
              + Add item
            </button>
          </div>
        </div>

        <div className="menu-bar__row menu-bar__row--stats">
          <div className="menu-stats">
            <span className="menu-stat">
              <strong>{sections?.length ?? '—'}</strong> sections
            </span>
            <span className="menu-stat">
              <strong>{itemCount}</strong> dishes
            </span>
            <button
              type="button"
              className={`menu-stat menu-stat--btn ${outOnly ? 'is-on' : ''}`}
              aria-pressed={outOnly}
              onClick={() => setOutOnly((v) => !v)}
              disabled={outOfStock === 0 && !outOnly}
            >
              <strong>{outOfStock}</strong> out of stock
            </button>
          </div>
          {searching && (
            <div className="menu-bar__searching">
              <span>
                {shownCount} match{shownCount === 1 ? '' : 'es'} across {shownSections?.length ?? 0}{' '}
                section{shownSections?.length === 1 ? '' : 's'}
              </span>
              <button type="button" className="menu-linkbtn" onClick={clearSearch}>
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}

      {!error && !sections && (
        <div className="dash-card">
          <div className="dash-state">Loading the menu…</div>
        </div>
      )}

      {!error && sections && sections.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">
            No menu yet. Start with a section like “Breakfast” or “Thali”, then add items to it.
          </div>
        </div>
      )}

      {/* The picker comes before the menu itself: pick a section, then read it.
          It's hidden while searching, when the results decide what's shown.

          A strip of tabs rather than the dropdown this used to be. Ten sections
          is one tap here against two there, every section and its size is
          readable without opening anything, and it matches how the Recipes and
          Inventory tabs pick a group. It scrolls sideways when it has to. */}
      {!error && !searching && sections && sections.length > 0 && (
        <SectionTabs
          ariaLabel="Menu sections"
          activeId={activeSection?.id}
          onChange={setActiveSectionId}
          tabs={sections.map((section) => {
            const out = section.items.filter((i) => !i.isAvailable).length;
            return {
              id: section.id,
              name: section.name,
              count: section.items.length,
              // A section with dishes off the menu is worth seeing before you
              // open it — that is usually why you came looking.
              flagged: out > 0,
              flagTitle: `${out} out of stock`,
              dimmed: !section.isActive,
            };
          })}
        />
      )}

      {!error && searching && shownSections?.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">
            Nothing on the menu matches that.{' '}
            <button type="button" className="menu-linkbtn" onClick={clearSearch}>
              Clear the search
            </button>
          </div>
        </div>
      )}

      {!error &&
        shownSections?.map((section) => {
          const groups = groupByType(section.items);

          return (
            <div
              className={`menu-section ${section.isActive ? '' : 'menu-section--off'}`}
              key={section.id}
            >
              <div className="menu-section__head">
                <div className="menu-section__heading">
                  <h3 className="menu-section__title">
                    {section.name}
                    {!section.isActive && <span className="badge badge--off">Hidden</span>}
                  </h3>
                  <p className="menu-section__meta">
                    {section.items.length} dish{section.items.length === 1 ? '' : 'es'}
                    {groups.map((group) => (
                      <span className="menu-section__tally" key={group.key}>
                        <FoodTypeMark type={group.key} />
                        {group.items.length} {group.label.toLowerCase()}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="menu-section__actions">
                  <button type="button" onClick={() => openItemForm(null, section.id)}>
                    Add item
                  </button>
                  {/* The day-end action, in the open. When the fish is off,
                      every fish dish goes off together — see
                      setCategoryItemsAvailable in menu.service.js. */}
                  {section.items.length > 0 &&
                    (section.items.every((i) => !i.isAvailable) ? (
                      <button type="button" onClick={() => setSectionAvailability(section, true)}>
                        Bring all back
                      </button>
                    ) : (
                      <button type="button" onClick={() => setSectionAvailability(section, false)}>
                        Mark all out
                      </button>
                    ))}
                  <RowMenu label={`More actions for ${section.name}`}>
                    <button type="button" onClick={() => openSectionForm(section)}>
                      Edit section
                    </button>
                    <button type="button" onClick={() => toggleSectionActive(section)}>
                      {section.isActive ? 'Hide from guests' : 'Show to guests'}
                    </button>
                    <button
                      type="button"
                      className="menu-danger"
                      onClick={() => deleteSection(section)}
                    >
                      Delete section
                    </button>
                  </RowMenu>
                </div>
              </div>

              {groups.length === 0 ? (
                <div className="menu-section__empty">Nothing in this section yet.</div>
              ) : (
                groups.map((group) => (
                  <div className="menu-group" key={group.key}>
                    <div className="menu-group__head">
                      <FoodTypeMark type={group.key} />
                      <span className="menu-group__label">{group.label}</span>
                      <span className="menu-group__count">{group.items.length}</span>
                    </div>
                    <ul className="menu-items">
                      {group.items.map((item) => (
                        <li
                          className={`menu-item ${item.isAvailable ? '' : 'menu-item--out'}`}
                          key={item.id}
                        >
                          <FoodTypeMark type={item.foodType} />
                          <div className="menu-item__body">
                            <div className="menu-item__name">
                              {item.name}
                              {!item.isAvailable && (
                                <span className="badge badge--off">Out of stock</span>
                              )}
                            </div>
                            {item.description && (
                              <div className="menu-item__desc">{item.description}</div>
                            )}
                          </div>
                          <div className="menu-item__price">
                            {item.portions.length > 0 ? (
                              <span className="menu-item__portions">
                                {item.portions.map((portion) => (
                                  <span className="menu-item__portion" key={portion.id}>
                                    <span className="menu-item__portion-label">{portion.label}</span>
                                    {formatPrice(portion.price)}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              formatPrice(item.price)
                            )}
                          </div>
                          {/* The one action a kitchen repeats mid-service stays
                              in the open; the rest are behind the ⋮. */}
                          <div className="menu-item__actions">
                            <button
                              type="button"
                              className="menu-item__toggle"
                              onClick={() => toggleAvailability(item)}
                            >
                              {item.isAvailable ? 'Mark out' : 'Back in'}
                            </button>
                            <RowMenu label={`More actions for ${item.name}`}>
                              <button type="button" onClick={() => openItemForm(item)}>
                                Edit dish
                              </button>
                              <button
                                type="button"
                                className="menu-danger"
                                onClick={() => deleteItem(item)}
                              >
                                Delete dish
                              </button>
                            </RowMenu>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          );
        })}

      {showSectionForm && (
        <div
          className="glass-backdrop menu-panel__backdrop"
          onClick={() => !submitting && setShowSectionForm(false)}
        >
          <div
            className="glass-panel menu-panel__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sectionModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-modal__head">
              <h3 id="sectionModalTitle">{editingSectionId ? 'Edit section' : 'New section'}</h3>
              <button
                type="button"
                className="menu-modal__close"
                onClick={() => setShowSectionForm(false)}
                disabled={submitting}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="menu-modal__body" onSubmit={handleSectionSubmit} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              <div className="field">
                <label htmlFor="sectionName">Section name</label>
                <input
                  id="sectionName"
                  value={sectionForm.name}
                  onChange={(e) => setSectionForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Breakfast"
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="sectionSort">Order on the menu</label>
                <input
                  id="sectionSort"
                  type="number"
                  value={sectionForm.sortOrder}
                  onChange={(e) => setSectionForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  placeholder="0"
                />
              </div>

              <div className="menu-panel__modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowSectionForm(false)}
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

      {showItemForm && (
        <div
          className="glass-backdrop menu-panel__backdrop"
          onClick={() => !submitting && setShowItemForm(false)}
        >
          <div
            className="glass-panel menu-panel__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="itemModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-modal__head">
              <div>
                <h3 id="itemModalTitle">{editingItemId ? 'Edit dish' : 'Add a dish'}</h3>
                <p className="menu-modal__sub">
                  {itemSection
                    ? `${editingItemId ? 'In' : 'Goes into'} ${itemSection.name}`
                    : 'Pick the section it belongs to'}
                </p>
              </div>
              <button
                type="button"
                className="menu-modal__close"
                onClick={() => setShowItemForm(false)}
                disabled={submitting}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form className="menu-modal__body" onSubmit={handleItemSubmit} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              <div className="field">
                <label htmlFor="itemSection">Section</label>
                <select
                  id="itemSection"
                  value={itemForm.categoryId}
                  aria-invalid={Boolean(itemErrors.categoryId)}
                  onChange={(e) => setItemForm((f) => ({ ...f, categoryId: e.target.value }))}
                >
                  <option value="">Choose a section</option>
                  {sections?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {itemErrors.categoryId && (
                  <p className="field__error">{itemErrors.categoryId}</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="itemName">Dish name</label>
                <input
                  id="itemName"
                  value={itemForm.name}
                  aria-invalid={Boolean(itemErrors.name)}
                  onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Paneer butter masala"
                  autoFocus
                />
                {itemErrors.name && <p className="field__error">{itemErrors.name}</p>}
              </div>

              {/* Three options, and the one an Indian diner reads first — a
                  dropdown would hide two of them behind a tap and show the
                  mark for none of them. */}
              <div className="field">
                <span className="field__label">Type</span>
                <div className="menu-type">
                  {FOOD_TYPES.map((type) => (
                    <label
                      key={type.key}
                      className={`menu-type__option ${
                        itemForm.foodType === type.key ? 'is-on' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="itemFoodType"
                        value={type.key}
                        checked={itemForm.foodType === type.key}
                        onChange={() => setItemForm((f) => ({ ...f, foodType: type.key }))}
                      />
                      <FoodTypeMark type={type.key} />
                      {type.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label htmlFor="itemDesc">
                  Description <span className="field__optional">optional</span>
                </label>
                <input
                  id="itemDesc"
                  value={itemForm.description}
                  maxLength={MAX_DESCRIPTION}
                  aria-invalid={Boolean(itemErrors.description)}
                  onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Paneer cooked in rich tomato, butter and cream gravy."
                />
                <div className="field__foot">
                  {itemErrors.description ? (
                    <p className="field__error">{itemErrors.description}</p>
                  ) : (
                    <span className="field__hint">Shown under the name on the guest&apos;s menu.</span>
                  )}
                  <span className="field__counter">
                    {itemForm.description.length}/{MAX_DESCRIPTION}
                  </span>
                </div>
              </div>

              {/* Portions replace the single price rather than sitting beside
                  it — a dish sold as half and full has no one price, and
                  showing an unused box next to the two real ones is how the
                  wrong number ends up on a bill. */}
              <div className="field">
                <span className="field__label">
                  Sizes <span className="field__optional">optional</span>
                </span>

                {portionRows.length > 0 && (
                  <div className="menu-portions">
                    {portionRows.map((row, index) => (
                      // Rows have no id until they're saved, so the index is
                      // the only handle there is. It holds because rows are
                      // only appended and removed, never reordered.
                      <div className="menu-portions__row" key={index}>
                        <input
                          className="menu-portions__name"
                          value={row.label}
                          aria-label={`Size ${index + 1} name`}
                          placeholder={index === 0 ? 'Half plate' : 'Full plate'}
                          onChange={(e) =>
                            setPortionRows((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, label: e.target.value } : r))
                            )
                          }
                        />
                        <div className="menu-money">
                          <span className="menu-money__symbol" aria-hidden="true">
                            ₹
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            aria-label={`Price for size ${index + 1}`}
                            value={row.price}
                            onChange={(e) =>
                              setPortionRows((rows) =>
                                rows.map((r, i) => (i === index ? { ...r, price: e.target.value } : r))
                              )
                            }
                            placeholder="0"
                          />
                        </div>
                        <button
                          type="button"
                          className="menu-portions__remove menu-danger"
                          aria-label={`Remove size ${index + 1}`}
                          onClick={() =>
                            setPortionRows((rows) => rows.filter((_, i) => i !== index))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="field__foot">
                  <span className="field__hint">
                    {hasSizes
                      ? 'The dish is ordered by size — the single price below is not charged.'
                      : 'Add a size only if the dish is sold as half and full plates.'}
                  </span>
                  <button
                    type="button"
                    className="menu-linkbtn"
                    onClick={() =>
                      setPortionRows((rows) => [...rows, { label: '', price: '' }])
                    }
                  >
                    + Add a size
                  </button>
                </div>
                {itemErrors.portions && <p className="field__error">{itemErrors.portions}</p>}
              </div>

              <div className="field-row">
                {!hasSizes && (
                  <div className="field">
                    <label htmlFor="itemPrice">Price</label>
                    <div className="menu-money">
                      <span className="menu-money__symbol" aria-hidden="true">
                        ₹
                      </span>
                      <input
                        id="itemPrice"
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={itemForm.price}
                        aria-invalid={Boolean(itemErrors.price)}
                        onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))}
                        placeholder="220"
                      />
                    </div>
                    {itemErrors.price && <p className="field__error">{itemErrors.price}</p>}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="itemSort">
                    Order in section <span className="field__optional">optional</span>
                  </label>
                  <input
                    id="itemSort"
                    type="number"
                    min="0"
                    step="1"
                    value={itemForm.sortOrder}
                    aria-invalid={Boolean(itemErrors.sortOrder)}
                    onChange={(e) => setItemForm((f) => ({ ...f, sortOrder: e.target.value }))}
                    placeholder="0"
                  />
                  {itemErrors.sortOrder ? (
                    <p className="field__error">{itemErrors.sortOrder}</p>
                  ) : (
                    <p className="field__hint">Lower shows first.</p>
                  )}
                </div>
              </div>

              {/* The same row markup the menu itself uses, so what's checked
                  here is what the guest gets rather than an approximation. */}
              <div className="menu-preview">
                <span className="menu-preview__label">Preview</span>
                <div className="menu-item menu-preview__row">
                  <FoodTypeMark type={itemForm.foodType} />
                  <div className="menu-item__body">
                    <div className="menu-item__name">{itemForm.name.trim() || 'Dish name'}</div>
                    {itemForm.description.trim() && (
                      <div className="menu-item__desc">{itemForm.description}</div>
                    )}
                  </div>
                  <div className="menu-item__price">
                    {hasSizes
                      ? namedPortions
                          .map(
                            (r) =>
                              `${r.label.trim()} ${
                                Number.isFinite(Number(r.price)) && String(r.price).trim() !== ''
                                  ? formatPrice(Number(r.price))
                                  : '—'
                              }`
                          )
                          .join(' · ')
                      : String(itemForm.price).trim() !== '' &&
                        Number.isFinite(Number(itemForm.price))
                      ? formatPrice(Number(itemForm.price))
                      : '—'}
                  </div>
                </div>
              </div>

              <p className="menu-panel__hint">
                Half and full plates are two separate items — there are no sizes or add-ons to pick
                on the guest&apos;s side, so what the kitchen sees is exactly what was ordered.
              </p>

              <div className="menu-panel__modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowItemForm(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-accent" disabled={submitting}>
                  {submitting ? 'Saving…' : editingItemId ? 'Save changes' : 'Add dish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
