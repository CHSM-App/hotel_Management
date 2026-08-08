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
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="auth-brand__mark">Lodge Management System</div>
        <div className="auth-brand__body">
          <h1>Vengurla Tech admin</h1>
          <p>Internal sign-in. Not for lodge owners or staff — use the regular sign-in page for that.</p>
        </div>
        <div className="auth-brand__foot">Vengurla Tech — staff access</div>
      </div>

      <div className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit} noValidate>
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
      </div>
    </div>
  );
}
