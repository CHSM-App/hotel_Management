import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';
import 'advance_receipt_pdf.dart';

/// Advances against a stay — what has been taken, and taking more.
///
/// Opens straight onto the newest live receipt rather than a list, the same
/// way the web tape chart's own "Advance receipt" button does: most stays
/// hold exactly one, and it was likely raised seconds ago. A stay that took
/// its advance in two goes gets a small picker above the document; a stay
/// with none yet opens straight onto the form instead.
///
/// Returns true if anything here changed the booking's own figures — a
/// further advance taken or a receipt voided — so the caller knows to
/// reload it.
Future<bool?> openAdvanceReceiptScreen(BuildContext context, Booking booking) {
  return Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => AdvanceReceiptScreen(booking: booking)),
  );
}

class AdvanceReceiptScreen extends ConsumerStatefulWidget {
  final Booking booking;

  const AdvanceReceiptScreen({super.key, required this.booking});

  @override
  ConsumerState<AdvanceReceiptScreen> createState() =>
      _AdvanceReceiptScreenState();
}

class _AdvanceReceiptScreenState extends ConsumerState<AdvanceReceiptScreen> {
  List<AdvanceReceipt>? _receipts;
  String? _loadError;
  AdvanceReceipt? _picked;
  bool _changed = false;

  bool _showTakeForm = false;
  final List<PaymentDraft> _lines = [PaymentDraft()];
  bool _taking = false;
  String? _takeError;

  bool _voiding = false;

  bool _pdfBusy = false;
  String? _pdfError;

  /// Same default stock as the web app's own paper picker — see
  /// [ReceiptPaperSize.defaultId].
  String _paperId = ReceiptPaperSize.defaultId;

