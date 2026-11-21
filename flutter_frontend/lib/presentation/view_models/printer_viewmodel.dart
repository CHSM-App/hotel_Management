import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../domain/models/printer_config.dart';

/// The receipt printer this device prints to, kept across launches.
///
/// Stored on the device only: a printer belongs to the counter it sits on, so
/// it is never sent to the server or shared between devices.
class PrinterViewModel extends StateNotifier<PrinterConfig> {
  static const _key = 'RECEIPT_PRINTER';
  static const _storage = FlutterSecureStorage();

  PrinterViewModel() : super(const PrinterConfig()) {
    _load();
  }

  Future<void> _load() async {
    try {
      final saved = PrinterConfig.decode(await _storage.read(key: _key));
      if (mounted) state = saved;
    } catch (_) {
      // No storage plugin (tests, odd platforms): start with no printer.
    }
  }

  Future<void> save(PrinterConfig config) async {
    state = config;
    try {
      await _storage.write(key: _key, value: config.encode());
    } catch (_) {
      // Still usable for this session.
    }
  }

  Future<void> clear() async {
    state = const PrinterConfig();
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}
