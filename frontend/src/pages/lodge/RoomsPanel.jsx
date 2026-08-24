import { useEffect, useState } from 'react';
import { apiGet, apiPostForm, apiPatchForm, apiPatch, apiDelete, ApiError, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
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
const bathroomTypeLabel = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };

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
      strokeWidth="2.4"
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
  const [submitting, setSubmitting] = useState(false);
  const [deleteModalRoom, setDeleteModalRoom] = useState(null);
  const [deleteModalError, setDeleteModalError] = useState('');
  const [deleteModalBusy, setDeleteModalBusy] = useState(false);
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

    if (!form.categoryId) {
      setFormError('Choose a category.');
      return;
    }
    if ((form.mode === 'single' || editingRoomId) && !form.roomNumber.trim()) {
      setFormError('Enter a room number.');
      return;
    }
    if (!editingRoomId && form.mode === 'bulk' && (!form.rangeStart || !form.rangeEnd)) {
      setFormError('Enter the start and end of the range.');
      return;
    }
    if (!form.floor.trim()) {
      setFormError('Enter the floor.');
      return;
    }
    if (form.beds.length === 0 || form.beds.some((b) => !b.size)) {
      setFormError('Choose a size for every bed.');
      return;
    }
    if (form.beds.some((b) => !b.count || Number(b.count) < 1)) {
      setFormError('Each bed needs a count of 1 or more.');
      return;
    }
    if (!form.bathroomType) {
      setFormError('Choose a bathroom type.');
      return;
    }
    if (!form.maxOccupancy || Number(form.maxOccupancy) <= 0) {
      setFormError('Enter a max occupancy greater than 0.');
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
      setFormError(err instanceof ApiError ? err.message : `Could not ${editingRoomId ? 'save' : 'add'} the room.`);
    } finally {
      setSubmitting(false);
    }
  };

  const loading = !error && (!rooms || !categories);
  const noCategories = categories && categories.length === 0;

  return (
    <div className="rooms-panel">
      {!error && !loading && noCategories && (
        <p className="rooms-panel__note">Please set up the price chart before adding rooms.</p>
      )}

      <div className="rooms-panel__toolbar">
        <span className="rooms-panel__count">
          {rooms ? `${rooms.length} room${rooms.length === 1 ? '' : 's'}` : ' '}
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

      {!error && rooms && rooms.length > 0 && (
        <div className="room-grid">
          {rooms.map((room) => (
            <div className="room-card" key={room.id}>
              <div className="room-card__cover">
                {room.images.length > 0 && !brokenPhotos.has(room.images[0].filename) ? (
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
                <span className={`room-card__status badge ${room.isActive ? 'badge--on' : 'badge--off'}`}>
                  {room.isActive ? 'Active' : 'Inactive'}
                </span>
                {room.images.length > 1 && (
                  <span className="room-card__photo-count">+{room.images.length - 1}</span>
                )}
              </div>

              <div className="room-card__body">
                <div className="room-card__top">
                  <span className="room-card__number">{room.roomNumber}</span>
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
                      <span className="room-card__chip">{bathroomTypeLabel[room.bathroomType]}</span>
                    )}
                    {room.maxOccupancy && (
                      <span className="room-card__chip room-card__chip--occupancy">
                        <GuestIcon />
                        Max {room.maxOccupancy} guest{room.maxOccupancy === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                )}

                {room.description && <div className="room-card__description">{room.description}</div>}
              </div>

              <div className="room-card__actions">
                <button type="button" className="room-card__edit-btn" onClick={() => openEditForm(room)}>
                  Edit
                </button>
                <button type="button" className="room-card__delete-btn" onClick={() => openDeleteModal(room)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="glass-backdrop rooms-panel__backdrop" onClick={closeForm}>
          <div className="glass-panel rooms-panel__modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRoomId ? 'Edit room' : 'Add room'}</h3>

            <form onSubmit={handleSubmit} noValidate>
              {formError && <div className="form-banner form-banner--error">{formError}</div>}

              <div className="form-section">
                <div className="form-section__title">Room number</div>

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

                {editingRoomId || form.mode === 'single' ? (
                  <div className="field">
                    <label htmlFor="roomNumber">Room number</label>
                    <input
                      id="roomNumber"
                      value={form.roomNumber}
                      onChange={(e) => setForm((f) => ({ ...f, roomNumber: e.target.value }))}
                      placeholder="101"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="rangeStart">From</label>
                      <input
                        id="rangeStart"
                        type="number"
                        value={form.rangeStart}
                        onChange={(e) => setForm((f) => ({ ...f, rangeStart: e.target.value }))}
                        placeholder="101"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="rangeEnd">To</label>
                      <input
                        id="rangeEnd"
                        type="number"
                        value={form.rangeEnd}
                        onChange={(e) => setForm((f) => ({ ...f, rangeEnd: e.target.value }))}
                        placeholder="110"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="form-section">
                <div className="form-section__title">Pricing</div>

                <div className="field">
                  <label htmlFor="categoryId">Category</label>
                  <select
                    id="categoryId"
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
                </div>
              </div>

              <div className="form-section">
                <div className="form-section__title">Room details</div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="floor">Floor</label>
                    <input
                      id="floor"
                      value={form.floor}
                      onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                      placeholder="1"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="bathroomType">Bathroom</label>
                    <select
                      id="bathroomType"
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
                  </div>
                </div>
                  <div className="field field--beds">
                    <label htmlFor="bed-size-0">Beds</label>
                    {/* One row per bed type, because a family room is a double
                        and two singles — storing whichever one the desk picked
                        first was losing the other half of the room. */}
                    {form.beds.map((bed, i) => (
                      <div className={`bed-row${form.beds.length > 1 ? '' : ' bed-row--single'}`} key={i}>
                        <select
                          id={`bed-size-${i}`}
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
                  <label htmlFor="maxOccupancy">Max occupancy</label>
                  <input
                    id="maxOccupancy"
                    type="number"
                    min="1"
                    value={form.maxOccupancy}
                    onChange={(e) => setForm((f) => ({ ...f, maxOccupancy: e.target.value }))}
                    placeholder="2"
                  />
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
                <div className="form-section">
                  <div className="form-section__title">Photos (optional)</div>

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
                    <p className="bookings-panel__hint">
                      Up to {MAX_ROOM_IMAGES} photos, JPG/PNG/WEBP, 5MB each.
                    </p>
                  </div>
                </div>
              )}

              <div className="rooms-panel__actions">
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
            </form>
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
