import { Fragment, useEffect, useMemo, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
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
  const [copyFailed, setCopyFailed] = useState(false);

  // navigator.clipboard needs a secure context (HTTPS, or localhost) and can
  // be missing entirely in some in-app/webview browsers. Lodges often run
  // this dashboard over a plain-HTTP LAN address on a reception tablet, so
  // the async API silently isn't there — falling back to the old
  // execCommand copy (deprecated, but still the only thing that works
  // without HTTPS) keeps the button functional instead of doing nothing.
  const legacyCopy = (text) => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    let ok;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(el);
    return ok;
  };

  const copyLink = () => {
    setCopyFailed(false);
    const markCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    };
    const markFailed = () => {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 1600);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(markCopied, () => {
        if (!legacyCopy(url)) markFailed();
        else markCopied();
      });
    } else if (legacyCopy(url)) {
      markCopied();
    } else {
      markFailed();
    }
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
          {copied ? 'Copied' : copyFailed ? "Couldn't copy" : 'Copy link'}
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
  const [tables, setTables] = useState(() => readCache('/tables:active'));
  const [codes, setCodes] = useState({});
  const [error, setError] = useState('');

  const propertyCopies = 1;
  const tableCopies = 1;
  const printSize = 'card';

  const origin = window.location.origin;
  const tableServiceOn = lodge?.foodTableService;

  useEffect(() => {
    if (!tableServiceOn) return;
    apiGet('/tables', { token: session?.token })
      .then((data) => {
        setTables(writeCache('/tables:active', data.tables.filter((t) => t.isActive)));
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
  //
  // Only the table codes wait on /tables. This used to bail whenever
  // activeTables was still null, which on a property with table service switched
  // on meant a slow — or failed — table fetch left the *property* code as an
  // empty grey square, on screen and on paper both. The property code has never
  // needed that request to be drawable.
  useEffect(() => {
    if (!lodge) return undefined;

    const urls = [
      orderUrl(origin, lodge.slug),
      ...(activeTables ?? []).map((t) => tableOrderUrl(origin, t.qrToken)),
    ];

    let cancelled = false;
    // Each code is caught on its own. One URL the encoder chokes on shouldn't
    // take the rest of the sheet down with it, which a bare Promise.all did.
    Promise.all(
      urls.map((url) =>
        toQrDataUrl(url, { size: 320 })
          .then((dataUrl) => [url, dataUrl])
          .catch(() => [url, null])
      )
    ).then((pairs) => {
      if (cancelled) return;
      setCodes(Object.fromEntries(pairs.filter(([, dataUrl]) => dataUrl)));
      if (pairs.some(([, dataUrl]) => !dataUrl)) {
        setError('Could not draw some of the QR codes in this browser.');
      }
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

  const tableCount = tableServiceOn ? activeTables?.length ?? 0 : 0;

  // The screen always shows exactly one of each code — it is a preview, and
  // eight identical squares would say nothing the first one doesn't. The paper
  // shows however many were asked for.
  //
  // So the count has to govern the original card too, not just the extras. It
  // didn't: at zero copies the tally read "nothing selected" and the Print
  // button greyed out, while the card itself sat there and would still have
  // printed. `qr-noprint` is what takes the original off the sheet when the
  // answer is none.
  // qr-orig is display:contents, so the wrapper never becomes the grid item
  // itself — the card inside it stays the cell, and the on-screen layout is
  // exactly what it was before any of this wrapping existed.
  const duplicatesOf = (count) => Array.from({ length: Math.max(0, count - 1) });
  const originClass = (count) => `qr-orig${count < 1 ? ' qr-noprint' : ''}`;

  return (
    <div className={`qr-panel qr-panel--${printSize}`}>
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
        <div className={`qr-grid ${propertyCopies > 1 ? '' : 'qr-grid--single'}`}>
          <div className={originClass(propertyCopies)}>
            <QrCard
              large
              title={lodge.name}
              subtitle={lodge.foodRoomService ? 'Scan to order food' : 'Scan to see the menu'}
              url={propertyUrl}
              dataUrl={codes[propertyUrl]}
              filename={`${lodge.slug}-ordering-code`}
            />
          </div>
          {duplicatesOf(propertyCopies).map((_, i) => (
            <div className="qr-dupe" key={`prop-${i}`}>
              <QrCard
                large
                title={lodge.name}
                subtitle={lodge.foodRoomService ? 'Scan to order food' : 'Scan to see the menu'}
                url={propertyUrl}
                dataUrl={codes[propertyUrl]}
                filename={`${lodge.slug}-ordering-code`}
              />
            </div>
          ))}
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
                const card = (
                  <QrCard
                    title={table.label}
                    subtitle="Scan to order"
                    url={url}
                    dataUrl={codes[url]}
                    filename={`${lodge.slug}-table-${table.label}`}
                  />
                );
                return (
                  <Fragment key={table.id}>
                    <div className={originClass(tableCopies)}>{card}</div>
                    {duplicatesOf(tableCopies).map((_, i) => (
                      <div className="qr-dupe" key={`${table.id}-${i}`}>
                        {card}
                      </div>
                    ))}
                  </Fragment>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
