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

  /// Whether the desk has actually edited a payment row — chosen a method,
  /// typed an amount, added or removed a row. Until then the single row
  /// keeps tracking the balance due as it moves (a discount typed after the
  /// row was seeded must still land in it), the same way the web screen's
  /// own row stays derived from the balance until the desk touches it.
  final bool paymentTouched;

  final bool issuing;

  /// A discount the desk gives on a CYCLE stay, in rupees, as typed. Kept as
  /// the typed string; the server caps the amount and solves the document.
  /// Empty means nothing off — the bill prices every night that was booked.
  final String discountInput;

  /// The reason printed beside the discount on the bill.
  final String discountReason;

  const BillingState({
    this.queue = const AsyncValue.loading(),
    this.invoices = const AsyncValue.loading(),
    this.target,
    this.preview,
    this.previewing = false,
    this.error,
    this.includeLateCheckout = true,
    this.payment = const [],
    this.paymentTouched = false,
    this.issuing = false,
    this.discountInput = '',
    this.discountReason = '',
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
    bool? paymentTouched,
    bool? issuing,
    String? discountInput,
    String? discountReason,
  }) => BillingState(
    queue: queue ?? this.queue,
    invoices: invoices ?? this.invoices,
    target: clearTarget ? null : (target ?? this.target),
    preview: clearPreview ? null : (preview ?? this.preview),
    previewing: previewing ?? this.previewing,
    error: clearError ? null : (error ?? this.error),
    includeLateCheckout: includeLateCheckout ?? this.includeLateCheckout,
    payment: payment ?? this.payment,
    paymentTouched: paymentTouched ?? this.paymentTouched,
    issuing: issuing ?? this.issuing,
    discountInput: discountInput ?? this.discountInput,
    discountReason: discountReason ?? this.discountReason,
  );

  /// Only a cycle property discounts here: on the other two modes the bill is
  /// what the stay costs and any concession is settled through what the
  /// guest hands over.
  bool get isCycleStay => preview?.checkinMode == 'CYCLE';

  /// The typed discount, as money. Never sent as a percentage — the server
  /// re-derives that, so the two can't disagree on the document.
  num get cycleDiscount => num.tryParse(discountInput) ?? 0;

  /// What the guest owes on the bill as it currently stands.
  num get balanceDue => preview?.balanceDue ?? 0;

  /// A stay paid in full up front. The bill still has to be issued — it is
  /// the tax document — but there is no money changing hands at the desk, so
  /// nothing about a payment is asked for: no rows, no method.
  bool get nothingDue => (balanceDue * 100).round() <= 0;

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
    // Nothing to reconcile against when the advance already covers the bill
    // — there is no payment to enter, so there is nothing to be wrong.
    if (nothingDue) return null;
    final rows = payment.where((p) => p.value > 0).toList();
    if (rows.isNotEmpty) {
      // Worded the way the web screen's own rows are — one row missing its
      // method reads as the whole payment being unset, and a split missing
      // one reads as the part of it that still needs an answer.
      if (rows.any((p) => p.method == null)) {
        return rows.length == 1
            ? 'Choose how the guest paid to issue this bill.'
            : 'Choose how each part was paid to issue this bill.';
      }
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
      paymentTouched: false,
      discountInput: '',
      discountReason: '',
    );
    await refreshPreview();
  }

  void close() => state = state.copyWith(
    clearTarget: true,
    clearPreview: true,
    clearError: true,
    payment: const [],
    paymentTouched: false,
    discountInput: '',
    discountReason: '',
  );

  /// Re-price. Only the overstay decision and the discount move this — adding
  /// the overstay charge can push a night into a different GST band and
  /// change the rounding, and a discount changes what the tax is charged on,
  /// so the whole document is re-derived rather than adjusted here.
  Future<void> refreshPreview() async {
    final stay = state.target;
    if (stay == null) return;

    state = state.copyWith(previewing: true, clearError: true);
    try {
      final preview = await usecase.preview(
        stay.id,
        includeLateCheckout: state.includeLateCheckout,
        discountAmount: state.cycleDiscount,
        discountReason: state.discountReason,
      );
      final rows = state.payment.isEmpty
          ? <PaymentDraft>[PaymentDraft()]
          : state.payment;
      // Keep the single untouched row tracking the balance due. Only while
      // the desk has not actually edited a row — a discount typed after the
      // row was first seeded must still move it, the same way the web
      // screen's own row stays derived from the balance until touched.
      if (rows.length == 1 && !state.paymentTouched) {
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

  /// Set the discount amount and re-price. Clearing it also clears the
  /// reason — an empty amount is charging in full, and a reason with no
  /// discount behind it would print beside nothing.
  Future<void> setDiscount(String amount) async {
    state = state.copyWith(
      discountInput: amount,
      discountReason: amount.trim().isEmpty ? '' : state.discountReason,
    );
    await refreshPreview();
  }

  Future<void> setDiscountReason(String reason) async {
    state = state.copyWith(discountReason: reason);
    await refreshPreview();
  }

  void addPaymentRow() => state = state.copyWith(
    payment: [...state.payment, PaymentDraft()],
    paymentTouched: true,
  );

  void removePaymentRow(int index) {
    final next = List.of(state.payment)..removeAt(index);
    state = state.copyWith(payment: next, paymentTouched: true);
  }

  /// Nudge listeners after a row is edited in place — a method chosen, an
  /// amount typed. Marks the row as the desk's own from here on, so a
  /// discount added afterwards no longer overwrites what was typed.
  void touch() => state = state.copyWith(
    payment: List.of(state.payment),
    paymentTouched: true,
  );

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
        if (state.cycleDiscount > 0 && state.discountReason.trim().isNotEmpty)
          'discountReason': state.discountReason.trim(),
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
