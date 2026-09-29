import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/asset.dart';
import '../bookings/receipt_download.dart';
import 'asset_report_pdf.dart';
import 'report_pdf_style.dart';

/// The asset register as a real .xlsx — the native equivalent of
/// frontend/src/pages/lodge/assetReportFile.js's downloadAssetsReportExcel():
/// a "Summary" sheet with the totals [AssetReportPdf]'s tiles and tables
/// print, an "Assets" sheet with one row per asset plus a footed totals row,
/// and a "Work orders" sheet with one row per work order plus its own
/// totals row — one sheet more than Expense/Income, since assets reports
/// also cover work orders.
class AssetReportExcel {
  static Future<String> download(List<Asset> assets, List<WorkOrder> workOrders, {String? lodgeName}) async {
    final bytes = build(assets, workOrders, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, AssetReportPdf.filenameFor('xlsx'));
  }

  static Uint8List build(List<Asset> assets, List<WorkOrder> workOrders, {String? lodgeName}) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _summarySheet(excel, assets, workOrders, lodgeName: lodgeName);
    _assetsSheet(excel, assets);
    _workOrdersSheet(excel, workOrders);

    if (defaultSheet != null && !const ['Summary', 'Assets', 'Work orders'].contains(defaultSheet)) {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static void _summarySheet(xl.Excel excel, List<Asset> assets, List<WorkOrder> workOrders, {String? lodgeName}) {
    final sheet = excel['Summary'];
    final totals = computeAssetTotals(assets, workOrders);
    final byCategory = groupAssetsByCategory(assets);
    final byVendor = groupAssetVendorSpend(assets, workOrders);

    xl.TextCellValue t(String s) => xl.TextCellValue(s);
    xl.DoubleCellValue m(num n) => xl.DoubleCellValue(n.toDouble());
    xl.IntCellValue i(int n) => xl.IntCellValue(n);

    void bold(List<xl.CellValue?> row) {
      sheet.appendRow(row);
      final r = sheet.maxRows - 1;
      for (var c = 0; c < row.length; c++) {
        sheet
            .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r))
            .cellStyle = xl.CellStyle(bold: true);
      }
    }

    bold([t(lodgeName?.isNotEmpty == true ? lodgeName! : 'Asset report')]);
    sheet.appendRow([t('Generated'), t(ReportPdfStyle.dateTime(DateTime.now()))]);
    sheet.appendRow([]);

    sheet.appendRow([t('Assets on register'), i(totals.assetCount)]);
    sheet.appendRow([t('Purchase value'), m(totals.purchaseValue)]);
    sheet.appendRow([t('Repair spend'), m(totals.repairSpend)]);
    sheet.appendRow([t('Total spend'), m(totals.totalSpend)]);
    sheet.appendRow([t('Open work orders'), i(totals.openWorkOrders)]);
    sheet.appendRow([]);

    bold([t('By status'), t('Assets')]);
    for (final status in kAssetStatuses) {
      sheet.appendRow([t(kAssetStatusLabel[status] ?? status), i(totals.byStatus[status] ?? 0)]);
    }
    sheet.appendRow([]);

    bold([t('By category'), t('Purchase value'), t('Assets')]);
    for (final g in byCategory) {
      sheet.appendRow([t(g.label), m(g.total), i(g.count)]);
    }
    sheet.appendRow([]);

    bold([t('By vendor'), t('Amount (purchases + repairs)'), t('Entries')]);
    for (final g in byVendor) {
      sheet.appendRow([t(g.label), m(g.total), i(g.count)]);
    }
  }

  static void _assetsSheet(xl.Excel excel, List<Asset> assets) {
    final sheet = excel['Assets'];
    const headers = [
      'Tag', 'Name', 'Category', 'Location', 'Status', 'Purchase date',
      'Purchase cost', 'Vendor', 'Warranty expiry', 'AMC expiry', 'Open work orders',
    ];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xl.CellStyle(bold: true);
    }

    for (final a in assets) {
      sheet.appendRow([
        xl.TextCellValue(a.assetTag ?? ''),
        xl.TextCellValue(a.name),
        xl.TextCellValue(a.categoryName),
        xl.TextCellValue(assetLocation(a)),
        xl.TextCellValue(kAssetStatusLabel[a.status] ?? a.status),
        xl.TextCellValue(ReportPdfStyle.dateOnly(a.purchaseDate)),
        xl.DoubleCellValue((a.purchaseCost ?? 0).toDouble()),
        xl.TextCellValue(a.vendorName ?? ''),
        xl.TextCellValue(ReportPdfStyle.dateOnly(a.warrantyExpiry)),
        xl.TextCellValue(ReportPdfStyle.dateOnly(a.amcExpiry)),
        xl.IntCellValue(a.openWorkOrders),
      ]);
    }

    final totals = computeAssetTotals(assets, const []);
    sheet.appendRow([
      xl.TextCellValue('Total'),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.DoubleCellValue(totals.purchaseValue.toDouble()),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow))
          .cellStyle = xl.CellStyle(bold: true);
    }
  }

  static void _workOrdersSheet(xl.Excel excel, List<WorkOrder> workOrders) {
    final sheet = excel['Work orders'];
    const headers = [
      'Asset', 'Issue', 'Status', 'Vendor', 'Opened', 'Closed', 'Parts cost', 'Labor cost', 'Total cost',
    ];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xl.CellStyle(bold: true);
    }

    for (final wo in workOrders) {
      sheet.appendRow([
        xl.TextCellValue(wo.assetName),
        xl.TextCellValue(kIssueTypeLabel[wo.issueType] ?? wo.issueType),
        xl.TextCellValue(kWorkOrderStatusLabel[wo.status] ?? wo.status),
        xl.TextCellValue(wo.vendorName ?? ''),
        xl.TextCellValue(ReportPdfStyle.dateOnly(wo.openedAt)),
        xl.TextCellValue(ReportPdfStyle.dateOnly(wo.closedAt)),
        xl.DoubleCellValue((wo.partsCost ?? 0).toDouble()),
        xl.DoubleCellValue((wo.laborCost ?? 0).toDouble()),
        xl.DoubleCellValue(repairCostOf(wo).toDouble()),
      ]);
    }

    final total = workOrders.fold<num>(0, (s, wo) => s + repairCostOf(wo));
    sheet.appendRow([
      xl.TextCellValue('Total'),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.DoubleCellValue(total.toDouble()),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow))
          .cellStyle = xl.CellStyle(bold: true);
    }
  }
}
