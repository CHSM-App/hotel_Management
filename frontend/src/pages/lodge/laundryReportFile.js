import { triggerDownload } from './bookingReportFile';

// The Laundry report as a workbook: one sheet per block on the screen. Counts
// are numbers so they can be summed; the guest sheet is left out for a property
// that does not take guest laundry.

// Sent to wash, received back from the wash, handed to the guest.
const GUEST_STATUS = { RECEIVED: 'In wash', WASHING: 'In wash', READY: 'Received', DELIVERED: 'Handed over', CANCELLED: 'Cancelled' };

const stamp = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

function sheet(name, headings, rows, widths) {
  const head = headings.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#e8e6f5' }));
  const data = rows.map((r) =>
    r.map((v) => (typeof v === 'number' ? { value: v, type: Number, align: 'right' } : { value: v === '' ? null : v }))
  );
  return { data: [head, ...data], sheet: name, stickyRowsCount: 1, columns: widths.map((width) => ({ width })) };
}

export async function downloadLaundryReportExcel(report, { guestLaundry }) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = [
    sheet(
      'Linen by item',
      ['Item', 'Changed in rooms', 'Sent for washing', 'Received washed', 'Lost', 'Damaged', 'Owned now', 'In wash now'],
      report.linen.byItem.map((i) => [i.name, i.changed, i.sent, i.received, i.lost, i.damaged, i.owned, i.inWashNow]),
      [24, 18, 18, 18, 10, 10, 12, 14]
    ),
    sheet(
      'By washed by',
      ['Washed by', 'Sent', 'Received', 'Lost', 'Damaged', 'Not back', 'Charged (₹)'],
      report.linen.byWasher.map((w) => [w.washedBy || 'Not recorded', w.sent, w.received, w.lost, w.damaged, w.notBack, w.charge || 0]),
      [28, 10, 10, 10, 10, 10, 14]
    ),
  ];
  if (guestLaundry) {
    sheets.push(
      sheet(
        'Guest laundry',
        ['Tag', 'Guest', 'Room', 'Pieces', 'Status', 'Taken in', 'Handed over', 'Amount', 'Washed by', 'Vendor price (₹)', 'Profit (₹)'],
        report.guest.orders.map((o) => [
          o.tagNumber, o.guestName || '', o.roomNumber || 'Walk-in', o.pieces, GUEST_STATUS[o.status] || o.status,
          stamp(o.receivedAt), stamp(o.deliveredAt), o.total, o.washedBy || '', o.washCharge ?? '', o.profit ?? '',
        ]),
        [8, 24, 10, 8, 14, 22, 22, 12, 22, 16, 14]
      )
    );
  }
  const workbook = await writeXlsxFile(sheets, { fontFamily: 'Calibri', fontSize: 11 });
  triggerDownload(await workbook.toBlob(), `laundry-report-${report.fromDate}-to-${report.toDate}.xlsx`);
}

export { GUEST_STATUS as LAUNDRY_ORDER_STATUS_LABEL };
