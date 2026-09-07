import { useRef, useState } from 'react';
import { apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { copyText } from '../../lib/clipboard';
import { validateCoordinates } from '../../lib/coordinates';
import LocationPicker from '../../components/LocationPicker';
import './forms.css';
import './HotelProfileModal.css';

const CHECKIN_LABEL = {
  HOUR_24: '24-hour cycle',
  NIGHT_BASED: 'Night-based',
  CYCLE: 'Fixed check-in / checkout',
};

// What this screen lets an owner change: the facts printed on a bill's
// masthead and the pin on the map. The property's slug, check-in cycle,
// GST-registered switch and what it actually sells (rooms/food/events) are
// read-only here — those ripple into billing and routing, and stay something
// only Vengurla Tech's internal admin panel touches. See backend
// me.schema.js#updateMyLodgeSchema, which enforces the same boundary.
function formFromLodge(lodge) {
  return {
    lodgeName: lodge.name ?? '',
    phone: lodge.phone ?? '',
    whatsappNumber: lodge.whatsappNumber ?? '',
    address: lodge.address ?? '',
    lodgeNameMr: lodge.nameMr ?? '',
    addressMr: lodge.addressMr ?? '',
    city: lodge.city ?? '',
    state: lodge.state ?? '',
    latitude: lodge.latitude == null ? '' : String(lodge.latitude),
    longitude: lodge.longitude == null ? '' : String(lodge.longitude),
    gstin: lodge.gstin ?? '',
  };
}

// Read-only facts shown above the form — worth seeing on this screen, but
// fixed elsewhere. A blank one is left out rather than shown empty.
function Fact({ label, value }) {
  if (!value) return null;
  return (
    <div className="hotel-profile__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function HotelProfileModal({ lodge, onSaved, onClose }) {
  const token = getSession()?.token;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => formFromLodge(lodge));
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState('');
  const errorRef = useRef(null);

  const reportError = (message) => {
    setError(message);
    setFieldError(null);
    requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  const update = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const publicUrl = `${window.location.origin}${lodge.hasRooms ? `/lodge/${lodge.slug}` : `/order/${lodge.slug}`}`;
  const handleCopyPublicLink = async () => {
    const copied = await copyText(publicUrl);
    setLinkCopied(copied ? 'copied' : 'failed');
    setTimeout(() => setLinkCopied(''), 2000);
  };

  const startEditing = () => {
    setForm(formFromLodge(lodge));
    setError('');
    setFieldError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setForm(formFromLodge(lodge));
    setError('');
    setFieldError(null);
    setEditing(false);
  };

  const closeModal = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldError(null);

    if (!form.lodgeName.trim()) {
      failOn('hp-name', 'Enter the property name.');
      return;
    }
    if (lodge.isGstRegistered && !form.gstin.trim()) {
      failOn('hp-gstin', 'Enter the GSTIN, or ask Vengurla Tech to turn off GST registration.');
      return;
    }
    const coords = validateCoordinates(form);
    if (!coords.ok) {
      failOn('hp-location-lat', coords.message);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
      const me = await apiPatch('/me/lodge', payload, { token });
      setEditing(false);
      onSaved(me.lodge);
    } catch (err) {
      if (err instanceof ApiError && err.field && document.getElementById(err.field)) {
        failOn(err.field, err.message);
      } else {
        reportError(err instanceof ApiError ? err.message : 'Could not save these changes.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-backdrop hotel-profile__backdrop" onClick={closeModal}>
      <div
        className="glass-panel hotel-profile__modal modal-form__panel"
        onClick={(e) => e.stopPropagation()}
      >
        {!editing ? (
          <div className="modal-form">
            <div className="modal-form__head">
              <div className="modal-form__head-row">
                <h3>Hotel profile</h3>
                <button
                  type="button"
                  className="modal-form__close"
                  onClick={onClose}
                  aria-label="Close"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="modal-form__body">
              <div className="hotel-profile__lodge-head">
                <div className="hotel-profile__monogram" aria-hidden="true">
                  {lodge.name.charAt(0)}
                </div>
                <div className="hotel-profile__lodge-title">
                  <div className="hotel-profile__lodge-name">{lodge.name}</div>
                  <div className="hotel-profile__badges">
                    <span className={`badge ${lodge.isGstRegistered ? 'badge--on' : 'badge--off'}`}>
                      {lodge.isGstRegistered ? `GST · ${lodge.gstin || 'Registered'}` : 'Non-GST'}
                    </span>
                    {lodge.isSpecifiedPremises && (
                      <span className="badge badge--accent">Specified premises</span>
                    )}
                  </div>
                </div>
              </div>

              <dl className="hotel-profile__facts">
                <Fact label="Location" value={[lodge.city, lodge.state].filter(Boolean).join(', ')} />
                <Fact label="Address" value={lodge.address} />
                <Fact label="Name (Marathi)" value={lodge.nameMr} />
                <Fact label="Address (Marathi)" value={lodge.addressMr} />
                <Fact label="Check-in" value={CHECKIN_LABEL[lodge.checkinMode] || lodge.checkinMode} />
                <Fact label="Phone" value={lodge.phone} />
                <Fact label="WhatsApp" value={lodge.whatsappNumber} />
                <Fact
                  label="Map pin"
                  value={
                    lodge.latitude != null && lodge.longitude != null
                      ? `${lodge.latitude}, ${lodge.longitude}`
                      : ''
                  }
                />
              </dl>

              <div className="hotel-profile__link">
                <div className="hotel-profile__link-head">
                  <span>Public link</span>
                  <button type="button" className="hotel-profile__copy-link" onClick={handleCopyPublicLink}>
                    {linkCopied === 'copied' && 'Copied!'}
                    {linkCopied === 'failed' && 'Press Ctrl+C'}
                    {!linkCopied && 'Copy'}
                  </button>
                </div>
                <code>{publicUrl}</code>
              </div>

              <p className="modal-form__hint">
                Check-in cycle, GST registration and what the property sells are set up by Vengurla Tech —
                contact them to change those.
              </p>
            </div>

            <div className="modal-form__foot">
              <div />
              <div className="modal-form__foot-actions">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Close
                </button>
                <button type="button" className="btn-accent" onClick={startEditing}>
                  Edit details
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form className="modal-form" onSubmit={handleSubmit} noValidate>
            <div className="modal-form__head">
              <div className="modal-form__head-row">
                <h3>Edit hotel profile</h3>
                <button
                  type="button"
                  className="modal-form__close"
                  onClick={cancelEditing}
                  disabled={saving}
                  aria-label="Close"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="modal-form__body">
              {error && (
                <div ref={errorRef} className="form-banner form-banner--error form-banner--flash">
                  {error}
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label htmlFor="hp-name">Name</label>
                  <input
                    id="hp-name"
                    aria-invalid={invalid('hp-name')}
                    value={form.lodgeName}
                    onChange={update('lodgeName')}
                    disabled={saving}
                  />
                  {fieldErr('hp-name')}
                </div>
                <div className="field">
                  <label htmlFor="hp-gstin">GSTIN</label>
                  <input
                    id="hp-gstin"
                    aria-invalid={invalid('hp-gstin')}
                    value={form.gstin}
                    onChange={update('gstin')}
                    placeholder={lodge.isGstRegistered ? '27ABCDE1234F1Z5' : 'Not GST registered'}
                    disabled={saving || !lodge.isGstRegistered}
                  />
                  {fieldErr('hp-gstin')}
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="hp-phone">Phone</label>
                  <input id="hp-phone" value={form.phone} onChange={update('phone')} disabled={saving} />
                </div>
                <div className="field">
                  <label htmlFor="hp-wa">WhatsApp number</label>
                  <input
                    id="hp-wa"
                    value={form.whatsappNumber}
                    onChange={update('whatsappNumber')}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="hp-address">Address</label>
                <input id="hp-address" value={form.address} onChange={update('address')} disabled={saving} />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="hp-city">City</label>
                  <input id="hp-city" value={form.city} onChange={update('city')} disabled={saving} />
                </div>
                <div className="field">
                  <label htmlFor="hp-state">State</label>
                  <input id="hp-state" value={form.state} onChange={update('state')} disabled={saving} />
                </div>
              </div>

              <div className="field">
                <label htmlFor="hp-location-lat">Map location</label>
                <LocationPicker
                  idPrefix="hp-location"
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onChange={(pos) => setForm((f) => ({ ...f, ...pos }))}
                  disabled={saving}
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="hp-name-mr">Name in Marathi (bill masthead)</label>
                  <input
                    id="hp-name-mr"
                    value={form.lodgeNameMr}
                    onChange={update('lodgeNameMr')}
                    disabled={saving}
                  />
                </div>
                <div className="field">
                  <label htmlFor="hp-address-mr">Address in Marathi</label>
                  <input
                    id="hp-address-mr"
                    value={form.addressMr}
                    onChange={update('addressMr')}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div className="modal-form__foot">
              <div />
              <div className="modal-form__foot-actions">
                <button type="button" className="btn-secondary" onClick={cancelEditing} disabled={saving}>
                  Cancel
                </button>
                <button className="btn-accent" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
