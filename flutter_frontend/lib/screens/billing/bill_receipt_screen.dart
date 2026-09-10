import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../../domain/models/invoice.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'bill_pdf.dart';

/// The bill just issued, shown the way the desk actually hands it over: the
/// document itself, with download and share sitting right under it. Reached
/// from the "Receipt" choice on the issue-bill confirmation — "Done" skips
/// straight past this and back to the billing list.
class BillReceiptScreen extends StatefulWidget {
  final Invoice invoice;
  final String? lodgeName;

  const BillReceiptScreen({super.key, required this.invoice, this.lodgeName});

  @override
  State<BillReceiptScreen> createState() => _BillReceiptScreenState();
}

class _BillReceiptScreenState extends State<BillReceiptScreen> {
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

  @override
  Widget build(BuildContext context) {
    final invoice = widget.invoice;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${kDocumentLabels[invoice.documentType] ?? 'Bill'} '
          '${invoice.invoiceNumber ?? ''}',
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
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: AppTheme.s4),
                Text(
                  _error!,
                  style: const TextStyle(color: AppTheme.danger, fontSize: 12),
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
