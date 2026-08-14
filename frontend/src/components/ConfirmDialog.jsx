import { useEffect } from 'react';
import './ConfirmDialog.css';

/**
 * A yes/no before something the user can't quietly undo.
 *
 * Exists as one component because the alternative is a copy per caller, and
 * copies drift: one grows an Escape key, another forgets that the destructive
 * answer shouldn't be the easiest thing to hit.
 *
 * The backdrop does not dismiss. A confirmation that can be dismissed by a
 * stray click is answering its own question — the point is that the user says
 * one thing or the other on purpose.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  // Destructive answers are unfilled and sit apart from the safe one, so the
  // irreversible choice takes the most deliberate aim.
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  // Escape cancels — never confirms. The key people press to back out of
  // something must not be the key that does it.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="glass-backdrop confirm-dialog__backdrop">
      <div
        className="glass-panel confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title">{title}</h3>
        {message && <p className="confirm-dialog__message">{message}</p>}

        <div className="confirm-dialog__actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'confirm-dialog__danger' : 'btn-accent'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
