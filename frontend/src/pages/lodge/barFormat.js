import { ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';

export const barToken = () => getSession()?.token;
export const errText = (err, fallback = 'Something went wrong. Try again.') => (err instanceof ApiError ? err.message : fallback);

const n = (v) => Number(v || 0).toLocaleString('en-IN');

// Stock is stored in ml; every screen shows both units: "2,430 ml (3 bottles + 180 ml)".
export function stockText(p) {
  const b = p.bottles;
  return `${n(p.stockMl)} ml (${n(b)} bottle${Math.abs(b) === 1 ? '' : 's'} + ${n(p.looseMl)} ml)`;
}
export const stockParts = (v) => `${n(v.stockMl)} ml (${n(v.bottles)} btl + ${n(v.looseMl)} ml)`;

// India time, same as the server's order date.
export const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const firstOfMonthIso = () => `${todayIso().slice(0, 8)}01`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// A plain thermal-style bill in its own window, so printing never drags the dashboard along.
export function printBarBill(bill, lodgeName) {
  const line = (i) => `<tr><td>${esc(i.name)} ${esc(i.size)} x${i.quantity}</td><td style="text-align:right">${i.lineTotal.toFixed(2)}</td></tr>`;
  const rows = [...bill.items, ...(bill.foodItems || [])].map(line).join('');
  const foodTax = bill.foodTaxAmount > 0 ? `<tr><td>Food GST ${bill.foodTaxPercent}% (incl.)</td><td style="text-align:right">${bill.foodTaxAmount.toFixed(2)}</td></tr>` : '';
  const pays = bill.payments.map((p) => `<div>${esc(p.method)}: ${p.amount.toFixed(2)}</div>`).join('');
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) return false;
  w.document.write(`<html><head><title>${esc(bill.billNumber)}</title>
    <style>body{font:13px monospace;margin:12px;max-width:300px}table{width:100%;border-collapse:collapse}h3,p{margin:4px 0;text-align:center}hr{border:0;border-top:1px dashed #000}</style></head>
    <body><h3>${esc(lodgeName)} - Bar</h3><p>${esc(bill.billNumber)} &middot; ${esc(String(bill.billDate).slice(0, 10))}</p>
    ${bill.customerName ? `<p>${esc(bill.customerName)}</p>` : ''}<hr><table>${rows}</table><hr>
    <table>${bill.discountAmount > 0 ? `<tr><td>Subtotal</td><td style="text-align:right">${bill.subtotal.toFixed(2)}</td></tr><tr><td>Discount</td><td style="text-align:right">-${bill.discountAmount.toFixed(2)}</td></tr>` : ''}${bill.taxPercent > 0 ? `<tr><td>Drinks tax ${bill.taxPercent}% (incl.)</td><td style="text-align:right">${bill.taxAmount.toFixed(2)}</td></tr>` : ''}${foodTax}
    <tr><td><b>Total</b></td><td style="text-align:right"><b>${bill.total.toFixed(2)}</b></td></tr></table><hr>${pays}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

// Kitchen order ticket: what to cook and for where, no prices. Sized for a
// thermal roll (58 or 80 mm, remembered per browser) via @page so any thermal
// driver prints a right-width slip. Run the browser with --kiosk-printing to
// skip the print dialog.
export const kotPaperMm = () => (localStorage.getItem('kotPaperMm') === '58' ? 58 : 80);
export const setKotPaperMm = (mm) => localStorage.setItem('kotPaperMm', String(mm));

export function printKot({ lodgeName, title = 'KOT', where, orderNo, guest, note, time, items }) {
  const mm = kotPaperMm();
  const d = new Date(time || Date.now());
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const clock = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const total = items.reduce((n, i) => n + i.qty, 0);
  const rows = items
    .map((i, n) => `<tr><td class="q">${i.qty}</td><td class="x">&times;</td><td class="n">${esc(i.name)}</td></tr>${n < items.length - 1 ? '<tr class="sep"><td colspan="3"></td></tr>' : ''}`)
    .join('');
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) return false;
  w.document.write(`<html><head><title>${esc(title)}</title>
    <style>
      @page{size:${mm}mm auto;margin:0}
      *{box-sizing:border-box}
      body{font:${mm === 58 ? 12 : 13}px 'Courier New',monospace;margin:0;padding:3mm 2mm;width:${mm - 2}mm;color:#000}
      .c{text-align:center}.lodge{font-size:1.15em;font-weight:bold;letter-spacing:.5px;text-transform:uppercase}
      .title{display:block;margin:6px 0 2px;padding:3px 0;border:2px solid #000;font-weight:bold;font-size:1.2em;letter-spacing:2px;text-align:center}
      .where{font-size:1.9em;font-weight:bold;text-align:center;margin:8px 0 4px;line-height:1.1}
      .meta{display:flex;justify-content:space-between;margin:2px 0}
      hr{border:0;border-top:2px solid #000;margin:6px 0}hr.d{border-top:1px dashed #000}
      table{width:100%;border-collapse:collapse}
      td{vertical-align:top;padding:3px 0}
      .q{width:22%;font-size:1.5em;font-weight:bold;text-align:right;padding-right:2px}.x{width:8%;text-align:center;font-weight:bold}
      .n{font-size:1.2em;font-weight:bold;word-break:break-word}
      tr.sep td{border-bottom:1px dotted #000;padding:0;height:2px}
      .note{margin-top:6px;border:1px dashed #000;padding:4px;font-weight:bold}
      .foot{margin-top:8px;font-size:.9em}
    </style></head>
    <body>
      <div class="c lodge">${esc(lodgeName)}</div>
      <span class="title">${esc(title)}</span>
      <div class="where">${esc(where)}</div>
      <div class="meta"><span>${orderNo ? `Order #${esc(orderNo)}` : ''}</span><span>${esc(clock)}</span></div>
      <div class="meta"><span>${esc(date)}</span>${guest ? `<span>${esc(guest)}</span>` : ''}</div>
      <hr><table>${rows}</table><hr>
      <div class="meta"><b>Items: ${items.length}</b><b>Total qty: ${total}</b></div>
      ${note ? `<div class="note">NOTE: ${esc(note)}</div>` : ''}
      <hr class="d"><div class="c foot">*** Kitchen copy ***</div>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
