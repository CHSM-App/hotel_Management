import 'package:flutter/material.dart';

import '../domain/models/draft.dart';
import '../screens/theme.dart';
import 'neu.dart';

/// One line of a payment: how it arrived, how much, and its trail.
///
/// Shared rather than owned by the booking form, because money arrives at more
/// than one moment in a stay — a deposit when the booking is taken, a further
/// advance at the door on check-in — and each is the same split-tender question
/// asked again. Keeping one control means the optional reference field is
/// offered the same way in both places rather than only in the screen
/// somebody remembered.
class PaymentRow extends StatefulWidget {
  final PaymentDraft line;

  /// Null disables the delete button rather than hiding it, so a single row
  /// does not change the shape of the ones below it.
  final VoidCallback? onRemove;

  final VoidCallback onChanged;

  /// Method and amount side by side on one line, for screens where the rows
  /// share the page with a lot else.
  final bool compact;

  /// Labelled "Payment type" and "Amount" boxes side by side with the delete
  /// button at the end — the booking form's advance rows.
  final bool inline;

  /// Fired only when the person types in the amount box.
  final VoidCallback? onAmountEdited;

  /// Inline rows: labels only on the first row of a list, so a split
  /// payment reads as one table rather than repeated captions.
  final bool showLabels;

  const PaymentRow({
    super.key,
    this.inline = false,
    this.onAmountEdited,
    this.showLabels = true,
    required this.line,
    required this.onRemove,
    required this.onChanged,
    this.compact = false,
  });

  @override
  State<PaymentRow> createState() => _PaymentRowState();
}

class _PaymentRowState extends State<PaymentRow> {
  late final _amount = TextEditingController(text: widget.line.amount);
  late final _reference = TextEditingController(text: widget.line.reference);

  @override
  void didUpdateWidget(covariant PaymentRow old) {
    super.didUpdateWidget(old);
    if (_amount.text != widget.line.amount) _amount.text = widget.line.amount;
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  /// A distinct mark per method so the closed field and the open menu read
  /// at a glance rather than by the label text alone.
  static IconData _iconFor(String method) => switch (method) {
        'CASH' => Icons.payments_outlined,
        'UPI' => Icons.qr_code_scanner_rounded,
        'CARD' => Icons.credit_card_rounded,
        _ => Icons.account_balance_wallet_outlined,
      };

  Widget _methodDropdown() {
    final fs = RoomyForm.fs(context, 13);
    return SizedBox(
      height: RoomyForm.height(context, widget.compact ? 40 : 44),
      child: NeuPressed(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: widget.line.method,
            isExpanded: true,
            isDense: true,
            icon: const Icon(
              Icons.keyboard_arrow_down_rounded,
              color: AppTheme.muted,
              size: 20,
            ),
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            elevation: 6,
            dropdownColor: AppTheme.card,
            hint: const Text(
              'Choose one',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: AppTheme.muted, fontSize: 13),
            ),
            // A compact icon + label once closed — the fuller row below is
            // only worth the width while the menu is open.
            selectedItemBuilder: (context) => [
              for (final e in kPaymentMethods.entries)
                Row(
                  children: [
                    Icon(_iconFor(e.key), size: 16, color: AppTheme.accent),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: Text(
                        e.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        softWrap: false,
                        style: TextStyle(
                          fontSize: fs,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.heading,
                        ),
                      ),
                    ),
                  ],
                ),
            ],
            items: [
              for (final e in kPaymentMethods.entries)
                DropdownMenuItem(
                  value: e.key,
                  child: Row(
                    children: [
                      Container(
                        width: 26,
                        height: 26,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppTheme.accent.withValues(alpha: 0.10),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(_iconFor(e.key), size: 14, color: AppTheme.accent),
                      ),
                      const SizedBox(width: AppTheme.s12),
                      Text(
                        e.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        softWrap: false,
                        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                ),
            ],
            onChanged: (m) {
              setState(() => widget.line.method = m);
              widget.onChanged();
            },
          ),
        ),
      ),
    );
  }

