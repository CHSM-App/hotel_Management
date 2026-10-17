import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../bookings/receipt_download.dart';
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
          overflow: TextOverflow.ellipsis,
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
              scrollViewDecoration: const BoxDecoration(
                color: Color(0xFFECEEF2),
              ),
              previewPageMargin: const EdgeInsets.all(AppTheme.s12),
              actions: const [],
            ),
          ),
          DecoratedBox(
            decoration: const BoxDecoration(
              color: AppTheme.card,
              border: Border(top: BorderSide(color: AppTheme.border2)),
              boxShadow: [
                BoxShadow(
                  color: Color(0x14000000),
                  blurRadius: 12,
                  offset: Offset(0, -2),
                ),
              ],
            ),
            child: SafeArea(
              top: false,
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxWidth: AppTheme.maxContentWidth,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppTheme.s12,
                      AppTheme.s8,
                      AppTheme.s12,
                      AppTheme.s4,
                    ),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: _ActionButton(
                                icon: Icons.print_rounded,
                                label: 'Print',
                                onPressed: () => _printPdf(context, ref),
                              ),
                            ),
                            const SizedBox(width: AppTheme.s8),
                            Expanded(
                              child: _ActionButton(
                                icon: Icons.download_rounded,
                                label: 'Download',
                                onPressed: () => _downloadPdf(context, ref),
                              ),
                            ),
                            const SizedBox(width: AppTheme.s8),
                            Expanded(
                              child: _ActionButton(
                                icon: Icons.share_rounded,
                                label: 'Share',
                                onPressed: () => _sharePdf(context, ref),
                              ),
                            ),
                          ],
                        ),
                        if (invoice.status == 'ISSUED') ...[
                          const SizedBox(height: AppTheme.s8),
                          // One press: the bill is sent to the guest's WhatsApp
                          // number by the server, link only — no chat to attach it
                          // in, same as the web billing screen's own button.
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              style: FilledButton.styleFrom(
                                backgroundColor: const Color(0xFF25D366),
                                foregroundColor: Colors.white,
                                minimumSize: const Size(0, 40),
                                padding: const EdgeInsets.symmetric(
                                  vertical: AppTheme.s8,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(
                                    AppTheme.rMedium,
                                  ),
                                ),
                                textStyle: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              onPressed: () => _shareOnWhatsApp(context, ref),
                              icon: const Icon(Icons.send_rounded, size: 18),
                              label: const Text('Send this bill on WhatsApp'),
                            ),
                          ),
                        ],
                        if (!invoice.isVoid) ...[
                          Align(
                            alignment: Alignment.center,
                            child: TextButton.icon(
                              style: TextButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              onPressed: () => _confirmVoid(context, ref),
                              icon: const Icon(
                                Icons.block_rounded,
                                size: 16,
                                color: AppTheme.danger,
                              ),
                              label: Text(
                                'Void this bill',
                                style: Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(color: AppTheme.danger),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
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
        SnackBar(
          content: const Text('PDF saved.'),
          backgroundColor: AppTheme.heading,
          action: canOpenSavedFile
              ? SnackBarAction(
                  label: 'Open',
                  textColor: Colors.white,
                  onPressed: () => openSavedFile(where, 'bill.pdf'),
                )
              : null,
        ),
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

  /// Send the bill to the guest's own WhatsApp number, from the server — not
  /// the device's own WhatsApp, and nothing for the desk to attach by hand.
  Future<void> _shareOnWhatsApp(BuildContext context, WidgetRef ref) async {
    final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await BillPdf.build(invoice, lodgeName: lodgeName);
      final filename =
          '${(invoice.invoiceNumber ?? '${invoice.id}').replaceAll(RegExp(r'[\\/]'), '-')}.pdf';
      final result = await ref
          .read(billingViewModelProvider.notifier)
          .shareInvoiceWhatsApp(invoice.id, bytes, filename);
      messenger.showSnackBar(
        SnackBar(
          content: Text('Bill sent on WhatsApp to ${result.phone}.'),
          backgroundColor: AppTheme.heading,
        ),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(apiErrorMessage(e)),
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
    String? errorText;
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) {
          return AlertDialog(
            backgroundColor: AppTheme.bg,
            title: const Text(
              'Void this bill?',
              style: TextStyle(color: AppTheme.heading),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  // A void is not a delete: the document stays on file and its
                  // number is never reused, because a gap in the series is what an
                  // auditor asks about.
                  'The bill stays on file marked void, and its number is not '
                  'reused. Say why.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: AppTheme.s16),
                NeuField(
                  controller: controller,
                  label: 'Reason',
                  maxLength: 200,
                  required: true,
                  errorText: errorText,
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Keep it'),
              ),
              TextButton(
                onPressed: () {
                  final value = controller.text.trim();
                  if (value.isEmpty) {
                    setState(() => errorText = 'Reason is required');
                    return;
                  }
                  Navigator.pop(context, value);
                },
                child: const Text(
                  'Void',
                  style: TextStyle(color: AppTheme.danger),
                ),
              ),
            ],
          );
        },
      ),
    );

    if (reason == null || reason.isEmpty || !context.mounted) return;
    final ok = await ref
        .read(billingViewModelProvider.notifier)
        .voidInvoice(invoice.id, reason);
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

/// Icon over label so "Download" fits a third of a narrow phone.
class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: AppTheme.heading,
        side: const BorderSide(color: AppTheme.border2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
        ),
        minimumSize: const Size(0, 38),
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s4,
          vertical: AppTheme.s8,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: AppTheme.accent),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
