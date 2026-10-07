import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/laundry.dart';
import '../../widgets/format.dart';
import '../bookings/receipt_download.dart';

/// The linen history table as a real .xlsx — the native equivalent of the
/// web's downloadSheet('Linen activity', ...) in LaundryPanel.jsx: one sheet,
/// one row per movement, the same columns as the on-screen table.
class LinenHistoryExcel {
  static const _headers = [
    'Date', 'Time', 'Action', 'Room', 'Item', 'Qty', 'Washed by', 'Charge (Rs)', 'Entered by', 'Note',
  ];

  static Future<String> download(List<LinenMovement> rows) async {
    final bytes = build(rows);
    final stamp = DateTime.now().toIso8601String().substring(0, 10);
    return saveBytesToDevice(bytes, 'linen-activity-$stamp.xlsx');
  }

  static Uint8List build(List<LinenMovement> rows) {
    final excel = xl.Excel.createExcel();
    final sheet = excel['Linen activity'];

    sheet.appendRow([for (final h in _headers) xl.TextCellValue(h)]);
    for (var c = 0; c < _headers.length; c++) {
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0)).cellStyle = xl.CellStyle(bold: true);
    }

    for (final m in rows) {
      final created = DateTime.tryParse(m.createdAt)?.toLocal();
      sheet.appendRow([
        xl.TextCellValue(formatDate(created)),
        xl.TextCellValue(formatTimeOfDay(m.createdAt)),
        xl.TextCellValue(kLinenMoveLabel[m.kind] ?? m.kind),
        xl.TextCellValue(m.roomNumber ?? ''),
        xl.TextCellValue(m.itemName),
        xl.IntCellValue(m.quantity),
        xl.TextCellValue(m.washedBy ?? ''),
        if (m.washCharge != null) xl.DoubleCellValue(m.washCharge!.toDouble()) else xl.TextCellValue(''),
        xl.TextCellValue(m.userName ?? ''),
        xl.TextCellValue(m.note ?? ''),
      ]);
    }

    final defaultSheet = excel.getDefaultSheet();
    if (defaultSheet != null && defaultSheet != 'Linen activity') {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }
}
