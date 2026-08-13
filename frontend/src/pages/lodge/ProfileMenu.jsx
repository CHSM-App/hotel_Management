import { useEffect, useRef, useState } from 'react';
import { apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { copyText } from '../../lib/clipboard';
import './ProfileMenu.css';

function roleLabel(role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

const CHECKIN_LABEL = {
  HOUR_24: '24-hour cycle',
  NIGHT_BASED: 'Night-based',
};

// Lodge facts that are worth reading but never worth acting on from here —
// they're what someone opens this menu to check ("what's our GSTIN again?"),
// not something they edit. Anything with no value on file is left out rather
// than shown empty; a blank row is noise in a list this short.
function Fact({ label, value }) {
  if (!value) return null;
  return (
    <div className="profile-menu__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const initialPasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function ProfileMenu({ user, lodge, onSignOut }) {
  const token = getSession()?.token;
  const rootRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [form, setForm] = useState(initialPasswordForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linkCopied, setLinkCopied] = useState('');

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

  // A property with no rooms has no room brochure to link to, so its public
  // link is the menu instead — that's the only thing a guest can do with it.
  const publicUrl = lodge
    ? `${window.location.origin}${lodge.hasRooms ? `/lodge/${lodge.slug}` : `/order/${lodge.slug}`}`
    : '';

  const handleCopyPublicLink = async () => {
    const copied = await copyText(publicUrl);
    // A button that shows "Copied!" when nothing reached the clipboard is worse
    // than one that admits it — the owner would paste stale text into WhatsApp.
    setLinkCopied(copied ? 'copied' : 'failed');
    setTimeout(() => setLinkCopied(''), 2000);
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

          {lodge && (
            <>
              <div className="profile-menu__divider" />

              <div className="profile-menu__lodge">
                <div className="profile-menu__lodge-head">
                  <div className="profile-menu__monogram" aria-hidden="true">
                    {lodge.name.charAt(0)}
                  </div>
                  <div className="profile-menu__lodge-title">
                    <div className="profile-menu__lodge-name">{lodge.name}</div>
                    <div className="profile-menu__badges">
                      <span className={`badge ${lodge.isGstRegistered ? 'badge--on' : 'badge--off'}`}>
                        {lodge.isGstRegistered ? `GST · ${lodge.gstin || 'Registered'}` : 'Non-GST'}
                      </span>
                      {lodge.isSpecifiedPremises && (
                        <span className="badge badge--accent">Specified premises</span>
                      )}
                    </div>
                  </div>
                </div>

                <dl className="profile-menu__facts">
                  <Fact
                    label="Location"
                    value={[lodge.city, lodge.state].filter(Boolean).join(', ')}
                  />
                  <Fact label="Address" value={lodge.address} />
                  <Fact
                    label="Check-in"
                    value={CHECKIN_LABEL[lodge.checkinMode] || lodge.checkinMode}
                  />
                  <Fact label="Phone" value={lodge.phone} />
                  <Fact label="WhatsApp" value={lodge.whatsappNumber} />
                </dl>

                <div className="profile-menu__link">
                  <div className="profile-menu__link-head">
                    <span>Public link</span>
                    <button
                      type="button"
                      className="profile-menu__copy-link"
                      onClick={handleCopyPublicLink}
                    >
                      {linkCopied === 'copied' && 'Copied!'}
                      {linkCopied === 'failed' && 'Press Ctrl+C'}
                      {!linkCopied && 'Copy'}
                    </button>
                  </div>
                  <code>{publicUrl}</code>
                </div>
              </div>
            </>
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
