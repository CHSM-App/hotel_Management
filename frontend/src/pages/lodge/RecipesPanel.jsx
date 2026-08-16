import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPut, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import {
  UNIT_LABEL,
  formatQty,
  groupByCategory,
  recipeUnitLabel,
  toRecipeQty,
  toStockQty,
} from './inventoryUnits';
import './forms.css';
import './InventoryPanel.css';

// Same order the menu editor groups by, so a dish sits in the same place on
// both screens.
const FOOD_TYPES = [
  { key: 'VEG', label: 'Veg' },
  { key: 'NON_VEG', label: 'Non-veg' },
];

function FoodTypeMark({ type }) {
  const className = `food-mark food-mark--${type.toLowerCase().replace('_', '-')}`;
  const label = FOOD_TYPES.find((t) => t.key === type)?.label || type;
  return <span className={className} title={label} aria-label={label} />;
}

// A blank ingredient row. materialId empty means "not chosen yet", which is
// dropped on save rather than refused — a half-typed row the owner abandoned
// shouldn't block the rest of the recipe.
const emptyLine = () => ({ key: Math.random().toString(36).slice(2), materialId: '', quantity: '' });

export default function RecipesPanel() {
  const session = getSession();
  const [dishes, setDishes] = useState(() => readCache('/inventory/recipes'));
  const [materials, setMaterials] = useState(() => readCache('/inventory/materials'));
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);

  // The dish being edited, its sizes, and the rows on screen. `scope` is which
  // size is being written: 'ALL' for one recipe covering every size, or a
  // portion id.
  const [editing, setEditing] = useState(null);
  const [perSize, setPerSize] = useState(false);
  const [scope, setScope] = useState('ALL');
  const [rowsByScope, setRowsByScope] = useState({});

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () =>
    Promise.all([
      apiGet('/inventory/recipes', { token: session?.token }),
      apiGet('/inventory/materials?includeInactive=false', { token: session?.token }),
    ])
      .then(([recipeData, materialData]) => {
        setDishes(writeCache('/inventory/recipes', recipeData.dishes));
        setMaterials(writeCache('/inventory/materials', materialData.materials));
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your dishes.'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const materialById = useMemo(
    () => new Map((materials || []).map((m) => [String(m.id), m])),
    [materials]
  );

  // Seventy-odd materials in one flat dropdown is the same haystack the
  // Inventory list had, so the picker takes the same headings.
  const materialGroups = useMemo(() => groupByCategory(materials || []), [materials]);

  const grouped = useMemo(() => {
    if (!dishes) return [];
    const needle = query.trim().toLowerCase();
    const filtered = dishes.filter((d) => {
      if (missingOnly && d.lineCount > 0 && !d.partialSizes) return false;
      if (needle && !d.name.toLowerCase().includes(needle)) return false;
      return true;
    });

    const out = [];
    for (const dish of filtered) {
      const last = out[out.length - 1];
      if (last && last.categoryId === dish.categoryId) last.dishes.push(dish);
      else out.push({ categoryId: dish.categoryId, categoryName: dish.categoryName, dishes: [dish] });
    }
    return out;
  }, [dishes, query, missingOnly]);

  const tally = useMemo(() => {
    const live = (dishes || []).filter((d) => d.isActive);
    return {
      total: live.length,
      missing: live.filter((d) => d.lineCount === 0).length,
      partial: live.filter((d) => d.partialSizes).length,
    };
  }, [dishes]);

  const openEditor = async (dish) => {
    setFormError('');
    try {
      const { recipe } = await apiGet(`/inventory/recipes/${dish.itemId}`, { token: session?.token });

      // Which mode the dish is already in is read off the rows themselves —
      // there's no flag, for the same reason portions don't have one.
      const sized = recipe.lines.some((l) => l.portionId !== null);
      const next = {};

      // Stored in the material's shelf unit, edited in the fine one — 0.18 kg
      // of rice is shown, and typed back, as 180 g.
      const asRow = (l) => {
        const material = materialById.get(String(l.materialId));
        return {
          key: `l${l.id}`,
          materialId: String(l.materialId),
          quantity: String(material ? toRecipeQty(l.quantity, material.unit) : l.quantity),
        };
      };

      if (sized) {
        for (const portion of recipe.portions) {
          next[String(portion.id)] = recipe.lines
            .filter((l) => String(l.portionId) === String(portion.id))
            .map(asRow);
          if (next[String(portion.id)].length === 0) next[String(portion.id)] = [emptyLine()];
        }
      }

      next.ALL = recipe.lines.filter((l) => l.portionId === null).map(asRow);
      if (next.ALL.length === 0) next.ALL = [emptyLine()];

      setEditing(recipe);
      setPerSize(sized);
      setScope(sized ? String(recipe.portions[0]?.id ?? 'ALL') : 'ALL');
      setRowsByScope(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that recipe.');
    }
  };

  const rows = rowsByScope[scope] || [];

  const setRows = (updater) =>
    setRowsByScope((all) => ({ ...all, [scope]: typeof updater === 'function' ? updater(all[scope] || []) : updater }));

  // Turning sizes on copies the shared recipe into every size, so the common
  // case — "a half plate is the same dish with less of everything" — starts
  // from something to edit down rather than from nothing.
  const enablePerSize = () => {
    setRowsByScope((all) => {
      const next = { ...all };
      for (const portion of editing.portions) {
        const key = String(portion.id);
        if (!next[key] || next[key].length === 0) {
          next[key] = (all.ALL || []).map((r) => ({ ...r, key: Math.random().toString(36).slice(2) }));
          if (next[key].length === 0) next[key] = [emptyLine()];
        }
      }
      return next;
    });
    setPerSize(true);
    setScope(String(editing.portions[0].id));
  };

  // Going back the other way keeps the first size's rows as the shared recipe —
  // dropping straight to an empty list would throw away the typing silently.
  const disablePerSize = () => {
    const firstKey = String(editing.portions[0]?.id ?? 'ALL');
    setRowsByScope((all) => ({
      ...all,
      ALL: (all.ALL || []).some((r) => r.materialId) ? all.ALL : all[firstKey] || [emptyLine()],
    }));
    setPerSize(false);
    setScope('ALL');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError('');

    const lines = [];
    const scopes = perSize ? editing.portions.map((p) => String(p.id)) : ['ALL'];

    for (const key of scopes) {
      const seen = new Set();
      for (const row of rowsByScope[key] || []) {
        // A row where nothing was chosen is an abandoned row, not an error.
        if (!row.materialId && String(row.quantity).trim() === '') continue;

        if (!row.materialId) {
          setFormError('Choose a raw material for every ingredient, or clear the row.');
          return;
        }
        const material = materialById.get(row.materialId);
        const value = Number(row.quantity);
        if (String(row.quantity).trim() === '' || !Number.isFinite(value) || value <= 0) {
          const name = material?.name || 'that ingredient';
          setFormError(`How much ${name} does it take? Quantities have to be above zero.`);
          return;
        }
        if (seen.has(row.materialId)) {
          const name = material?.name || 'That material';
          setFormError(`${name} is listed twice for the same size.`);
          return;
        }
        seen.add(row.materialId);

        // Typed in the fine unit, stored in the material's own. The column keeps
        // three decimals, which is exactly one gram of a kilo — so anything
        // finer than a whole gram rounds away, and half a gram would be stored
        // as nothing at all. Said here rather than silently saving a zero.
        const stored = material ? toStockQty(value, material.unit) : value;
        if (stored <= 0) {
          setFormError(
            `${material?.name || 'That ingredient'} is too small to record — ` +
              `the smallest a recipe can hold is 1 ${recipeUnitLabel(material?.unit)}.`
          );
          return;
        }

        lines.push({
          portionId: key === 'ALL' ? null : Number(key),
          materialId: Number(row.materialId),
          quantity: stored,
        });
      }
    }

    setSubmitting(true);
    try {
      await apiPut(`/inventory/recipes/${editing.itemId}`, { lines }, { token: session?.token });
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save that recipe.');
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !dishes) {
    return <div className="form-banner form-banner--error">{error}</div>;
  }

  if (!dishes) {
    return <p className="inv-panel__hint">Loading your dishes…</p>;
  }

  if (materials && materials.length === 0) {
    return (
      <p className="inv-panel__hint">
        Add what you buy on the <strong>Inventory</strong> tab first — rice, oil, paneer — then come back
        here to say how much of each a dish takes.
      </p>
    );
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
              placeholder="Search dishes"
              aria-label="Search dishes"
            />
          </div>
        </div>

        <div className="inv-bar__row inv-bar__row--stats">
          <div className="inv-stats">
            <span className="inv-stat">
              {tally.total} {tally.total === 1 ? 'dish' : 'dishes'}
            </span>
            <button
              type="button"
              className={`inv-stat inv-stat--btn${missingOnly ? ' inv-stat--on' : ''}`}
              onClick={() => setMissingOnly((v) => !v)}
            >
              {tally.missing} with no recipe
            </button>
            {tally.partial > 0 && <span className="inv-stat inv-stat--bad">{tally.partial} part-done</span>}
          </div>
        </div>
      </div>

      <p className="inv-panel__hint inv-panel__lede">
        A dish with no recipe still sells — it just doesn’t take anything out of the store cupboard when
        it’s cooked.
      </p>

      {grouped.length === 0 ? (
        <p className="inv-panel__hint">No dish matches that.</p>
      ) : (
        grouped.map((group) => (
          <div key={group.categoryId} className="inv-section">
            <div className="inv-section__head">
              <h3 className="inv-section__title">{group.categoryName}</h3>
              <span className="inv-section__tally">{group.dishes.length}</span>
            </div>

            <ul className="inv-list">
              {group.dishes.map((dish) => (
                <li
                  key={dish.itemId}
                  className={`inv-item inv-item--dish${dish.isActive ? '' : ' inv-item--off'}`}
                >
                  <div className="inv-item__body">
                    <div className="inv-item__name">
                      <FoodTypeMark type={dish.foodType} />
                      {dish.name}
                      {!dish.isActive && <span className="inv-tag">Off the menu</span>}
                    </div>
                    <div className="inv-item__meta">
                      {dish.lineCount === 0 ? (
                        <span className="inv-item__missing">No recipe — nothing is deducted</span>
                      ) : (
                        <>
                          {dish.lineCount} {dish.lineCount === 1 ? 'ingredient' : 'ingredients'}
                          {dish.portionCount > 0 && ` · ${dish.portionCount} sizes`}
                        </>
                      )}
                      {dish.partialSizes && (
                        <span className="inv-tag inv-tag--bad">Some sizes have no recipe</span>
                      )}
                    </div>
                  </div>

                  <div className="inv-item__actions">
                    <button type="button" className="btn-secondary" onClick={() => openEditor(dish)}>
                      {dish.lineCount === 0 ? 'Add recipe' : 'Edit recipe'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {editing && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => !submitting && setEditing(null)}>
          <div
            className="glass-panel inv-panel__modal inv-panel__modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipeModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inv-modal__head">
              <div>
                <h3 id="recipeModalTitle">{editing.name}</h3>
                <p className="inv-modal__sub">What one serving takes out of the store cupboard</p>
              </div>
              <button
                type="button"
                className="inv-modal__close"
                onClick={() => setEditing(null)}
                disabled={submitting}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form className="inv-modal__body" onSubmit={handleSave} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              {editing.portions.length > 0 && (
                <>
                  <div className="inv-mode">
                    <button
                      type="button"
                      className={`inv-mode__option${!perSize ? ' inv-mode__option--on' : ''}`}
                      onClick={disablePerSize}
                    >
                      <strong>Same for every size</strong>
                      <span>One recipe, used whichever size is ordered</span>
                    </button>
                    <button
                      type="button"
                      className={`inv-mode__option${perSize ? ' inv-mode__option--on' : ''}`}
                      onClick={enablePerSize}
                    >
                      <strong>Different per size</strong>
                      <span>A half plate takes less than a full one</span>
                    </button>
                  </div>

                  {perSize && (
                    <div className="inv-scopes">
                      {editing.portions.map((portion) => {
                        const filled = (rowsByScope[String(portion.id)] || []).filter(
                          (r) => r.materialId
                        ).length;
                        return (
                          <button
                            key={portion.id}
                            type="button"
                            className={`inv-scopes__tab${
                              scope === String(portion.id) ? ' inv-scopes__tab--on' : ''
                            }`}
                            onClick={() => setScope(String(portion.id))}
                          >
                            {portion.label}
                            <span className={`inv-scopes__count${filled === 0 ? ' inv-scopes__count--none' : ''}`}>
                              {filled}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              <div className="inv-recipe">
                {rows.map((row, index) => {
                  const material = materialById.get(row.materialId);
                  return (
                    <div key={row.key} className="inv-recipe__row">
                      <select
                        value={row.materialId}
                        aria-label="Raw material"
                        onChange={(e) => {
                          const value = e.target.value;
                          setRows((list) =>
                            list.map((r, i) => (i === index ? { ...r, materialId: value } : r))
                          );
                        }}
                      >
                        <option value="">Choose a material…</option>
                        {materialGroups.map((group) => (
                          <optgroup key={group.key} label={group.label}>
                            {group.materials.map((m) => (
                              <option key={m.id} value={String(m.id)}>
                                {m.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>

                      <div className="inv-recipe__qty">
                        <input
                          type="number"
                          // A whole gram is the finest the stored column can
                          // hold, so it is the finest worth stepping in.
                          step="1"
                          min="0"
                          value={row.quantity}
                          placeholder="0"
                          aria-label="Quantity per serving"
                          onChange={(e) => {
                            const value = e.target.value;
                            setRows((list) =>
                              list.map((r, i) => (i === index ? { ...r, quantity: value } : r))
                            );
                          }}
                        />
                        {/* The fine unit, not the shelf one: rice counted by
                            the kilo is cooked by the gram. */}
                        <span className="inv-recipe__unit">
                          {material ? recipeUnitLabel(material.unit) : '—'}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="inv-recipe__remove"
                        aria-label="Remove ingredient"
                        onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}

                <button
                  type="button"
                  className="inv-linkbtn"
                  onClick={() => setRows((list) => [...list, emptyLine()])}
                >
                  + Add an ingredient
                </button>
              </div>

              {materials.length > 0 && rows.some((r) => r.materialId) && (
                <p className="field__hint inv-modal__note">
                  Deducted when a cook ticks this dish off the kitchen screen, multiplied by how many were
                  ordered. Available now:{' '}
                  {rows
                    .filter((r) => r.materialId)
                    .map((r) => {
                      const m = materialById.get(r.materialId);
                      return m ? `${m.name} ${formatQty(m.quantity)} ${UNIT_LABEL[m.unit]}` : null;
                    })
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}

              <div className="inv-panel__modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditing(null)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-accent" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save recipe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
