import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import './forms.css';
import './MenuPanel.css';

const FOOD_TYPES = [
  { key: 'VEG', label: 'Veg' },
  { key: 'NON_VEG', label: 'Non-veg' },
  { key: 'EGG', label: 'Egg' },
];

const emptySectionForm = { name: '', sortOrder: '' };
const emptyItemForm = {
  categoryId: '',
  name: '',
  description: '',
  price: '',
  foodType: 'VEG',
  sortOrder: '',
};

// The veg/non-veg mark is the first thing an Indian diner looks for, so it's a
// shape and colour rather than a word — readable before the name is.
function FoodTypeMark({ type }) {
  const className = `food-mark food-mark--${type.toLowerCase().replace('_', '-')}`;
  const label = FOOD_TYPES.find((t) => t.key === type)?.label || type;
  return <span className={className} title={label} aria-label={label} />;
}

export default function MenuPanel() {
  const session = getSession();
  const [sections, setSections] = useState(null);
  const [error, setError] = useState('');

  const [sectionForm, setSectionForm] = useState(emptySectionForm);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [showSectionForm, setShowSectionForm] = useState(false);

  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [editingItemId, setEditingItemId] = useState(null);
  const [showItemForm, setShowItemForm] = useState(false);

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    setFormError('');
    setShowItemForm(true);
  };

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

    if (!itemForm.categoryId) {
      setFormError('Choose a menu section.');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        categoryId: itemForm.categoryId,
        name: itemForm.name,
        description: itemForm.description,
        price: itemForm.price,
        foodType: itemForm.foodType,
        sortOrder: itemForm.sortOrder || 0,
      };
      if (editingItemId) {
        await apiPatch(`/menu/items/${editingItemId}`, body, { token: session?.token });
      } else {
        await apiPost('/menu/items', body, { token: session?.token });
      }
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

  const itemCount = sections?.reduce((sum, s) => sum + s.items.length, 0) ?? 0;

  return (
    <div className="menu-panel">
      <div className="rooms-panel__toolbar">
        <span className="rooms-panel__count">
          {sections
            ? `${sections.length} section${sections.length === 1 ? '' : 's'} · ${itemCount} item${itemCount === 1 ? '' : 's'}`
            : ' '}
        </span>
        <div className="menu-panel__toolbar-actions">
          <button type="button" className="btn-secondary" onClick={() => openSectionForm(null)}>
            + Section
          </button>
          <button
            type="button"
            className="btn-accent"
            onClick={() => openItemForm(null, sections?.[0]?.id)}
            disabled={!sections || sections.length === 0}
          >
            + Add item
          </button>
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

      {!error &&
        sections?.map((section) => (
          <div className={`menu-section ${section.isActive ? '' : 'menu-section--off'}`} key={section.id}>
            <div className="menu-section__head">
              <div className="menu-section__title">
                {section.name}
                {!section.isActive && <span className="badge badge--off">Hidden</span>}
              </div>
              <div className="menu-section__actions">
                <button type="button" onClick={() => openItemForm(null, section.id)}>
                  Add item
                </button>
                <button type="button" onClick={() => openSectionForm(section)}>
                  Edit
                </button>
                <button type="button" onClick={() => toggleSectionActive(section)}>
                  {section.isActive ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="menu-danger" onClick={() => deleteSection(section)}>
                  Delete
                </button>
              </div>
            </div>

            {section.items.length === 0 ? (
              <div className="menu-section__empty">Nothing in this section yet.</div>
            ) : (
              <ul className="menu-items">
                {section.items.map((item) => (
                  <li className={`menu-item ${item.isAvailable ? '' : 'menu-item--out'}`} key={item.id}>
                    <FoodTypeMark type={item.foodType} />
                    <div className="menu-item__body">
                      <div className="menu-item__name">
                        {item.name}
                        {!item.isAvailable && <span className="badge badge--off">Out of stock</span>}
                      </div>
                      {item.description && <div className="menu-item__desc">{item.description}</div>}
                    </div>
                    <div className="menu-item__price">{formatPrice(item.price)}</div>
                    <div className="menu-item__actions">
                      <button type="button" onClick={() => toggleAvailability(item)}>
                        {item.isAvailable ? 'Mark out' : 'Back in'}
                      </button>
                      <button type="button" onClick={() => openItemForm(item)}>
                        Edit
                      </button>
                      <button type="button" className="menu-danger" onClick={() => deleteItem(item)}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

      {showSectionForm && (
        <div className="glass-backdrop" onClick={() => !submitting && setShowSectionForm(false)}>
          <div className="glass-panel menu-panel__modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingSectionId ? 'Edit section' : 'New section'}</h3>
            <form onSubmit={handleSectionSubmit} noValidate>
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
        <div className="glass-backdrop" onClick={() => !submitting && setShowItemForm(false)}>
          <div className="glass-panel menu-panel__modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingItemId ? 'Edit item' : 'New item'}</h3>
            <form onSubmit={handleItemSubmit} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              <div className="field">
                <label htmlFor="itemSection">Section</label>
                <select
                  id="itemSection"
                  value={itemForm.categoryId}
                  onChange={(e) => setItemForm((f) => ({ ...f, categoryId: e.target.value }))}
                >
                  <option value="">Choose a section</option>
                  {sections?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="itemName">Item name</label>
                <input
                  id="itemName"
                  value={itemForm.name}
                  onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Veg thali"
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="itemDesc">Description</label>
                <input
                  id="itemDesc"
                  value={itemForm.description}
                  onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Two chapati, rice, dal, sabzi"
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="itemPrice">Price</label>
                  <input
                    id="itemPrice"
                    type="number"
                    step="0.01"
                    value={itemForm.price}
                    onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="120"
                  />
                </div>
                <div className="field">
                  <label htmlFor="itemType">Type</label>
                  <select
                    id="itemType"
                    value={itemForm.foodType}
                    onChange={(e) => setItemForm((f) => ({ ...f, foodType: e.target.value }))}
                  >
                    {FOOD_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
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
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
