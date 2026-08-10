import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import {
  PROPERTY_TYPES,
  FOOD_SERVICE_STYLES,
  FEATURES,
  featuresForCapabilities,
  SIDEBAR_GROUP_ORDER,
} from '../../lib/propertyProfile';
import '../auth/AuthLayout.css';
import './LodgeRegistration.css';

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
  // Chosen from PROPERTY_TYPES rather than set as raw bits — see the picker in
  // the form below. The four capability flags are derived from these two on
  // submit, so the payload the API receives is unchanged.
  propertyType: 'LODGE',
  foodServiceStyle: 'BOTH',
  isGstRegistered: false,
  gstin: '',
  isSpecifiedPremises: false,
  ownerName: '',
  ownerEmail: '',
  ownerPhone: '',
  tempPassword: '',
};

// The four bits the API stores, resolved from the two choices the form asks
// for. Food service style only applies to a lodge that serves meals: a
// restaurant has no rooms to serve, and a plain lodge has no food.
function capabilitiesFor(propertyType, foodServiceStyle) {
  const type = PROPERTY_TYPES.find((t) => t.key === propertyType) || PROPERTY_TYPES[0];
  if (propertyType !== 'LODGE_WITH_FOOD') return { ...type.flags };

  const style = FOOD_SERVICE_STYLES.find((s) => s.key === foodServiceStyle) || FOOD_SERVICE_STYLES[0];
  return { ...type.flags, ...style.flags };
}

