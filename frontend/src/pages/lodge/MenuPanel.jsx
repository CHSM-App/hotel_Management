import { useEffect, useMemo, useRef, useState } from 'react';
import {
  apiGet,
  apiPost,
  apiPatch,
  apiPut,
  apiPostForm,
  apiPatchForm,
  apiDelete,
  ApiError,
  API_BASE,
} from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import SectionTabs from './SectionTabs';
import RowMenu from './RowMenu';
import Req from '../../components/RequiredMark';
import './forms.css';
import './MenuPanel.css';

// Ordered the way an Indian menu is read and the way a kitchen board is written
// — veg, then non-veg. The groups inside a section and the Type dropdown on the
// item form both walk this list, so the two can't disagree. Egg is not a third
// choice: an egg dish is entered as non-veg, which is the side of the line a
// guest reading the marks puts it on anyway.
const FOOD_TYPES = [
  { key: 'VEG', label: 'Veg' },
  { key: 'NON_VEG', label: 'Non-veg' },
];

// Matches menu_items.description in schema.sql and the zod rule guarding it —
// the counter in the form should run out at the same place the API would.
const MAX_DESCRIPTION = 300;

// One photo per dish, matching the single-file limit the upload middleware
// enforces. WEBP included because a phone camera's JPEG of a thali is a couple
// of megabytes and this is the format that halves it.
const DISH_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const emptySectionForm = { name: '', sortOrder: '' };

// Marks a dropdown value as "a section that doesn't exist yet" — the rest of
// the string is its name. Real sections carry a numeric id, so the two can't be
// confused, and a name can never be mistaken for an id.
const NEW_SECTION_PREFIX = 'new:';

// The headings a multi-cuisine Indian menu is normally written under, in the
// order a menu card is read. Deliberately the same list scripts/seed-menu.js
// writes, so a property that was seeded and one that types its own menu end up
// using the same words for the same things — "Starters" on one and "Starter" on
// another is how the same dish gets counted twice in a report.
//
// Suggestions, not a fixed set: a lodge with a bar or a Jain counter types its
// own, and nothing here prevents that.
const SECTION_SUGGESTIONS = [
  'Starters',
  'Soups',
  'Main Course – Indian',
  'Rice & Biryani',
  'Indian Breads',
  'Chinese',
  'Snacks & Fast Food',
  'Desserts',
  'Beverages',
];

