import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/draft.dart';
import '../../domain/models/invoice.dart';
import '../../domain/usecase/billing_usecase.dart';
// A pure formatter over intl, no widgets — the message it builds is read by
// both this class and the screen, so it is formatted once, here.
import '../../widgets/format.dart';
import 'booking_viewmodel.dart' show BookingViewModel;

/// The billing screen: the queue of unbilled stays, the bills already issued,
/// and the one bill being cut right now.
class BillingState {
  final AsyncValue<List<BillableStay>> queue;
  final AsyncValue<List<Invoice>> invoices;

  // ── The bill being cut ───────────────────────────────────────────────────
  final BillableStay? target;
  final BillPreview? preview;
  final bool previewing;
  final String? error;

  /// Whether the overstay charge reception agreed lands on this bill. Starts as
  /// yes — it was already agreed with the guest — and the person writing the
  /// bill is the one who can still take it back off.
  final bool includeLateCheckout;

  /// How the balance is being tendered. One row is the ordinary case.
  final List<PaymentDraft> payment;

  final bool issuing;

  const BillingState({
    this.queue = const AsyncValue.loading(),
    this.invoices = const AsyncValue.loading(),
    this.target,
    this.preview,
    this.previewing = false,
    this.error,
    this.includeLateCheckout = true,
    this.payment = const [],
    this.issuing = false,
  });

  BillingState copyWith({
    AsyncValue<List<BillableStay>>? queue,
    AsyncValue<List<Invoice>>? invoices,
    BillableStay? target,
    bool clearTarget = false,
    BillPreview? preview,
    bool clearPreview = false,
    bool? previewing,
    String? error,
    bool clearError = false,
    bool? includeLateCheckout,
    List<PaymentDraft>? payment,
    bool? issuing,
  }) => BillingState(
    queue: queue ?? this.queue,
    invoices: invoices ?? this.invoices,
    target: clearTarget ? null : (target ?? this.target),
    preview: clearPreview ? null : (preview ?? this.preview),
    previewing: previewing ?? this.previewing,
    error: clearError ? null : (error ?? this.error),
    includeLateCheckout: includeLateCheckout ?? this.includeLateCheckout,
    payment: payment ?? this.payment,
    issuing: issuing ?? this.issuing,
  );

  /// What the guest owes on the bill as it currently stands.
  num get balanceDue => preview?.balanceDue ?? 0;

  /// What the rows add up to.
  num get collected => sumPayments(payment.where((p) => p.value > 0).toList());

  /// Whether the money entered matches what is owed.
  ///
  /// Compared in paise rather than as floats: 600 + 900.10 is
  /// 1500.0999999999999 in binary floating point, and a settlement refused for
  /// a rounding artefact is worse than one that adds up.
  bool get settles => (collected * 100).round() == (balanceDue * 100).round();

  /// The message to show, or null when the bill may be issued.
  ///
  /// The balance due is fixed — it is what the stay costs, and nothing typed
  /// into the payment rows moves it. A bill cannot be cut until the money
  /// recorded equals it.
  String? get settlementProblem {
    if (preview == null) return null;
    final rows = payment.where((p) => p.value > 0).toList();
    if (rows.isNotEmpty) {
      final problem = paymentLinesError(rows);
      if (problem != null) return problem;
    }
    if (settles) return null;
    final short = ((balanceDue - collected) * 100).round() / 100;
    // Through the money formatter, not interpolated. A num that happens to be
    // a double renders as "500.0", and "₹500.0 of the balance is still
    // unaccounted for" is not a sentence anyone should be shown.
    return short > 0
        ? '${formatPrice(short)} of the balance is still unaccounted for.'
        : 'That is ${formatPrice(-short)} more than the balance due.';
  }
}

class BillingViewModel extends StateNotifier<BillingState> {
  final BillingUsecase usecase;

  BillingViewModel(this.usecase) : super(const BillingState());

  /// Load the queue and the bills already issued.
  Future<void> load() async {
    state = state.copyWith(clearError: true);
    try {
      final rows = await usecase.queue();
      state = state.copyWith(queue: AsyncValue.data(rows));
    } catch (e, st) {
      state = state.copyWith(queue: AsyncValue.error(e, st));
    }
    try {
      final rows = await usecase.invoices();
      state = state.copyWith(invoices: AsyncValue.data(rows));
    } catch (e, st) {
      state = state.copyWith(invoices: AsyncValue.error(e, st));
    }
  }

