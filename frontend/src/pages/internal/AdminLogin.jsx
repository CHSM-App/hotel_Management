import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost, ApiError } from '../../lib/api';
import { setSession } from '../../lib/auth';
import '../auth/AuthLayout.css';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Staff-only page: keep it out of search indexes. The real access
  // control is the /auth/admin-login endpoint only accepting SUPERADMIN.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.identifier.trim() || !form.password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiPost('/auth/admin-login', form);
      setSession({ token: data.token, role: data.role, name: data.name });
      navigate('/vt-internal/dashboard');
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
          <div className="auth-card__badge auth-card__badge--staff" aria-hidden="true">
            {/* Shield over a keyhole — internal access to every property, rather
                than the roofline-and-key of a single lodge's own sign-in. */}
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 3.2 4.8 6.1v5.4c0 4.3 2.9 7.6 7.2 9.3 4.3-1.7 7.2-5 7.2-9.3V6.1L12 3.2Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="11.2" r="1.9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 13.1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="auth-card__eyebrow">Staff only</div>
          <h2>Admin sign-in</h2>
          <p className="auth-card__hint">Not linked anywhere in the product. Bookmark this page.</p>

          {error && <div className="form-banner form-banner--error">{error}</div>}

          <div className="field">
            <label htmlFor="identifier">Email</label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              value={form.identifier}
              onChange={update('identifier')}
              placeholder="you@vengurlatech.com"
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

        <p className="auth-panel__foot">
          Lodge owners and staff sign in at the regular sign-in page.
        </p>
      </div>
    </div>
  );
}
