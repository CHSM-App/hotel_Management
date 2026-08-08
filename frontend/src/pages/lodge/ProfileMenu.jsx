import { useEffect, useRef, useState } from 'react';
import { apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import './ProfileMenu.css';

function roleLabel(role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

const initialPasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function ProfileMenu({ user, onSignOut }) {
  const token = getSession()?.token;
  const rootRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [form, setForm] = useState(initialPasswordForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const closeMenu = () => {
    setOpen(false);
    setShowChangePassword(false);
    setForm(initialPasswordForm);
    setError('');
    setSuccess(false);
  };

  const toggleMenu = () => {
    if (open) {
      closeMenu();
    } else {
      setOpen(true);
    }
  };

  // Click-away and Escape both close the menu — standard dropdown behavior,
  // and important here since it's holding a password form a user might
  // otherwise leave half-filled and forget about.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) closeMenu();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (form.newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation don’t match.');
      return;
    }

    setSubmitting(true);
    try {
      await apiPatch(
        '/me/password',
        { currentPassword: form.currentPassword, newPassword: form.newPassword },
        { token }
      );
      setSuccess(true);
      setForm(initialPasswordForm);
      setShowChangePassword(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setSubmitting(false);
    }
  };

  const initial = user.name ? user.name.charAt(0).toUpperCase() : '?';

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className="profile-menu__trigger"
        onClick={toggleMenu}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initial}
      </button>

      {open && (
        <div className="profile-menu__dropdown">
          <div className="profile-menu__identity">
            <div className="profile-menu__avatar">{initial}</div>
            <div>
              <div className="profile-menu__name">{user.name}</div>
              <span className="badge badge--on">{roleLabel(user.role)}</span>
            </div>
          </div>

          {(user.email || user.phone) && (
            <div className="profile-menu__contact">
              {user.phone && <div>{user.phone}</div>}
              {user.email && <div>{user.email}</div>}
            </div>
          )}

          <div className="profile-menu__divider" />

          {success && !showChangePassword && (
            <div className="form-banner form-banner--info profile-menu__banner">Password changed.</div>
          )}

          {!showChangePassword ? (
            <button
              type="button"
              className="profile-menu__action"
              onClick={() => {
                setShowChangePassword(true);
                setSuccess(false);
              }}
            >
              Change password
            </button>
          ) : (
            <form onSubmit={handleChangePassword} className="profile-menu__password-form">
              {error && <div className="form-banner form-banner--error profile-menu__banner">{error}</div>}
              <div className="field">
                <label htmlFor="profileCurrentPassword">Current password</label>
                <input
                  id="profileCurrentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={form.currentPassword}
                  onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="profileNewPassword">New password</label>
                <input
                  id="profileNewPassword"
                  type="password"
                  autoComplete="new-password"
                  value={form.newPassword}
                  onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="profileConfirmPassword">Confirm new password</label>
                <input
                  id="profileConfirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                />
              </div>
              <div className="profile-menu__form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowChangePassword(false);
                    setForm(initialPasswordForm);
                    setError('');
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button className="btn-accent" type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          )}

          <div className="profile-menu__divider" />

          <button type="button" className="profile-menu__action profile-menu__action--danger" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
