import 'package:flutter/material.dart';

import '../domain/models/draft.dart';
import '../screens/theme.dart';
import 'neu.dart';

/// One line of a payment: how it arrived, how much, and its trail.
///
/// Shared rather than owned by the booking form, because money arrives at more
/// than one moment in a stay — a deposit when the booking is taken, a further
/// advance at the door on check-in — and each is the same split-tender question
/// asked again. Keeping one control means a reference stays mandatory on UPI in
/// both places rather than only in the screen somebody remembered.
class PaymentRow extends StatefulWidget {
  final PaymentDraft line;

  /// Null disables the delete button rather than hiding it, so a single row
  /// does not change the shape of the ones below it.
  final VoidCallback? onRemove;

  final VoidCallback onChanged;

  const PaymentRow({
    super.key,
    required this.line,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  State<PaymentRow> createState() => _PaymentRowState();
}

class _PaymentRowState extends State<PaymentRow> {
  late final _amount = TextEditingController(text: widget.line.amount);
  late final _reference = TextEditingController(text: widget.line.reference);

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: NeuPressed(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: widget.line.method,
                    isExpanded: true,
                    dropdownColor: AppTheme.bg,
                    hint: const Text(
                      'Choose one',
                      style: TextStyle(color: AppTheme.muted, fontSize: 14),
                    ),
                    items: [
                      for (final e in kPaymentMethods.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (m) {
                      setState(() => widget.line.method = m);
                      widget.onChanged();
                    },
                  ),
                ),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            SizedBox(
              width: 96,
              child: NeuPressed(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                child: TextField(
                  controller: _amount,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.right,
                  onTap: () => _amount.selection = TextSelection(
                    baseOffset: 0,
                    extentOffset: _amount.text.length,
                  ),
                  onChanged: (v) {
                    widget.line.amount = v;
                    widget.onChanged();
                  },
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 13,
                  ),
                  decoration: const InputDecoration(
                    hintText: '0',
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20),
              color: widget.onRemove == null
                  ? AppTheme.muted.withValues(alpha: 0.4)
                  : AppTheme.danger,
              onPressed: widget.onRemove,
            ),
          ],
        ),
        // Only for money that left a trail — asking for a reference against
        // cash is asking for one to be invented.
        if (needsPaymentReference(widget.line.method)) ...[
          const SizedBox(height: AppTheme.s8),
          NeuField(
            controller: _reference,
            label: 'Transaction number',
            hint: widget.line.method == 'UPI'
                ? 'UPI reference / UTR'
                : 'Approval code',
            maxLength: 64,
            onChanged: (v) => widget.line.reference = v,
          ),
        ],
      ],
    );
  }
}
