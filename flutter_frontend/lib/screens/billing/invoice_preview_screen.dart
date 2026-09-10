import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'bill_pdf.dart';

/// The bill itself, tapped open from its card in the queue — the page the
/// card's own Print/Download/Share row used to be squeezed onto, before it
/// ran out of room on a narrow phone.
class InvoicePreviewScreen extends ConsumerWidget {
  final Invoice invoice;

  const InvoicePreviewScreen({super.key, required this.invoice});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Text(
          '${kDocumentLabels[invoice.documentType] ?? 'Bill'} '
          '${invoice.invoiceNumber ?? ''}',
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: PdfPreview(
              build: (format) => BillPdf.build(invoice, lodgeName: lodgeName),
              // The memo's own bar below carries these — no need for the
              // preview widget's built-in one, sized for a tablet-width toolbar.
              allowPrinting: false,
              allowSharing: false,
              canChangeOrientation: false,
              canChangePageFormat: false,
              canDebug: false,
              actions: const [],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(AppTheme.s16),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: NeuButton(
                          onPressed: () => _printPdf(context, ref),
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.s8,
                            vertical: AppTheme.s16,
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.print_rounded, size: 18, color: AppTheme.heading),
                              SizedBox(width: 6),
                              Flexible(
                                child: Text('Print', overflow: TextOverflow.ellipsis),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: NeuButton(
                          onPressed: () => _downloadPdf(context, ref),
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.s8,
                            vertical: AppTheme.s16,
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.download_rounded, size: 18, color: AppTheme.heading),
                              SizedBox(width: 6),
                              Flexible(
                                child: Text('Download', overflow: TextOverflow.ellipsis),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: NeuButton(
                          onPressed: () => _sharePdf(context, ref),
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.s8,
                            vertical: AppTheme.s16,
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.share_rounded, size: 18, color: AppTheme.heading),
                              SizedBox(width: 6),
                              Flexible(
                                child: Text('Share', overflow: TextOverflow.ellipsis),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (!invoice.isVoid) ...[
                    const SizedBox(height: AppTheme.s4),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => _confirmVoid(context, ref),
                        child: const Text(
                          'Void this bill',
                          style: TextStyle(color: AppTheme.danger, fontSize: 13),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Save the file to the device itself, no share sheet involved.
  Future<void> _downloadPdf(BuildContext context, WidgetRef ref) async {
    final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;
    try {
      final where = await BillPdf.download(invoice, lodgeName: lodgeName);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Saved to $where'), backgroundColor: AppTheme.heading),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not build the PDF.'),
          backgroundColor: AppTheme.heading,
        ),
      );
    }
  }

  /// Build the document and hand it to the platform's share sheet, which is
  /// where "save to Files", "send on WhatsApp" and "print" all live on a phone.
  Future<void> _sharePdf(BuildContext context, WidgetRef ref) async {
    final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;
    try {
      await BillPdf.share(invoice, lodgeName: lodgeName);
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not build the PDF.'),
          backgroundColor: AppTheme.heading,
        ),
      );
    }
  }

  /// Build the document and hand it straight to the OS print dialog — the
  /// desk's own printer, not the share sheet's "print" buried a tap deeper.
  Future<void> _printPdf(BuildContext context, WidgetRef ref) async {
    final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;
    try {
      await BillPdf.print(invoice, lodgeName: lodgeName);
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not build the PDF.'),
          backgroundColor: AppTheme.heading,
        ),
      );
    }
  }

  Future<void> _confirmVoid(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Void this bill?', style: TextStyle(color: AppTheme.heading)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              // A void is not a delete: the document stays on file and its
              // number is never reused, because a gap in the series is what an
              // auditor asks about.
              'The bill stays on file marked void, and its number is not '
              'reused. Say why.',
              style: TextStyle(color: AppTheme.text, fontSize: 13),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuField(controller: controller, label: 'Reason', maxLength: 200),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Keep it'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Void', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );

    if (reason == null || reason.isEmpty || !context.mounted) return;
    final ok = await ref.read(billingViewModelProvider.notifier).voidInvoice(invoice.id, reason);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok ? 'Bill voided.' : 'Could not void that bill.'),
        backgroundColor: AppTheme.heading,
      ),
    );
    if (ok) Navigator.of(context).pop();
  }
}
