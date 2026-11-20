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
    <table>${bill.taxPercent > 0 ? `<tr><td>Drinks tax ${bill.taxPercent}% (incl.)</td><td style="text-align:right">${bill.taxAmount.toFixed(2)}</td></tr>` : ''}${foodTax}
    <tr><td><b>Total</b></td><td style="text-align:right"><b>${bill.total.toFixed(2)}</b></td></tr></table><hr>${pays}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