  Widget _compactBuild() {
    return Column(
      children: [
        Row(
          children: [
            Expanded(flex: 5, child: _methodDropdown()),
            const SizedBox(width: 6),
            Expanded(
              flex: 4,
              child: SizedBox(
                height: 40,
                child: NeuPressed(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                  child: Center(
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
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                      decoration: const InputDecoration(
                        prefixText: '₹ ',
                        prefixStyle: TextStyle(color: AppTheme.muted, fontSize: 13),
                        hintText: '0',
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            SizedBox(
              height: 36,
              width: 32,
              child: IconButton(
                icon: const Icon(Icons.close_rounded, size: 18),
                color: widget.onRemove == null
                    ? AppTheme.muted.withValues(alpha: 0.35)
                    : AppTheme.danger,
                onPressed: widget.onRemove,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ),
          ],
        ),
        if (needsPaymentReference(widget.line.method)) ...[
          const SizedBox(height: 6),
          NeuField(
            controller: _reference,
            label: 'Transaction number (optional)',
            hint: widget.line.method == 'UPI' ? 'UPI reference / UTR' : 'Approval code',
            maxLength: 64,
            dense: true,
            onChanged: (v) => widget.line.reference = v,
          ),
        ],
      ],
    );
  }

  Widget _label(String text) => Padding(
    padding: EdgeInsets.only(bottom: RoomyForm.on(context) ? 6 : AppTheme.s4),
    child: Text(
      text,
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
        color: AppTheme.heading,
        fontWeight: FontWeight.w700,
        fontSize: RoomyForm.on(context) ? 13.5 : null,
      ),
    ),
  );

  Widget _amountBox({TextAlign align = TextAlign.left}) => SizedBox(
    height: RoomyForm.height(context, 44),
    width: double.infinity,
    child: NeuPressed(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      child: Center(
        child: TextField(
          controller: _amount,
          keyboardType: TextInputType.number,
          textAlign: align,
          onTap: () => _amount.selection = TextSelection(
            baseOffset: 0,
            extentOffset: _amount.text.length,
          ),
          onChanged: (v) {
            widget.line.amount = v;
            widget.onAmountEdited?.call();
            widget.onChanged();
          },
          style: TextStyle(
            color: AppTheme.heading,
            fontSize: RoomyForm.fs(context, 13),
          ),
          decoration: const InputDecoration(
            hintText: '0',
            border: InputBorder.none,
            isDense: true,
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ),
    ),
  );

  Widget _inlineBuild() {
    return Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 5,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (widget.showLabels) _label('Payment type'),
                  _methodDropdown(),
                ],
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              flex: 4,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (widget.showLabels) _label('Amount'),
                  _amountBox(),
                ],
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            // Level with the boxes, below the label line.
            Padding(
              padding: EdgeInsets.only(top: widget.showLabels ? 22 : 0),
              child: SizedBox(
                height: RoomyForm.height(context, 44),
                width: 36,
                child: IconButton(
                  icon: const Icon(Icons.delete_outline, size: 20),
                  color: widget.onRemove == null
                      ? AppTheme.muted.withValues(alpha: 0.4)
                      : AppTheme.danger,
                  tooltip: 'Remove payment',
                  onPressed: widget.onRemove,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ),
            ),
          ],
        ),
        if (needsPaymentReference(widget.line.method)) ...[
          const SizedBox(height: AppTheme.s8),
          NeuField(
            controller: _reference,
            label: 'Transaction number (optional)',
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

  @override
  Widget build(BuildContext context) {
    if (widget.compact) return _compactBuild();
    if (widget.inline) return _inlineBuild();
    return Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(child: _methodDropdown()),
            const SizedBox(width: AppTheme.s8),
            SizedBox(
              height: 36,
              width: 36,
              child: IconButton(
                icon: const Icon(Icons.delete_outline, size: 20),
                color: widget.onRemove == null
                    ? AppTheme.muted.withValues(alpha: 0.4)
                    : AppTheme.danger,
                onPressed: widget.onRemove,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        SizedBox(
          height: RoomyForm.height(context, 44),
          width: double.infinity,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: Center(
              child: TextField(
                controller: _amount,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.left,
                onTap: () => _amount.selection = TextSelection(
                  baseOffset: 0,
                  extentOffset: _amount.text.length,
                ),
                onChanged: (v) {
                  widget.line.amount = v;
                  widget.onChanged();
                },
                style: TextStyle(
                  color: AppTheme.heading,
                  fontSize: RoomyForm.fs(context, 13),
                ),
                decoration: const InputDecoration(
                  hintText: '0',
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ),
          ),
        ),
        // Only for money that left a trail — asking for a reference against
        // cash is asking for one to be invented.
        if (needsPaymentReference(widget.line.method)) ...[
          const SizedBox(height: AppTheme.s8),
          NeuField(
            controller: _reference,
            label: 'Transaction number (optional)',
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
