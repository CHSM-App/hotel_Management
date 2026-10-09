import 'package:flutter/material.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// What reception settled while cancelling — the refund shape or the
/// cancellation-charge shape, whichever the booking's own advance decided,
/// plus whatever reason was typed.
class CancelSettlement {
  final String? reason;
  final num? refundAmount;
  final String? refundMethod;
  final num? cancellationCharge;
  final String? chargeMethod;

  const CancelSettlement({
    this.reason,
    this.refundAmount,
    this.refundMethod,
    this.cancellationCharge,
    this.chargeMethod,
  });
}

/// Settle the advance before the booking goes — the same panel the web tape
/// chart's own "Cancel booking" opens onto: what goes back to the guest and
/// what the property keeps, when the stay held a deposit; a charge taken on
/// the spot instead, when it held none.
///
/// Returns null if reception backed out and kept the booking.
Future<CancelSettlement?> showCancelBookingSheet(
  BuildContext context,
  Booking booking,
) {
  return showDialog<CancelSettlement>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _CancelBookingDialog(booking: booking),
  );
}

class _CancelBookingDialog extends StatefulWidget {
  final Booking booking;

  const _CancelBookingDialog({required this.booking});

  @override
  State<_CancelBookingDialog> createState() => _CancelBookingDialogState();
}

class _CancelBookingDialogState extends State<_CancelBookingDialog> {
  final _refundAmount = TextEditingController();
  String? _refundMethod;

  bool _collectCharge = false;
  final _chargeAmount = TextEditingController();
  String? _chargeMethod;

  final _reason = TextEditingController();

  String? _refundAmountError;
  String? _refundMethodError;
  String? _chargeAmountError;
  String? _chargeMethodError;

  bool get _hasAdvance => (widget.booking.advanceAmount ?? 0) > 0;

  @override
  void dispose() {
    _refundAmount.dispose();
    _chargeAmount.dispose();
    _reason.dispose();
    super.dispose();
  }

  num get _kept {
    final advance = widget.booking.advanceAmount ?? 0;
    final refund = num.tryParse(_refundAmount.text.trim()) ?? 0;
    final kept = advance - refund;
    return kept < 0 ? 0 : kept;
  }

