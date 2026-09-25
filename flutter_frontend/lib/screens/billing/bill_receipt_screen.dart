import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'bill_pdf.dart';

/// The bill just issued, shown the way the desk actually hands it over: the
/// document itself, with download and share sitting right under it. Reached
/// from the "Receipt" choice on the issue-bill confirmation — "Done" skips
/// straight past this and back to the billing list.
class BillReceiptScreen extends ConsumerStatefulWidget {
  final Invoice invoice;
  final String? lodgeName;

  const BillReceiptScreen({super.key, required this.invoice, this.lodgeName});

  @override
  ConsumerState<BillReceiptScreen> createState() => _BillReceiptScreenState();
}

class _BillReceiptScreenState extends ConsumerState<BillReceiptScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not prepare the bill PDF.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Same shape as [_run], but for WhatsApp: a failure here has a reason
  /// worth reading — no number on file, sending not set up, the provider
  /// rejected it — and flattening all of that to "could not prepare the PDF"
  /// would leave the desk with nothing to act on. The PDF itself, if it got
  /// that far, built fine.
  Future<void> _runWhatsApp(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _shareOnWhatsApp() async {
    final invoice = widget.invoice;
    final messenger = ScaffoldMessenger.of(context);
    final bytes = await BillPdf.build(invoice, lodgeName: widget.lodgeName);
    final filename =
        '${(invoice.invoiceNumber ?? '${invoice.id}').replaceAll(RegExp(r'[\\/]'), '-')}.pdf';
    final result = await ref
        .read(billingViewModelProvider.notifier)
        .shareInvoiceWhatsApp(invoice.id, bytes, filename);
    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text('Bill sent on WhatsApp to ${result.phone}.'),
        backgroundColor: AppTheme.heading,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final invoice = widget.invoice;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${kDocumentLabels[invoice.documentType] ?? 'Bill'} '
          '${invoice.invoiceNumber ?? ''}',
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppTheme.s16),
          child: Column(
            children: [
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: AppTheme.border),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: PdfPreview(
                    key: ValueKey(invoice.id),
                    build: (format) =>
                        BillPdf.build(invoice, lodgeName: widget.lodgeName),
                    canChangePageFormat: false,
                    canChangeOrientation: false,
                    canDebug: false,
                    useActions: false,
                    pdfFileName: '${invoice.invoiceNumber ?? invoice.id}.pdf',
                  ),
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    tooltip: 'Download',
                    onPressed: _busy
                        ? null
                        : () => _run(() async {
                            final messenger = ScaffoldMessenger.of(context);
                            final where = await BillPdf.download(
                              invoice,
                              lodgeName: widget.lodgeName,
                            );
                            if (!mounted) return;
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text('Saved to $where'),
                                backgroundColor: AppTheme.heading,
                              ),
                            );
                          }),
                    icon: const Icon(Icons.download_rounded),
                    color: Colors.white,
                    style: IconButton.styleFrom(backgroundColor: AppTheme.accent),
                  ),
                  const SizedBox(width: AppTheme.s16),
                  IconButton(
                    tooltip: 'Print',
                    onPressed: _busy
                        ? null
                        : () => _run(
                            () => BillPdf.print(
                              invoice,
                              lodgeName: widget.lodgeName,
                            ),
                          ),
                    icon: const Icon(Icons.print_rounded),
                    color: AppTheme.text,
                  ),
                  const SizedBox(width: AppTheme.s16),
                  IconButton(
                    tooltip: 'Share',
                    onPressed: _busy
                        ? null
                        : () => _run(
                            () => BillPdf.share(
                              invoice,
                              lodgeName: widget.lodgeName,
                            ),
                          ),
                    icon: const Icon(Icons.share_rounded),
                    color: AppTheme.text,
                  ),
                  if (!invoice.isVoid) ...[
                    const SizedBox(width: AppTheme.s16),
                    // One press: the bill goes to the guest's own WhatsApp
                    // number, sent by the server — not the device's own
                    // WhatsApp, and nothing for the desk to attach by hand.
                    IconButton(
                      tooltip: 'Send on WhatsApp',
                      onPressed: _busy ? null : () => _runWhatsApp(_shareOnWhatsApp),
                      icon: const Icon(Icons.send_rounded),
                      color: const Color(0xFF25D366),
                    ),
                  ],
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: AppTheme.s4),
                Text(
                  _error!,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.danger),
                ),
              ],
              const SizedBox(height: AppTheme.s12),
              NeuButton(
                primary: true,
                expand: true,
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Done'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
