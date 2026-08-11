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
            Pick what kind of property it is first — that decides which sections the owner gets.
            Then create the tenant, set its GST defaults, and hand over the first login, which the
            owner changes on their first sign-in.
          </p>
        </div>

        <form className="reg-grid" onSubmit={handleSubmit} noValidate>
          <div className="reg-col">
            {error && <div className="form-banner form-banner--error">{error}</div>}
            {success && (
              <div className="form-banner form-banner--info">
                {successNoun} created. Share the phone/email and temporary password with the owner
                directly.{' '}
                <Link to="/vt-internal/dashboard" style={{ color: '#1d5b3a', fontWeight: 600 }}>
                  View all properties →
                </Link>
              </div>
            )}

            {/* Step 1, before anything else is asked. It decides which sections
                the account gets and what the rest of this form calls things, so
                answering it first is what makes the remaining questions read
                sensibly — a restaurateur is never asked for their "lodge name". */}
            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">1</span>
                <div>
                  <h2 className="reg-card__title">What are you registering?</h2>
                  <p className="reg-card__hint">
                    Everything below adapts to this answer, including what the account is allowed
                    to bill.
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
                <span className="reg-note__icon" aria-hidden="true">
                  ⚠
                </span>
                <span>
                  Whether it has rooms is fixed after go-live — turning that off later would strand
                  their bookings behind a hidden section.
                </span>
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
            </section>

            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">3</span>
                <div>
                  <h2 className="reg-card__title">Billing</h2>
                  <p className="reg-card__hint">
                    These set the tax defaults every document this account issues is built from.
                  </p>
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
            </section>

            <section className="reg-card">
              <div className="reg-card__head">
                <span className="reg-step">4</span>
                <div>
                  <h2 className="reg-card__title">Owner &amp; first login</h2>
                  <p className="reg-card__hint">
                    The owner signs in with their phone or email and this password, then changes it.
                  </p>
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
                <div className="reg-password">
                  <input
                    id="tempPassword"
                    value={form.tempPassword}
                    onChange={update('tempPassword')}
                    placeholder="Generate or set one"
                  />
                  <button className="reg-generate" type="button" onClick={generatePassword}>
                    Generate
                  </button>
                </div>
              </div>
            </section>
          </div>

          <aside className="reg-aside">
            {/* Built from the same FEATURES list the dashboard renders its sidebar
                from, so this is literally what the owner will see after signing
                in — not a hand-maintained marketing list that can go stale. */}
            <div className="reg-summary">
              <div className="reg-summary__identity">
                <div
                  className={`reg-summary__name ${form.lodgeName.trim() ? '' : 'reg-summary__name--empty'}`}
                >
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