  /// Print, download and share all build the same file the same way and
  /// differ only in what they do with it once it exists — so the building,
  /// the busy state, and the one error message live here once.
  Future<void> _runPdfAction(Future<void> Function() action) async {
    setState(() {
      _pdfBusy = true;
      _pdfError = null;
    });
    try {
      await action();
    } catch (_) {
      if (!mounted) return;
      setState(() => _pdfError = 'Could not prepare the receipt PDF.');
    } finally {
      if (mounted) setState(() => _pdfBusy = false);
    }
  }

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final receipts = await ref
          .read(billingUsecaseProvider)
          .advanceReceipts(widget.booking.id);
      if (!mounted) return;
      setState(() => _receipts = receipts);
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadError = 'Could not load advance receipts.');
    }
  }

  /// The newest issued one, unless the picker chose an earlier one — a void
  /// is never auto-picked, the same way the web modal never lands on one:
  /// it is not what anyone means by "show me the receipt".
  AdvanceReceipt? get _shown {
    if (_picked != null) return _picked;
    final list = _receipts;
    if (list == null) return null;
    for (final r in list) {
      if (r.status == 'ISSUED') return r;
    }
    return null;
  }

  num get _stayTotal => (widget.booking.totalPrice ?? 0).round();
  num get _alreadyHeld => widget.booking.advanceAmount ?? 0;
  num get _remaining {
    final r = _stayTotal - _alreadyHeld;
    return r < 0 ? 0 : r;
  }

  bool get _canTakeMore =>
      widget.booking.status != 'CANCELLED' && _remaining > 0;

  num get _amount => sumPayments(_lines);

  Future<void> _take() async {
    final paid = _lines.where((l) => l.value > 0).toList();
    if (paid.isEmpty) return;
    final problem = paymentLinesError(paid);
    if (problem != null) {
      setState(() => _takeError = problem);
      return;
    }

    setState(() {
      _taking = true;
      _takeError = null;
    });
    try {
      final body = <String, dynamic>{
        'amountReceived': sumPayments(paid),
        if (paid.length == 1) 'paymentMethod': paid.first.method,
        if (paid.length == 1 &&
            needsPaymentReference(paid.first.method) &&
            paid.first.reference.trim().isNotEmpty)
          'paymentReference': paid.first.reference.trim(),
        if (paid.length > 1)
          'paymentLines': paid.map((l) => l.toJson()).toList(),
      };
      final receipt = await ref
          .read(billingUsecaseProvider)
          .issueAdvanceReceipt(widget.booking.id, body);
      if (!mounted) return;
      setState(() {
        _receipts = [receipt, ...?_receipts];
        _picked = receipt;
        _lines
          ..clear()
          ..add(PaymentDraft());
        _taking = false;
        _showTakeForm = false;
        _changed = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _taking = false;
        _takeError = 'Could not record this advance. Try again.';
      });
    }
  }

  Future<void> _void() async {
    final shown = _shown;
    if (shown == null) return;
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _VoidReasonDialog(),
    );
    if (reason == null || reason.trim().isEmpty || !mounted) return;

    setState(() => _voiding = true);
    try {
      final voided = await ref
          .read(billingUsecaseProvider)
          .voidAdvanceReceipt(shown.id, reason.trim());
      if (!mounted) return;
      setState(() {
        _receipts = [
          for (final r in _receipts ?? const <AdvanceReceipt>[])
            r.id == voided.id ? voided : r,
        ];
        _picked = voided;
        _voiding = false;
        _changed = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _voiding = false);
      _say('Could not void the receipt. Try again.');
    }
  }

  void _say(String message) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
  );

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final shown = _shown;
    final loaded = _receipts != null;
    final existing = shown != null;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        backgroundColor: AppTheme.bg,
        appBar: AppBar(
          backgroundColor: AppTheme.bg,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          foregroundColor: AppTheme.heading,
          titleSpacing: 0,
          title: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                margin: const EdgeInsets.only(right: AppTheme.s8),
                decoration: const BoxDecoration(
                  color: AppTheme.accent,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(
                  Icons.receipt_long_rounded,
                  color: Colors.white,
                  size: 18,
                ),
              ),
              Text(
                existing
                    ? (shown.receiptNumber ?? 'Receipt')
                    : 'Advance receipt',
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: AppTheme.s16),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'Room ${b.roomNumber ?? '—'}',
                    style: const TextStyle(
                      color: AppTheme.accent,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: (!loaded && _loadError == null)
              ? const Center(child: CircularProgressIndicator())
              : _showTakeForm
              ? _takeForm()
              : SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(
                          AppTheme.s16,
                          0,
                          AppTheme.s16,
                          AppTheme.s12,
                        ),
                        child: _header(shown, loaded, existing),
                      ),
                      if (existing) ...[
                        Padding(
                          padding: const EdgeInsets.fromLTRB(
                            AppTheme.s16,
                            0,
                            AppTheme.s16,
                            AppTheme.s12,
                          ),
                          child: NeuCard(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppTheme.s12,
                              vertical: AppTheme.s4,
                            ),
                            child: _PaperPicker(
                              value: _paperId,
                              onChanged: (id) => setState(() => _paperId = id),
                            ),
                          ),
                        ),
                        // A fixed height rather than Expanded: PdfPreview
                        // needs bounded constraints, and giving it the whole
                        // remaining viewport is what let the header and
                        // button row above it scroll along with the receipt
                        // as one page instead of the preview alone owning
                        // its own separate scroll region.
                        Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.s16,
                          ),
                          child: Container(
                            clipBehavior: Clip.antiAlias,
                            decoration: BoxDecoration(
                              color: AppTheme.card,
                              borderRadius: BorderRadius.circular(
                                AppTheme.rMedium,
                              ),
                              border: Border.all(color: AppTheme.border),
                              boxShadow: AppTheme.subtle,
                            ),
                            child: SizedBox(
                              height: MediaQuery.of(context).size.height * 0.85,
                              child: PdfPreview(
                                key: ValueKey('${shown.id}-$_paperId'),
                                build: (format) => AdvanceReceiptPdf.build(
                                  shown,
                                  paperId: _paperId,
                                ),
                                canChangePageFormat: false,
                                canChangeOrientation: false,
                                canDebug: false,
                                // The print/share bar is the row of icon
                                // buttons below the document, not this
                                // widget's own — without this, the desk saw
                                // the same two actions offered twice on one
                                // screen.
                                useActions: false,
                                pdfFileName:
                                    '${shown.receiptNumber ?? shown.id}.pdf',
                              ),
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(
                            AppTheme.s16,
                            AppTheme.s12,
                            AppTheme.s16,
                            AppTheme.s16,
                          ),
                          child: NeuCard(
                            child: Column(
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    _IconAction(
                                      icon: Icons.download_rounded,
                                      label: 'Download',
                                      filled: true,
                                      busy: _pdfBusy,
                                      onPressed: () => _runPdfAction(() async {
                                        final where =
                                            await AdvanceReceiptPdf.download(
                                              shown,
                                              paperId: _paperId,
                                            );
                                        if (!mounted) return;
                                        _say('Saved to $where');
                                      }),
                                    ),
                                    const SizedBox(width: AppTheme.s16),
                                    _IconAction(
                                      icon: Icons.share_rounded,
                                      label: 'Share',
                                      busy: _pdfBusy,
                                      onPressed: () => _runPdfAction(
                                        () => AdvanceReceiptPdf.share(
                                          shown,
                                          paperId: _paperId,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                if (_pdfError != null) ...[
                                  const SizedBox(height: AppTheme.s8),
                                  Text(
                                    _pdfError!,
                                    style: const TextStyle(
                                      color: AppTheme.danger,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
        ),
      ),
    );
  }

  Widget _header(AdvanceReceipt? shown, bool loaded, bool existing) {
    final b = widget.booking;
    final paidInFull = loaded && _remaining <= 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NeuCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.person_rounded,
                      color: AppTheme.accent,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          b.guestName ?? 'Guest',
                          style: const TextStyle(
                            color: AppTheme.heading,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Stay total ${formatPrice(_stayTotal)}',
                          style: const TextStyle(
                            color: AppTheme.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (loaded) _StatusPill(paidInFull: paidInFull),
                ],
              ),
              const SizedBox(height: AppTheme.s16),
              Row(
                children: [
                  Expanded(
                    child: _MoneyStat(
                      label: 'Advance held',
                      value: _alreadyHeld,
                      color: AppTheme.vacant,
                      icon: Icons.savings_rounded,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(
                    child: _MoneyStat(
                      label: paidInFull ? 'Balance' : 'Still to pay',
                      value: _remaining,
                      color: paidInFull ? AppTheme.muted : AppTheme.draft,
                      icon: paidInFull
                          ? Icons.check_circle_rounded
                          : Icons.hourglass_bottom_rounded,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        // Outside the "no receipt" branch on purpose — a stay whose advance
        // arrived in two goes still has to be able to reach the first
        // receipt again.
        if (loaded && (_receipts?.length ?? 0) > 1) ...[
          const SizedBox(height: AppTheme.s12),
          SizedBox(
            height: 32,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final r in _receipts!)
                  Padding(
                    padding: const EdgeInsets.only(right: AppTheme.s8),
                    child: _ReceiptChip(
                      receipt: r,
                      active: r.id == shown?.id,
                      onTap: () => setState(() {
                        _picked = r;
                        _showTakeForm = false;
                      }),
                    ),
                  ),
              ],
            ),
          ),
        ],

        if (loaded && shown == null) ...[
          const SizedBox(height: AppTheme.s12),
          Text(
            _alreadyHeld > 0
                ? '${formatPrice(_alreadyHeld)} is recorded against this stay but has no receipt.'
                : 'No advance has been taken against this stay yet.',
            style: const TextStyle(color: AppTheme.muted, fontSize: 13),
          ),
        ],

        if (shown != null && shown.isVoid) ...[
          const SizedBox(height: AppTheme.s12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: AppTheme.danger.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              'Void — ${shown.voidReason ?? 'No reason recorded.'}',
              style: const TextStyle(color: AppTheme.danger, fontSize: 12),
            ),
          ),
        ],

        if (_loadError != null) ...[
          const SizedBox(height: AppTheme.s12),
          Text(
            _loadError!,
            style: const TextStyle(color: AppTheme.danger, fontSize: 13),
          ),
        ],

        const SizedBox(height: AppTheme.s12),

        // Take another advance / Done / Void, wrapped onto a second line on
        // a narrow phone rather than being forced to share one with the
        // three icons above.
        Wrap(
          spacing: AppTheme.s8,
          runSpacing: AppTheme.s8,
          children: [
            if (_canTakeMore)
              NeuButton(
                onPressed: () => setState(() => _showTakeForm = true),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.add_circle_outline_rounded,
                      size: 16,
                      color: AppTheme.accent,
                    ),
                    SizedBox(width: 6),
                    Text('Take another advance'),
                  ],
                ),
              ),
            NeuButton(
              primary: true,
              onPressed: () => Navigator.of(context).pop(_changed),
              child: const Text('Done'),
            ),
            if (shown != null && !shown.isVoid)
              TextButton.icon(
                onPressed: _voiding ? null : _void,
                style: TextButton.styleFrom(foregroundColor: AppTheme.danger),
                icon: const Icon(Icons.block_rounded, size: 16),
                label: Text(_voiding ? 'Voiding…' : 'Void this receipt'),
              ),
          ],
        ),
      ],
    );
  }

  Widget _takeForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16,
        0,
        AppTheme.s16,
        AppTheme.s16,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Advance received now',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: AppTheme.s4),
          Text(
            'Up to ${formatPrice(_remaining)} still to pay.',
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
          const SizedBox(height: AppTheme.s12),
          for (var i = 0; i < _lines.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: PaymentRow(
                key: ValueKey(_lines[i]),
                line: _lines[i],
                onRemove: _lines.length == 1
                    ? null
                    : () => setState(() => _lines.removeAt(i)),
                onChanged: () => setState(() {}),
              ),
            ),
          if (_lines.length < 5)
            NeuButton(
              expand: true,
              onPressed: () => setState(() => _lines.add(PaymentDraft())),
              child: const Text('+ Add another payment'),
            ),
          const SizedBox(height: AppTheme.s16),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Amount',
                  style: TextStyle(color: AppTheme.text, fontSize: 13),
                ),
              ),
              Text(
                formatPrice(_amount),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          if (_takeError != null) ...[
            const SizedBox(height: AppTheme.s8),
            Text(
              _takeError!,
              style: const TextStyle(color: AppTheme.danger, fontSize: 12),
            ),
          ],
          const SizedBox(height: AppTheme.s16),
          Row(
            children: [
              Expanded(
                child: NeuButton(
                  onPressed: _taking
                      ? null
                      : () => setState(() => _showTakeForm = false),
                  child: const Text('Back'),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: NeuButton(
                  primary: true,
                  onPressed: (_taking || _amount <= 0) ? null : _take,
                  child: Text(
                    _taking ? 'Recording…' : 'Record & print receipt',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// "Paid in full" in the vacant green, "₹X left" in the same amber the tape
/// chart marks a draft with — so the state of the money reads at a glance
/// without parsing a sentence.
class _StatusPill extends StatelessWidget {
  final bool paidInFull;

  const _StatusPill({required this.paidInFull});

  @override
  Widget build(BuildContext context) {
    final color = paidInFull ? AppTheme.vacant : AppTheme.draft;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            paidInFull ? Icons.check_circle_rounded : Icons.pending_rounded,
            size: 13,
            color: color,
          ),
          const SizedBox(width: 4),
          Text(
            paidInFull ? 'Paid in full' : 'Part paid',
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

/// One of the two money figures under the guest's name — what has been
/// taken, and what is left — each in its own tinted tile so the two never
/// have to be told apart by reading the label first.
class _MoneyStat extends StatelessWidget {
  final String label;
  final num value;
  final Color color;
  final IconData icon;

  const _MoneyStat({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: AppTheme.s8,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: color),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            formatPrice(value),
            style: const TextStyle(
              color: AppTheme.heading,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

/// One of the three ways to hand the receipt off the phone — a circular
/// icon button with its own label underneath, the way the web modal's own
/// print/download/share row reads at a glance without needing text buttons
/// wide enough to spell each one out.
class _IconAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool busy;
  final bool filled;
  final VoidCallback onPressed;

  const _IconAction({
    required this.icon,
    required this.label,
    required this.busy,
    required this.onPressed,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        InkResponse(
          onTap: busy ? null : onPressed,
          radius: 26,
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: filled ? AppTheme.accent : AppTheme.card,
              shape: BoxShape.circle,
              border: filled ? null : Border.all(color: AppTheme.border),
            ),
            child: busy
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: filled ? Colors.white : AppTheme.accent,
                    ),
                  )
                : Icon(
                    icon,
                    size: 20,
                    color: filled ? Colors.white : AppTheme.text,
                  ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(color: AppTheme.muted, fontSize: 11),
        ),
      ],
    );
  }
}

/// The same "Paper" dropdown the web modal offers above its receipt — Print
/// and the download have to agree about the sheet, which is why one choice
/// governs both here too.
class _PaperPicker extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const _PaperPicker({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.description_outlined, size: 16, color: AppTheme.muted),
        const SizedBox(width: 6),
        const Text(
          'Paper',
          style: TextStyle(
            color: AppTheme.muted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: value,
                isExpanded: true,
                dropdownColor: AppTheme.bg,
                style: const TextStyle(color: AppTheme.heading, fontSize: 13),
                items: [
                  for (final p in ReceiptPaperSize.all)
                    DropdownMenuItem(
                      value: p.id,
                      child: Text('${p.label} — ${p.hint}'),
                    ),
                ],
                onChanged: (id) {
                  if (id != null) onChanged(id);
                },
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ReceiptChip extends StatelessWidget {
  final AdvanceReceipt receipt;
  final bool active;
  final VoidCallback onTap;

  const _ReceiptChip({
    required this.receipt,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppTheme.accent : AppTheme.card,
          border: Border.all(color: active ? AppTheme.accent : AppTheme.border),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          '${receipt.receiptNumber ?? '#${receipt.id}'}'
          '${receipt.isVoid ? ' · void' : ''} · ${formatPrice(receipt.amountReceived)}',
          style: TextStyle(
            color: active ? Colors.white : AppTheme.text,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _VoidReasonDialog extends StatefulWidget {
  const _VoidReasonDialog();

  @override
  State<_VoidReasonDialog> createState() => _VoidReasonDialogState();
}

class _VoidReasonDialogState extends State<_VoidReasonDialog> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: const Text(
        'Void this receipt?',
        style: TextStyle(color: AppTheme.heading),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'The advance comes back off the booking, so the balance at '
            'checkout is the full amount again. Say why.',
            style: TextStyle(color: AppTheme.text, fontSize: 13),
          ),
          const SizedBox(height: AppTheme.s16),
          NeuField(controller: _reason, label: 'Reason'),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Keep it'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, _reason.text),
          child: const Text('Void receipt'),
        ),
      ],
    );
  }
}