const emptyItemForm = {
  categoryId: '',
  name: '',
  description: '',
  price: '',
  foodType: 'VEG',
  sortOrder: '',
  // The photo picked in this form and not yet saved.
  imageFile: null,
  // The filename already on the dish, if it has one. Kept apart from imageFile
  // so the form can tell "there is a photo on file" from "a new one is being
  // attached" — and so removing one can mean removing the saved one.
  currentImage: null,
  removeImage: false,
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

// Same idea for the section form, which until now had no checks of its own and
// so learned about an empty name only from the server, as a banner.
function validateSection(form) {
  const errors = {};

  if (!form.name.trim()) errors.name = 'Section name is required.';

  const sort = String(form.sortOrder).trim();
  if (sort !== '' && (!Number.isInteger(Number(sort)) || Number(sort) < 0)) {
    errors.sortOrder = 'Whole numbers from 0 up.';
  }

  return errors;
}

// Which input each field name belongs to. Declaration order is the order the
// fields appear on the form, so "the first error" is the topmost one — that is
// where the cursor should land, not on whichever the server happened to fail
// on first. Keys match the schema field names in menu.schema.js; the server
// sends one back with a validation error, and it is looked up here.
const SECTION_FIELD_IDS = {
  name: 'sectionName',
  sortOrder: 'sectionSort',
};

const ITEM_FIELD_IDS = {
  categoryId: 'itemSection',
  name: 'itemName',
  description: 'itemDesc',
  portions: 'itemPortions',
  price: 'itemPrice',
  sortOrder: 'itemSort',
};

// Moves the cursor to the first field that has a message under it. Deliberately
// tolerant of a miss: the price input isn't rendered at all when a dish is
// priced by size, and a server field we have no input for (or a plain network
// failure) should leave the message where it is rather than throw.
function focusFirstError(errors, fieldIds) {
  const first = Object.keys(fieldIds).find((key) => errors[key]);
  if (!first) return;

  const el = document.getElementById(fieldIds[first]);
  if (!el) return;

  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Splits a failed request into "this belongs under a field" and "this doesn't".
// A server message only lands inline when it names a field this form actually
// shows; anything else — a 500, a permission error, a dropped connection — has
// no field to sit under and stays in the banner.
function splitApiError(err, fieldIds, fallback) {
  if (err instanceof ApiError && err.field && fieldIds[err.field]) {
    return { fieldErrors: { [err.field]: err.message }, banner: '' };
  }
  return { fieldErrors: {}, banner: err instanceof ApiError ? err.message : fallback };
}

// The section name box, with the standard headings behind it. A plain text
// field, not a picker: anything can be typed, and the list is only a shortcut
// to the ten a menu usually has.
//
// The list opens on focus rather than sitting under the field permanently —
// ten headings laid out as chips took more room than the form they were
// helping with, and read as the answer rather than a suggestion. Same shape as
// GuestNameField on the bookings form, minus the fetching: this list is a
// constant, so there is nothing to debounce and nothing to race.
function SectionNameField({ id, value, invalid, suggestions, onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  // Clicking elsewhere dismisses. On the document rather than the input's blur,
  // because blur fires before the click lands on an option and would close the
  // list out from under the pointer.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentDown);
    return () => document.removeEventListener('mousedown', onDocumentDown);
  }, [open]);

  // Typing narrows the list, so an index taken before it narrowed can point
  // past the end. Clamped as it is read rather than reset in an effect — that
  // costs a second render, and there is nothing here to keep in sync.
  const activeIndex = active < suggestions.length ? active : -1;

  const take = (name) => {
    setOpen(false);
    onPick(name);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && !open) {
      setOpen(true);
      return;
    }
    if (!open || suggestions.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      // Only swallowed when a row is actually highlighted — Enter on a typed
      // name has to keep submitting the form.
      e.preventDefault();
      take(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="menu-suggest" ref={boxRef}>
      <input
        id={id}
        value={value}
        // Deliberately not one of the suggestions: proposing a heading the
        // list below doesn't offer reads as an oversight, and echoing the
        // first row of it is just the same word twice.
        placeholder="Thali"
        autoFocus
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
        aria-invalid={invalid}
        // The browser's own saved-form dropdown would sit on top of this one.
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      />
      {open && suggestions.length > 0 && (
        <ul className="menu-suggest__list" id={`${id}-suggestions`} role="listbox">
          {suggestions.map((name, i) => (
            <li key={name} role="option" aria-selected={i === activeIndex} id={`${id}-suggestion-${i}`}>
              <button
                type="button"
                className={`menu-suggest__option${i === activeIndex ? ' menu-suggest__option--active' : ''}`}
                // mousedown, not click: the input's blur would otherwise race
                // the click and the row would move out from under the cursor.
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(name);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  const [sections, setSections] = useState(() => readCache('/menu'));
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

  // The banner is now only for failures with no field to sit under; anything
  // the server pins to a field goes into the errors map beside it.
  const [formError, setFormError] = useState('');
  const [itemErrors, setItemErrors] = useState({});
  const [sectionErrors, setSectionErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // A dish's sizes, typed on the dish. Empty means one price and nothing to
  // choose, which is what every dish looks like until a size is added.
  const [portionRows, setPortionRows] = useState([]);

  const load = () => {
    apiGet('/menu', { token: session?.token })
      .then((data) => {
        setSections(writeCache('/menu', data.sections));
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
    setSectionErrors({});
    setShowSectionForm(true);
  };

  // Offered only while adding, and only for headings this menu doesn't already
  // have — suggesting "Starters" to a lodge that has one just walks them into
  // the duplicate-name error. Narrows as they type, so it doubles as a
  // "did you mean" for a half-typed name.
  const sectionSuggestions = useMemo(() => {
    if (editingSectionId) return [];
    const taken = new Set((sections ?? []).map((s) => s.name.trim().toLowerCase()));
    const typed = sectionForm.name.trim().toLowerCase();
    return SECTION_SUGGESTIONS.filter(
      (name) => !taken.has(name.toLowerCase()) && (!typed || name.toLowerCase().includes(typed))
    );
  }, [sections, sectionForm.name, editingSectionId]);

  const pickSectionSuggestion = (name) => {
    setSectionForm((f) => ({
      ...f,
      name,
      // The list is in menu-card order, so a suggestion already knows roughly
      // where it belongs — Desserts near the end, Starters at the top. Only
      // filled when the owner hasn't set one: left at the default of 0 a new
      // section lands above everything, which is right for almost none of these.
      sortOrder:
        String(f.sortOrder ?? '').trim() === ''
          ? String(SECTION_SUGGESTIONS.indexOf(name) + 1)
          : f.sortOrder,
    }));
    setSectionErrors({});
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
            imageFile: null,
            currentImage: item.image ?? null,
            removeImage: false,
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

    const errors = validateSection(sectionForm);
    setSectionErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, SECTION_FIELD_IDS);
      return;
    }

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
      const { fieldErrors, banner } = splitApiError(
        err,
        SECTION_FIELD_IDS,
        'Could not save the section.'
      );
      setSectionErrors(fieldErrors);
      setFormError(banner);
      focusFirstError(fieldErrors, SECTION_FIELD_IDS);
    } finally {
      setSubmitting(false);
    }
  };

  const handleItemSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const errors = validateItem(itemForm, portionRows);
    setItemErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, ITEM_FIELD_IDS);
      return;
    }

    const portions = portionRows
      .filter((r) => r.label.trim() !== '')
      .map((r) => ({ label: r.label.trim(), price: Number(r.price) }));

    setSubmitting(true);
    try {
      // A dish can name a section that doesn't exist yet — see offerNewSections.
      // Made first, because the dish needs its id, and with the sort order it
      // has in SECTION_SUGGESTIONS so a menu built this way still reads in menu
      // order rather than in the order the dishes happened to be typed.
      let categoryId = itemForm.categoryId;
      if (categoryId.startsWith(NEW_SECTION_PREFIX)) {
        const name = categoryId.slice(NEW_SECTION_PREFIX.length);
        try {
          const created = await apiPost(
            '/menu/categories',
            { name, sortOrder: SECTION_SUGGESTIONS.indexOf(name) + 1 },
            { token: session?.token }
          );
          categoryId = String(created.id);
        } catch (err) {
          // Caught here rather than falling through to the handler below: this
          // failure is about the section, but the server reports it against
          // `name`, which on this form is the dish's own name box. Left to the
          // generic path it would put "Section name is required" under the
          // dish name. Reported against the picker instead.
          setItemErrors({
            categoryId: err instanceof ApiError ? err.message : 'Could not create that section.',
          });
          focusFirstError({ categoryId: true }, ITEM_FIELD_IDS);
          return; // the finally below still clears `submitting`
        }
      }

      // Multipart rather than JSON now that a dish can carry a photo. Every
      // field goes over as a string, which is what the server's coercions
      // already expected of a form.
      const body = new FormData();
      body.append('categoryId', categoryId);
      body.append('name', itemForm.name);
      body.append('description', itemForm.description);
      // menu_items.price is NOT NULL and stays the dish's own price. With
      // portions on, nothing is ever charged at it — the cheapest portion is
      // written here so anything reading a single price still reads a real
      // one rather than a stale figure from before the sizes existed.
      body.append(
        'price',
        String(portions.length > 0 ? Math.min(...portions.map((p) => p.price)) : itemForm.price)
      );
      body.append('foodType', itemForm.foodType);
      body.append('sortOrder', String(itemForm.sortOrder || 0));
      if (itemForm.imageFile) body.append('image', itemForm.imageFile);
      // Only said when it is meant. Sending it as false on every save would
      // work, but "remove the photo" is a real instruction and shouldn't ride
      // along on edits that never touched it.
      if (itemForm.removeImage && !itemForm.imageFile) body.append('removeImage', 'true');

      const saved = editingItemId
        ? await apiPatchForm(`/menu/items/${editingItemId}`, body, { token: session?.token })
        : await apiPostForm('/menu/items', body, { token: session?.token });

      // Second call on purpose: the dish has to exist before its portions can
      // point at it, and a new dish only gets an id from the response above.
      const savedId = editingItemId || saved.id;
      await apiPut(`/menu/items/${savedId}/portions`, { portions }, { token: session?.token });

      setShowItemForm(false);
      load();
    } catch (err) {
      const { fieldErrors, banner } = splitApiError(err, ITEM_FIELD_IDS, 'Could not save the item.');
      setItemErrors(fieldErrors);
      setFormError(banner);
      focusFirstError(fieldErrors, ITEM_FIELD_IDS);
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
  // A menu with no sections had no way in: the Section dropdown was empty, so
  // "Add item" was disabled, so the only way to a first dish was to know that a
  // section had to be made first. A brand-new property is offered the standard
  // headings here instead, and the one it picks is created with the dish.
  //
  // Only while the menu is genuinely empty. Once there are sections, a picker
  // that can quietly invent an eleventh is a way to end up with "Beverages" and
  // "Drinks" side by side.
  const offerNewSections = Boolean(sections && sections.length === 0);
  const itemSection = sections?.find((s) => String(s.id) === String(itemForm.categoryId)) ?? null;
  // The name behind a `new:` value, for the dialog's subtitle.
  const pendingSectionName = itemForm.categoryId.startsWith(NEW_SECTION_PREFIX)
    ? itemForm.categoryId.slice(NEW_SECTION_PREFIX.length)
    : null;
  // A row counts once it has a name; a named row with no price is an error
  // rather than something to quietly drop, so it isn't filtered out here.
  const namedPortions = portionRows.filter((r) => r.label.trim() !== '');
  const hasSizes = namedPortions.length > 0;

  // What the photo slot shows: the file just picked, else whatever is on the
  // dish already, else nothing. A freshly picked file wins because it is what
  // saving would put there.
  const dishPhotoPreview = itemForm.imageFile
    ? URL.createObjectURL(itemForm.imageFile)
    : !itemForm.removeImage && itemForm.currentImage
      ? `${API_BASE}/menu-images/${itemForm.currentImage}`
      : null;

  // Removing clears a pending file first — one click should undo the last
  // thing done, not skip past it to the saved photo underneath.
  const clearDishPhoto = () => {
    setItemForm((f) =>
      f.imageFile ? { ...f, imageFile: null } : { ...f, removeImage: true, imageFile: null }
    );
  };

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
              // Only while the menu is still loading. An empty menu used to
              // disable this, which left a new property with no way to add a
              // dish and no indication that a section was the missing step —
              // the form now offers to make one.
              disabled={!sections}
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
            No menu yet. Add a section like “Thali” or “Tandoor” — or go straight to
            <button type="button" className="menu-linkbtn" onClick={() => openItemForm(null)}>
              adding a dish
            </button>
            and pick the section it belongs to there.
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
                    <ul className="dish-grid">
                      {group.items.map((item) => (
                        <li
                          className={`dish-card ${item.isAvailable ? '' : 'dish-card--out'}`}
                          key={item.id}
                        >
                          {/* Only where there is one. An empty frame on every
                              dish would make a menu of forty look unfinished
                              rather than photographed selectively. */}
                          {item.image && (
                            <img
                              className="dish-card__photo"
                              src={`${API_BASE}/menu-images/${item.image}`}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <div className="dish-card__main">
                            <div className="dish-card__name">
                              <FoodTypeMark type={item.foodType} />
                              <span className="dish-card__name-text">{item.name}</span>
                              {!item.isAvailable && <span className="badge badge--off">Out</span>}
                            </div>
                            {item.description && (
                              <div className="dish-card__desc">{item.description}</div>
                            )}

                            <div className="dish-card__foot">
                              <div className="dish-card__price">
                                {item.portions.length > 0 ? (
                                  <span className="dish-card__portions">
                                    {item.portions.map((portion) => (
                                      <span className="dish-card__portion" key={portion.id}>
                                        <span className="dish-card__portion-label">
                                          {portion.label}
                                        </span>
                                        {formatPrice(portion.price)}
                                      </span>
                                    ))}
                                  </span>
                                ) : (
                                  formatPrice(item.price)
                                )}
                              </div>
                              {/* The one action a kitchen repeats mid-service
                                  stays in the open; the rest are behind the ⋮. */}
                              <div className="dish-card__actions">
                                <button
                                  type="button"
                                  className="dish-card__toggle"
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
                            </div>
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
            className="glass-panel menu-panel__modal menu-panel__modal--fixed"
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
            <form
              className="menu-modal__body menu-modal__body--fixed"
              onSubmit={handleSectionSubmit}
              noValidate
            >
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              <div className="field">
                <label htmlFor="sectionName">
                  Section name
                  <Req />
                </label>
                <SectionNameField
                  id="sectionName"
                  value={sectionForm.name}
                  invalid={Boolean(sectionErrors.name)}
                  suggestions={sectionSuggestions}
                  onChange={(name) => setSectionForm((f) => ({ ...f, name }))}
                  onPick={pickSectionSuggestion}
                />
                {sectionErrors.name && <p className="field__error">{sectionErrors.name}</p>}
              </div>

              <div className="field">
                <label htmlFor="sectionSort">Order on the menu</label>
                <input
                  id="sectionSort"
                  type="number"
                  value={sectionForm.sortOrder}
                  aria-invalid={Boolean(sectionErrors.sortOrder)}
                  onChange={(e) => setSectionForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  placeholder="0"
                />
                {sectionErrors.sortOrder && (
                  <p className="field__error">{sectionErrors.sortOrder}</p>
                )}
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
                    : pendingSectionName
                      ? `Goes into ${pendingSectionName}, which will be created`
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
                <label htmlFor="itemSection">
                  Section
                  <Req />
                </label>
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
                  {/* Grouped and labelled, so it is clear these are not
                      sections the menu has — picking one makes it. */}
                  {offerNewSections && (
                    <optgroup label="Create a section">
                      {SECTION_SUGGESTIONS.map((name) => (
                        <option key={name} value={`${NEW_SECTION_PREFIX}${name}`}>
                          {name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {pendingSectionName && (
                  <p className="field__hint">
                    <strong>{pendingSectionName}</strong> will be created and this dish added to it.
                  </p>
                )}
                {itemErrors.categoryId && (
                  <p className="field__error">{itemErrors.categoryId}</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="itemName">
                  Dish name
                  <Req />
                </label>
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

              {/* A dish photo is the one thing on this form that sells the
                  dish. Optional and unhurried: a kitchen photographs its
                  signature plates over time, not all forty on the day it
                  writes the menu. */}
              <div className="field">
                <span className="field__label">
                  Photo <span className="field__optional">optional</span>
                </span>

                <div className="menu-photo">
                  {dishPhotoPreview ? (
                    <div className="menu-photo__preview">
                      <img src={dishPhotoPreview} alt={itemForm.name || 'Dish photo'} />
                      <button
                        type="button"
                        className="menu-photo__remove"
                        onClick={clearDishPhoto}
                        aria-label="Remove photo"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="menu-photo__empty" aria-hidden="true">
                      No photo
                    </div>
                  )}

                  <div className="menu-photo__pick">
                    <input
                      id="itemImage"
                      type="file"
                      accept={DISH_IMAGE_ACCEPT}
                      onChange={(e) => {
                        const file = e.target.files[0] || null;
                        // Cleared so re-picking the same file after removing it
                        // still fires a change event.
                        e.target.value = '';
                        if (file) setItemForm((f) => ({ ...f, imageFile: file, removeImage: false }));
                      }}
                    />
                    <span className="field__hint">JPG, PNG or WEBP, up to 5MB.</span>
                  </div>
                </div>
              </div>

              {/* Portions replace the single price rather than sitting beside
                  it — a dish sold as half and full has no one price, and
                  showing an unused box next to the two real ones is how the
                  wrong number ends up on a bill. */}
              {/* tabIndex so a portions error has something to move the cursor
                  to — the block is a list of rows, not one input, and the
                  message names which row is wrong. */}
              <div className="field" id="itemPortions" tabIndex={-1}>
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
                    <label htmlFor="itemPrice">
                      Price
                      <Req />
                    </label>
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

              {/* The same card markup the menu itself uses, so what's checked
                  here is what the menu shows rather than an approximation. */}
              <div className="menu-preview">
                <span className="menu-preview__label">Preview</span>
                <div className="dish-card menu-preview__card">
                  {dishPhotoPreview && (
                    <img className="dish-card__photo" src={dishPhotoPreview} alt="" />
                  )}
                  <div className="dish-card__main">
                    <div className="dish-card__name">
                      <FoodTypeMark type={itemForm.foodType} />
                      <span className="dish-card__name-text">
                        {itemForm.name.trim() || 'Dish name'}
                      </span>
                    </div>
                    {itemForm.description.trim() && (
                      <div className="dish-card__desc">{itemForm.description}</div>
                    )}
                    <div className="dish-card__foot">
                      <div className="dish-card__price">
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
