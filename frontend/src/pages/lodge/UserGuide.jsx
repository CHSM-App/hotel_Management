import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { guideForLodge, describeProperty, describeFoodService } from '../../lib/userGuide';
import './UserGuide.css';

// The guide as a page of its own, at /guide.
//
// It reads /me for the same two things the dashboard's sidebar reads — what
// this property can do, and what this user is allowed to reach — and renders
// only the parts that survive both. A restaurant is never told to check guests
// in; a cook is never walked through billing. What is on the page is what the
// reader can actually go and do.
export default function UserGuide() {
  const navigate = useNavigate();
  const session = getSession();
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    apiGet('/me', { token: session?.token })
      .then((data) => {
        if (!ignore) setMe(data);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof ApiError ? err.message : 'Could not load the guide.');
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lodge = me?.lodge;
  const permissions = me?.user.permissions || [];
  const sections = guideForLodge(lodge, permissions);
  const property = describeProperty(lodge);
  const foodService = describeFoodService(lodge);

  return (
    <div className="guide-page">
      <header className="guide-page__top">
        <div className="guide-page__topinner">
          <button type="button" className="guide-page__back" onClick={() => navigate('/dashboard')}>
            ← Back to dashboard
          </button>
          <span className="guide-page__lodge">{lodge?.name || ''}</span>
        </div>
      </header>

      <div className="guide-page__inner">
        <div className="guide-page__intro">
          <p className="guide-page__eyebrow">User guide</p>
          <h1 className="guide-page__title">How to use the system</h1>
          {lodge && (
            // Stated up front so the reader knows why their guide is shorter
            // than the one on the next desk. Without this line, a missing
            // section reads as something broken rather than something not
            // switched on.
            <p className="guide-page__lede">
              Written for <strong>{lodge.name}</strong>, which is set up as {property.label}
              {foodService ? `, serving food ${foodService}` : ''}. Everything below is a screen you
              can actually open — nothing here describes a feature this {property.noun} does not
              have, or one your role cannot reach.
            </p>
          )}
          {error && <div className="form-banner form-banner--error">{error}</div>}
          {!me && !error && <p className="guide-page__loading">Loading your guide…</p>}
        </div>

        {me && (
          <div className="guide-page__cols">
            {/* Contents rail: the page is long by design, and this is how
                somebody halfway through a shift finds the one screen they are
                stuck on without reading the rest. */}
            <nav className="guide-toc" aria-label="Guide contents">
              <p className="guide-toc__label">On this page</p>
              <ul>
                {sections.map((section) => (
                  <li key={section.key}>
                    <a href={`#guide-${section.key}`}>{section.title}</a>
                  </li>
                ))}
              </ul>
            </nav>

            <main className="guide-page__body">
              {sections.map((section) => (
                <section
                  className="guide-section"
                  key={section.key}
                  id={`guide-${section.key}`}
                  aria-labelledby={`guide-h-${section.key}`}
                >
                  <h2 className="guide-section__title" id={`guide-h-${section.key}`}>
                    {section.title}
                  </h2>
                  <p className="guide-section__summary">{section.summary}</p>

                  {/* Numbered because they are a sequence — the order is the
                      order the screen makes you work in. */}
                  <ol className="guide-steps">
                    {section.steps.map((step, i) => (
                      <li className="guide-step" key={step.heading}>
                        <span className="guide-step__num" aria-hidden="true">
                          {i + 1}
                        </span>
                        <div>
                          <h3 className="guide-step__heading">{step.heading}</h3>
                          <p className="guide-step__body">{step.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {/* The irreversible things and the places people get caught
                      out. Set apart so they are not skimmed as more steps. */}
                  {section.notes.length > 0 && (
                    <div className="guide-notes">
                      <h3 className="guide-notes__title">Worth knowing</h3>
                      <ul>
                        {section.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              ))}

              <p className="guide-page__foot">
                Still stuck? Whoever set this {property.noun} up can change what your role reaches,
                and can turn features on or off for the whole property.
              </p>
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
