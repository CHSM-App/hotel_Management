import { useState } from 'react';
import { Link } from 'react-router-dom';
import './PrivacyPolicy.css';

const SUPPORT_EMAIL = 'support@vengurlatech.com';

// No server endpoint for this yet: submitting opens the user's mail app with the
// request pre-filled to support. Swap for a POST when requests need tracking.
export default function DeleteAccount() {
  const [f, setF] = useState({ name: '', phone: '', email: '', reason: '', confirm: false });
  const set = (k) => (e) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = (e) => {
    e.preventDefault();
    const body = [
      `Name: ${f.name}`,
      `Registered phone: ${f.phone}`,
      `Registered email: ${f.email || '-'}`,
      `Reason: ${f.reason || '-'}`,
      '',
      'I confirm I want this account and its personal data deleted.',
    ].join('\n');
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      'Account deletion request'
    )}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="policy-page">
      <div className="policy-shell policy-shell--narrow" id="account-deletion">
        <main className="policy-card">
          <p className="policy-eyebrow">Account deletion</p>
          <h1>Request account deletion</h1>
          <p className="policy-updated">We respond within 30 days</p>

          <p>
            Use this form to ask us to delete a staff account and its personal data. We verify the
            request, then delete the account within 30 days — except data we must keep for legal,
            tax or regulatory reasons (for example billing records or guest register data), which
            is kept only as long as the law requires. Guests should contact the property they
            stayed at, or use this form and we will forward it. See our{' '}
            <Link to="/privacy#account-deletion">Privacy Policy</Link> for details.
          </p>

          <form className="policy-form" onSubmit={submit}>
            <div className="policy-form__row">
              <label>
                Full name
                <input required value={f.name} onChange={set('name')} autoComplete="name" />
              </label>
              <label>
                Registered phone number
                <input required type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" />
              </label>
            </div>
            <label>
              Registered email (optional)
              <input type="email" value={f.email} onChange={set('email')} autoComplete="email" />
            </label>
            <label>
              Reason (optional)
              <textarea rows={3} value={f.reason} onChange={set('reason')} />
            </label>
            <label className="policy-form__check">
              <input required type="checkbox" checked={f.confirm} onChange={set('confirm')} />
              <span>I understand this permanently deletes my account and cannot be undone.</span>
            </label>
            <button type="submit" className="policy-form__submit">
              Submit deletion request
            </button>
            <p className="policy-form__hint">
              This opens your email app with the request ready to send to {SUPPORT_EMAIL}.
            </p>
          </form>

          <p>
            <Link to="/privacy">← Back to Privacy Policy</Link>
          </p>
        </main>
      </div>
    </div>
  );
}
