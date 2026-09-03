import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPostForm, apiPatchForm, apiPatch, apiDelete, ApiError, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { useSearchTerm, matchesSearch } from '../../lib/searchContext';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import IconButton from '../../components/IconButton';
import { EditIcon, TrashIcon } from '../../components/ActionIcons';
import Req from '../../components/RequiredMark';
import StepNum from '../../components/StepNum';
import './forms.css';
import './RoomsPanel.css';

const BED_SIZES = ['SINGLE', 'DOUBLE', 'QUEEN', 'KING'];
const BATHROOM_TYPES = ['ATTACHED', 'COMMON'];
const MAX_ROOM_IMAGES = 6;
const ROOM_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const bedSizeLabel = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };

function bedSummary(room) {
  const beds = room.beds && room.beds.length > 0 ? room.beds : room.bedSize ? [{ size: room.bedSize, count: 1 }] : [];
  if (beds.length === 0) return null;
  return beds.map((b) => `${b.count} ${bedSizeLabel[b.size] || b.size}`).join(' + ');
}
const bathroomTypeLabel = { ATTACHED: 'Attached Bathroom', COMMON: 'Common Bathroom' };

const initialForm = {
  mode: 'single',
  roomNumber: '',
  rangeStart: '',
  rangeEnd: '',
  categoryId: '',
  floor: '',
  beds: [{ size: '', count: '1' }],
  bathroomType: '',
  maxOccupancy: '',
  description: '',
  imageFiles: [],
};

function GuestIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/* Same 12px box and stroke weight as GuestIcon, so the two chip icons sit at
   the same optical size in a row. */
function BathIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12V5.5a2.5 2.5 0 0 1 5 0V6" />
      <path d="M2 12h20v2a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5v-2Z" />
      <path d="M7 19l-1 2M17 19l1 2" />
    </svg>
  );
}

