import { useState } from 'react';
import { apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import LocationPicker from '../../components/LocationPicker';
import { validateCoordinates } from '../../lib/coordinates';
import './LodgeEditModal.css';

const CHECKIN_MODES = [
  { value: 'HOUR_24', label: '24-hour cycle (from check-in time)' },
  { value: 'NIGHT_BASED', label: 'Night-based (fixed checkout time)' },
  { value: 'CYCLE', label: 'Fixed cycle (check-in / checkout times, whole nights)' },
];

// Support correcting a property after onboarding. Everything the registration
// form asked for can be put right here; what it deliberately does not touch
// is the owner's login, which stays with the owner.
//
// The row arrives in the API's snake_case and is posted back in the camelCase
// the schema reads, so the mapping is done once on the way in and once on the
// way out rather than leaking either shape into the inputs.
function formFromLodge(lodge) {
  return {
    lodgeName: lodge.name ?? '',
    slug: lodge.slug ?? '',
    phone: lodge.phone ?? '',
    whatsappNumber: lodge.whatsapp_number ?? '',
    address: lodge.address ?? '',
    lodgeNameMr: lodge.name_mr ?? '',
    addressMr: lodge.address_mr ?? '',
    city: lodge.city ?? '',
    state: lodge.state ?? '',
    latitude: lodge.latitude == null ? '' : String(lodge.latitude),
    longitude: lodge.longitude == null ? '' : String(lodge.longitude),
    checkinMode: lodge.checkin_mode ?? 'HOUR_24',
    isGstRegistered: !!lodge.is_gst_registered,
    gstin: lodge.gstin ?? '',
    isSpecifiedPremises: !!lodge.is_specified_premises,
    hasRooms: !!lodge.has_rooms,
    servesFood: !!lodge.serves_food,
    foodRoomService: !!lodge.food_room_service,
    foodTableService: !!lodge.food_table_service,
    hasEvents: !!lodge.has_events,
    isActive: !!lodge.is_active,
  };
}

function Check({ id, label, note, checked, onChange, disabled }) {
  return (
    <div className="checkbox-field">
      <input id={id} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <div>
        <label htmlFor={id}>{label}</label>
        {note && <span className="checkbox-field__note">{note}</span>}
      </div>
    </div>
  );
}

export default function LodgeEditModal({ lodge, stats, onSaved, onClose }) {
  const token = getSession()?.token;
  const [form, setForm] = useState(() => formFromLodge(lodge));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Turning rooms off on a property with bookings would strand them behind a
  // hidden section — the same warning the registration form gives, enforced
  // here where it can actually happen.
  const roomsLocked = lodge.has_rooms && (stats?.bookings ?? 0) > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.lodgeName.trim() || !form.slug.trim()) {
      setError('Name and slug are required.');
      return;
    }
    if (form.isGstRegistered && !form.gstin.trim()) {
      setError('Enter the GSTIN, or turn off GST registration.');
      return;
    }
    const coords = validateCoordinates(form);
    if (!coords.ok) {
      setError(coords.message);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        // null clears a pin that was there before.
        latitude: coords.latitude,
        longitude: coords.longitude,
        // Hidden controls are cleared rather than left stale, as on registration.
        foodRoomService: form.servesFood && form.hasRooms ? form.foodRoomService : false,
        foodTableService: form.servesFood ? form.foodTableService : false,
        isSpecifiedPremises: form.hasRooms && form.servesFood ? form.isSpecifiedPremises : false,
        gstin: form.isGstRegistered ? form.gstin : '',
      };
      const detail = await apiPatch(`/internal/lodges/${lodge.id}`, payload, { token });
      onSaved(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save these changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lodge-edit__backdrop" onClick={saving ? undefined : onClose}>
      <form className="lodge-edit" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} noValidate>
        <div className="lodge-edit__head">
          <h2>Edit {lodge.name}</h2>
          <button type="button" className="lodge-edit__close" onClick={onClose} disabled={saving} aria-label="Close">
            ×
          </button>
        </div>

        {error && <div className="form-banner form-banner--error">{error}</div>}

        <section className="lodge-edit__section">
          <h3>Property &amp; contact</h3>
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-name">Name</label>
              <input id="edit-name" value={form.lodgeName} onChange={update('lodgeName')} />
            </div>
            <div className="field">
              <label htmlFor="edit-slug">Slug</label>
              <input id="edit-slug" value={form.slug} onChange={update('slug')} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-phone">Phone</label>
              <input id="edit-phone" value={form.phone} onChange={update('phone')} />
            </div>
            <div className="field">
              <label htmlFor="edit-wa">WhatsApp number</label>
              <input id="edit-wa" value={form.whatsappNumber} onChange={update('whatsappNumber')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="edit-address">Address</label>
            <input id="edit-address" value={form.address} onChange={update('address')} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-city">City</label>
              <input id="edit-city" value={form.city} onChange={update('city')} />
            </div>
            <div className="field">
              <label htmlFor="edit-state">State</label>
              <input id="edit-state" value={form.state} onChange={update('state')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="edit-location-lat">Map location</label>
            <LocationPicker
              idPrefix="edit-location"
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={(pos) => setForm((f) => ({ ...f, ...pos }))}
              disabled={saving}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-name-mr">Name in Marathi (bill masthead)</label>
              <input id="edit-name-mr" value={form.lodgeNameMr} onChange={update('lodgeNameMr')} />
            </div>
            <div className="field">
              <label htmlFor="edit-address-mr">Address in Marathi</label>
              <input id="edit-address-mr" value={form.addressMr} onChange={update('addressMr')} />
            </div>
          </div>
        </section>

        <section className="lodge-edit__section">
          <h3>What the property is</h3>
          <Check
            id="edit-hasRooms"
            label="Lets rooms"
            note={roomsLocked ? 'Fixed: this property already has bookings.' : 'Bookings, tape chart, rates and the guest register.'}
            checked={form.hasRooms}
            onChange={update('hasRooms')}
            disabled={roomsLocked}
          />
          <Check
            id="edit-servesFood"
            label="Serves food"
            note="Menu, QR ordering and the kitchen queue."
            checked={form.servesFood}
            onChange={update('servesFood')}
          />
          {form.servesFood && (
            <div className="lodge-edit__indent">
              {form.hasRooms && (
                <Check
                  id="edit-foodRoomService"
                  label="Guests can order to their rooms"
                  checked={form.foodRoomService}
                  onChange={update('foodRoomService')}
                />
              )}
              <Check
                id="edit-foodTableService"
                label="Diners can order at tables"
                checked={form.foodTableService}
                onChange={update('foodTableService')}
              />
            </div>
          )}
          <Check
            id="edit-hasEvents"
            label="Lets a hall, lawn or terrace for functions"
            note="The Events & functions section: diary, quotes, holds, advances and bills."
            checked={form.hasEvents}
            onChange={update('hasEvents')}
          />
        </section>

        <section className="lodge-edit__section">
          <h3>Billing &amp; GST</h3>
          {form.hasRooms && (
            <div className="field">
              <label htmlFor="edit-checkin">Check-in cycle</label>
              <select id="edit-checkin" value={form.checkinMode} onChange={update('checkinMode')}>
                {CHECKIN_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Check
            id="edit-gst"
            label="GST registered"
            note="Decides whether tax invoices and bills of supply exist at all. Bills already issued keep their document type."
            checked={form.isGstRegistered}
            onChange={update('isGstRegistered')}
          />
          {form.isGstRegistered && (
            <div className="field">
              <label htmlFor="edit-gstin">GSTIN</label>
              <input id="edit-gstin" value={form.gstin} onChange={update('gstin')} placeholder="27ABCDE1234F1Z5" />
            </div>
          )}
          {form.hasRooms && form.servesFood && (
            <Check
              id="edit-specified"
              label="Specified premises"
              note="Taxes food at 18% with ITC instead of 5% without. Confirm with their CA."
              checked={form.isSpecifiedPremises}
              onChange={update('isSpecifiedPremises')}
            />
          )}
        </section>

        <section className="lodge-edit__section">
          <h3>Account</h3>
          <Check
            id="edit-active"
            label="Active"
            note="An inactive property keeps its data but its logins are turned away."
            checked={form.isActive}
            onChange={update('isActive')}
          />
        </section>

        <div className="lodge-edit__actions">
          <button type="button" className="btn-view" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-accent" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
