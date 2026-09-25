// The "Export to Excel" button on the internal lodges list. Same library and
// download shape as bookingReportFile.js's downloadBookingReportExcel — a
// real .xlsx a staff member can open, sort and filter, not a formatted print.

const bold = (value) => ({ value, fontWeight: 'bold' });
const text = (value) => ({ value: value === '' || value == null ? null : value });

const HEADERS = ['Lodge', 'Slug', 'Type', 'Owner', 'Owner phone', 'City', 'State', 'Check-in', 'GST', 'GSTIN', 'Status', 'Onboarded'];

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadLodgesExcel(lodges, { describeType, checkinLabel }) {
  const rows = [
    [bold('Onboarded lodges')],
    [text(`${lodges.length} ${lodges.length === 1 ? 'lodge' : 'lodges'} · exported ${formatDate(Date.now())}`)],
    [],
    HEADERS.map(bold),
    ...lodges.map((l) => [
      text(l.name),
      text(l.slug),
      text(describeType(l)),
      text(l.owner_name),
      text(l.owner_phone),
      text(l.city),
      text(l.state),
      text(l.has_rooms ? checkinLabel[l.checkin_mode] || l.checkin_mode : ''),
      text(l.is_gst_registered ? 'Registered' : 'Non-GST'),
      text(l.gstin),
      text(l.is_active ? 'Active' : 'Inactive'),
      text(formatDate(l.created_at)),
    ]),
  ];

  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = await writeXlsxFile(rows, {
    fontFamily: 'Calibri',
    fontSize: 11,
    columns: HEADERS.map(() => ({ width: 20 })),
  });
  triggerDownload(await workbook.toBlob(), `Onboarded-lodges-${formatDate(Date.now()).replace(/ /g, '-')}.xlsx`);
}
