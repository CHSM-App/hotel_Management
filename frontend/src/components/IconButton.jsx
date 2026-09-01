import './IconButton.css';

// An icon-only action button that names itself on hover.
//
// The label is required and does triple duty: it is the accessible name via
// aria-label, the hover tooltip via a data attribute the CSS renders, and the
// long-press label on touch. It is NOT rendered as a `title` attribute — the
// browser's native tooltip would fire a second, unstyled bubble a beat after
// ours and sit in a different place.
//
// Why a CSS tooltip rather than the native one: `title` waits about a second
// before appearing, can't be positioned, and is invisible to keyboard users.
// This one shows on hover AND on keyboard focus, which is the whole reason an
// icon-only control is usable at all without a mouse.
//
// `tone="danger"` tints the button red — for Delete and the like.
export default function IconButton({
  label,
  icon,
  tone,
  className = '',
  ...rest
}) {
  const classes = [
    'icon-btn',
    tone === 'danger' ? 'icon-btn--danger' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      data-tooltip={label}
      {...rest}
    >
      {icon}
    </button>
  );
}