  void _submit() {
    setState(() {
      _refundAmountError = null;
      _refundMethodError = null;
      _chargeAmountError = null;
      _chargeMethodError = null;
    });

    if (_hasAdvance) {
      final advance = widget.booking.advanceAmount ?? 0;
      final typed = _refundAmount.text.trim();
      final refund = num.tryParse(typed);
      if (typed.isEmpty || refund == null || refund < 0) {
        setState(() => _refundAmountError = 'Enter an amount.');
        return;
      }
      if (refund > advance) {
        setState(() => _refundAmountError = 'Up to ${formatPrice(advance)}.');
        return;
      }
      if (_refundMethod == null && refund > 0) {
        setState(() => _refundMethodError = 'Choose a type.');
        return;
      }
      Navigator.of(context).pop(
        CancelSettlement(
          reason: _reason.text,
          refundAmount: refund,
          refundMethod: refund > 0 ? _refundMethod : null,
        ),
      );
      return;
    }

    if (_collectCharge) {
      final total = widget.booking.totalPrice ?? 0;
      final typed = _chargeAmount.text.trim();
      final amount = num.tryParse(typed);
      if (typed.isEmpty || amount == null || amount <= 0) {
        setState(() => _chargeAmountError = 'Enter an amount.');
        return;
      }
      if (total > 0 && amount > total) {
        setState(() => _chargeAmountError = 'Up to ${formatPrice(total)}.');
        return;
      }
      if (_chargeMethod == null) {
        setState(() => _chargeMethodError = 'Choose a type.');
        return;
      }
      Navigator.of(context).pop(
        CancelSettlement(
          reason: _reason.text,
          cancellationCharge: amount,
          chargeMethod: _chargeMethod,
        ),
      );
      return;
    }

    Navigator.of(context).pop(CancelSettlement(reason: _reason.text));
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(AppTheme.s16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: Container(
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rLarge),
            boxShadow: AppTheme.elevated,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s16, AppTheme.s8, 0),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [AppTheme.danger, Color(0xFFB23A5A)],
                        ),
                        borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x33B23A5A),
                            offset: Offset(0, 3),
                            blurRadius: 8,
                          ),
                        ],
                      ),
                      child: const Icon(Icons.event_busy_rounded, size: 17, color: Colors.white),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    const Expanded(
                      child: Text(
                        'Cancel this booking',
                        style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 16),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded, size: 19, color: AppTheme.muted),
                      splashRadius: 18,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s8),
              Container(
                height: 3,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(colors: [AppTheme.danger, Color(0x00B23A5A)]),
                ),
              ),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _hasAdvance
                            ? 'Settle the advance before the booking goes: what goes back to '
                                  'the guest, and what the property keeps as the cancellation '
                                  'charge.'
                            : 'No advance was taken on this stay. The booking can be '
                                  'cancelled as it is, or a cancellation charge collected '
                                  'from the guest now.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: AppTheme.s12),

                      if (_hasAdvance) ...[
                        Container(
                          padding: const EdgeInsets.all(AppTheme.s12),
                          decoration: BoxDecoration(
                            color: AppTheme.bg,
                            border: Border.all(color: AppTheme.border),
                            borderRadius: BorderRadius.circular(AppTheme.rMedium),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _SettleRow(
                                label: 'Advance taken',
                                note: b.advanceDescription.isEmpty
                                    ? null
                                    : b.advanceDescription,
                                value: formatPrice(b.advanceAmount),
                              ),
                              const Divider(height: AppTheme.s16),
                              Text(
                                'Refund to guest',
                                style: Theme.of(context).textTheme.bodyMedium,
                              ),
                              const SizedBox(height: AppTheme.s8),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    flex: 3,
                                    child: _MethodDropdown(
                                      label: 'Payment type',
                                      value: _refundMethod,
                                      error: _refundMethodError,
                                      onChanged: (v) => setState(() {
                                        _refundMethod = v;
                                        _refundMethodError = null;
                                      }),
                                    ),
                                  ),
                                  const SizedBox(width: AppTheme.s8),
                                  Expanded(
                                    flex: 2,
                                    child: _AmountField(
                                      controller: _refundAmount,
                                      error: _refundAmountError,
                                      onChanged: () => setState(() {
                                        _refundAmountError = null;
                                      }),
                                    ),
                                  ),
                                ],
                              ),
                              const Divider(height: AppTheme.s16),
                              _SettleRow(
                                label: 'Kept as cancellation charge',
                                value: _refundAmount.text.trim().isEmpty
                                    ? '—'
                                    : formatPrice(_kept),
                                strong: true,
                              ),
                            ],
                          ),
                        ),
                      ] else ...[
                        Row(
                          children: [
                            Checkbox(
                              value: _collectCharge,
                              activeColor: AppTheme.accent,
                              onChanged: (v) => setState(() => _collectCharge = v ?? false),
                            ),
                            Text(
                              'Collect a cancellation charge',
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                          ],
                        ),
                        if (_collectCharge) ...[
                          const SizedBox(height: AppTheme.s4),
                          Container(
                            padding: const EdgeInsets.all(AppTheme.s12),
                            decoration: BoxDecoration(
                              color: AppTheme.bg,
                              border: Border.all(color: AppTheme.border),
                              borderRadius: BorderRadius.circular(AppTheme.rMedium),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Cancellation charge',
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                                const SizedBox(height: AppTheme.s8),
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      flex: 3,
                                      child: _MethodDropdown(
                                        label: 'Payment type',
                                        value: _chargeMethod,
                                        error: _chargeMethodError,
                                        onChanged: (v) => setState(() {
                                          _chargeMethod = v;
                                          _chargeMethodError = null;
                                        }),
                                      ),
                                    ),
                                    const SizedBox(width: AppTheme.s8),
                                    Expanded(
                                      flex: 2,
                                      child: _AmountField(
                                        controller: _chargeAmount,
                                        error: _chargeAmountError,
                                        onChanged: () => setState(() {
                                          _chargeAmountError = null;
                                        }),
                                      ),
                                    ),
                                  ],
                                ),
                                const Divider(height: AppTheme.s16),
                                _SettleRow(
                                  label: 'Collected as cancellation charge',
                                  value: _chargeAmount.text.trim().isEmpty
                                      ? '—'
                                      : formatPrice(
                                          num.tryParse(_chargeAmount.text.trim()) ?? 0,
                                        ),
                                  strong: true,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],

                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        dense: true,
                        controller: _reason,
                        label: 'Reason (optional)',
                        hint: 'Guest called off the trip',
                        maxLength: 200,
                      ),
                    ],
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s16),
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppTheme.border))),
                child: Row(
                  children: [
                    Expanded(
                      child: NeuButton(
                        onPressed: () => Navigator.of(context).pop(),
                        expand: true,
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: const Text('Keep the booking', overflow: TextOverflow.ellipsis),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: NeuButton(
                        primary: true,
                        color: AppTheme.danger,
                        expand: true,
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        onPressed: _submit,
                        child: const Text('Cancel booking', overflow: TextOverflow.ellipsis),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SettleRow extends StatelessWidget {
  final String label;
  final String? note;
  final String value;
  final bool strong;

  const _SettleRow({
    required this.label,
    this.note,
    required this.value,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: RichText(
            text: TextSpan(
              style: TextStyle(
                color: AppTheme.heading,
                fontSize: 13,
                fontWeight: strong ? FontWeight.w700 : FontWeight.w400,
              ),
              children: [
                TextSpan(text: label),
                if (note != null)
                  TextSpan(
                    text: '  · $note',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: AppTheme.heading,
            fontSize: 13,
            fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _MethodDropdown extends StatelessWidget {
  final String label;
  final String? value;
  final String? error;
  final ValueChanged<String?> onChanged;

  const _MethodDropdown({
    required this.label,
    required this.value,
    required this.error,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
        const SizedBox(height: 4),
        NeuPressed(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: Theme(
            data: Theme.of(context).copyWith(
              focusColor: AppTheme.accent.withValues(alpha: 0.1),
              hoverColor: AppTheme.accent.withValues(alpha: 0.06),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: value,
                isExpanded: true,
                dropdownColor: AppTheme.card,
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                elevation: 3,
                itemHeight: null,
                hint: const Text(
                  'Choose type',
                  style: TextStyle(color: AppTheme.muted, fontSize: 13),
                ),
                items: [
                  for (final e in kPaymentMethods.entries)
                    DropdownMenuItem(
                      value: e.key,
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              e.value,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 13,
                                color: e.key == value ? AppTheme.accent : AppTheme.text,
                                fontWeight: e.key == value ? FontWeight.w700 : FontWeight.w400,
                              ),
                            ),
                          ),
                          if (e.key == value)
                            const Icon(Icons.check_rounded, color: AppTheme.accent, size: 15),
                        ],
                      ),
                    ),
                ],
                onChanged: onChanged,
              ),
            ),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 2),
          Text(error!, style: const TextStyle(color: AppTheme.danger, fontSize: 11)),
        ],
      ],
    );
  }
}

class _AmountField extends StatelessWidget {
  final TextEditingController controller;
  final String? error;
  final VoidCallback onChanged;

  const _AmountField({
    required this.controller,
    required this.error,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Amount', style: TextStyle(color: AppTheme.muted, fontSize: 11)),
        const SizedBox(height: 4),
        NeuPressed(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            onChanged: (_) => onChanged(),
            style: const TextStyle(color: AppTheme.heading, fontSize: 14),
            decoration: const InputDecoration(
              hintText: '0',
              border: InputBorder.none,
              isDense: true,
              contentPadding: EdgeInsets.symmetric(vertical: 10),
            ),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 2),
          Text(error!, style: const TextStyle(color: AppTheme.danger, fontSize: 11)),
        ],
      ],
    );
  }
}
