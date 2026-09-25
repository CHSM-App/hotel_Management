import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import LocationPicker from '../../components/LocationPicker';
import { validateCoordinates } from '../../lib/coordinates';
import Req from '../../components/RequiredMark';
import {
  PROPERTY_TYPES,
  FOOD_SERVICE_STYLES,
  FEATURES,
  featuresForCapabilities,
  SIDEBAR_GROUP_ORDER,
} from '../../lib/propertyProfile';
import '../auth/AuthLayout.css';
import './LodgeRegistration.css';

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const CHECKIN_MODES = [
  { value: 'HOUR_24', label: '24-hour cycle (from check-in time)' },
  { value: 'NIGHT_BASED', label: 'Night-based (fixed checkout time)' },
  { value: 'CYCLE', label: 'Fixed cycle (check-in / checkout times, whole nights)' },
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
  latitude: '',
  longitude: '',
  lodgeNameMr: '',
  addressMr: '',
  checkinMode: 'HOUR_24',
  propertyType: 'LODGE',
  foodServiceStyle: 'BOTH',
  // Add-ons: off by default, switched on explicitly in the Feature access
  // section below. hasEvents already worked this way; hasAssets/hasExpenses
  // now follow the same pattern instead of shipping on for free.
  hasEvents: false,
  hasAssets: false,
  hasExpenses: false,
  isGstRegistered: false,
  gstin: '',
  isSpecifiedPremises: false,
  ownerName: '',
  ownerEmail: '',
  ownerPhone: '',
  tempPassword: '',
};

