import { useEffect, useRef, useState } from 'react';
import { apiPatch, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { copyText } from '../../lib/clipboard';
import './forms.css';
import './ProfileMenu.css';

function roleLabel(role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

const CHECKIN_LABEL = {
  HOUR_24: '24-hour cycle',
  NIGHT_BASED: 'Night-based',
  CYCLE: 'Fixed check-in / checkout',
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

const initialPasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '', otp: '' };

export default function ProfileMenu({ user, lodge, onSignOut }) {
  const token = getSession()?.token;
  const rootRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [form, setForm] = useState(initialPasswordForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The dropdown is a fixed panel that can still run past the bottom of a
  // short phone screen once the password form's fields and hint text are all
  // open — a failure caught on submit brings its banner into view rather than
  // relying on it already being visible, same as the other forms in the app.
  const errorRef = useRef(null);
  const reportError = (message) => {
    setError(message);
    requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };
  const [linkCopied, setLinkCopied] = useState('');
  // Which half of the password change is on screen. "details" collects the
  // passwords, "code" collects the one-time code that authorises the change.
  const [passwordStep, setPasswordStep] = useState('details');
  // Masked destination the server reports, e.g. "+91 ******3210", so the user
  // can tell which phone to look at without it being readable over a shoulder.
  const [codeSentTo, setCodeSentTo] = useState('');

  const closeMenu = () => {
    setOpen(false);
    setShowChangePassword(false);
    setForm(initialPasswordForm);
    setError('');
    setSuccess(false);
    setPasswordStep('details');
    setCodeSentTo('');
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

  // Both passwords are validated here, before any code is sent. Sending one and
  // then rejecting the form would spend a real WhatsApp message — and the user's
  // patience — on a mistake the browser could see on its own.
  const validateNewPassword = () => {
    if (!form.currentPassword) return 'Enter your current password.';
    if (form.newPassword.length < 8) return 'New password must be at least 8 characters.';
    if (form.newPassword !== form.confirmPassword) return 'New password and confirmation don’t match.';
    return null;
  };

  const requestCode = async () => {
    setError('');
    const invalid = validateNewPassword();
    if (invalid) {
      reportError(invalid);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiPost('/me/password/otp', { currentPassword: form.currentPassword }, { token });
      setCodeSentTo(res?.phone || '');
      setPasswordStep('code');
      setForm((f) => ({ ...f, otp: '' }));
    } catch (err) {
      reportError(err instanceof ApiError ? err.message : 'Could not send the code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendCode = async (e) => {
    e.preventDefault();
    await requestCode();
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!/^\d{6}$/.test(form.otp.trim())) {
      reportError('Enter the 6-digit code sent to your phone.');
      return;
    }

    setSubmitting(true);
    try {
      await apiPatch(
        '/me/password',
        {
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
          otp: form.otp.trim(),
        },
        { token }
      );
      setSuccess(true);
      setForm(initialPasswordForm);
      setShowChangePassword(false);
      setPasswordStep('details');
      setCodeSentTo('');
    } catch (err) {
      reportError(err instanceof ApiError ? err.message : 'Could not change your password.');
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
        <span className="profile-menu__trigger-avatar" aria-hidden="true">{initial}</span>
        {/* The name and role read out of the topbar rather than only from inside
            the menu — at a shared front desk, "who is this machine signed in
            as?" is worth answering without a click. Hidden on narrow screens,
            where the topbar has no room for it and the avatar stands alone. */}
        <span className="profile-menu__trigger-text">
          <span className="profile-menu__trigger-name">{user.name}</span>
          <span className="profile-menu__trigger-role">{roleLabel(user.role)}</span>
        </span>
        <svg
          className="profile-menu__trigger-chevron"
          viewBox="0 0 12 12"
          width="12"
          height="12"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
            <form
              onSubmit={passwordStep === 'details' ? handleSendCode : handleChangePassword}
              className="profile-menu__password-form"
            >
              {error && (
                <div
                  ref={errorRef}
                  className="form-banner form-banner--error form-banner--flash profile-menu__banner"
                >
                  {error}
                </div>
              )}

              {passwordStep === 'details' ? (
                <>
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
                  <p className="profile-menu__hint">
                    We’ll send a 6-digit code to your registered WhatsApp number to confirm this change.
                  </p>
                </>
              ) : (
                <>
                  <p className="profile-menu__hint">
                    {codeSentTo
                      ? `Enter the 6-digit code sent to ${codeSentTo}.`
                      : 'Enter the 6-digit code sent to your WhatsApp number.'}
                  </p>
                  <div className="field">
                    <label htmlFor="profileOtp">Verification code</label>
                    <input
                      id="profileOtp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={form.otp}
                      onChange={(e) => setForm((f) => ({ ...f, otp: e.target.value.replace(/\D/g, '') }))}
                    />
                  </div>
                  <button
                    type="button"
                    className="profile-menu__link-button"
                    onClick={requestCode}
                    disabled={submitting}
                  >
                    Resend code
                  </button>
                </>
              )}

              <div className="profile-menu__form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (passwordStep === 'code') {
                      // Back to the passwords rather than out of the flow: the
                      // code stays valid, so a mistyped new password does not
                      // cost another message.
                      setPasswordStep('details');
                      setError('');
                      return;
                    }
                    setShowChangePassword(false);
                    setForm(initialPasswordForm);
                    setError('');
                  }}
                  disabled={submitting}
                >
                  {passwordStep === 'code' ? 'Back' : 'Cancel'}
                </button>
                <button className="btn-accent" type="submit" disabled={submitting}>
                  {submitting
                    ? passwordStep === 'details'
                      ? 'Sending…'
                      : 'Saving…'
                    : passwordStep === 'details'
                      ? 'Send code'
                      : 'Verify & save'}
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
