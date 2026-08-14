import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiPost, ApiError } from '../../lib/api';
import { isLodgeUser, setSession } from '../../lib/auth';
import './AuthLayout.css';

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If they get here already signed in — a bookmark, a typed URL, or Back
  // reaching an entry older than the replace — send them on rather than show a
  // sign-in form to somebody who has already satisfied it. Below every hook,
  // so the early return can't change how many run.
  if (isLodgeUser()) {
    return <Navigate to="/dashboard" replace />;
  }

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.identifier.trim() || !form.password) {
      setError('Enter your phone or email and your password.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiPost('/auth/login', form);
      setSession({ token: data.token, role: data.role, name: data.name });
      // replace, not push: signing in is a transition, not a place. Leaving
      // /login on the stack means Back from the dashboard lands on a login
      // form the user has already satisfied.
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell auth-shell--simple">
      <div className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit} noValidate>
          <div className="auth-card__badge" aria-hidden="true">
            {/* Roofline over a key — the two things this login sits between:
                the property, and access to it. */}
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M3 10.2 12 3.5l9 6.7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="10.2" cy="14.4" r="2.7" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12.4 16.1 17 20.4M15.2 18.7l1.7-1.7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2>Sign in</h2>
          <p className="auth-card__hint">Use the phone or email your lodge registered with.</p>

          {error && <div className="form-banner form-banner--error">{error}</div>}

          <div className="field">
            <label htmlFor="identifier">Phone or email</label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              value={form.identifier}
              onChange={update('identifier')}
              placeholder="9876543210 or you@lodge.com"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={update('password')}
              placeholder="••••••••"
            />
          </div>

          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-panel__foot">Trouble signing in? Contact your property owner or admin.</p>
      </div>
    </div>
  );
}
