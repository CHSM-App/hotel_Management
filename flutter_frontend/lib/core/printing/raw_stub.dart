import 'dart:typed_data';

import 'print_error.dart';

/// The web build has no sockets or Bluetooth; only the system print dialog.

bool get tcpSupported => false;
bool get bluetoothSupported => false;

const _no = ThermalPrintException('Direct thermal printing is not available in the browser. Use Print instead.');

Future<void> sendTcp(String host, int port, Uint8List bytes) async => throw _no;

Future<List<BtDevice>> bluetoothPaired() async => throw _no;

Future<void> sendBluetooth(String mac, Uint8List bytes) async => throw _no;
