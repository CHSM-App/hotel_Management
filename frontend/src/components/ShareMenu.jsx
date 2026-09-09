import ShareIcon from './ShareIcon';

// Sending a document to the guest on WhatsApp, in one press.
//
// The server does the sending, not the desk's own phone. Pressing this
// uploads the PDF, the server stores it behind a link and texts that link to
// the guest's number through an approved SMSala template, and the toast that
// follows reports the provider's own verdict — sent or failed. There is
// nothing for the desk to attach and no other app to switch to.
//
// Disabled where the guest has no number on file and none was entered on the
// screen — see billShare.service.js on the backend for the same check.
export default function ShareMenu({
  onShare,
  disabled = false,
  busy = false,
  // Shown in the tooltip so the desk can see which number the bill will go to
  // before pressing — the moment a wrong number is still cheap to fix.
  guestPhone = '',
  label = 'Send this bill to the guest on WhatsApp',
  className = 'btn-secondary bill-actions__icon-btn',
}) {
  const title = busy
    ? 'Sending…'
    : guestPhone
      ? `Send this bill on WhatsApp to ${guestPhone}`
      : 'Send this bill on WhatsApp';

  // No wrapper element. The <span> that used to be here anchored a dropdown
  // that no longer exists, and it broke the action row's sizing: those rules
  // are direct-child selectors (.bill-actions__buttons > button), so a button
  // one level down missed them and rendered at the icon's own 20px rather than
  // the row's 44px.
  return (
    <button
      type="button"
      className={className}
      onClick={() => onShare('whatsapp')}
      disabled={disabled}
      aria-label={busy ? 'Preparing the PDF' : label}
      title={title}
    >
      <ShareIcon />
    </button>
  );
}
