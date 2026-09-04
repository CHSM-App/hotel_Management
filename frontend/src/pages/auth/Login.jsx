import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiPost, ApiError } from '../../lib/api';
import { isLodgeUser, setSession } from '../../lib/auth';
import Req from '../../components/RequiredMark';
import './AuthLayout.css';

function EyeToggle({ shown, onClick }) {
  return (
    <button
      type="button"
      className="field__eye-toggle"
      onClick={onClick}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      tabIndex={-1}
    >
      {shown ? (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M3 3l18 18M10.6 10.6a2.5 2.5 0 003.5 3.5M6.6 6.7C4.5 8.1 3 10 2 12c1.6 3.6 5 7 10 7 1.8 0 3.4-.4 4.8-1.1M17.4 15.4C19 14 20.2 12 22 12c-1-2-2.5-3.9-4.4-5.3-1.4-.7-3-1.1-4.8-1.1"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M2 12c1.6-3.6 5-7 10-7s8.4 3.4 10 7c-1.6 3.6-5 7-10 7s-8.4-3.4-10-7Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2.7" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )}
    </button>
  );
}

const initialForgotForm = { identifier: '', newPassword: '', confirmPassword: '' };

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef(null);
  const reportError = (message) => {
    setError(message);
    requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  // Swaps in for the sign-in form itself, the same way ProfileMenu's password
  // form swaps in for its "Change password" button — one card, one thing on
  // screen at a time, rather than a second page to navigate to.
  const [showForgot, setShowForgot] = useState(false);
  const [forgotForm, setForgotForm] = useState(initialForgotForm);
  const [forgotError, setForgotError] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);
  const [showForgotPasswords, setShowForgotPasswords] = useState(false);
  const forgotErrorRef = useRef(null);
  const reportForgotError = (message) => {
    setForgotError(message);
    requestAnimationFrame(() => {
      forgotErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const closeForgot = () => {
    setShowForgot(false);
    setForgotForm(initialForgotForm);
    setForgotError('');
    setForgotDone(false);
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setForgotError('');

    if (!forgotForm.identifier.trim()) {
      reportForgotError('Enter your phone or email.');
      return;
    }
    if (forgotForm.newPassword.length < 8) {
      reportForgotError('New password must be at least 8 characters.');
      return;
    }
    if (forgotForm.newPassword !== forgotForm.confirmPassword) {
      reportForgotError('New password and confirmation don’t match.');
      return;
    }

    setForgotSubmitting(true);
    try {
      await apiPost('/auth/forgot-password', {
        identifier: forgotForm.identifier.trim(),
        newPassword: forgotForm.newPassword,
      });
      setForgotDone(true);
    } catch (err) {
      reportForgotError(err instanceof ApiError ? err.message : 'Could not reset your password.');
    } finally {
      setForgotSubmitting(false);
    }
  };

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
      reportError('Enter your phone or email and your password.');
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
      reportError(err instanceof ApiError ? err.message : 'Could not sign in. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell auth-shell--simple">
      <div className="auth-panel">
        {!showForgot ? (
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

            {error && (
              <div ref={errorRef} className="form-banner form-banner--error form-banner--flash">
                {error}
              </div>
            )}

            <div className="field">
              <label htmlFor="identifier">
                Phone or email
                <Req />
              </label>
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
              <div className="field__label-row">
                <label htmlFor="password">
                  Password
                  <Req />
                </label>
                <button
                  type="button"
                  className="field__aux-link"
                  onClick={() => {
                    setShowForgot(true);
                    setError('');
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <div className="field__input-wrap">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={update('password')}
                  placeholder="••••••••"
                />
                <EyeToggle shown={showPassword} onClick={() => setShowPassword((v) => !v)} />
              </div>
            </div>

            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form className="auth-card" onSubmit={handleForgotSubmit} noValidate>
            <h2>Reset password</h2>
            <p className="auth-card__hint">
              Enter the phone or email your lodge registered with, and choose a new password.
            </p>

            {forgotError && (
              <div ref={forgotErrorRef} className="form-banner form-banner--error form-banner--flash">
                {forgotError}
              </div>
            )}

            {forgotDone && (
              <div className="form-banner form-banner--info">
                Password updated. You can sign in with your new password now.
              </div>
            )}

            {!forgotDone && (
              <>
                <div className="field">
                  <label htmlFor="forgotIdentifier">
                    Phone or email
                    <Req />
                  </label>
                  <input
                    id="forgotIdentifier"
                    type="text"
                    autoComplete="username"
                    value={forgotForm.identifier}
                    onChange={(e) => setForgotForm((f) => ({ ...f, identifier: e.target.value }))}
                    placeholder="9876543210 or you@lodge.com"
                  />
                </div>

                <div className="field">
                  <label htmlFor="forgotNewPassword">
                    New password
                    <Req />
                  </label>
                  <div className="field__input-wrap">
                    <input
                      id="forgotNewPassword"
                      type={showForgotPasswords ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={forgotForm.newPassword}
                      onChange={(e) => setForgotForm((f) => ({ ...f, newPassword: e.target.value }))}
                    />
                    <EyeToggle
                      shown={showForgotPasswords}
                      onClick={() => setShowForgotPasswords((v) => !v)}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="forgotConfirmPassword">
                    Confirm new password
                    <Req />
                  </label>
                  <div className="field__input-wrap">
                    <input
                      id="forgotConfirmPassword"
                      type={showForgotPasswords ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={forgotForm.confirmPassword}
                      onChange={(e) => setForgotForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                    />
                    <EyeToggle
                      shown={showForgotPasswords}
                      onClick={() => setShowForgotPasswords((v) => !v)}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="auth-card__actions">
              <button type="button" className="btn-secondary" onClick={closeForgot} disabled={forgotSubmitting}>
                {forgotDone ? 'Back to sign in' : 'Cancel'}
              </button>
              {!forgotDone && (
                <button className="btn-primary" type="submit" disabled={forgotSubmitting}>
                  {forgotSubmitting ? 'Saving…' : 'Reset password'}
                </button>
              )}
            </div>
          </form>
        )}

        <p className="auth-panel__foot">Trouble signing in? Contact your property owner or admin.</p>
      </div>
    </div>
  );
}
