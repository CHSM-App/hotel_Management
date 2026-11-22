import 'package:flutter/material.dart';

import '../../domain/models/draft.dart';
import '../../domain/models/invoice_window.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';

/// The panels the booking form adds for the two "already happened" flows:
/// correcting a billed stay (the invoice is restated in place) and recording a
/// past stay (saved checked out and billed at once). Kept out of
/// take_booking_screen.dart, which only decides when to show them.

enum _Tone { info, warn, danger }

class _Banner extends StatelessWidget {
  final _Tone tone;
  final IconData icon;
  final String title;
  final String? body;

  const _Banner({
    required this.tone,
    required this.icon,
    required this.title,
    this.body,
  });

  @override
  Widget build(BuildContext context) {
    final (wash, ink) = switch (tone) {
      _Tone.info => (AppTheme.sidebarBrandWash, AppTheme.accent),
      _Tone.warn => (AppTheme.warningWash, AppTheme.warningInk),
      _Tone.danger => (const Color(0xFFFDECEC), AppTheme.danger),
    };
    return Semantics(
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppTheme.s12),
        decoration: BoxDecoration(
          color: wash,
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          border: Border.all(color: ink.withValues(alpha: 0.25)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: ink, size: 20),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: ink,
                      fontWeight: FontWeight.w800,
                      fontSize: 13.5,
                    ),
                  ),
                  if (body != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      body!,
                      style: TextStyle(color: ink, fontSize: 12.5, height: 1.35),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _day(DateTime d) => formatDate(d);

/// Which methods a tender can be, as chips — cash / UPI / card.
class _MethodChips extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const _MethodChips({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: AppTheme.s8,
    runSpacing: AppTheme.s4,
    children: [
      for (final e in kPaymentMethods.entries)
        ChoiceChip(
          label: Text(e.value),
          selected: value == e.key,
          onSelected: (_) => onChanged(e.key),
          selectedColor: AppTheme.sidebarBrandWash,
          labelStyle: TextStyle(
            color: value == e.key ? AppTheme.accent : AppTheme.text,
            fontWeight: FontWeight.w700,
          ),
        ),
    ],
  );
}

/// Shown while correcting a billed stay. Says what will happen to the invoice,
/// which dates the neighbouring invoices allow, and collects the reason plus
/// how any extra is paid.
class InvoiceRevisionPanel extends StatelessWidget {
  final InvoiceEditWindow window;
  final TextEditingController reason;
  final String? reasonError;
  final String method;
  final ValueChanged<String> onMethod;
  final TextEditingController reference;
  final bool refundAcknowledged;
  final ValueChanged<bool> onRefundAcknowledged;

  /// The total on file and the re-priced one; null until a quote is in.
  final num? oldTotal;
  final num? newTotal;

  const InvoiceRevisionPanel({
    super.key,
    required this.window,
    required this.reason,
    required this.reasonError,
    required this.method,
    required this.onMethod,
    required this.reference,
    required this.refundAcknowledged,
    required this.onRefundAcknowledged,
    this.oldTotal,
    this.newTotal,
  });

  String get _windowText {
    if (window.isOpen) {
      return 'No other invoices sit next to this one, so the dates are open.';
    }
    final a = window.minDate == null ? 'any earlier day' : _day(window.minDate!);
    final b = window.maxDate == null ? 'any later day' : _day(window.maxDate!);
    final nbrs = [
      if (window.prevNumber != null) '#${window.prevNumber}',
      if (window.nextNumber != null) '#${window.nextNumber}',
    ].join(' and ');
    return 'Check-out can be between $a and $b because the invoices either '
        'side of it ($nbrs) fix those days.';
  }

  @override
  Widget build(BuildContext context) {
    final diff = (oldTotal != null && newTotal != null)
        ? newTotal! - oldTotal!
        : null;
    final needsMethod = diff == null || diff > 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Banner(
          tone: _Tone.warn,
          icon: Icons.receipt_long_rounded,
          title: 'Invoice #${window.invoiceNumber} will be updated in place',
          body:
              '$_windowText\nIt keeps its number and date; the change is '
              'recorded.',
        ),
        const SizedBox(height: AppTheme.s12),
        NeuField(
          controller: reason,
          label: 'Reason for the change (optional)',
          hint: 'e.g. Guest left a day early',
          maxLength: 200,
          errorText: reasonError,
        ),
        if (diff != null && diff != 0) ...[
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Icon(
                diff > 0 ? Icons.north_east_rounded : Icons.south_east_rounded,
                size: 16,
                color: diff > 0 ? AppTheme.checkout : AppTheme.danger,
              ),
              const SizedBox(width: AppTheme.s4),
              Expanded(
                child: Text(
                  diff > 0
                      ? 'New total ${formatPrice(newTotal)} — about '
                            '${formatPrice(diff)} more than the invoice.'
                      : 'New total ${formatPrice(newTotal)} — about '
                            '${formatPrice(-diff)} less than the invoice.',
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
        if (needsMethod) ...[
          const SizedBox(height: AppTheme.s12),
          Text('If more is due, it is paid by', style: AppTheme.fieldLabel(context)),
          const SizedBox(height: AppTheme.s4),
          _MethodChips(value: method, onChanged: onMethod),
          if (method != 'CASH') ...[
            const SizedBox(height: AppTheme.s8),
            NeuField(
              controller: reference,
              label: 'Transaction number (optional)',
              maxLength: 64,
            ),
          ],
        ],
        if (diff == null || diff < 0) ...[
          const SizedBox(height: AppTheme.s8),
          CheckboxListTile(
            value: refundAcknowledged,
            onChanged: (v) => onRefundAcknowledged(v ?? false),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            dense: true,
            title: const Text(
              'If the new bill is lower, I will refund the difference to the guest',
              style: TextStyle(fontSize: 12.5, color: AppTheme.heading),
            ),
          ),
        ],
      ],
    );
  }
}

/// Shown when a new booking ends today or earlier and the property may record
/// past stays: the stay is saved as checked out and billed straight away.
class PastBookingPanel extends StatelessWidget {
  final PastWindow? window;
  final bool loading;
  final bool closed;
  final bool showSide;
  final String billingSide;
  final ValueChanged<String> onSide;
  final TimeOfDay inTime;
  final TimeOfDay outTime;
  final VoidCallback onPickIn;
  final VoidCallback onPickOut;
  final List<PaymentDraft> finalLines;
  final VoidCallback onAddLine;
  final ValueChanged<int> onRemoveLine;
  final VoidCallback onChanged;

  /// Stay total less the advance — what the final payment has to come to.
  final num? due;
  final String? error;

  const PastBookingPanel({
    super.key,
    required this.window,
    required this.loading,
    required this.closed,
    required this.showSide,
    required this.billingSide,
    required this.onSide,
    required this.inTime,
    required this.outTime,
    required this.onPickIn,
    required this.onPickOut,
    required this.finalLines,
    required this.onAddLine,
    required this.onRemoveLine,
    required this.onChanged,
    required this.due,
    this.error,
  });

  @override
  Widget build(BuildContext context) {
    final w = window;
    if (closed && w != null) {
      return _Banner(
        tone: _Tone.danger,
        icon: Icons.block_rounded,
        title: 'Those days are already invoiced',
        body:
            'Invoice #${w.lastNumber ?? ''} was the last one issued (stay '
            'ended ${w.lastStayEnd == null ? '' : _day(w.lastStayEnd!)}). A '
            'past booking must end on or after '
            '${w.minDate == null ? '' : _day(w.minDate!)}.',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Banner(
          tone: _Tone.info,
          icon: Icons.history_rounded,
          title: 'Past booking: saved as checked out and billed now',
          body: loading
              ? 'Checking the invoice numbering…'
              : (w?.minDate != null
                    ? 'Past bookings can end from ${_day(w!.minDate!)} to today'
                          '${w.lastNumber == null ? '' : ' (last invoice #${w.lastNumber})'}.'
                    : null),
        ),
        if (showSide) ...[
          const SizedBox(height: AppTheme.s12),
          Text('Invoice type', style: AppTheme.fieldLabel(context)),
          const SizedBox(height: AppTheme.s4),
          SegmentedButton<String>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: 'GST', label: Text('GST')),
              ButtonSegment(value: 'NON_GST', label: Text('Non-GST')),
            ],
            selected: {billingSide},
            onSelectionChanged: (s) => onSide(s.first),
          ),
        ],
        const SizedBox(height: AppTheme.s12),
        Row(
          children: [
            Expanded(
              child: _TimeBox(
                label: 'Checked in at',
                time: inTime,
                onTap: onPickIn,
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: _TimeBox(
                label: 'Checked out at',
                time: outTime,
                onTap: onPickOut,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s12),
        Row(
          children: [
            Expanded(
              child: Text(
                'Final payment',
                style: AppTheme.fieldLabel(context),
              ),
            ),
            if (due != null)
              Text(
                '${formatPrice(due)} due',
                style: const TextStyle(
                  color: AppTheme.checkout,
                  fontWeight: FontWeight.w800,
                  fontSize: 12.5,
                ),
              ),
          ],
        ),
        const SizedBox(height: AppTheme.s4),
        NeuCard(
          padding: const EdgeInsets.all(AppTheme.s8),
          child: Column(
            children: [
              for (var i = 0; i < finalLines.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s4),
                  child: PaymentRow(
                    key: ValueKey('past-final-$i'),
                    line: finalLines[i],
                    onRemove: finalLines.length == 1
                        ? null
                        : () => onRemoveLine(i),
                    onChanged: onChanged,
                  ),
                ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s4),
                  child: Text(
                    error!,
                    style: const TextStyle(color: AppTheme.danger, fontSize: 12),
                  ),
                ),
              if (finalLines.length < 5)
                NeuButton(
                  expand: true,
                  onPressed: onAddLine,
                  padding: const EdgeInsets.symmetric(vertical: AppTheme.s4),
                  child: const Text('+ Add another payment'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TimeBox extends StatelessWidget {
  final String label;
  final TimeOfDay time;
  final VoidCallback onTap;

  const _TimeBox({
    required this.label,
    required this.time,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: AppTheme.fieldLabel(context)),
      const SizedBox(height: AppTheme.s4),
      Semantics(
        button: true,
        label: '$label ${time.format(context)}',
        child: GestureDetector(
          onTap: onTap,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s12,
              vertical: AppTheme.s8,
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.schedule_rounded,
                  color: AppTheme.accent,
                  size: 16,
                ),
                const SizedBox(width: AppTheme.s8),
                Text(
                  time.format(context),
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: AppTheme.heading,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ],
  );
}

/// Last look before money or an invoice changes. Returns true to go ahead.
Future<bool> confirmMoneyChange(
  BuildContext context, {
  required String title,
  required List<(String, String)> rows,
  required String confirmLabel,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (k, v) in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        k,
                        style: const TextStyle(color: AppTheme.muted),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Flexible(
                      child: Text(
                        v,
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Back'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return ok ?? false;
}
