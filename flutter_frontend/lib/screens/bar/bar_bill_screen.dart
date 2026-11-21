import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../domain/models/bar.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import '../printing/thermal_print_action.dart';
import '../../domain/models/receipt_doc.dart';
import 'bar_bill_pdf.dart';
import 'bar_common.dart';

/// An issued bar bill: the slip itself with Print / Download / Share under it.
class BarBillScreen extends ConsumerWidget {
  final BarBill bill;

  const BarBillScreen({super.key, required this.bill});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lodge = ref.watch(authViewModelProvider).me?.lodge.name ?? 'Bar';

    Future<void> run(Future<String?> Function() job) async {
      try {
        final msg = await job();
        if (context.mounted && msg != null) barSnack(context, msg);
      } catch (_) {
        if (context.mounted) barSnack(context, 'Could not prepare the bill PDF.');
      }
    }

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(title: Text('Bill ${bill.billNumber}')),
      body: Column(
        children: [
          Expanded(
            child: PdfPreview(
              build: (_) => BarBillPdf.build(bill, lodgeName: lodge),
              canChangePageFormat: false,
              canChangeOrientation: false,
              canDebug: false,
              useActions: false,
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Wrap(
                spacing: AppTheme.s8,
                runSpacing: AppTheme.s8,
                children: [
                  NeuButton(
                    primary: true,
                    onPressed: () => run(
                      () async {
                        barSnack(context, 'Sending to the printer…');
                        return runThermalPrint(
                          context,
                          ref,
                          ReceiptDocs.bar(bill, lodgeName: lodge, lodge: ref.read(authViewModelProvider).me?.lodge),
                        );
                      },
                    ),
                    child: const Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.receipt_long_rounded, size: 18), SizedBox(width: 6), Text('Thermal print')]),
                  ),
                  NeuButton(onPressed: () => run(() async { await BarBillPdf.print(bill, lodge); return null; }), child: const Text('Print')),
                  NeuButton(onPressed: () => run(() async => 'Saved: ${await BarBillPdf.download(bill, lodge)}'), child: const Text('Download')),
                  NeuButton(onPressed: () => run(() async { await BarBillPdf.share(bill, lodge); return null; }), child: const Text('Share')),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
