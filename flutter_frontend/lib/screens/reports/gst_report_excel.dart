import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

/// The GST filing summary as a real .xlsx — the footed totals, the split by
/// document type, and every issued bill, the same shape [GstReportPdf] and
/// gst_report_panel.dart's data grids show.
class GstReportExcel {
  static Future<void> download(GstSummaryReport report, {String? lodgeName, String? gstin}) async {
    final bytes = build(report, lodgeName: lodgeName, gstin: gstin);
    await saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(GstSummaryReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'GST-summary-$period.xlsx';
  }

  static Uint8List build(GstSummaryReport report, {String? lodgeName, String? gstin}) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();
    final sheet = excel['GST summary'];
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final totals = report.totals;

    xl.TextCellValue t(String s) => xl.TextCellValue(s);
    xl.DoubleCellValue m(num n) => xl.DoubleCellValue(n.toDouble());

    void bold(List<xl.CellValue?> row) {
      sheet.appendRow(row);
      final r = sheet.maxRows - 1;
      for (var c = 0; c < row.length; c++) {
        sheet
            .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r))
            .cellStyle = xl.CellStyle(bold: true);
      }
    }

    bold([t(lodgeName?.isNotEmpty == true ? lodgeName! : 'GST summary')]);
    sheet.appendRow([t('GST summary'), t(period)]);
    if (gstin != null) sheet.appendRow([t('GSTIN'), t(gstin)]);
    sheet.appendRow([t('Bills issued'), xl.IntCellValue(totals.count)]);
    sheet.appendRow([t('Room charges'), m(totals.roomSubtotal)]);
    sheet.appendRow([t('CGST'), m(totals.cgstAmount)]);
    sheet.appendRow([t('SGST'), m(totals.sgstAmount)]);
    sheet.appendRow([t('Total revenue'), m(totals.totalAmount)]);
    sheet.appendRow([]);

    if (report.byDocumentType.isNotEmpty) {
      bold([t('Document'), t('Bills'), t('Room charges'), t('CGST'), t('SGST'), t('Total')]);
      const types = ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT'];
      for (final type in types) {
        final d = report.byDocumentType[type];
        if (d == null || d.count == 0) continue;
        sheet.appendRow([
          t(kDocumentTypeLabel[type] ?? type), xl.IntCellValue(d.count), m(d.roomSubtotal), m(d.cgstAmount),
          m(d.sgstAmount), m(d.totalAmount),
        ]);
      }
      bold([
        t('Total'), xl.IntCellValue(totals.count), m(totals.roomSubtotal), m(totals.cgstAmount),
        m(totals.sgstAmount), m(totals.totalAmount),
      ]);
      sheet.appendRow([]);
    }

    bold([t('Bill no.'), t('Document'), t('Guest'), t('Date'), t('CGST'), t('SGST'), t('Total')]);
    for (final inv in report.invoices) {
      sheet.appendRow([
        t(inv.invoiceNumber ?? ''),
        t(kDocumentTypeLabel[inv.documentType] ?? inv.documentType ?? ''),
        t(inv.guestName ?? ''),
        t(_dateOfTimestamp(inv.createdAt)),
        m(inv.cgstAmount),
        m(inv.sgstAmount),
        m(inv.totalAmount),
      ]);
    }
    bold([
      t('Total'), t(''), t(''), t(''), m(totals.cgstAmount), m(totals.sgstAmount), m(totals.totalAmount),
    ]);

    if (defaultSheet != null && defaultSheet != 'GST summary') excel.delete(defaultSheet);

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static String _dateOfTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return iso;
    return ReportPdfStyle.dateOnly(
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
    );
  }
}