export default function LodgeRegistration() {
  const [form, setForm] = useState(initialForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  // Captured at submit, because the form resets to its Lodge default straight
  // afterwards — otherwise creating a restaurant would report "Lodge created".
  const [successNoun, setSuccessNoun] = useState('Lodge');
  const [submitting, setSubmitting] = useState(false);
  const session = useMemo(() => getSession(), []);

  const update = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  // The chosen type drives both the capability flags sent to the API and the
  // words this form uses for everything after step 1.
  const type = useMemo(
    () => PROPERTY_TYPES.find((t) => t.key === form.propertyType) || PROPERTY_TYPES[0],
    [form.propertyType]
  );

  const capabilities = useMemo(
    () => capabilitiesFor(form.propertyType, form.foodServiceStyle),
    [form.propertyType, form.foodServiceStyle]
  );

  const includedFeatures = useMemo(() => featuresForCapabilities(capabilities), [capabilities]);
  const includedKeys = new Set(includedFeatures.map((f) => f.key));
  const excludedFeatures = FEATURES.filter((f) => !includedKeys.has(f.key));

  const includedGroups = SIDEBAR_GROUP_ORDER.map((group) => ({
    group,
    features: includedFeatures.filter((f) => f.group === group),
  })).filter((g) => g.features.length > 0);

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
      setError(`${type.Noun} name, slug, owner name and owner phone are required.`);
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
      const { propertyType, foodServiceStyle, ...rest } = form;
      const caps = capabilitiesFor(propertyType, foodServiceStyle);
      const payload = {
        ...rest,
        ...caps,
        // The checkbox is hidden for types it can't apply to, but hiding a
        // control doesn't clear it — ticking it as a lodge with meals and then
        // switching to Restaurant would otherwise submit a stale true and tax
        // their food at 18%.
        isSpecifiedPremises: caps.hasRooms && caps.servesFood ? rest.isSpecifiedPremises : false,
      };
      await apiPost('/internal/lodges', payload, { token: session?.token });
      setSuccessNoun(type.Noun);
      setSuccess(true);
      setForm(initialForm);
      setSlugTouched(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : `Could not create the ${type.noun}. Check your connection.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="auth-brand__mark">Lodge Management System</div>
        <div className="auth-brand__body">
          <h1>Register a new {type.noun}</h1>
          <p>
            Internal only. Pick what kind of property it is first — that decides which sections the
            owner gets. Then create the tenant, set its GST defaults, and hand over the first login,
            which the owner changes on their first sign-in.
          </p>
        </div>
        <div className="auth-brand__foot">Vengurla Tech — staff access</div>
      </div>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit} noValidate style={{ maxWidth: 460 }}>
          <Link to="/vt-internal/dashboard" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'inline-block', marginBottom: 16 }}>
            ← All properties
          </Link>
          <div className="auth-card__eyebrow">Staff only</div>
          <h2>New {type.noun}</h2>
          <p className="auth-card__hint">Not linked anywhere in the product. Bookmark this page.</p>

          {error && <div className="form-banner form-banner--error">{error}</div>}
          {success && (
            <div className="form-banner form-banner--info">
              {successNoun} created. Share the phone/email and temporary password with the owner
              directly.{' '}
              <Link to="/vt-internal/dashboard" style={{ color: 'var(--brand-ink)', fontWeight: 600 }}>
                View all properties →
              </Link>
            </div>
          )}

          {/* Step 1, before anything else is asked. It decides which sections
              the account gets and what the rest of this form calls things, so
              answering it first is what makes the remaining questions read
              sensibly — a restaurateur is never asked for their "lodge name". */}
          <div className="step-head">
            <span className="step-head__num">1</span>
            <div>
              <div className="section-label section-label--flush">What are you registering?</div>
              <p className="step-head__hint">
                Whether it has rooms is fixed after go-live — turning that off later would strand
                their bookings behind a hidden section.
              </p>
            </div>
          </div>

          <div className="type-picker">
            {PROPERTY_TYPES.map((type) => (
              <label
                key={type.key}
                className={`type-card ${form.propertyType === type.key ? 'type-card--on' : ''}`}
              >
                <input
                  type="radio"
                  name="propertyType"
                  value={type.key}
                  checked={form.propertyType === type.key}
                  onChange={() => setForm((f) => ({ ...f, propertyType: type.key }))}
                />
                <span className="type-card__body">
                  <span className="type-card__label">{type.label}</span>
                  <span className="type-card__tagline">{type.tagline}</span>
                  <span className="type-card__desc">{type.description}</span>
                </span>
              </label>
            ))}
          </div>

          {form.propertyType === 'LODGE_WITH_FOOD' && (
            <div className="field">
              <label htmlFor="foodServiceStyle">How do guests order food?</label>
              <select
                id="foodServiceStyle"
                value={form.foodServiceStyle}
                onChange={update('foodServiceStyle')}
              >
                {FOOD_SERVICE_STYLES.map((style) => (
                  <option key={style.key} value={style.key}>
                    {style.label} — {style.description}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Built from the same FEATURES list the dashboard renders its sidebar
              from, so this is literally what the owner will see after signing
              in — not a hand-maintained marketing list that can go stale. */}
          <div className="includes">
            <div className="includes__head">
              This {type.noun} will get
              <span className="includes__count">{includedFeatures.length} sections</span>
            </div>
            {includedGroups.map(({ group, features }) => (
              <div className="includes__group" key={group}>
                <div className="includes__group-name">{group}</div>
                <ul className="includes__list">
                  {features.map((f) => (
                    <li key={f.key}>
                      <strong>{f.title}</strong>
                      <span>{f.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {excludedFeatures.length > 0 && (
              <div className="includes__excluded">
                <span className="includes__group-name">Hidden for this {type.noun}</span>
                {excludedFeatures.map((f) => f.title).join(' · ')}
              </div>
            )}
          </div>

          <div className="step-head">
            <span className="step-head__num">2</span>
            <div>
              <div className="section-label section-label--flush">{type.Noun} details</div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="lodgeName">{type.Noun} name</label>
            <input
              id="lodgeName"
              value={form.lodgeName}
              onChange={handleNameChange}
              placeholder={type.examples.name}
            />
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
              placeholder={type.examples.slug}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="phone">{type.Noun} phone</label>
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

          {capabilities.hasRooms && (
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
          )}

          <div className="step-head">
            <span className="step-head__num">3</span>
            <div>
              <div className="section-label section-label--flush">Billing</div>
            </div>
          </div>

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

          {/* Needs rooms AND food to be a real question.
              "Specified premises" is a GST status defined by accommodation: a
              property qualifies because its rooms went above ₹7,500/night in
              the preceding financial year, or because the owner filed a
              declaration opting in. A restaurant with no rooms therefore
              cannot hold it (its food is 5% without ITC regardless), and a
              lodge with no kitchen has no food supply for it to rate. */}
          {capabilities.hasRooms && capabilities.servesFood && (
            <div className="checkbox-field">
              <input
                id="isSpecifiedPremises"
                type="checkbox"
                checked={form.isSpecifiedPremises}
                onChange={update('isSpecifiedPremises')}
              />
              <div>
                <label htmlFor="isSpecifiedPremises">Specified premises</label>
                <span className="checkbox-field__note">
                  Tick only if rooms went above ₹7,500 a night last financial year, or the owner has
                  filed a declaration opting in. It taxes their food at 18% with ITC instead of 5%
                  without — confirm with their CA before ticking.
                </span>
              </div>
            </div>
          )}

          <div className="step-head">
            <span className="step-head__num">4</span>
            <div>
              <div className="section-label section-label--flush">Owner &amp; first login</div>
            </div>
          </div>

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
