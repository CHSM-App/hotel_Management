import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/bar.dart';
import 'package:hotel_manager/domain/models/me.dart';
import 'package:hotel_manager/screens/bar/bar_bill_pdf.dart';
import 'package:hotel_manager/screens/shell/feature.dart';

Me _me({required List<String> perms, bool hasBar = true, bool servesFood = false}) => Me.fromJson({
  'user': {'id': '1', 'name': 'T', 'role': 'STAFF', 'permissions': perms},
  'lodge': {'id': '2', 'name': 'Lodge', 'hasBar': hasBar, 'servesFood': servesFood, 'barTaxPercent': '18.00'},
});

List<String> _keys(Me me) => kFeatures.where((f) => f.availableTo(me)).map((f) => f.key).toList();

void main() {
  group('models', () {
    test('product reads string ids, stock view and low flag', () {
      final p = BarProduct.fromJson({
        'id': '7',
        'categoryId': '3',
        'name': 'Whisky',
        'bottleMl': 750,
        'stockMl': 2000,
        'bottles': 2,
        'looseMl': 500,
        'isLow': true,
        'sizes': [
          {'id': '9', 'label': '60 ml', 'ml': 60, 'price': '150.00'},
        ],
      });
      expect(p.id, 7);
      expect(p.categoryId, 3);
      expect(p.stockText, '2 btl + 500 ml');
      expect(p.isLow, isTrue);
      expect(p.sizes.single.price, 150.0);
    });

    test('stock text covers empty, loose-only and whole bottles', () {
      expect(barStockText(0, 0), '0 ml');
      expect(barStockText(0, 90), '90 ml');
      expect(barStockText(3, 0), '3 btl');
    });

    test('order reads drinks, dishes and delivery state', () {
      final o = BarOrder.fromJson({
        'id': '5',
        'orderNumber': 12,
        'source': 'TABLE',
        'tableLabel': 'T4',
        'status': 'OPEN',
        'subtotal': 450,
        'undelivered': 1,
        'readyToBill': false,
        'items': [
          {'id': '1', 'name': 'Beer', 'size': '650 ml', 'quantity': 2, 'lineTotal': 400, 'deliveredAt': '2026-01-01'},
        ],
        'foodItems': [
          {'id': '2', 'foodOrderId': '8', 'name': 'Fries', 'quantity': 1, 'lineTotal': 50, 'kitchenStatus': 'READY'},
        ],
      });
      expect(o.label, 'Table T4');
      expect(o.items.single.delivered, isTrue);
      expect(o.foodItems.single.ready, isTrue);
      expect(o.foodItems.single.foodOrderId, 8);
    });

    test('sales report folds payments and room-bill totals', () {
      final s = BarSales.fromJson({
        'from': '2026-01-01',
        'to': '2026-01-31',
        'bills': 3,
        'total': 1000,
        'onRoomBill': {'invoices': 1, 'total': 200},
        'byPayment': [
          {'method': 'CASH', 'amount': 600},
        ],
        'byDay': [
          {'date': '2026-01-02T00:00:00.000Z', 'bills': 2, 'total': 800},
        ],
      });
      expect(s.roomTotal, 200);
      expect(s.byPayment['CASH'], 600);
      expect(s.byDay.single.date, '2026-01-02');
    });
  });

  group('shell gating', () {
    test('bar.take reaches Bar orders but not Menu & Stock', () {
      final keys = _keys(_me(perms: ['bar.take']));
      expect(keys, contains('bar'));
      expect(keys, isNot(contains('barMenu')));
    });

    test('bar.manage reaches Menu & Stock', () {
      expect(_keys(_me(perms: ['bar.manage'])), contains('barMenu'));
    });

    test('a lodge without a bar shows nothing', () {
      final keys = _keys(_me(perms: ['bar.take', 'bar.manage', 'bar.bill'], hasBar: false));
      expect(keys, isNot(contains('bar')));
      expect(keys, isNot(contains('barMenu')));
    });

    test('bar.report alone earns the sales reports row', () {
      expect(_keys(_me(perms: ['bar.report'])), contains('report-sales'));
    });

    test('lodge parses the bar flag and tax', () {
      final me = _me(perms: const []);
      expect(me.lodge.hasBar, isTrue);
      expect(me.lodge.barTaxPercent, 18.0);
    });
  });

  test('bill pdf builds', () async {
    const bill = BarBill(
      id: 1,
      billNumber: '1',
      total: 300,
      drinksSubtotal: 300,
      taxPercent: 18,
      items: [BarBillLine(kind: 'DRINK', name: 'Beer', size: '650 ml', unitPrice: 150, quantity: 2, lineTotal: 300)],
      payments: [BarPayment(method: 'CASH', amount: 300)],
    );
    final bytes = await BarBillPdf.build(bill, lodgeName: 'Lodge');
    expect(bytes.length, greaterThan(500));
  });
}