// The four bits the API stores, resolved from the two choices step 1 asks
// for. Food service style only applies to a lodge that serves meals.
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
  const [fieldError, setFieldError] = useState(null);
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
  const [success, setSuccess] = useState(false);
  const [successNoun, setSuccessNoun] = useState('Lodge');
  const [submitting, setSubmitting] = useState(false);
  const session = useMemo(() => getSession(), []);

  const update = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const type = useMemo(
    () => PROPERTY_TYPES.find((t) => t.key === form.propertyType) || PROPERTY_TYPES[0],
    [form.propertyType]
  );

  // What the property type alone unlocks — the base features that ride along
  // with Lodge / Lodge with meals / Restaurant and can't be switched off here.
  const baseCapabilities = useMemo(
    () => capabilitiesFor(form.propertyType, form.foodServiceStyle),
    [form.propertyType, form.foodServiceStyle]
  );

  // Base capabilities plus the three opt-in add-ons, for the summary rail and
  // the payload.
  const capabilities = useMemo(
    () => ({ ...baseCapabilities, hasEvents: form.hasEvents, hasAssets: form.hasAssets, hasExpenses: form.hasExpenses }),
    [baseCapabilities, form.hasEvents, form.hasAssets, form.hasExpenses]
  );

  const includedFeatures = useMemo(() => featuresForCapabilities(capabilities), [capabilities]);
  const includedKeys = new Set(includedFeatures.map((f) => f.key));
  const excludedFeatures = FEATURES.filter((f) => !includedKeys.has(f.key));

  const includedGroups = SIDEBAR_GROUP_ORDER.map((group) => ({
    group,
    features: includedFeatures.filter((f) => f.group === group),
  })).filter((g) => g.features.length > 0);

  // The three add-on switches in the Feature access section. Everything else
  // FEATURES lists either has no capability gate (Billing, Staff) or is a
  // fixed base feature the property type already decided.
  const ADDONS = [
    { key: 'events', formKey: 'hasEvents', feature: FEATURES.find((f) => f.key === 'events') },
    { key: 'assets', formKey: 'hasAssets', feature: FEATURES.find((f) => f.key === 'assets') },
    { key: 'expenses', formKey: 'hasExpenses', feature: FEATURES.find((f) => f.key === 'expenses') },
  ];
  const baseFeatures = FEATURES.filter((f) => !ADDONS.some((a) => a.key === f.key));

  const handleNameChange = (e) => {
    const lodgeName = e.target.value;
    setForm((f) => ({ ...f, lodgeName, slug: slugTouched ? f.slug : slugify(lodgeName) }));
  };

  const generatePassword = () => {
    setForm((f) => ({ ...f, tempPassword: Math.random().toString(36).slice(2, 10) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldError(null);

    if (!form.lodgeName.trim()) {
      failOn('lodgeName', `Enter the ${type.noun} name.`);
      return;
    }
    if (!form.slug.trim()) {
      failOn('slug', 'Enter a public link slug.');
      return;
    }
    if (form.isGstRegistered && !form.gstin.trim()) {
      failOn('gstin', 'Enter the GSTIN, or turn off GST registration.');
      return;
    }
    if (form.gstin.trim() && !GSTIN_PATTERN.test(form.gstin.trim().toUpperCase())) {
      failOn('gstin', 'Enter a valid 15-character GSTIN.');
      return;
    }
    if (!form.ownerName.trim()) {
      failOn('ownerName', 'Enter the owner name.');
      return;
    }
    if (!form.ownerPhone.trim()) {
      failOn('ownerPhone', 'Enter the owner phone.');
      return;
    }
    if (!form.tempPassword) {
      failOn('tempPassword', 'Set a temporary password for the first login.');
      return;
    }
    const coords = validateCoordinates(form);
    if (!coords.ok) {
      failOn('location-lat', coords.message);
      return;
    }

    setSubmitting(true);
    try {
      const { propertyType, foodServiceStyle, ...rest } = form;
      const caps = {
        ...capabilitiesFor(propertyType, foodServiceStyle),
        hasEvents: Boolean(rest.hasEvents),
        hasAssets: Boolean(rest.hasAssets),
        hasExpenses: Boolean(rest.hasExpenses),
      };
      const payload = {
        ...rest,
        ...caps,
        latitude: coords.latitude,
        longitude: coords.longitude,
        isSpecifiedPremises: caps.hasRooms && caps.servesFood ? rest.isSpecifiedPremises : false,
      };
      await apiPost('/internal/lodges', payload, { token: session?.token });
      setSuccessNoun(type.Noun);
      setSuccess(true);
      setForm(initialForm);
      setSlugTouched(false);
    } catch (err) {
      if (err instanceof ApiError && err.field && document.getElementById(err.field)) {
        failOn(err.field, err.message);
      } else {
        reportError(
          err instanceof ApiError ? err.message : `Could not create the ${type.noun}. Check your connection.`
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="reg-shell">
      <header className="reg-topbar">
        <div>
          <div className="reg-topbar__mark">Lodge Management System</div>
          <div className="reg-topbar__eyebrow">
            Vengurla Tech admin{session?.name ? ` · ${session.name}` : ''}
          </div>
        </div>
        <Link className="reg-back" to="/vt-internal/dashboard">
          ← All properties
        </Link>
      </header>

      <div className="reg-main">
        <div className="reg-head">
          <span className="reg-head__chip">Staff only</span>
          <h1>Register a new {type.noun}</h1>
          <p>
            Pick what kind of property it is first, choose which add-ons the account gets, then create
            the tenant and hand over the first login, which the owner changes on their first sign-in.
          </p>
        </div>

        <form className="reg-grid" onSubmit={handleSubmit} noValidate>
          <div className="reg-col">
            {error && (
              <div ref={errorRef} className="form-banner form-banner--error form-banner--flash">
                {error}
              </div>
            )}
            {success && (
              <div className="form-banner form-banner--info">
                {successNoun} created. Share the phone/email and temporary password with the owner
                directly.{' '}
                <Link to="/vt-internal/dashboard" style={{ color: '#1d5b3a', fontWeight: 600 }}>
                  View all properties →
                </Link>
              </div>
            )}

            {/* Step 1: property type. Decides the base features (step 3
                shows exactly which) and what the rest of this form calls
                things. */}
            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">1</span>
                <div>
                  <h2 className="reg-card__title">What are you registering?</h2>
                  <p className="reg-card__hint">
                    Fixes the base features this account gets — see Feature access below.
                  </p>
                </div>
              </div>

              <div className="reg-types">
                {PROPERTY_TYPES.map((option) => (
                  <label
                    key={option.key}
                    className={`reg-type ${form.propertyType === option.key ? 'reg-type--on' : ''}`}
                  >
                    <input
                      className="reg-type__input"
                      type="radio"
                      name="propertyType"
                      value={option.key}
                      checked={form.propertyType === option.key}
                      onChange={() => setForm((f) => ({ ...f, propertyType: option.key }))}
                    />
                    <span className="reg-type__check" aria-hidden="true" />
                    <span className="reg-type__body">
                      <span className="reg-type__label">{option.label}</span>
                      <span className="reg-type__tagline">{option.tagline}</span>
                      <span className="reg-type__desc">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="reg-note">
                <span className="reg-note__icon" aria-hidden="true">⚠</span>
                <span>
                  Whether it has rooms is fixed after go-live — turning that off later would strand
                  their bookings behind a hidden section.
                </span>
              </div>

              {form.propertyType === 'LODGE_WITH_FOOD' && (
                <div className="field">
                  <label htmlFor="foodServiceStyle">How do guests order food?</label>
                  <select id="foodServiceStyle" value={form.foodServiceStyle} onChange={update('foodServiceStyle')}>
                    {FOOD_SERVICE_STYLES.map((style) => (
                      <option key={style.key} value={style.key}>
                        {style.label} — {style.description}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">2</span>
                <div>
                  <h2 className="reg-card__title">{type.Noun} details</h2>
                  <p className="reg-card__hint">
                    The name and slug appear on their public page and on every bill.
                  </p>
                </div>
              </div>

              <div className="field">
                <label htmlFor="lodgeName">
                  {type.Noun} name<Req />
                </label>
                <input
                  id="lodgeName"
                  aria-invalid={invalid('lodgeName')}
                  value={form.lodgeName}
                  onChange={handleNameChange}
                  placeholder={type.examples.name}
                />
                {fieldErr('lodgeName')}
              </div>

              <div className="field">
                <label htmlFor="slug">
                  Public link slug<Req />
                </label>
                <input
                  id="slug"
                  aria-invalid={invalid('slug')}
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update('slug')(e);
                  }}
                  placeholder={type.examples.slug}
                />
                {fieldErr('slug')}
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

              <div className="field">
                <label htmlFor="location-lat">Map location (optional)</label>
                <LocationPicker
                  idPrefix="location"
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onChange={(pos) => setForm((f) => ({ ...f, ...pos }))}
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="lodgeNameMr">Name in Marathi (optional)</label>
                  <input id="lodgeNameMr" value={form.lodgeNameMr} onChange={update('lodgeNameMr')} placeholder="आनंद होम स्टे" lang="mr" />
                </div>
                <div className="field">
                  <label htmlFor="addressMr">Address in Marathi (optional)</label>
                  <input id="addressMr" value={form.addressMr} onChange={update('addressMr')} placeholder="मोती तलावाजवळ, सावंतवाडी, वेंगुर्ला" lang="mr" />
                </div>
              </div>

              {baseCapabilities.hasRooms && (
                <div className="field">
                  <label htmlFor="checkinMode">Check-in cycle</label>
                  <select id="checkinMode" value={form.checkinMode} onChange={update('checkinMode')}>
                    {CHECKIN_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            {/* Step 3: the dedicated Feature access section this form exists
                for. Base features (from step 1) are shown locked and already
                checked — nothing to decide, just a promise of what ships.
                The three add-ons get a real switch each. */}
            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">3</span>
                <div>
                  <h2 className="reg-card__title">Feature access</h2>
                  <p className="reg-card__hint">
                    Every tab the owner's dashboard can show, and who controls it.
                  </p>
                </div>
              </div>

              <div className="reg-access-group">
                <div className="reg-access-group__label">
                  Included with {type.label} — set by step 1, not editable here
                </div>
                <div className="reg-access-list">
                  {baseFeatures.map((f) => {
                    const on = includedKeys.has(f.key);
                    return (
                      <div key={f.key} className={`reg-access-row ${on ? '' : 'reg-access-row--off'}`}>
                        <div className="reg-access-row__text">
                          <span className="reg-access-row__title">{f.title}</span>
                          <span className="reg-access-row__desc">{f.description}</span>
                        </div>
                        <span className={`reg-lock ${on ? 'reg-lock--on' : 'reg-lock--off'}`} aria-hidden="true">
                          {on ? '✓' : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="reg-access-group">
                <div className="reg-access-group__label">Add-ons — switch on per property</div>
                <div className="reg-access-list">
                  {ADDONS.map(({ formKey, feature }) => (
                    <label key={formKey} className="reg-access-row reg-access-row--toggle">
                      <div className="reg-access-row__text">
                        <span className="reg-access-row__title">{feature.title}</span>
                        <span className="reg-access-row__desc">{feature.description}</span>
                      </div>
                      <span className="reg-switch">
                        <input type="checkbox" checked={form[formKey]} onChange={update(formKey)} />
                        <span className="reg-switch__track"><span className="reg-switch__thumb" /></span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">4</span>
                <div>
                  <h2 className="reg-card__title">Billing</h2>
                  <p className="reg-card__hint">
                    These set the tax defaults every document this account issues is built from.
                  </p>
                </div>
              </div>

              <div className="checkbox-field">
                <input id="isGstRegistered" type="checkbox" checked={form.isGstRegistered} onChange={update('isGstRegistered')} />
                <div>
                  <label htmlFor="isGstRegistered">GST registered</label>
                  <span className="checkbox-field__note">Fixed after go-live. Decides whether tax invoices and bills of supply exist at all.</span>
                </div>
              </div>

              {form.isGstRegistered && (
                <div className="field">
                  <label htmlFor="gstin">
                    GSTIN<Req label="required while GST registered" />
                  </label>
                  <input id="gstin" aria-invalid={invalid('gstin')} value={form.gstin} onChange={update('gstin')} placeholder="27ABCDE1234F1Z5" />
                  {fieldErr('gstin')}
                </div>
              )}

              {baseCapabilities.hasRooms && baseCapabilities.servesFood && (
                <div className="checkbox-field">
                  <input id="isSpecifiedPremises" type="checkbox" checked={form.isSpecifiedPremises} onChange={update('isSpecifiedPremises')} />
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
            </section>

            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">5</span>
                <div>
                  <h2 className="reg-card__title">Owner &amp; first login</h2>
                  <p className="reg-card__hint">
                    The owner signs in with their phone or email and this password, then changes it.
                  </p>
                </div>
              </div>

              <div className="field">
                <label htmlFor="ownerName">
                  Owner name<Req />
                </label>
                <input id="ownerName" aria-invalid={invalid('ownerName')} value={form.ownerName} onChange={update('ownerName')} placeholder="Suresh Naik" />
                {fieldErr('ownerName')}
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="ownerPhone">
                    Owner phone<Req />
                  </label>
                  <input id="ownerPhone" aria-invalid={invalid('ownerPhone')} value={form.ownerPhone} onChange={update('ownerPhone')} placeholder="9876543210" />
                  {fieldErr('ownerPhone')}
                </div>
                <div className="field">
                  <label htmlFor="ownerEmail">Owner email (optional)</label>
                  <input id="ownerEmail" type="email" value={form.ownerEmail} onChange={update('ownerEmail')} placeholder="owner@lodge.com" />
                </div>
              </div>

              <div className="field">
                <label htmlFor="tempPassword">
                  Temporary password<Req />
                </label>
                <div className="reg-password">
                  <input id="tempPassword" aria-invalid={invalid('tempPassword')} value={form.tempPassword} onChange={update('tempPassword')} placeholder="Generate or set one" />
                  <button className="reg-generate" type="button" onClick={generatePassword}>Generate</button>
                </div>
                {fieldErr('tempPassword')}
              </div>
            </section>
          </div>

          <aside className="reg-aside">
            <div className="reg-summary">
              <div className="reg-summary__identity">
                <div className={`reg-summary__name ${form.lodgeName.trim() ? '' : 'reg-summary__name--empty'}`}>
                  {form.lodgeName.trim() || `Untitled ${type.noun}`}
                </div>
                <div className="reg-summary__link">/{form.slug.trim() || type.examples.slug}</div>
              </div>

              <div className="reg-summary__head">
                <span className="reg-summary__eyebrow">This {type.noun} will get</span>
                <span className="reg-summary__count">{includedFeatures.length} sections</span>
              </div>

              {includedGroups.map(({ group, features }) => (
                <div className="reg-summary__group" key={group}>
                  <div className="reg-summary__group-name">{group}</div>
                  <ul className="reg-summary__list">
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
                <div className="reg-summary__excluded">
                  <div className="reg-summary__group-name">Hidden for this {type.noun}</div>
                  {excludedFeatures.map((f) => f.title).join(' · ')}
                </div>
              )}
            </div>

            <div className="reg-submit">
              <button className="reg-cta" type="submit" disabled={submitting}>
                {submitting ? `Creating ${type.noun}…` : `Create ${type.noun} and first login`}
              </button>
              <p className="reg-submit__note">
                Hand the temporary password over directly — it is never emailed.
              </p>
            </div>
          </aside>
        </form>
      </div>
    </div>
  );
}
