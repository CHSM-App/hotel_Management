import 'package:flutter/material.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';

/// What reception settled at the door.
class CheckInResult {
  final String? idProofType;
  final String? idProofNumber;
  final List<PaymentDraft> advanceLines;

  const CheckInResult({
    this.idProofType,
    this.idProofNumber,
    this.advanceLines = const [],
  });
}

/// Check a reservation in.
///
/// Returns null if reception backed out. Everything on it is optional, which is
/// the point: a reservation taken on this app already carries an ID proof and
/// often the whole advance, so the common case is opening this and confirming.
/// The fields are here for the reservation that arrived from somewhere else, or
/// for the guest who hands over the rest of the deposit at the counter.
///
/// The ID proof is not validated here even though the server can refuse without
/// one. Whether a stay already has an ID on file is a fact only the server
/// holds — the register row does not carry it — so guessing would either block
/// a check-in that would have worked or claim one would fail that would not.
/// The server's own refusal is shown instead.
Future<CheckInResult?> showCheckInSheet(
  BuildContext context,
  Booking booking,
) {
  return showModalBottomSheet<CheckInResult>(
    context: context,
    backgroundColor: AppTheme.bg,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppTheme.rLarge),
      ),
    ),
    builder: (_) => _CheckInSheet(booking: booking),
  );
}

class _CheckInSheet extends StatefulWidget {
  final Booking booking;

  const _CheckInSheet({required this.booking});

  @override
  State<_CheckInSheet> createState() => _CheckInSheetState();
}

class _CheckInSheetState extends State<_CheckInSheet> {
  final _idNumber = TextEditingController();
  String? _idType;

  /// Starts empty. A reservation usually paid its deposit when it was taken,
  /// so an advance row offered by default would invite a second one to be
  /// entered on top of what is already against the stay.
  final List<PaymentDraft> _lines = [];

  @override
  void dispose() {
    _idNumber.dispose();
    super.dispose();
  }

  num get _extra => sumPayments(_lines);

  /// What is still owed once anything taken at the door is counted.
  num get _remaining {
    final due = widget.booking.balanceDue - _extra;
    return due < 0 ? 0 : due;
  }

  String? get _problem => _lines.isEmpty ? null : paymentLinesError(_lines);

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;

    return Padding(
      // Clear of the keyboard: the ID number and the amount are both typed.
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppTheme.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Check in ${b.guestName ?? 'guest'}',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: AppTheme.s4),
            Text(
              'Room ${b.roomNumber ?? '—'} · '
              '${formatIsoDate(b.checkInDate)} → ${formatIsoDate(b.checkOutDate)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: AppTheme.s24),

            // ── ID proof ─────────────────────────────────────────────────
            const _Heading('ID proof'),
            const SizedBox(height: AppTheme.s4),
            const Text(
              'Only needed if none was recorded when the booking was taken.',
              style: TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
            const SizedBox(height: AppTheme.s12),
            NeuPressed(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _idType,
                  isExpanded: true,
                  dropdownColor: AppTheme.bg,
                  hint: const Text(
                    'Type of ID',
                    style: TextStyle(color: AppTheme.muted, fontSize: 14),
                  ),
                  items: [
                    for (final e in kIdProofTypes.entries)
                      DropdownMenuItem(value: e.key, child: Text(e.value)),
                  ],
                  onChanged: (v) => setState(() => _idType = v),
                ),
              ),
            ),
            if (_idType != null) ...[
              const SizedBox(height: AppTheme.s12),
              NeuField(
                controller: _idNumber,
                label: 'ID number',
                maxLength: 64,
              ),
            ],

            const SizedBox(height: AppTheme.s24),

            // ── Further advance ──────────────────────────────────────────
            const _Heading('Money taken now'),
            const SizedBox(height: AppTheme.s4),
            Text(
              (b.advanceAmount ?? 0) > 0
                  // Named so the desk is not asked to remember it: check-in
                  // adds to the deposit rather than replacing it.
                  ? '${formatPrice(b.advanceAmount)} was already taken. '
                        'Anything added here is on top of it.'
                  : 'Nothing has been taken against this stay yet.',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
            const SizedBox(height: AppTheme.s12),
            for (var i = 0; i < _lines.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTheme.s12),
                child: PaymentRow(
                  key: ValueKey(_lines[i]),
                  line: _lines[i],
                  onRemove: () => setState(() => _lines.removeAt(i)),
                  onChanged: () => setState(() {}),
                ),
              ),
            NeuButton(
              expand: true,
              onPressed: () => setState(() => _lines.add(PaymentDraft())),
              child: Text(
                _lines.isEmpty ? 'Add a payment' : 'Add another payment',
              ),
            ),

            const SizedBox(height: AppTheme.s24),
            const Divider(height: 1),
            const SizedBox(height: AppTheme.s16),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Still to pay',
                    style: TextStyle(color: AppTheme.text, fontSize: 13),
                  ),
                ),
                Text(
                  formatPrice(_remaining),
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
            if (_problem != null) ...[
              const SizedBox(height: AppTheme.s12),
              Text(
                _problem!,
                style: const TextStyle(color: AppTheme.danger, fontSize: 12),
              ),
            ],
            const SizedBox(height: AppTheme.s16),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: _problem != null ? null : _submit,
              child: const Text('Check in'),
            ),
            const SizedBox(height: AppTheme.s8),
          ],
        ),
      ),
    );
  }

  void _submit() {
    Navigator.pop(
      context,
      CheckInResult(
        idProofType: _idType,
        idProofNumber: _idNumber.text,
        // Only the rows that carry money. An empty row left open by a mistaken
        // tap is not a payment of zero.
        advanceLines: _lines.where((l) => l.value > 0).toList(),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  final String text;

  const _Heading(this.text);

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: Theme.of(context).textTheme.titleMedium,
  );
}
