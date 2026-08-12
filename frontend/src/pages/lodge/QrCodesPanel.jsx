import { Fragment, useEffect, useMemo, useState } from 'react';
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

// How big each card prints. A property code goes on a wall or a room folder
// and wants to be seen from across the room; a table code sits at arm's length
// on a table tent. Same code either way — only the printed size differs.
const PRINT_SIZES = [
  { key: 'small', label: 'Small', hint: '8 per sheet' },
  { key: 'card', label: 'Card', hint: '4 per sheet' },
  { key: 'large', label: 'Large', hint: '2 per sheet' },
];

export default function QrCodesPanel({ lodge }) {
  const session = getSession();
  const [tables, setTables] = useState(null);
  const [codes, setCodes] = useState({});
  const [error, setError] = useState('');

  // What actually goes on the paper. "Print all" printed one of everything at
  // one size, which is never what a property wants: the ordering code needs a
  // copy in every room, while each table needs exactly one.
  const [propertyCopies, setPropertyCopies] = useState(1);
  const [tableCopies, setTableCopies] = useState(1);
  const [printSize, setPrintSize] = useState('card');

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
  const totalCards = propertyCopies + tableCount * tableCopies;
  const perSheet = printSize === 'small' ? 8 : printSize === 'large' ? 2 : 4;
  const sheets = Math.ceil(totalCards / perSheet) || 0;

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
      <div className="qr-panel__bar">
        <div className="qr-panel__intro">
          <h3 className="qr-panel__heading">Ordering codes</h3>
          <p className="qr-panel__note">
            Print this page and cut along the dashed edges. One code covers the whole property — put
            copies in the rooms and at reception.
          </p>
        </div>
      </div>

      {/* Print settings, not display settings. Nothing here changes what a
          guest scans — the same code is on every copy. */}
      <div className="qr-print">
        <div className="qr-print__row">
          <label className="qr-print__field">
            <span className="qr-print__label">Copies of the property code</span>
            <input
              type="number"
              min="0"
              max="99"
              value={propertyCopies}
              onChange={(e) => setPropertyCopies(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
            />
            <span className="qr-print__hint">One per room, plus reception</span>
          </label>

          {tableCount > 0 && (
            <label className="qr-print__field">
              <span className="qr-print__label">Copies of each table code</span>
              <input
                type="number"
                min="0"
                max="99"
                value={tableCopies}
                onChange={(e) => setTableCopies(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
              />
              <span className="qr-print__hint">{tableCount} tables · usually one each</span>
            </label>
          )}

          <div className="qr-print__field">
            <span className="qr-print__label">Size on the page</span>
            <div className="qr-print__sizes">
              {PRINT_SIZES.map((size) => (
                <button
                  key={size.key}
                  type="button"
                  className={`qr-print__size${printSize === size.key ? ' qr-print__size--on' : ''}`}
                  aria-pressed={printSize === size.key}
                  onClick={() => setPrintSize(size.key)}
                >
                  <strong>{size.label}</strong>
                  <span>{size.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="qr-print__foot">
          <span className="qr-print__tally">
            {totalCards === 0 ? (
              'Nothing selected to print.'
            ) : (
              <>
                <strong>{totalCards}</strong> card{totalCards === 1 ? '' : 's'} on{' '}
                <strong>{sheets}</strong> sheet{sheets === 1 ? '' : 's'}
              </>
            )}
          </span>
          <button
            type="button"
            className="btn-accent"
            onClick={() => window.print()}
            disabled={totalCards === 0}
          >
            Print
          </button>
        </div>
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
