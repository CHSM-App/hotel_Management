import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import '../auth/AuthLayout.css';

const CHECKIN_MODES = [
  { value: 'HOUR_24', label: '24-hour cycle (from check-in time)' },
  { value: 'NIGHT_BASED', label: 'Night-based (fixed checkout time)' },
];

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const initialForm = {
  lodgeName: '',
  slug: '',
  phone: '',
  whatsappNumber: '',
  city: '',
  state: '',
  address: '',
  checkinMode: 'HOUR_24',
  isGstRegistered: false,
  gstin: '',
  isSpecifiedPremises: false,
  ownerName: '',
  ownerEmail: '',
  ownerPhone: '',
  tempPassword: '',
};

export default function LodgeRegistration() {
  const [form, setForm] = useState(initialForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const session = useMemo(() => getSession(), []);

  const update = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleNameChange = (e) => {
    const lodgeName = e.target.value;
    setForm((f) => ({
      ...f,
      lodgeName,
      slug: slugTouched ? f.slug : slugify(lodgeName),
    }));
  };

  const generatePassword = () => {
    const value = Math.random().toString(36).slice(2, 10);
    setForm((f) => ({ ...f, tempPassword: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.lodgeName.trim() || !form.slug.trim() || !form.ownerName.trim() || !form.ownerPhone.trim()) {
      setError('Lodge name, slug, owner name and owner phone are required.');
      return;
    }
    if (form.isGstRegistered && !form.gstin.trim()) {
      setError('Enter the GSTIN, or turn off GST registration.');
      return;
    }
    if (!form.tempPassword) {
      setError('Set a temporary password for the first login.');
      return;
    }

    setSubmitting(true);
    try {
      await apiPost('/internal/lodges', form, { token: session?.token });
      setSuccess(true);
      setForm(initialForm);
      setSlugTouched(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the lodge. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="auth-brand__mark">Lodge Management System</div>
        <div className="auth-brand__body">
          <h1>Register a new lodge</h1>
          <p>
            Internal only. Create the tenant, set its GST and billing defaults, and hand over the
            owner&apos;s first login. The owner changes this password on their first sign-in.
          </p>
        </div>
        <div className="auth-brand__foot">Vengurla Tech — staff access</div>
      </div>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit} noValidate style={{ maxWidth: 460 }}>
          <Link to="/vt-internal/dashboard" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'inline-block', marginBottom: 16 }}>
            ← All lodges
          </Link>
          <div className="auth-card__eyebrow">Staff only</div>
          <h2>New lodge</h2>
          <p className="auth-card__hint">Not linked anywhere in the product. Bookmark this page.</p>

          {error && <div className="form-banner form-banner--error">{error}</div>}
          {success && (
            <div className="form-banner form-banner--info">
              Lodge created. Share the phone/email and temporary password with the owner directly.{' '}
              <Link to="/vt-internal/dashboard" style={{ color: 'var(--brand-ink)', fontWeight: 600 }}>
                View all lodges →
              </Link>
            </div>
          )}

          <div className="section-label">Lodge</div>

          <div className="field">
            <label htmlFor="lodgeName">Lodge name</label>
            <input id="lodgeName" value={form.lodgeName} onChange={handleNameChange} placeholder="Sagar Kinara Residency" />
          </div>

          <div className="field">
            <label htmlFor="slug">Public link slug</label>
            <input
              id="slug"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                update('slug')(e);
              }}
              placeholder="sagar-kinara-residency"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="phone">Lodge phone</label>
              <input id="phone" value={form.phone} onChange={update('phone')} placeholder="02362 123456" />
            </div>
            <div className="field">
              <label htmlFor="whatsappNumber">WhatsApp number</label>
              <input id="whatsappNumber" value={form.whatsappNumber} onChange={update('whatsappNumber')} placeholder="9876543210" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="city">City / village</label>
              <input id="city" value={form.city} onChange={update('city')} placeholder="Vengurla" />
            </div>
            <div className="field">
              <label htmlFor="state">State</label>
              <input id="state" value={form.state} onChange={update('state')} placeholder="Maharashtra" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="address">Address</label>
            <input id="address" value={form.address} onChange={update('address')} placeholder="Beach road, near jetty" />
          </div>

          <div className="field">
            <label htmlFor="checkinMode">Check-in cycle</label>
            <select id="checkinMode" value={form.checkinMode} onChange={update('checkinMode')}>
              {CHECKIN_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          <div className="section-label">Billing</div>

          <div className="checkbox-field">
            <input
              id="isGstRegistered"
              type="checkbox"
              checked={form.isGstRegistered}
              onChange={update('isGstRegistered')}
            />
            <div>
              <label htmlFor="isGstRegistered">GST registered</label>
              <span className="checkbox-field__note">
                Fixed after go-live. Decides whether tax invoices and bills of supply exist at all.
              </span>
            </div>
          </div>

          {form.isGstRegistered && (
            <div className="field">
              <label htmlFor="gstin">GSTIN</label>
              <input id="gstin" value={form.gstin} onChange={update('gstin')} placeholder="27ABCDE1234F1Z5" />
            </div>
          )}

          <div className="checkbox-field">
            <input
              id="isSpecifiedPremises"
              type="checkbox"
              checked={form.isSpecifiedPremises}
              onChange={update('isSpecifiedPremises')}
            />
            <div>
              <label htmlFor="isSpecifiedPremises">Specified premises</label>
              <span className="checkbox-field__note">Sets the restaurant GST rate to 18% with ITC.</span>
            </div>
          </div>

          <div className="section-label">Owner &amp; first login</div>

          <div className="field">
            <label htmlFor="ownerName">Owner name</label>
            <input id="ownerName" value={form.ownerName} onChange={update('ownerName')} placeholder="Suresh Naik" />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="ownerPhone">Owner phone</label>
              <input id="ownerPhone" value={form.ownerPhone} onChange={update('ownerPhone')} placeholder="9876543210" />
            </div>
            <div className="field">
              <label htmlFor="ownerEmail">Owner email (optional)</label>
              <input id="ownerEmail" type="email" value={form.ownerEmail} onChange={update('ownerEmail')} placeholder="owner@lodge.com" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="tempPassword">Temporary password</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="tempPassword"
                value={form.tempPassword}
                onChange={update('tempPassword')}
                placeholder="Generate or set one"
              />
              <button
                type="button"
                onClick={generatePassword}
                style={{
                  whiteSpace: 'nowrap',
                  padding: '0 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                }}
              >
                Generate
              </button>
            </div>
          </div>

          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Creating lodge…' : 'Create lodge and first login'}
          </button>
        </form>
      </div>
    </div>
  );
}
