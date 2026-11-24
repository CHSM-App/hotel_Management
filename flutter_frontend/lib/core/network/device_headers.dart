import 'dart:io';
import 'dart:math';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// Who-is-this-device headers the server writes into the booking edit log.
///
/// The id is a random value kept in a file in the app's support folder, not in
/// secure storage: sign-out wipes that, and one device should keep one id.
/// Resolved once; a failure just means the edit is logged without a device.
class DeviceHeaders {
  static Future<Map<String, String>>? _cached;

  static Future<Map<String, String>> get() => _cached ??= _build();

  static Future<Map<String, String>> _build() async {
    try {
      final info = await PackageInfo.fromPlatform();
      return {
        'X-Device-Id': await _id(),
        'X-Device-Info':
            '${Platform.operatingSystem} ${Platform.operatingSystemVersion} | '
            'app ${info.version}+${info.buildNumber}',
      };
    } catch (_) {
      return const {};
    }
  }

  static Future<String> _id() async {
    final file = File('${(await getApplicationSupportDirectory()).path}/device_id');
    if (await file.exists()) {
      final v = (await file.readAsString()).trim();
      if (v.isNotEmpty) return v;
    }
    final rnd = Random.secure();
    final id = List.generate(16, (_) => rnd.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    await file.writeAsString(id);
    return id;
  }
}
