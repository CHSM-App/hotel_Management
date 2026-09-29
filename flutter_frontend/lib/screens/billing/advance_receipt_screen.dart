import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../bookings/receipt_download.dart';
import '../theme.dart';
import 'advance_receipt_pdf.dart';

/// The advance receipt, as the desk actually hands it over — mirrors
/// AdvanceReceiptModal.jsx: the voucher itself with Print/Download/WhatsApp
/// under it, "Take another advance" when the booking or function can still
/// take one, and "Void this receipt" for one already issued.
///
/// Reached from the "Take advance" action right after a new one is issued,
/// and from tapping an existing receipt row to view, reprint or void it.
class AdvanceReceiptScreen extends ConsumerStatefulWidget {
  final AdvanceReceipt receipt;

  /// Whether the booking/function behind this receipt can still take
  /// another advance — false once it's cancelled, settled, or fully paid.
  final bool canTakeAnother;

  const AdvanceReceiptScreen({
    super.key,
    required this.receipt,
    this.canTakeAnother = false,
  });

  /// The sentinel [Navigator.pop] returns when the desk taps "Take another
  /// advance" — the caller reopens its own take-advance form rather than this
  /// screen owning a second copy of that payment UI.
  static const takeAnother = 'take-another';

  @override
  ConsumerState<AdvanceReceiptScreen> createState() => _AdvanceReceiptScreenState();
}

class _AdvanceReceiptScreenState extends ConsumerState<AdvanceReceiptScreen> {
  late AdvanceReceipt _receipt = widget.receipt;
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
      setState(() => _error = 'Could not prepare the receipt PDF.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmVoid() async {
    final controller = TextEditingController();
    String? errorText;
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          backgroundColor: AppTheme.bg,
          title: const Text('Void this receipt?', style: TextStyle(color: AppTheme.heading)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'The receipt stays on file marked void, and its number is not reused. Say why.',
              ),
              const SizedBox(height: AppTheme.s16),
              NeuField(controller: controller, label: 'Reason', maxLength: 200, required: true, errorText: errorText),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Keep it')),
            TextButton(
              onPressed: () {
                final value = controller.text.trim();
                if (value.isEmpty) {
                  setState(() => errorText = 'Reason is required');
                  return;
                }
                Navigator.pop(context, value);
              },
              child: const Text('Void', style: TextStyle(color: AppTheme.danger)),
            ),
          ],
        ),
      ),
    );

    if (reason == null || reason.isEmpty || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final voided = await ref.read(billingViewModelProvider.notifier).voidAdvanceReceipt(_receipt.id, reason);
    if (!mounted) return;
    if (voided != null) {
      setState(() => _receipt = voided);
      messenger.showSnackBar(const SnackBar(content: Text('Receipt voided.'), backgroundColor: AppTheme.heading));
    } else {
      messenger.showSnackBar(const SnackBar(content: Text('Could not void this receipt.'), backgroundColor: AppTheme.heading));
    }
  }

  @override
  Widget build(BuildContext context) {
    final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;
    final r = _receipt;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${kDocumentLabels[r.documentType] ?? 'Receipt'} ${r.receiptNumber ?? ''}',
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppTheme.s16),
          child: Column(
            children: [
              Text(
                '${r.guestName ?? ''} · ${r.isEventReceipt ? 'function' : 'stay'} total ${_money(r.stayTotal)} · '
                '${_money(r.amountReceived)} advance held · ${_money(r.balanceDue)} still to pay',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppTheme.s12),
              Expanded(
                child: Container(
                  decoration: BoxDecoration(border: Border.all(color: AppTheme.border), borderRadius: BorderRadius.circular(12)),
                  clipBehavior: Clip.antiAlias,
                  child: PdfPreview(
                    key: ValueKey(r.id),
                    build: (format) => AdvanceReceiptPdf.build(r, lodgeName: lodgeName),
                    canChangePageFormat: false,
                    canChangeOrientation: false,
                    canDebug: false,
                    useActions: false,
                    pdfFileName: '${r.receiptNumber ?? r.id}.pdf',
                  ),
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    tooltip: 'Print',
                    onPressed: _busy ? null : () => _run(() => AdvanceReceiptPdf.print(r, lodgeName: lodgeName)),
                    icon: const Icon(Icons.print_rounded),
                    color: AppTheme.text,
                  ),
                  const SizedBox(width: AppTheme.s16),
                  IconButton(
                    tooltip: 'Download',
                    onPressed: _busy
                        ? null
                        : () => _run(() async {
                            final messenger = ScaffoldMessenger.of(context);
                            final where = await AdvanceReceiptPdf.download(r, lodgeName: lodgeName);
                            if (!mounted) return;
                            messenger.showSnackBar(
                              SnackBar(
                                content: const Text('PDF saved.'),
                                backgroundColor: AppTheme.heading,
                                action: canOpenSavedFile
                                    ? SnackBarAction(
                                        label: 'Open',
                                        textColor: Colors.white,
                                        onPressed: () => openSavedFile(where, 'receipt.pdf'),
                                      )
                                    : null,
                              ),
                            );
                          }),
                    icon: const Icon(Icons.download_rounded),
                    color: Colors.white,
                    style: IconButton.styleFrom(backgroundColor: AppTheme.accent),
                  ),
                  const SizedBox(width: AppTheme.s16),
                  IconButton(
                    tooltip: 'Share on WhatsApp',
                    onPressed: _busy ? null : () => _run(() => AdvanceReceiptPdf.share(r, lodgeName: lodgeName)),
                    icon: const Icon(Icons.send_rounded),
                    color: const Color(0xFF25D366),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: AppTheme.s4),
                Text(_error!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.danger)),
              ],
              const SizedBox(height: AppTheme.s12),
              if (widget.canTakeAnother && !r.isVoid) ...[
                NeuButton(
                  expand: true,
                  onPressed: _busy ? null : () => Navigator.of(context).pop(AdvanceReceiptScreen.takeAnother),
                  child: const Text('Take another advance'),
                ),
                const SizedBox(height: AppTheme.s8),
              ],
              NeuButton(
                primary: true,
                expand: true,
                onPressed: () => Navigator.of(context).pop(_receipt),
                child: const Text('Done'),
              ),
              if (!r.isVoid) ...[
                const SizedBox(height: AppTheme.s4),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: _busy ? null : _confirmVoid,
                    child: Text(
                      'Void this receipt',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.danger),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _money(num n) => '₹${n.toStringAsFixed(0)}';
}