export default function RoomsPanel() {
  const session = getSession();
  // Seeded from what this session already fetched, so coming back to the page
  // paints the rooms immediately instead of showing "Loading rooms…" again
  // while a request crosses the internet to the database.
  const [rooms, setRooms] = useState(() => readCache('/rooms'));
  const [categories, setCategories] = useState(() => readCache('/categories'));
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // The add-room form scrolls (beds, occupancy, photos below the fold), so a
  // failure caught on Save — a blank required field, or the server rejecting
  // the room number as already taken — has to bring itself to the eye rather
  // than rely on already being in view. failOn does that for a single field:
  // it puts the message under the control that caused it, marks the control
  // itself, and scrolls there. reportFormError is the same idea for a failure
  // that isn't any one field's fault (a save that fails after the request is
  // already sent).
  const formErrorRef = useRef(null);
  const reportFormError = (message) => {
    setFormError(message);
    requestAnimationFrame(() => {
      formErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };
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
  const [deleteModalRoom, setDeleteModalRoom] = useState(null);
  const [deleteModalError, setDeleteModalError] = useState('');
  const [deleteModalBusy, setDeleteModalBusy] = useState(false);
  const [statusModalRoom, setStatusModalRoom] = useState(null);
  const [statusModalError, setStatusModalError] = useState('');
  const [statusModalBusy, setStatusModalBusy] = useState(false);
  const [existingImages, setExistingImages] = useState([]);
  // Photos whose file did not load. A room_images row can outlive its file —
  // an upload lost to a deploy, a half-finished delete — and the browser's
  // broken-image glyph is the worst possible answer: it reads as the app being
  // broken rather than the photo being gone. Remembering the failures lets the
  // card fall back to the placeholder it already has for a room with no photos.
  const [brokenPhotos, setBrokenPhotos] = useState(() => new Set());

  const [lightbox, setLightbox] = useState(null);

  const openLightbox = (images, index) => setLightbox({ images, index });
  const closeLightbox = () => setLightbox(null);
  const showPrevImage = () =>
    setLightbox((lb) => (lb ? { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length } : lb));
  const showNextImage = () =>
    setLightbox((lb) => (lb ? { ...lb, index: (lb.index + 1) % lb.images.length } : lb));

  useEffect(() => {
    if (!lightbox) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') showPrevImage();
      if (e.key === 'ArrowRight') showNextImage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(lightbox)]);

  // Refetched on every mount — this only decides whether the panel has
  // anything to show while that is in flight.
  const loadAll = () => {
    Promise.all([
      apiGet('/rooms', { token: session?.token }),
      apiGet('/categories', { token: session?.token }),
    ])
      .then(([roomsData, categoriesData]) => {
        setRooms(writeCache('/rooms', roomsData.rooms));
        setCategories(writeCache('/categories', categoriesData.categories));
        setError('');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load rooms.');
      });
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForm = () => {
    setEditingRoomId(null);
    setForm(initialForm);
    setExistingImages([]);
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (room) => {
    setEditingRoomId(room.id);
    setForm({
      mode: 'single',
      roomNumber: room.roomNumber,
      rangeStart: '',
      rangeEnd: '',
      categoryId: String(room.category.id),
      floor: room.floor || '',
      beds:
        room.beds && room.beds.length > 0
          ? room.beds.map((b) => ({ size: b.size, count: String(b.count) }))
          : [{ size: room.bedSize || '', count: '1' }],
      bathroomType: room.bathroomType || '',
      maxOccupancy: room.maxOccupancy != null ? String(room.maxOccupancy) : '',
      description: room.description || '',
      imageFiles: [],
    });
    setExistingImages(room.images || []);
    setFormError('');
    setShowForm(true);
  };

  const addImageFiles = (fileList) => {
    setForm((f) => {
      const room = MAX_ROOM_IMAGES - existingImages.length - f.imageFiles.length;
      if (room <= 0) return f;
      return { ...f, imageFiles: [...f.imageFiles, ...Array.from(fileList).slice(0, room)] };
    });
  };

  const removeImageFile = (index) => {
    setForm((f) => ({ ...f, imageFiles: f.imageFiles.filter((_, i) => i !== index) }));
  };

  const handleDeleteExistingImage = async (imageId) => {
    if (!editingRoomId) return;
    setFormError('');
    try {
      await apiDelete(`/rooms/${editingRoomId}/images/${imageId}`, { token: session?.token });
      setExistingImages((imgs) => imgs.filter((img) => img.id !== imageId));
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not delete this photo.');
    }
  };

  const closeForm = () => {
    if (submitting) return;
    setShowForm(false);
  };

  const openDeleteModal = (room) => {
    setDeleteModalRoom(room);
    setDeleteModalError('');
  };

  const closeDeleteModal = () => {
    if (deleteModalBusy) return;
    setDeleteModalRoom(null);
  };

  const openStatusModal = (room) => {
    setStatusModalRoom(room);
    setStatusModalError('');
  };

  const closeStatusModal = () => {
    if (statusModalBusy) return;
    setStatusModalRoom(null);
  };

  const handleToggleStatus = async () => {
    setStatusModalError('');
    setStatusModalBusy(true);
    try {
      await apiPatch(
        `/rooms/${statusModalRoom.id}/status`,
        { isActive: !statusModalRoom.isActive },
        { token: session?.token }
      );
      setStatusModalRoom(null);
      loadAll();
    } catch (err) {
      setStatusModalError(err instanceof ApiError ? err.message : 'Could not update this room.');
    } finally {
      setStatusModalBusy(false);
    }
  };

  const handleDeactivateOrActivate = async () => {
    setDeleteModalError('');
    setDeleteModalBusy(true);
    try {
      await apiPatch(
        `/rooms/${deleteModalRoom.id}/status`,
        { isActive: !deleteModalRoom.isActive },
        { token: session?.token }
      );
      setDeleteModalRoom(null);
      loadAll();
    } catch (err) {
      setDeleteModalError(err instanceof ApiError ? err.message : 'Could not update this room.');
    } finally {
      setDeleteModalBusy(false);
    }
  };

  const handlePermanentDelete = async () => {
    setDeleteModalError('');
    setDeleteModalBusy(true);
    try {
      await apiDelete(`/rooms/${deleteModalRoom.id}`, { token: session?.token });
      setDeleteModalRoom(null);
      loadAll();
    } catch (err) {
      setDeleteModalError(err instanceof ApiError ? err.message : 'Could not delete this room.');
    } finally {
      setDeleteModalBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFieldError(null);

    if (!form.categoryId) {
      failOn('categoryId', 'Choose a category.');
      return;
    }
    if ((form.mode === 'single' || editingRoomId) && !form.roomNumber.trim()) {
      failOn('roomNumber', 'Enter a room number.');
      return;
    }
    if (!editingRoomId && form.mode === 'bulk' && !form.rangeStart) {
      failOn('rangeStart', 'Enter the start of the range.');
      return;
    }
    if (!editingRoomId && form.mode === 'bulk' && !form.rangeEnd) {
      failOn('rangeEnd', 'Enter the end of the range.');
      return;
    }
    if (!form.floor.trim()) {
      failOn('floor', 'Enter the floor.');
      return;
    }
    const missingBedSize = form.beds.findIndex((b) => !b.size);
    if (form.beds.length === 0 || missingBedSize !== -1) {
      failOn(`bed-size-${missingBedSize === -1 ? 0 : missingBedSize}`, 'Choose a size for every bed.');
      return;
    }
    const badBedCount = form.beds.findIndex((b) => !b.count || Number(b.count) < 1);
    if (badBedCount !== -1) {
      failOn(`bed-size-${badBedCount}`, 'Each bed needs a count of 1 or more.');
      return;
    }
    if (!form.bathroomType) {
      failOn('bathroomType', 'Choose a bathroom type.');
      return;
    }
    if (!form.maxOccupancy || Number(form.maxOccupancy) <= 0) {
      failOn('maxOccupancy', 'Enter a max occupancy greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('categoryId', String(Number(form.categoryId)));
      formData.append('floor', form.floor.trim());
      formData.append(
        'beds',
        JSON.stringify(form.beds.map((b) => ({ size: b.size, count: Number(b.count) })))
      );
      formData.append('bathroomType', form.bathroomType);
      formData.append('maxOccupancy', String(Number(form.maxOccupancy)));
      formData.append('description', form.description.trim());
      form.imageFiles.forEach((file) => formData.append('images', file));

      if (editingRoomId) {
        formData.append('roomNumber', form.roomNumber.trim());
        await apiPatchForm(`/rooms/${editingRoomId}`, formData, { token: session?.token });
      } else {
        if (form.mode === 'single') {
          formData.append('roomNumber', form.roomNumber.trim());
        } else {
          formData.append('rangeStart', String(Number(form.rangeStart)));
          formData.append('rangeEnd', String(Number(form.rangeEnd)));
        }
        await apiPostForm('/rooms', formData, { token: session?.token });
      }
      setShowForm(false);
      loadAll();
    } catch (err) {
      // A room number (or range) already taken, or a category that stopped
      // being valid between opening the form and saving it, both name the
      // field they're about — so they land under it, focused and scrolled to,
      // the same as a blank field caught before the request ever went out.
      // Anything else (a dropped connection, a permission error) names no
      // field and goes to the banner instead.
      if (err instanceof ApiError && err.field && document.getElementById(err.field)) {
        failOn(err.field, err.message);
      } else {
        reportFormError(err instanceof ApiError ? err.message : `Could not ${editingRoomId ? 'save' : 'add'} the room.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const loading = !error && (!rooms || !categories);
  const noCategories = categories && categories.length === 0;

  // The app bar's search box, narrowed against what the card actually shows —
  // number, category, floor, bed, bathroom, occupancy and the active/inactive
  // word. Matching what is on the card is the point: someone types "deluxe" or
  // "inactive" because they can see it, and a match they cannot see reads as
  // the filter being broken.
  // A card only earns the tall photo band if there is a photo to put in it. A
  // room whose only image 404s counts as photoless, same as one with none at
  // all — otherwise the card holds open 132px for a broken <img>.
  const hasCover = (room) =>
    room.images.length > 0 && !brokenPhotos.has(room.images[0].filename);

  const searchTerm = useSearchTerm();
  const visibleRooms = (rooms || []).filter((room) =>
    matchesSearch(
      searchTerm,
      room.roomNumber,
      room.category?.name,
      room.floor && `Floor ${room.floor}`,
      bedSummary(room),
      room.bathroomType && bathroomTypeLabel[room.bathroomType],
      room.maxOccupancy && `Max ${room.maxOccupancy} Guests`,
      room.isActive ? 'Active' : 'Inactive',
      room.description
    )
  );
  // A search that matched nothing is a different state from a lodge with no
  // rooms yet, and the two need different words — one is a dead end you fix by
  // clearing the box, the other by adding a room.
  const searching = searchTerm.trim().length > 0;

  // --- what the add/edit form shows about itself ---

  // The category carries the rate, and the rate is what the form is really
  // setting — the chips beside the select and the figure in the footer both
  // read off it.
  const selectedCategory =
    (categories || []).find((c) => String(c.id) === String(form.categoryId)) || null;

  const photoCount = existingImages.length + form.imageFiles.length;

  // How many rooms this submit will actually create. A bulk range whose ends
  // aren't both filled in yet has no count to give, so it says so rather than
  // showing a wrong one.
  const bulkCount = (() => {
    const from = Number(form.rangeStart);
    const to = Number(form.rangeEnd);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    if (!form.rangeStart || !form.rangeEnd || to < from) return null;
    return to - from + 1;
  })();

  const roomCountLabel = editingRoomId
    ? `Room ${form.roomNumber || '—'}`
    : form.mode === 'bulk'
      ? bulkCount
        ? `${bulkCount} room${bulkCount === 1 ? '' : 's'}`
        : 'Room range'
      : form.roomNumber.trim()
        ? `Room ${form.roomNumber.trim()}`
        : '1 room';

  // Which of the four blocks are answered. Same signal the booking form uses:
  // the badge swaps its digit for a tick, so a tall form can be re-read by
  // scrolling rather than by re-checking every field.
  const numberDone =
    editingRoomId || form.mode === 'single' ? form.roomNumber.trim() !== '' : bulkCount !== null;
  const stepDone = {
    1: numberDone,
    2: form.categoryId !== '',
    3:
      form.floor.trim() !== '' &&
      form.bathroomType !== '' &&
      form.beds.some((b) => b.size !== '') &&
      form.maxOccupancy !== '',
    4: photoCount > 0,
  };

  return (
    <div className="rooms-panel">
      {!error && !loading && noCategories && (
        <p className="rooms-panel__note">Please set up the price chart before adding rooms.</p>
      )}

      <div className="rooms-panel__toolbar">
        <span className="rooms-panel__count">
          {rooms
            ? searching
              ? `${visibleRooms.length} of ${rooms.length} room${rooms.length === 1 ? '' : 's'}`
              : `${rooms.length} room${rooms.length === 1 ? '' : 's'}`
            : ' '}
        </span>
        <button type="button" className="btn-accent" onClick={openForm} disabled={noCategories}>
          + Add room
        </button>
      </div>

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}

      {loading && (
        <div className="dash-card">
          <div className="dash-state">Loading rooms…</div>
        </div>
      )}

      {!error && rooms && !noCategories && rooms.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">No rooms yet. Add your first room to start filling the chart.</div>
        </div>
      )}

      {!error && rooms && rooms.length > 0 && visibleRooms.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">No rooms match “{searchTerm.trim()}”.</div>
        </div>
      )}

      {!error && rooms && visibleRooms.length > 0 && (
        <div className="room-grid">
          {visibleRooms.map((room) => (
            <div className="room-card" key={room.id}>
              <div
                className={`room-card__cover${
                  hasCover(room) ? '' : ' room-card__cover--empty'
                }`}
              >
                {hasCover(room) ? (
                  <button
                    type="button"
                    className="room-card__cover-btn"
                    onClick={() => openLightbox(room.images, 0)}
                    aria-label={`View photos of room ${room.roomNumber}`}
                  >
                    <img
                      src={`${API_BASE}/room-images/${room.images[0].filename}`}
                      alt={`Room ${room.roomNumber}`}
                      className="room-card__cover-img"
                      onError={() =>
                        setBrokenPhotos((prev) => new Set(prev).add(room.images[0].filename))
                      }
                    />
                  </button>
                ) : (
                  <div className="room-card__cover-placeholder">{room.roomNumber}</div>
                )}
                <button
                  type="button"
                  className={`room-card__status badge ${room.isActive ? 'badge--on' : 'badge--off'}`}
                  onClick={() => openStatusModal(room)}
                  title={`Click to ${room.isActive ? 'deactivate' : 'activate'} room ${room.roomNumber}`}
                  aria-label={`Room ${room.roomNumber} is ${
                    room.isActive ? 'active' : 'inactive'
                  }. Click to ${room.isActive ? 'deactivate' : 'activate'}.`}
                >
                  {room.isActive ? 'Active' : 'Inactive'}
                </button>
                {room.images.length > 1 && (
                  <span className="room-card__photo-count">+{room.images.length - 1}</span>
                )}
              </div>

              <div className="room-card__body">
                <div className="room-card__top">
                  {/* On a photoless card the band above already carries the room
                      number at 30px, so repeating it here is the card saying the
                      same word twice. A photo card has no such band, and needs
                      it. */}
                  {hasCover(room) && (
                    <span className="room-card__number">{room.roomNumber}</span>
                  )}
                  <span className="room-card__rate">
                    {formatPrice(room.price)}
                    <span className="room-card__rate-unit"> /night</span>
                  </span>
                </div>
                <div className="room-card__category">{room.category.name}</div>

                {(room.floor || room.bedSize || room.bathroomType || room.maxOccupancy) && (
                  <div className="room-card__chips">
                    {room.floor && <span className="room-card__chip">Floor {room.floor}</span>}
                    {bedSummary(room) && <span className="room-card__chip">{bedSummary(room)}</span>}
                    {room.bathroomType && (
                      <span className="room-card__chip">
                        <BathIcon />
                        {bathroomTypeLabel[room.bathroomType]}
                      </span>
                    )}
                    {room.maxOccupancy && (
                      <span className="room-card__chip room-card__chip--occupancy">
                        <GuestIcon />
                        Max {room.maxOccupancy} Guest{room.maxOccupancy === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                )}

                {room.description && <div className="room-card__description">{room.description}</div>}
              </div>

              <div className="room-card__actions">
                <IconButton
                  label={`Edit room ${room.roomNumber}`}
                  icon={<EditIcon />}
                  onClick={() => openEditForm(room)}
                />
                <IconButton
                  label={`Delete room ${room.roomNumber}`}
                  icon={<TrashIcon />}
                  tone="danger"
                  onClick={() => openDeleteModal(room)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="glass-backdrop rooms-panel__backdrop" onClick={closeForm}>
          <div
            className="glass-panel rooms-panel__modal rooms-panel__modal--form modal-form__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="modal-form" onSubmit={handleSubmit} noValidate>
              {/* Header stays put while the body scrolls: single against bulk
                  changes what the rest of the form asks for, so it shouldn't
                  scroll out of sight. Same shape as the new-booking form. */}
              <div className="modal-form__head">
                <div className="modal-form__head-row">
                  <h3>{editingRoomId ? `Edit room · ${form.roomNumber}` : 'Add room'}</h3>
                  {/* One room or a floor's worth is the first decision, so it
                      belongs beside the title. An edit is always one room. */}
                  {!editingRoomId && (
                    <div className="toggle-group">
                      <button
                        type="button"
                        aria-pressed={form.mode === 'single'}
                        onClick={() => setForm((f) => ({ ...f, mode: 'single' }))}
                      >
                        Single
                      </button>
                      <button
                        type="button"
                        aria-pressed={form.mode === 'bulk'}
                        onClick={() => setForm((f) => ({ ...f, mode: 'bulk' }))}
                      >
                        Bulk range
                      </button>
                    </div>
                  )}
                  {/* The way out, visible without scrolling to the bottom of a
                      form this tall. The one in the footer is the same door. */}
                  <button
                    type="button"
                    className="modal-form__close"
                    onClick={closeForm}
                    disabled={submitting}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="modal-form__sub">
                  {editingRoomId
                    ? 'Corrections apply to this room only — its bookings and history stay as they are.'
                    : form.mode === 'bulk'
                      ? 'Creates every room in the range at once, all sharing these details. Photos are added per room afterwards.'
                      : 'Adds one room to the chart. Everything but the description and photos is needed before it can be booked.'}
                </p>
              </div>

              <div className="modal-form__body">
              {formError && (
                <div ref={formErrorRef} className="form-banner form-banner--error form-banner--flash">
                  {formError}
                </div>
              )}

              <div className="form-section">
                <div className="form-section__title">
                  <StepNum n={1} done={stepDone[1]} />
                  {editingRoomId || form.mode === 'single' ? 'Room number' : 'Room range'}
                </div>

                {editingRoomId || form.mode === 'single' ? (
                  <div className="field">
                    <label htmlFor="roomNumber">
                      Room number
                      <Req />
                    </label>
                    <input
                      id="roomNumber"
                      aria-invalid={invalid('roomNumber')}
                      value={form.roomNumber}
                      onChange={(e) => setForm((f) => ({ ...f, roomNumber: e.target.value }))}
                      placeholder="101"
                      autoFocus
                    />
                    {fieldErr('roomNumber')}
                  </div>
                ) : (
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="rangeStart">
                        From
                        <Req />
                      </label>
                      <input
                        id="rangeStart"
                        type="number"
                        aria-invalid={invalid('rangeStart')}
                        value={form.rangeStart}
                        onChange={(e) => setForm((f) => ({ ...f, rangeStart: e.target.value }))}
                        placeholder="101"
                      />
                      {fieldErr('rangeStart')}
                    </div>
                    <div className="field">
                      <label htmlFor="rangeEnd">
                        To
                        <Req />
                      </label>
                      <input
                        id="rangeEnd"
                        type="number"
                        aria-invalid={invalid('rangeEnd')}
                        value={form.rangeEnd}
                        onChange={(e) => setForm((f) => ({ ...f, rangeEnd: e.target.value }))}
                        placeholder="110"
                      />
                      {fieldErr('rangeEnd')}
                    </div>
                  </div>
                )}
              </div>

              <div className="form-section">
                <div className="form-section__title">
                  <StepNum n={2} done={stepDone[2]} />Pricing
                </div>

                <div className="field">
                  <label htmlFor="categoryId">
                    Category
                    <Req />
                  </label>
                  <select
                    id="categoryId"
                    aria-invalid={invalid('categoryId')}
                    value={form.categoryId}
                    onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                  >
                    <option value="">Choose a category</option>
                    {categories?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {formatPrice(c.basePrice)}
                      </option>
                    ))}
                  </select>
                  {fieldErr('categoryId')}
                </div>

                {/* What the category actually means in money, once picked. The
                    rate is the thing being set here, and reading it back off a
                    dropdown option is the wrong place to check it. */}
                {selectedCategory && (
                  <div className="modal-form__chips">
                    <span className="modal-form__chip modal-form__chip--rate">
                      {formatPrice(selectedCategory.basePrice)} /night
                    </span>
                    <span className="modal-form__chip">{selectedCategory.name}</span>
                  </div>
                )}
              </div>

              <div className="form-section">
                <div className="form-section__title">
                  <StepNum n={3} done={stepDone[3]} />Room details
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="floor">
                      Floor
                      <Req />
                    </label>
                    <input
                      id="floor"
                      aria-invalid={invalid('floor')}
                      value={form.floor}
                      onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                      placeholder="1"
                    />
                    {fieldErr('floor')}
                  </div>
                  <div className="field">
                    <label htmlFor="bathroomType">
                      Bathroom
                      <Req />
                    </label>
                    <select
                      id="bathroomType"
                      aria-invalid={invalid('bathroomType')}
                      value={form.bathroomType}
                      onChange={(e) => setForm((f) => ({ ...f, bathroomType: e.target.value }))}
                    >
                      <option value="">Choose one</option>
                      {BATHROOM_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {bathroomTypeLabel[type]}
                        </option>
                      ))}
                    </select>
                    {fieldErr('bathroomType')}
                  </div>
                </div>
                  <div className="field field--beds">
                    <label htmlFor="bed-size-0">
                      Beds
                      <Req />
                    </label>
                    {/* One row per bed type, because a family room is a double
                        and two singles — storing whichever one the desk picked
                        first was losing the other half of the room. */}
                    {form.beds.map((bed, i) => (
                      <div key={i}>
                        <div className={`bed-row${form.beds.length > 1 ? '' : ' bed-row--single'}`}>
                          <select
                            id={`bed-size-${i}`}
                            aria-invalid={invalid(`bed-size-${i}`)}
                            value={bed.size}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                beds: f.beds.map((b, j) => (j === i ? { ...b, size: e.target.value } : b)),
                              }))
                            }
                          >
                            <option value="">Choose one</option>
                            {BED_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {bedSizeLabel[size]}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="1"
                            className="bed-row__count"
                            aria-invalid={invalid(`bed-size-${i}`)}
                            aria-label={`How many ${bedSizeLabel[bed.size] || ''} beds`}
                            value={bed.count}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                beds: f.beds.map((b, j) => (j === i ? { ...b, count: e.target.value } : b)),
                              }))
                            }
                          />
                          {/* The last row has no remove button: a room with no
                              beds is not a room, and the server rejects it. */}
                          {form.beds.length > 1 && (
                            <button
                              type="button"
                              className="bed-row__remove"
                              aria-label="Remove this bed"
                              onClick={() =>
                                setForm((f) => ({ ...f, beds: f.beds.filter((_, j) => j !== i) }))
                              }
                            >
                              ×
                            </button>
                          )}
                        </div>
                        {fieldErr(`bed-size-${i}`)}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="bed-add"
                      onClick={() =>
                        setForm((f) => ({ ...f, beds: [...f.beds, { size: '', count: '1' }] }))
                      }
                    >
                      + Add another bed
                    </button>
                  </div>

                <div className="field">
                  <label htmlFor="maxOccupancy">
                    Max occupancy
                    <Req />
                  </label>
                  <input
                    id="maxOccupancy"
                    type="number"
                    min="1"
                    aria-invalid={invalid('maxOccupancy')}
                    value={form.maxOccupancy}
                    onChange={(e) => setForm((f) => ({ ...f, maxOccupancy: e.target.value }))}
                    placeholder="2"
                  />
                  {fieldErr('maxOccupancy')}
                </div>

                <div className="field">
                  <label htmlFor="description">Description (optional)</label>
                  <input
                    id="description"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Corner room, quiet side, good morning light"
                    maxLength={200}
                  />
                </div>
              </div>

              {(editingRoomId || form.mode === 'single') && (
                <details className="form-section form-section--collapsible" open>
                  <summary>
                    <StepNum n={4} done={stepDone[4]} />
                    Photos
                    {photoCount > 0 && <span className="form-section__badge">{photoCount}</span>}
                  </summary>

                  {existingImages.length > 0 && (
                    <div className="room-form__photo-grid">
                      {existingImages.map((img) => (
                        <div className="room-form__photo" key={img.id}>
                          <img src={`${API_BASE}/room-images/${img.filename}`} alt="Room" />
                          <button
                            type="button"
                            className="room-form__photo-remove"
                            onClick={() => handleDeleteExistingImage(img.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {form.imageFiles.length > 0 && (
                    <div className="room-form__photo-grid">
                      {form.imageFiles.map((file, index) => (
                        <div className="room-form__photo" key={index}>
                          <img src={URL.createObjectURL(file)} alt="New upload preview" />
                          <button type="button" className="room-form__photo-remove" onClick={() => removeImageFile(index)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="field">
                    <input
                      type="file"
                      accept={ROOM_IMAGE_ACCEPT}
                      multiple
                      disabled={existingImages.length + form.imageFiles.length >= MAX_ROOM_IMAGES}
                      onChange={(e) => {
                        addImageFiles(Array.from(e.target.files));
                        e.target.value = '';
                      }}
                    />
                    <p className="modal-form__hint">
                      Up to {MAX_ROOM_IMAGES} photos, JPG/PNG/WEBP, 5MB each.
                    </p>
                  </div>
                </details>
              )}
              </div>

              {/* Rate and actions pinned below the scroll area, the way the
                  booking form pins its total: the figure the room will be sold
                  at has to stay visible while the details are filled in. */}
              <div className="modal-form__foot">
                <div className="modal-form__summary">
                  {selectedCategory ? (
                    <>
                      <span className="modal-form__summary-label">
                        {roomCountLabel} · {selectedCategory.name}
                      </span>
                      <span className="modal-form__summary-value">
                        {formatPrice(selectedCategory.basePrice)}
                        <span className="modal-form__summary-unit"> /night</span>
                      </span>
                    </>
                  ) : (
                    <span className="modal-form__summary-label">Pick a category to set the rate</span>
                  )}
                </div>
                <div className="modal-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={closeForm} disabled={submitting}>
                    Cancel
                  </button>
                  <button className="btn-accent" type="submit" disabled={submitting}>
                    {editingRoomId
                      ? submitting
                        ? 'Saving…'
                        : 'Save changes'
                      : submitting
                        ? 'Adding…'
                        : 'Add room'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {statusModalRoom && (
        <div className="glass-backdrop rooms-panel__backdrop" onClick={closeStatusModal}>
          <div className="glass-panel rooms-panel__delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {statusModalRoom.isActive ? 'Deactivate' : 'Activate'} room {statusModalRoom.roomNumber}?
            </h3>
            <p className="rooms-panel__delete-hint">
              {statusModalRoom.isActive
                ? 'It will be hidden from new bookings, but its history stays intact.'
                : 'It will be available for new bookings again.'}
            </p>

            {statusModalError && <div className="form-banner form-banner--error">{statusModalError}</div>}

            <div className="rooms-panel__actions">
              <button type="button" className="btn-secondary" onClick={closeStatusModal} disabled={statusModalBusy}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleToggleStatus} disabled={statusModalBusy}>
                {statusModalBusy ? 'Saving…' : statusModalRoom.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalRoom && (
        <div className="glass-backdrop rooms-panel__backdrop" onClick={closeDeleteModal}>
          <div className="glass-panel rooms-panel__delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete room {deleteModalRoom.roomNumber}</h3>
            <p className="rooms-panel__delete-hint">Choose how you want to remove this room.</p>

            {deleteModalError && <div className="form-banner form-banner--error">{deleteModalError}</div>}

            <div className="rooms-panel__delete-options">
              <button
                type="button"
                className="rooms-panel__delete-option"
                onClick={handleDeactivateOrActivate}
                disabled={deleteModalBusy}
              >
                <strong>{deleteModalRoom.isActive ? 'Deactivate' : 'Activate'}</strong>
                <span>
                  {deleteModalRoom.isActive
                    ? "Hide it from new bookings, but keep its history."
                    : 'Make it available for new bookings again.'}
                </span>
              </button>
              <button
                type="button"
                className="rooms-panel__delete-option rooms-panel__delete-option--danger"
                onClick={handlePermanentDelete}
                disabled={deleteModalBusy}
              >
                <strong>Permanently delete</strong>
                <span>Remove it completely. This can&apos;t be undone, and only works if it has no bookings.</span>
              </button>
            </div>

            <div className="rooms-panel__actions">
              <button type="button" className="btn-secondary" onClick={closeDeleteModal} disabled={deleteModalBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="room-lightbox" onClick={closeLightbox}>
          <button type="button" className="room-lightbox__close" onClick={closeLightbox} aria-label="Close">
            ×
          </button>

          {lightbox.images.length > 1 && (
            <button
              type="button"
              className="room-lightbox__nav room-lightbox__nav--prev"
              onClick={(e) => {
                e.stopPropagation();
                showPrevImage();
              }}
              aria-label="Previous photo"
            >
              ‹
            </button>
          )}

          <img
            src={`${API_BASE}/room-images/${lightbox.images[lightbox.index].filename}`}
            alt={`Photo ${lightbox.index + 1} of ${lightbox.images.length}`}
            className="room-lightbox__image"
            onClick={(e) => e.stopPropagation()}
          />

          {lightbox.images.length > 1 && (
            <button
              type="button"
              className="room-lightbox__nav room-lightbox__nav--next"
              onClick={(e) => {
                e.stopPropagation();
                showNextImage();
              }}
              aria-label="Next photo"
            >
              ›
            </button>
          )}

          {lightbox.images.length > 1 && (
            <span className="room-lightbox__counter">
              {lightbox.index + 1} / {lightbox.images.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
