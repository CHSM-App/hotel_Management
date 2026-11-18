import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/invoice.dart';
import 'package:hotel_manager/domain/repository/billing_repo.dart';
import 'package:hotel_manager/domain/usecase/billing_usecase.dart';
import 'package:hotel_manager/presentation/view_models/billing_viewmodel.dart';

/// Only what a stay settlement touches; anything else is a test mistake.
class _Repo implements BillingRepository {
  BillSettle? previewedWith;
  Map<String, dynamic>? settledBody;
  int? settledRoom;
  int issueCalls = 0;
  String mode = 'FINAL';

  @override
  Future<BillPreview> preview(
    int bookingId, {
    bool includeLateCheckout = true,
    num discountAmount = 0,
    String? discountReason,
    BillSettle? settle,
  }) async {
    previewedWith = settle;
    return BillPreview.fromJson({
      'bookingId': bookingId,
      'nights': 1,
      'advancePaid': 300,
      'isGstRegistered': true,
      'gst': {'totalAmount': 1800, 'documentType': 'TAX_INVOICE'},
      'nonGst': {'totalAmount': 1800},
      'settleMode': settle == null ? null : mode,
    });
  }

  @override
  Future<SettleResult> settle(
    int bookingId,
    Map<String, dynamic> body, {
    int? roomId,
  }) async {
    settledBody = body;
    settledRoom = roomId;
    return SettleResult(
      mode: mode,
      invoice: mode == 'ROOM' ? null : Invoice(id: 9, invoiceNumber: 'GST-1'),
    );
  }

  @override
  Future<Invoice> issue(int bookingId, Map<String, dynamic> body) async {
    issueCalls++;
    return Invoice(id: 1);
  }

  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

void main() {
  const stay = BillableStay(id: 7, guestName: 'Asha');

  Future<BillingViewModel> opened(_Repo repo, BillSettle? settle) async {
    final vm = BillingViewModel(BillingUsecase(repo));
    await vm.open(stay, settle: settle);
    // The desk records what the bill says is owed: 1800 - 300 advance.
    vm.state.payment.first
      ..method = 'CASH'
      ..amount = '1500';
    return vm;
  }

  test('a checkout bill is priced as a settlement, late charge included', () async {
    final repo = _Repo();
    await opened(repo, const BillSettle(lateCharge: 150));
    expect(repo.previewedWith?.lateCharge, 150);
  });

  test('settling uses settle-checkout, never the plain invoice', () async {
    final repo = _Repo();
    final vm = await opened(repo, const BillSettle(lateCharge: 150));

    final invoice = await vm.issue();

    expect(invoice?.invoiceNumber, 'GST-1');
    expect(repo.issueCalls, 0);
    expect(repo.settledBody?['lateCharge'], 150);
    // What the screen showed, so a bill that moved is refused, not mis-settled.
    expect(repo.settledBody?['expectedDue'], 1500);
    expect(repo.settledBody?['collectedAmount'], 1500);
    expect(repo.settledRoom, isNull);
    expect(vm.state.lastSettledBookingId, 7);
    expect(vm.state.lastSettleMode, 'FINAL');
  });

  test('one room leaving alone settles that room and returns no bill', () async {
    final repo = _Repo()..mode = 'ROOM';
    final vm = await opened(repo, const BillSettle(roomId: 12, lateCharge: 0));

    final invoice = await vm.issue();

    expect(invoice, isNull);
    expect(repo.settledRoom, 12);
    expect(vm.state.lastSettleMode, 'ROOM');
  });

  test('a bill with no settle still goes through the plain invoice call', () async {
    final repo = _Repo();
    final vm = await opened(repo, null);

    await vm.issue();

    expect(repo.issueCalls, 1);
    expect(repo.settledBody, isNull);
  });

  test('the settled-stay marker survives close() and resets on the next open', () async {
    final repo = _Repo();
    final vm = await opened(repo, const BillSettle());
    await vm.issue();

    vm.close();
    expect(vm.state.lastSettledBookingId, 7);

    await vm.open(stay);
    expect(vm.state.lastSettledBookingId, isNull);
  });
}
