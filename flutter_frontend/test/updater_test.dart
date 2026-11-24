import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/update/updater.dart';

void main() {
  test('isNewer compares numerically, tolerates v/+build', () {
    expect(isNewer('1.0.10', '1.0.9'), isTrue);
    expect(isNewer('v1.1', '1.0.9+10'), isTrue);
    expect(isNewer('1.0.9', '1.0.9'), isFalse);
    expect(isNewer('1.0.8', '1.0.9'), isFalse);
    expect(isNewer('garbage', '1.0.9'), isFalse);
    expect(isNewer('1.10.0', '1.9.9'), isTrue);
    expect(isNewer('v2.0', '1.9.9+4'), isTrue);
    expect(isNewer('', '1.0.3'), isFalse);
  });

  test('parseManifest: only a newer, complete manifest prompts', () {
    final ok = parseManifest(
        {'version': '1.0.10', 'url': 'https://x/s.exe', 'force': true, 'message': 'hi'}, '1.0.9')!;
    expect(ok.force, isTrue);
    expect(ok.message, 'hi');
    expect(ok.current, '1.0.9');
    expect(parseManifest({'version': '1.0.9', 'url': 'u'}, '1.0.9'), isNull);
    expect(parseManifest({'version': '2.0.0'}, '1.0.9'), isNull); // no url
    expect(parseManifest('not a map', '1.0.9'), isNull);
    expect(parseManifest(null, '1.0.9'), isNull);
    // GitHub serves octet-stream, so the body arrives as a raw JSON string.
    expect(parseManifest('{"version":"1.0.11","url":"https://x/s.exe"}', '1.0.10'), isNotNull);
    expect(parseManifest('{not json', '1.0.10'), isNull);
  });
}
