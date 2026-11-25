import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { apiGet, apiPostForm, ApiError, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import QuotationDocument from './QuotationDocument';
import { buildQuotationPdfBlob, imageAsDataUrl } from './quotationPdf';
import { formatPrice } from './priceFormat';
import { whatsAppChatUrl } from './quotationWhatsApp';

const day = (iso) =>
  new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const money = (n) => Number(n) || 0;

// The event / food / bar quotation as the generic letter QuotationDocument draws,
// built from the breakdown the server froze (`details`).
export function genericLetter(q) {
  const d = q.details || {};
  if (q.kind === 'EVENT') {
    const p = d.pricing || {};
    const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return {
      title: 'Event quotation',
      facts: [
        ['Venue', d.venueName || ''],
        ['Starts', when(d.input?.startAt)],
        ['Ends', when(d.input?.endAt)],
        ['Guests', String(p.billablePax ?? '')],
      ],
      columns: ['Description', 'Detail', 'Amount'],
      rows: (p.lines || []).map((l) => [l.label, l.note || '', formatPrice(l.amount)]),
      totals: [
        ...(money(p.discountAmount) > 0
          ? [['Total before concession', formatPrice(p.grossAmount)], ['Concession', `− ${formatPrice(p.discountAmount)}`]]
          : []),
        ['Total', formatPrice(q.total), true],
      ],
      note: d.note,
      terms: [
        'This quotation is for the venue, date and time mentioned above.',
        'It is a quotation only. It does not confirm or hold the venue.',
        'The venue is confirmed only after a booking is made and an advance is received.',
        'Any change in date, time, guest count or add-ons will change the amount.',
        'Services not listed above are charged separately.',
      ],
    };
  }
  return {
    title: q.kind === 'BAR' ? 'Bar quotation' : 'Food quotation',
    facts: [
      ['Items', String((d.lines || []).length)],
      ['Valid until', q.validUntil ? day(q.validUntil) : ''],
    ],
    columns: ['Item', 'Rate', 'Qty', 'Amount'],
    rows: (d.lines || []).map((l) => [l.itemName, formatPrice(l.unitPrice), String(l.quantity), formatPrice(l.lineTotal)]),
    totals: [
      ['Subtotal', formatPrice(d.subtotal)],
      ...(money(d.discount) > 0 ? [['Discount', `− ${formatPrice(d.discount)}`]] : []),
      ['Total', formatPrice(q.total), true],
    ],
    note: d.note,
    terms: [
      'Prices are as on the date of this quotation and may change.',
      ...(q.kind === 'BAR' && money(d.taxPercent) > 0 ? ['Prices include tax.'] : []),
      'This is a quotation only. It is not a bill.',
      'Items are subject to availability at the time of the order.',
    ],
  };
}

/**
 * Builds a saved quotation's PDF, and sends it on WhatsApp.
 *
 * `host` must be rendered once by the caller: it is the offscreen sheet the PDF
 * is photographed from. `buildPdf(q)` resolves to a Blob; `send(q)` resolves to
 * a one-line message for the desk and never throws.
 *
 * send(): with the property's approved template set up (WHATSAPP_QUOTATION_TEMPLATE_ID)
 * and a guest number, the server sends it itself, PDF link included. Otherwise it
 * opens a WhatsApp chat with the message typed in (and the link, when one could be made).
 */
export function useQuotationSend() {
  const token = getSession()?.token;
  const [doc, setDoc] = useState(null);
  const ref = useRef(null);

  const buildPdf = async (q) => {
    const { lodge } = await apiGet('/me', { token });
    const logoSrc = lodge?.logoUrl ? await imageAsDataUrl(`${API_BASE}${lodge.logoUrl}`) : null;
    const base = {
      lodge,
      logoSrc,
      date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      preparedBy: getSession()?.name || '',
      guest: {
        name: q.guestName || '',
        phone: q.guestPhone && `+91 ${q.guestPhone.slice(0, 5)} ${q.guestPhone.slice(5)}`,
      },
      total: q.total,
    };
    let props;
    if (q.kind === 'ROOM') {
      const { rooms } = await apiGet('/rooms', { token });
      const quoted = q.rooms.map((r) => ({ room: rooms.find((x) => x.id === r.roomId), from: r.fromDate, to: r.toDate, result: r.result }));
      const missing = quoted.findIndex((r) => !r.room);
      if (missing !== -1) {
        throw new ApiError(`Room ${q.rooms[missing].roomNumber} is no longer available, so this quotation cannot be re-issued.`);
      }
      props = { ...base, rooms: quoted };
    } else {
      props = { ...base, generic: genericLetter(q) };
    }
    // Rendered now, not on the next tick: the capture below needs the node.
    flushSync(() => setDoc(props));
    try {
      return await buildQuotationPdfBlob(ref.current);
    } finally {
      setDoc(null);
    }
  };

  const send = async (q) => {
    try {
      const blob = await buildPdf(q);
      const form = () => {
        const f = new FormData();
        f.append('quotation', new File([blob], `${q.referenceCode}.pdf`, { type: 'application/pdf' }));
        return f;
      };
      if (q.guestPhone) {
        try {
          const sent = await apiPostForm(`/quotations/${q.id}/share/whatsapp`, form(), { token });
          return `Quotation sent on WhatsApp to +${sent.phone}.`;
        } catch (err) {
          // 503: the template is not set up — fall through to the chat link.
          if (!(err instanceof ApiError) || err.status !== 503) {
            return err instanceof ApiError ? err.message : 'Could not send the quotation on WhatsApp.';
          }
        }
      }
      let link = '';
      try {
        link = (await apiPostForm(`/quotations/${q.id}/share`, form(), { token })).link;
      } catch {
        /* the message still goes, without the link */
      }
      const { lodge } = await apiGet('/me', { token });
      window.open(whatsAppChatUrl(q, { hotel: lodge?.name, hotelPhone: lodge?.phone, link }), '_blank', 'noopener');
      return link ? 'WhatsApp opened with the quotation.' : 'WhatsApp opened (the quotation link could not be made).';
    } catch (err) {
      return err instanceof ApiError ? err.message : 'Could not prepare the quotation. Try again.';
    }
  };

  const host = doc ? (
    <div className="quote-pdf-source" aria-hidden="true">
      <QuotationDocument ref={ref} {...doc} />
    </div>
  ) : null;

  return { buildPdf, send, host };
}
