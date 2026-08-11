import { useEffect, useMemo, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { toQrDataUrl, tableOrderUrl, orderUrl } from '../../lib/qr';
import './QrCodesPanel.css';

// Table labels are free text — "Table 1", "Patio #2", "हॉल 3" — and go straight
// into a download attribute, so anything that isn't safe in a filename becomes
// a hyphen before it gets there.
function safeFilename(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'qr-code'
  );
}

// The printed card is the whole point of this screen, so the name is set in
// large plain text under the code. A guest whose camera won't focus, or whose
// phone is dead, still has something to tell reception.
//
// The copy and download buttons carry `qr-card__tools` so the print stylesheet
// can drop them in one rule — they'd otherwise print as empty grey boxes on
// every card.
function QrCard({ title, subtitle, url, dataUrl, large, filename }) {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <figure className={`qr-card ${large ? 'qr-card--large' : ''}`}>
      <div className="qr-card__frame">
        {dataUrl ? (
          <img className="qr-card__img" src={dataUrl} alt={`QR code for ${title}`} />
        ) : (
          <div className="qr-card__img qr-card__img--loading" />
        )}
      </div>
      <figcaption className="qr-card__caption">
        <div className="qr-card__title">{title}</div>
        {subtitle && <div className="qr-card__subtitle">{subtitle}</div>}
      </figcaption>
      <div className="qr-card__url">{url}</div>
      <div className="qr-card__tools">
        <button type="button" onClick={copyLink}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a
          className="qr-card__download"
          href={dataUrl || undefined}
          download={`${safeFilename(filename)}.png`}
          aria-disabled={!dataUrl}
        >
          PNG
        </a>
      </div>
    </figure>
  );
}

export default function QrCodesPanel({ lodge }) {
  const session = getSession();
  const [tables, setTables] = useState(null);
  const [codes, setCodes] = useState({});
  const [error, setError] = useState('');

  const origin = window.location.origin;
  const tableServiceOn = lodge?.foodTableService;

  useEffect(() => {
    if (!tableServiceOn) return;
    apiGet('/tables', { token: session?.token })
      .then((data) => {
        setTables(data.tables.filter((t) => t.isActive));
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load tables.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableServiceOn]);

  // Derived rather than stored: with table service off there is nothing to
  // fetch, and writing [] into state from the effect above would be a render
  // pass to say what the props already told us. Memoised because a fresh []
  // each render is a new dependency for the effect below, which would redraw
  // every QR code on every render.
  const activeTables = useMemo(() => (tableServiceOn ? tables : []), [tableServiceOn, tables]);

  // Codes are rendered once per target and cached by URL, so re-rendering the
  // list (or printing it) doesn't regenerate every image.
  useEffect(() => {
    if (!activeTables || !lodge) return undefined;

    const urls = [orderUrl(origin, lodge.slug), ...activeTables.map((t) => tableOrderUrl(origin, t.qrToken))];

    let cancelled = false;
    Promise.all(urls.map((url) => toQrDataUrl(url, { size: 320 }).then((dataUrl) => [url, dataUrl])))
      .then((pairs) => {
        if (!cancelled) setCodes(Object.fromEntries(pairs));
      })
      .catch(() => {
        if (!cancelled) setError('Could not draw the QR codes in this browser.');
      });

    return () => {
      cancelled = true;
    };
  }, [activeTables, lodge, origin]);

  if (!lodge?.servesFood) {
    return (
      <div className="dash-card">
        <div className="dash-state">
          Food ordering is switched off for this property. Turn it on under Settings to generate QR
          codes.
        </div>
      </div>
    );
  }

  const propertyUrl = orderUrl(origin, lodge.slug);

  return (
    <div className="qr-panel">
      <div className="qr-panel__bar">
        <div className="qr-panel__intro">
          <h3 className="qr-panel__heading">Ordering codes</h3>
          <p className="qr-panel__note">
            Print this page and cut along the dashed edges. One code covers the whole property — put
            copies in the rooms and at reception.
          </p>
        </div>
        <button type="button" className="btn-accent" onClick={() => window.print()}>
          Print all
        </button>
      </div>

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}

      <section className="qr-group">
        <header className="qr-group__head">
          <h4 className="qr-group__title">Your ordering code</h4>
          <span className="qr-group__badge">1 code</span>
        </header>
        <p className="qr-group__hint">
          {lodge.foodRoomService
            ? 'Guests scan this, pick their items, then enter their room number and the PIN you give them at check-in. The same code works everywhere, so you never reprint it when rooms change.'
            : 'Guests scan this to see the menu. Ordering happens at your dining tables — see below.'}
        </p>
        <div className="qr-grid qr-grid--single">
          <QrCard
            large
            title={lodge.name}
            subtitle={lodge.foodRoomService ? 'Scan to order food' : 'Scan to see the menu'}
            url={propertyUrl}
            dataUrl={codes[propertyUrl]}
            filename={`${lodge.slug}-ordering-code`}
          />
        </div>

        {lodge.foodRoomService && (
          <p className="qr-panel__pin-note">
            Each guest&apos;s PIN is on their booking, under Bookings — read it out at check-in. It
            stops working the moment they check out.
          </p>
        )}
      </section>

      {tableServiceOn && (
        <section className="qr-group">
          <header className="qr-group__head">
            <h4 className="qr-group__title">Tables</h4>
            {activeTables?.length > 0 && (
              <span className="qr-group__badge">
                {activeTables.length} code{activeTables.length === 1 ? '' : 's'}
              </span>
            )}
          </header>
          <p className="qr-group__hint">
            One code per table. These need no PIN — orders wait in the queue until the kitchen
            accepts them.
          </p>
          {activeTables?.length === 0 ? (
            <p className="qr-group__hint">No active tables to make codes for.</p>
          ) : (
            <div className="qr-grid">
              {activeTables?.map((table) => {
                const url = tableOrderUrl(origin, table.qrToken);
                return (
                  <QrCard
                    key={table.id}
                    title={table.label}
                    subtitle="Scan to order"
                    url={url}
                    dataUrl={codes[url]}
                    filename={`${lodge.slug}-table-${table.label}`}
                  />
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
