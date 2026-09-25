import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/constant.dart';
import '../../domain/models/menu.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// The two URL shapes the web's qr.js encodes — kept here so this screen and
/// the guest-facing ordering pages can't drift apart. `baseUrl` is the same
/// host that serves both the API and those pages in production.
String _orderUrl(String slug) => '$baseUrl/order/$slug';
String _tableOrderUrl(String token) => '$baseUrl/order/t/$token';

const _kPrintSizes = [('small', 'Small', '8 per sheet', 8), ('card', 'Card', '4 per sheet', 4), ('large', 'Large', '2 per sheet', 2)];

/// Menu & QR codes > QR codes — mirrors QrCodesPanel.jsx: one code for the
/// whole property, one per active table, drawn on-device. There is no
/// browser `window.print()` here, so "print" instead builds a PDF laid out at
/// the requested copy counts and hands it to the OS print/share sheet — see
/// screens/billing/bill_pdf.dart for this app's existing PDF pattern.
class QrCodesPanel extends ConsumerStatefulWidget {
  const QrCodesPanel({super.key});

  @override
  ConsumerState<QrCodesPanel> createState() => _QrCodesPanelState();
}

class _QrCodesPanelState extends ConsumerState<QrCodesPanel> {
  int _propertyCopies = 1;
  int _tableCopies = 1;
  String _printSize = 'card';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(tablesViewModelProvider.notifier).load());
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authViewModelProvider).me;
    final lodge = me?.lodge;

    if (lodge == null) return const Center(child: CircularProgressIndicator());
    if (!lodge.servesFood) {
      return const NeuNotice(
        icon: Icons.qr_code_2_rounded,
        message: 'Food ordering is switched off for this property. '
            'Turn it on under Settings to generate QR codes.',
      );
    }

    final tablesState = ref.watch(tablesViewModelProvider);
    final activeTables = lodge.foodTableService
        ? tablesState.tables.where((t) => t.isActive).toList()
        : const <DiningTable>[];
    final propertyUrl = _orderUrl(lodge.slug ?? '');
    final totalCards = _propertyCopies + activeTables.length * _tableCopies;
    final perSheet = _kPrintSizes.firstWhere((s) => s.$1 == _printSize).$4;
    final sheets = totalCards == 0 ? 0 : (totalCards / perSheet).ceil();

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, AppTheme.s16),
      children: [
        Text('Ordering codes', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 2),
        Text(
          'One code covers the whole property — put copies in the rooms and at reception. '
          'Print exports a PDF at whatever copy counts and size you choose below.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppTheme.s8),
        NeuCard(
          padding: const EdgeInsets.all(AppTheme.s8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _copiesField(context, 'Copies of the property code', _propertyCopies, (v) => setState(() => _propertyCopies = v)),
              if (activeTables.isNotEmpty) ...[
                const SizedBox(height: AppTheme.s8),
                _copiesField(context, 'Copies of each table code (${activeTables.length} tables)', _tableCopies, (v) => setState(() => _tableCopies = v)),
              ],
              const SizedBox(height: AppTheme.s8),
              Text('Size on the page', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 4),
              Row(
                children: [
                  for (final (key, label, hint, _) in _kPrintSizes)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(right: AppTheme.s8),
                        child: GestureDetector(
                          onTap: () => setState(() => _printSize = key),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 6),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: _printSize == key ? AppTheme.accent : AppTheme.bg,
                              borderRadius: BorderRadius.circular(AppTheme.rSmall),
                              border: Border.all(color: _printSize == key ? AppTheme.accent : AppTheme.border),
                            ),
                            child: Column(
                              children: [
                                Text(label, style: TextStyle(color: _printSize == key ? Colors.white : AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 12)),
                                Text(hint, style: TextStyle(color: _printSize == key ? Colors.white70 : AppTheme.muted, fontSize: 9)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      totalCards == 0 ? 'Nothing selected to print.' : '$totalCards card${totalCards == 1 ? '' : 's'} on $sheets sheet${sheets == 1 ? '' : 's'}',
                      style: Theme.of(context).textTheme.bodySmall,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  NeuButton(
                    primary: true,
                    onPressed: totalCards == 0
                        ? null
                        : () => _printAll(lodge.name, propertyUrl, activeTables),
                    child: const Text('Print'),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s12),
        Text('Your ordering code', style: Theme.of(context).textTheme.titleMedium, overflow: TextOverflow.ellipsis),
        const SizedBox(height: AppTheme.s8),
        _QrCard(
          title: lodge.name,
          subtitle: lodge.foodRoomService ? 'Scan to order food' : 'Scan to see the menu',
          url: propertyUrl,
        ),
        if (lodge.foodRoomService)
          Padding(
            padding: const EdgeInsets.only(top: AppTheme.s8),
            child: Text(
              'Each guest\'s PIN is on their booking, under Bookings — read it out at '
              'check-in. It stops working the moment they check out.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        if (lodge.foodTableService) ...[
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              Expanded(child: Text('Tables', style: Theme.of(context).textTheme.titleMedium, overflow: TextOverflow.ellipsis)),
              if (activeTables.isNotEmpty) Text('${activeTables.length} codes', style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            'One code per table. These need no PIN — orders wait in the queue until the kitchen accepts them.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: AppTheme.s8),
          if (activeTables.isEmpty)
            Text('No active tables to make codes for.', style: Theme.of(context).textTheme.bodySmall)
          else
            // A grid, not one full-width card per table — the QR itself is
            // small enough now that two fit side by side on a phone.
            LayoutBuilder(
              builder: (context, constraints) {
                final columns = (constraints.maxWidth / 200).floor().clamp(2, 4);
                final itemWidth = (constraints.maxWidth - AppTheme.s8 * (columns - 1)) / columns;
                return Wrap(
                  spacing: AppTheme.s8,
                  runSpacing: AppTheme.s8,
                  children: [
                    for (final t in activeTables)
                      SizedBox(
                        width: itemWidth,
                        child: _QrCard(title: t.label, subtitle: 'Scan to order', url: _tableOrderUrl(t.qrToken ?? '')),
                      ),
                  ],
                );
              },
            ),
        ],
      ],
    );
  }

  Widget _copiesField(BuildContext context, String label, int value, ValueChanged<int> onChanged) {
    return Row(
      children: [
        Expanded(child: Text(label, style: Theme.of(context).textTheme.bodySmall, overflow: TextOverflow.ellipsis)),
        IconButton(
          icon: const Icon(Icons.remove_circle_outline, size: 18, color: AppTheme.muted),
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          onPressed: value > 0 ? () => onChanged(value - 1) : null,
        ),
        SizedBox(
          width: 20,
          child: Text('$value', textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700)),
        ),
        IconButton(
          icon: const Icon(Icons.add_circle_outline, size: 18, color: AppTheme.muted),
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          onPressed: value < 99 ? () => onChanged(value + 1) : null,
        ),
      ],
    );
  }

  Future<void> _printAll(String lodgeName, String propertyUrl, List<DiningTable> tables) async {
    final perSheet = _kPrintSizes.firstWhere((s) => s.$1 == _printSize).$4;
    final entries = <_QrPrintEntry>[
      for (var i = 0; i < _propertyCopies; i++)
        _QrPrintEntry(title: lodgeName, subtitle: 'Scan to order', url: propertyUrl),
      for (final t in tables)
        for (var i = 0; i < _tableCopies; i++)
          _QrPrintEntry(title: t.label, subtitle: 'Scan to order', url: _tableOrderUrl(t.qrToken ?? '')),
    ];
    final bytes = await _buildQrPdf(entries, perSheet: perSheet);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }
}

class _QrPrintEntry {
  final String title;
  final String subtitle;
  final String url;
  const _QrPrintEntry({required this.title, required this.subtitle, required this.url});
}

Future<Uint8List> _buildQrPdf(List<_QrPrintEntry> entries, {required int perSheet}) async {
  final doc = pw.Document();
  final columns = perSheet == 2 ? 1 : 2;
  final rows = (perSheet / columns).ceil();

  for (var start = 0; start < entries.length; start += perSheet) {
    final page = entries.skip(start).take(perSheet).toList();
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (context) => pw.GridView(
          crossAxisCount: columns,
          childAspectRatio: rows <= 2 ? 0.8 : 1,
          children: [
            for (final e in page)
              pw.Container(
                padding: const pw.EdgeInsets.all(12),
                decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.5, style: pw.BorderStyle.dashed)),
                child: pw.Column(
                  mainAxisAlignment: pw.MainAxisAlignment.center,
                  children: [
                    pw.BarcodeWidget(
                      barcode: pw.Barcode.qrCode(),
                      data: e.url,
                      width: 140,
                      height: 140,
                    ),
                    pw.SizedBox(height: 6),
                    pw.Text(e.title, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold), textAlign: pw.TextAlign.center),
                    pw.Text(e.subtitle, style: const pw.TextStyle(fontSize: 9), textAlign: pw.TextAlign.center),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  return doc.save();
}

class _QrCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final String url;
  const _QrCard({required this.title, required this.subtitle, required this.url});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s8),
      child: Column(
        children: [
          QrImageView(data: url, size: 128, backgroundColor: Colors.white),
          const SizedBox(height: AppTheme.s8),
          Text(
            title,
            style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          Text(subtitle, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
          const SizedBox(height: 4),
          Text(
            url,
            style: const TextStyle(color: AppTheme.muted, fontSize: 10),
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          TextButton.icon(
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), minimumSize: Size.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: url));
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Link copied'), backgroundColor: AppTheme.heading),
                );
              }
            },
            icon: const Icon(Icons.copy_rounded, size: 14),
            label: const Text('Copy link', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}
