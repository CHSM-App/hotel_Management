import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/update/updater.dart';

void main() {
  test('isNewer compares versions and rejects junk', () {
    expect(isNewer('1.0.4', '1.0.3'), isTrue);
    expect(isNewer('1.10.0', '1.9.9'), isTrue);
    expect(isNewer('v2.0', '1.9.9+4'), isTrue);
    expect(isNewer('1.0.3', '1.0.3'), isFalse);
    expect(isNewer('1.0.2', '1.0.3'), isFalse);
    expect(isNewer('', '1.0.3'), isFalse);
    expect(isNewer('abc', '1.0.3'), isFalse);
  });
}
