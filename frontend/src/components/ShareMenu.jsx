import ShareIcon from './ShareIcon';

// Sending a document to the guest on WhatsApp, in one press.
//
// The desk's own WhatsApp does the sending, not the server. Pressing this saves
// the PDF and opens a chat with the guest, message already typed; the desk
// attaches the file from the downloads folder and presses send. That attach is
// a manual step and there is no way around it from a browser — wa.me carries
// text and never a file, and no page can put a local PDF into someone else's
// WhatsApp.
//
// A server-side send does exist (see billShare.service.js on the backend) and
// needs no attaching at all, but it can only go out through an approved SMSala
// template. Until that template is approved this is the route that works, and
// it works on any desk with WhatsApp installed or WhatsApp Web signed in.
//
// So this button is never disabled for configuration reasons: there is nothing
// to configure. It greys out only while the PDF is being built.
export default function ShareMenu({
  onShare,
  disabled = false,
  busy = false,
  // Shown in the tooltip so the desk can see which number the chat will open
  // on before pressing — the moment a wrong number is still cheap to fix.
  guestPhone = '',
  label = 'Send this document to the guest on WhatsApp',
  className = 'btn-secondary bill-actions__icon-btn',
}) {
  const title = busy
    ? 'Preparing…'
    : guestPhone
      ? `Save the PDF and open WhatsApp to ${guestPhone}`
      : 'Save the PDF and open WhatsApp';

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