  /// Open a stay for billing.
  Future<void> open(BillableStay stay) async {
    state = state.copyWith(
      target: stay,
      clearPreview: true,
      clearError: true,
      includeLateCheckout: true,
      // Pre-filled with the balance due, so an ordinary bill is one dropdown
      // and nothing else. The desk collects exactly what is owed on almost
      // every bill.
      payment: [PaymentDraft()],
    );
    await refreshPreview();
  }

  void close() => state = state.copyWith(
    clearTarget: true,
    clearPreview: true,
    clearError: true,
    payment: const [],
  );

  /// Re-price. Only the overstay decision moves this — adding that charge can
  /// push a night into a different GST band and change the rounding, so the
  /// whole document is re-derived rather than adjusted here.
  Future<void> refreshPreview() async {
    final stay = state.target;
    if (stay == null) return;

    state = state.copyWith(previewing: true, clearError: true);
    try {
      final preview = await usecase.preview(
        stay.id,
        includeLateCheckout: state.includeLateCheckout,
      );
      final rows = state.payment.isEmpty
          ? <PaymentDraft>[PaymentDraft()]
          : state.payment;
      // Seed the single untouched row with the balance due. Only while the
      // desk has not typed anything, or a refetch would overwrite what is
      // being entered.
      if (rows.length == 1 && rows.first.amount.trim().isEmpty) {
        rows.first.amount = preview.balanceDue > 0
            ? '${preview.balanceDue}'
            : '';
      }
      state = state.copyWith(
        previewing: false,
        preview: preview,
        payment: List.of(rows),
      );
    } catch (e) {
      state = state.copyWith(
        previewing: false,
        error: BookingViewModel.messageFor(e),
      );
    }
  }

  Future<void> setLateCheckout(bool include) async {
    state = state.copyWith(includeLateCheckout: include);
    await refreshPreview();
  }

  void addPaymentRow() =>
      state = state.copyWith(payment: [...state.payment, PaymentDraft()]);

  void removePaymentRow(int index) {
    final next = List.of(state.payment)..removeAt(index);
    state = state.copyWith(payment: next);
  }

  /// Nudge listeners after a row is edited in place.
  void touch() => state = state.copyWith(payment: List.of(state.payment));

  /// Cut the bill.
  ///
  /// Returns the invoice on success, null on failure with the error set.
  /// Guarded against a second tap: this burns a serial and there is no undo,
  /// only a void.
  Future<Invoice?> issue() async {
    final stay = state.target;
    final preview = state.preview;
    if (stay == null || preview == null || state.issuing) return null;

    final problem = state.settlementProblem;
    if (problem != null) {
      state = state.copyWith(error: problem);
      return null;
    }

    state = state.copyWith(issuing: true, clearError: true);
    try {
      final rows = state.payment.where((p) => p.value > 0).toList();
      final invoice = await usecase.issue(stay.id, {
        'billingSide': preview.billingSide,
        // What the server itself worked out, read back off the preview rather
        // than recomputed — the two must not be able to disagree.
        'discountAmount': preview.amounts?.discountAmount ?? 0,
        'includeLateCheckout': state.includeLateCheckout,
        'collectedAmount': state.collected,
        if (rows.isNotEmpty) ...{
          'paymentMethod': rows.first.method,
          if (needsPaymentReference(rows.first.method) &&
              rows.first.reference.trim().isNotEmpty)
            'paymentReference': rows.first.reference.trim(),
          // Only on a real split; one row is what the server already
          // synthesises from the method above.
          if (rows.length > 1)
            'paymentLines': rows.map((r) => r.toJson()).toList(),
        },
      });
      state = state.copyWith(issuing: false);
      // Deliberately not reloading here.
      //
      // The screen that opened this one refreshes both lists as soon as it is
      // returned to, so doing it here as well was the same two calls twice —
      // and because it was awaited, the bill page sat on screen for the length
      // of them before closing. The desk had already finished with it.
      return invoice;
    } catch (e) {
      state = state.copyWith(
        issuing: false,
        error: BookingViewModel.messageFor(e),
      );
      return null;
    }
  }

  /// Cancel a bill that should not have been issued.
  Future<bool> voidInvoice(int id, String reason) async {
    try {
      await usecase.voidInvoice(id, reason);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: BookingViewModel.messageFor(e));
      return false;
    }
  }
}
