import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/asset.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

num repairCostOf(WorkOrder wo) => (wo.partsCost ?? 0) + (wo.laborCost ?? 0);

/// One totals object the on-screen tab, this PDF's tiles and
/// [AssetReportExcel]'s summary sheet all read from, so the three views can
/// never disagree on a figure — mirrors computeTotals() in
/// assetReportFile.js.
class AssetTotals {
  final int assetCount;
  final num purchaseValue;
  final num repairSpend;
  final num totalSpend;
  final Map<String, int> byStatus;
  final int openWorkOrders;

  const AssetTotals({
    this.assetCount = 0,
    this.purchaseValue = 0,
    this.repairSpend = 0,
    this.totalSpend = 0,
    this.byStatus = const {},
    this.openWorkOrders = 0,
  });
}

AssetTotals computeAssetTotals(List<Asset> assets, List<WorkOrder> workOrders) {
  final purchaseValue = assets.fold<num>(0, (s, a) => s + (a.purchaseCost ?? 0));
  final repairSpend = workOrders.fold<num>(0, (s, wo) => s + repairCostOf(wo));
  final byStatus = <String, int>{for (final s in kAssetStatuses) s: 0};
  for (final a in assets) {
    final key = byStatus.containsKey(a.status) ? a.status : 'IN_USE';
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  final openWorkOrders = workOrders.where((wo) => wo.status != 'CLOSED').length;
  return AssetTotals(
    assetCount: assets.length,
    purchaseValue: purchaseValue,
    repairSpend: repairSpend,
    totalSpend: purchaseValue + repairSpend,
    byStatus: byStatus,
    openWorkOrders: openWorkOrders,
  );
}

/// A label with its total and how many entries fed it — mirrors
/// groupByCategory()/groupByVendor() in assetReportFile.js.
class AssetGroup {
  final String label;
  final num total;
  final int count;

  const AssetGroup({required this.label, this.total = 0, this.count = 0});
}

List<AssetGroup> groupAssetsByCategory(List<Asset> assets) {
  final map = <String, (num, int)>{};
  for (final a in assets) {
    final key = a.categoryName.isEmpty ? 'Uncategorised' : a.categoryName;
    final (t, c) = map[key] ?? (0, 0);
    map[key] = (t + (a.purchaseCost ?? 0), c + 1);
  }
  final groups = [for (final entry in map.entries) AssetGroup(label: entry.key, total: entry.value.$1, count: entry.value.$2)];
  groups.sort((a, b) => b.total.compareTo(a.total));
  return groups;
}

/// Merges vendor spend from asset purchases and work-order repairs into one
/// ranked list — mirrors groupByVendor() in assetReportFile.js.
List<AssetGroup> groupAssetVendorSpend(List<Asset> assets, List<WorkOrder> workOrders) {
  final map = <String, (num, int)>{};
  for (final a in assets) {
    final vendor = a.vendorName;
    final cost = a.purchaseCost ?? 0;
    if (vendor == null || vendor.isEmpty || cost == 0) continue;
    final (t, c) = map[vendor] ?? (0, 0);
    map[vendor] = (t + cost, c + 1);
  }
  for (final wo in workOrders) {
    final vendor = wo.vendorName;
    final cost = repairCostOf(wo);
    if (vendor == null || vendor.isEmpty || cost == 0) continue;
    final (t, c) = map[vendor] ?? (0, 0);
    map[vendor] = (t + cost, c + 1);
  }
  final groups = [for (final entry in map.entries) AssetGroup(label: entry.key, total: entry.value.$1, count: entry.value.$2)];
  groups.sort((a, b) => b.total.compareTo(a.total));
  return groups;
}

String assetLocation(Asset a) {
  if (a.roomNumber?.isNotEmpty == true) return 'Room ${a.roomNumber}';
  if (a.locationNote.isNotEmpty) return a.locationNote;
  return a.department;
}

/// The asset register as a real PDF — the native equivalent of
/// frontend/src/pages/lodge/assetReportFile.js's buildAssetsReportPdf():
/// masthead, headline tiles, "By status" and "Top categories" tables, then a
/// new page with the full register.
///
/// Portrait A4, same as the web version.
class AssetReportPdf {
  static Future<String> download(List<Asset> assets, List<WorkOrder> workOrders, {String? lodgeName}) async {
    final bytes = await build(assets, workOrders, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, filenameFor('pdf'));
  }

  static Future<void> share(List<Asset> assets, List<WorkOrder> workOrders, {String? lodgeName}) async {
    final bytes = await build(assets, workOrders, lodgeName: lodgeName);
    await shareBytesFromDevice(bytes, filenameFor('pdf'));
  }

  static Future<void> print(List<Asset> assets, List<WorkOrder> workOrders, {String? lodgeName}) async {
    final bytes = await build(assets, workOrders, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  // Full register, not a date range, so the filename is stamped by when it
  // was generated — mirrors reportFilename() in assetReportFile.js. Shared
  // with [AssetReportExcel] so the two extensions of the same report agree
  // on a name.
  static String filenameFor(String extension) {
    final now = DateTime.now();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return 'Asset-report-${months[now.month - 1]}-${now.year}.$extension';
  }

  static Future<Uint8List> build(List<Asset> assets, List<WorkOrder> workOrders, {String? lodgeName}) async {
    final totals = computeAssetTotals(assets, workOrders);
    final name = (lodgeName?.isNotEmpty ?? false) ? lodgeName! : 'Asset report';
    final generatedAt = DateTime.now();
    final runningHead = '${ReportPdfStyle.ascii(name)} - asset report';

    final doc = pw.Document();
    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.copyWith(
          marginLeft: ReportPdfStyle.margin,
          marginRight: ReportPdfStyle.margin,
          marginTop: ReportPdfStyle.margin,
          marginBottom: ReportPdfStyle.margin + 16,
        ),
        header: (context) => context.pageNumber == 1
            ? pw.SizedBox()
            : pw.Padding(
                padding: const pw.EdgeInsets.only(bottom: 10),
                child: pw.Text(runningHead, style: pw.TextStyle(fontSize: 7.5, color: ReportPdfStyle.muted)),
              ),
        footer: (context) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            pw.Container(height: 0.5, color: ReportPdfStyle.rule),
            pw.SizedBox(height: 4),
            pw.Row(
              children: [
                pw.Expanded(
                  child: pw.Text(
                    ReportPdfStyle.ascii('$name . Asset report . All amounts in Rs.'),
                    style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted),
                  ),
                ),
                pw.Text('Page ${context.pageNumber} of ${context.pagesCount}',
                    style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted)),
              ],
            ),
          ],
        ),
        build: (context) => [
          ReportPdfStyle.masthead(
            name: name,
            title: 'Asset report',
            subtitle: 'Full asset register',
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.tiles([
            ('Assets on register', ReportPdfStyle.count(totals.assetCount)),
            ('Purchase value', ReportPdfStyle.amount(totals.purchaseValue)),
            ('Repair spend', ReportPdfStyle.amount(totals.repairSpend)),
            ('Open work orders', ReportPdfStyle.count(totals.openWorkOrders)),
          ], width: ReportPdfStyle.contentWidthPortrait, perRow: 4),
          pw.SizedBox(height: 14),
          ReportPdfStyle.heading('By status'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Status', flex: 2.4),
              ReportPdfColumn('Assets', flex: 1.4, align: pw.TextAlign.right),
            ],
            rows: [
              for (final status in kAssetStatuses)
                [kAssetStatusLabel[status] ?? status, ReportPdfStyle.count(totals.byStatus[status] ?? 0)],
            ],
          ),
          pw.SizedBox(height: 14),
          ReportPdfStyle.heading('Top categories by purchase value'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Category', flex: 3),
              ReportPdfColumn('Assets', flex: 1, align: pw.TextAlign.right),
              ReportPdfColumn('Value', flex: 1.4, align: pw.TextAlign.right),
            ],
            rows: [
              for (final g in groupAssetsByCategory(assets).take(10))
                [g.label, ReportPdfStyle.count(g.count), ReportPdfStyle.amount(g.total)],
            ],
          ),
          pw.NewPage(),
          ReportPdfStyle.heading('Register - ${totals.assetCount} ${totals.assetCount == 1 ? 'asset' : 'assets'}'),
          if (assets.isEmpty)
            pw.Text('No assets on the register.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Tag', flex: 0.9),
                ReportPdfColumn('Name', flex: 2.2),
                ReportPdfColumn('Category', flex: 1.5),
                ReportPdfColumn('Status', flex: 1.2),
                ReportPdfColumn('Vendor', flex: 1.8),
                ReportPdfColumn('Purchase date', flex: 1.1),
                ReportPdfColumn('Cost', flex: 1.2, align: pw.TextAlign.right),
              ],
              fontSize: 7.5,
              rows: [
                for (final a in assets)
                  [
                    a.assetTag?.isNotEmpty == true ? a.assetTag! : '—',
                    a.name,
                    a.categoryName.isEmpty ? '—' : a.categoryName,
                    kAssetStatusLabel[a.status] ?? a.status,
                    a.vendorName?.isNotEmpty == true ? a.vendorName! : '—',
                    ReportPdfStyle.dateOnly(a.purchaseDate),
                    ReportPdfStyle.amount(a.purchaseCost),
                  ],
              ],
              totals: ['Total', '', '', '', '', '', ReportPdfStyle.amount(totals.purchaseValue)],
            ),
        ],
      ),
    );

    return doc.save();
  }
}
