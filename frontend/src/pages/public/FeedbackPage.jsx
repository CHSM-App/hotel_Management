import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import './FeedbackPage.css';

// What the post-checkout (or post-event-completion) WhatsApp link opens: one
// focused page, no dashboard chrome, same trust model as AssetQrPage.jsx —
// the token in the URL is the whole credential, issued once by
// feedbackRequests.service.js or eventFeedbackRequests.service.js and never
// reused. The copy stays generic (no "stay" or "event" wording) since the
// same page serves either.
export default function FeedbackPage() {
  const { token } = useParams();
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiGet(`/public/feedback/${token}`)
      .then((data) => {
        if (cancelled) return;
        setContext(data);
        setSubmitted(Boolean(data.alreadySubmitted));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this page.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) {
      setSubmitError('Choose a rating.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await apiPost(`/public/feedback/${token}`, { rating, comment });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not send your feedback. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="feedback-page">
        <div className="feedback-card feedback-card--center">Loading…</div>
      </div>
    );
  }

  if (error || !context) {
    return (
      <div className="feedback-page">
        <div className="feedback-card feedback-card--center">
          <p className="feedback-error">{error || 'This feedback link is no longer available.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-page">
      <div className="feedback-card">
        {submitted ? (
          <div className="feedback-thanks">
            <span className="feedback-thanks__icon" aria-hidden="true">
              🙏
            </span>
            <h1>Thank you!</h1>
            <p>Your feedback has already been shared with {context.hotelName}. We really appreciate it.</p>
          </div>
        ) : (
          <>
            <header className="feedback-header">
              <h1>How was your experience?</h1>
              <p>
                Hi {context.guestName}, we&rsquo;d love to hear how your time with{' '}
                <strong>{context.hotelName}</strong> went.
              </p>
            </header>

            <form className="feedback-form" onSubmit={submit}>
              <div
                className="feedback-stars"
                role="radiogroup"
                aria-label="Rating"
                onMouseLeave={() => setHoverRating(0)}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`feedback-star${n <= (hoverRating || rating) ? ' feedback-star--on' : ''}`}
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    onMouseEnter={() => setHoverRating(n)}
                    onClick={() => setRating(n)}
                  >
                    ★
                  </button>
                ))}
              </div>

              <label className="feedback-field">
                <span>Anything you&rsquo;d like to tell us? (optional)</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="The good, the small, anything at all…"
                  rows={4}
                  maxLength={1000}
                />
              </label>

              {submitError && <p className="feedback-error">{submitError}</p>}

              <button type="submit" className="feedback-submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Share feedback'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
