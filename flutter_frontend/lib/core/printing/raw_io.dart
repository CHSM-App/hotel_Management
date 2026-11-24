import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import 'package:universal_ble/universal_ble.dart';

import 'print_error.dart';

/// Raw byte transports for devices that have `dart:io` — everything except the
/// web build, which gets raw_stub.dart.

bool get tcpSupported => true;
/// Android talks classic Bluetooth (SPP) to a printer paired in the phone's
/// settings; Windows talks BLE (Bluetooth Low Energy) and finds the printer by
/// scanning, as the printer must be switched on and advertising.
bool get bluetoothSupported => Platform.isAndroid || Platform.isWindows;

/// Send [bytes] to a network printer (ESC/POS over a raw TCP socket).
Future<void> sendTcp(String host, int port, Uint8List bytes) async {
  Socket socket;
  try {
    socket = await Socket.connect(host, port, timeout: const Duration(seconds: 5));
  } on SocketException {
    throw ThermalPrintException('Printer not reachable at $host:$port. Check it is on and on the same network.');
  } on TimeoutException {
    throw ThermalPrintException('Printer at $host:$port did not answer.');
  }
  try {
    socket.add(bytes);
    await socket.flush();
  } on SocketException {
    throw const ThermalPrintException('The printer dropped the connection while printing.');
  } finally {
    await socket.close();
  }
}

/// Printers already paired in the phone's Bluetooth settings.
Future<List<BtDevice>> bluetoothPaired() async {
  if (Platform.isWindows) return _bleScan();
  await _ensureBluetooth();
  final list = await PrintBluetoothThermal.pairedBluetooths;
  return [for (final d in list) BtDevice(d.name, d.macAdress)];
}

Future<void> _ensureBluetooth() async {
  if (!await PrintBluetoothThermal.isPermissionBluetoothGranted) {
    throw const ThermalPrintException('Bluetooth permission was denied. Allow it in the phone settings.');
  }
  if (!await PrintBluetoothThermal.bluetoothEnabled) {
    throw const ThermalPrintException('Bluetooth is off. Turn it on and try again.');
  }
}

/// Connect to a paired printer, write [bytes] in small chunks (the printers'
/// serial buffers are tiny), and disconnect.
Future<void> sendBluetooth(String mac, Uint8List bytes) async {
  if (Platform.isWindows) return _bleSend(mac, bytes);
  await _ensureBluetooth();
  final ok = await PrintBluetoothThermal.connect(macPrinterAddress: mac);
  if (!ok) {
    throw const ThermalPrintException('Could not connect to the Bluetooth printer. Is it on and in range?');
  }
  try {
    // ponytail: ~6 KB/s; a dropped byte inside a raster command garbles the whole
    // receipt, so favour slow. Raise if the printer copes.
    const chunk = 240;
    for (var i = 0; i < bytes.length; i += chunk) {
      final end = (i + chunk < bytes.length) ? i + chunk : bytes.length;
      // A plain List<int>: a Uint8List crosses the channel as a Java byte[],
      // which the plugin fails to cast, so raster receipts never print.
      final sent = await PrintBluetoothThermal.writeBytes(List<int>.from(bytes.sublist(i, end)));
      if (!sent) throw const ThermalPrintException('The Bluetooth printer stopped accepting data.');
      await Future<void>.delayed(const Duration(milliseconds: 40));
    }
    // Let the printer drain its buffer before the link is dropped.
    await Future<void>.delayed(const Duration(milliseconds: 500));
  } finally {
    await PrintBluetoothThermal.disconnect;
  }
}

// -- Windows: Bluetooth Low Energy ------------------------------------------

Future<void> _ensureBleOn() async {
  final AvailabilityState state;
  try {
    state = await UniversalBle.getBluetoothAvailabilityState();
  } catch (_) {
    // The plugin's native side isn't loaded: the app was started before it was
    // added (hot reload can't load native code) or this build lacks it.
    throw const ThermalPrintException(
      'Bluetooth is not available in this running copy of the app. Close it completely and start it again (a full rebuild, not a hot reload).',
    );
  }
  if (state == AvailabilityState.unsupported) {
    throw const ThermalPrintException('This PC has no Bluetooth adapter.');
  }
  if (state == AvailabilityState.poweredOff) {
    throw const ThermalPrintException('Bluetooth is off. Turn it on in Windows settings and try again.');
  }
}

/// Scan for a few seconds and return every named device heard. The printer
/// has to be switched on (and not connected to another device) to show up.
Future<List<BtDevice>> _bleScan() async {
  await _ensureBleOn();
  final found = <String, BtDevice>{};
  final sub = UniversalBle.scanStream.listen((d) {
    final name = (d.name ?? '').trim();
    if (name.isNotEmpty) found[d.deviceId] = BtDevice(name, d.deviceId);
  });
  try {
    await UniversalBle.startScan();
    await Future<void>.delayed(const Duration(seconds: 6));
  } catch (_) {
    throw const ThermalPrintException('Could not scan for Bluetooth devices. Is Bluetooth on?');
  } finally {
    await sub.cancel();
    try {
      await UniversalBle.stopScan();
    } catch (_) {}
  }
  return found.values.toList()..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
}

/// The GATT characteristic bytes are written to: a writable one, preferring the
/// services the common thermal-printer modules use, else the last service's
/// first writable one.
({String service, String characteristic, bool ack, bool noAck})? _pickWritable(List<BleService> services) {
  ({String service, String characteristic, bool ack, bool noAck})? pick;
  var preferred = false;
  for (final s in services) {
    final isPrinterService = RegExp(r'^(0000)?(18f0|ffe0|ff00|fee7|e7810a71|49535343|bef8d6c9)', caseSensitive: false).hasMatch(s.uuid);
    for (final c in s.characteristics) {
      final canWrite = c.properties.contains(CharacteristicProperty.write) || c.properties.contains(CharacteristicProperty.writeWithoutResponse);
      if (!canWrite) continue;
      if (preferred && !isPrinterService) break;
      pick = (
        service: s.uuid,
        characteristic: c.uuid,
        ack: c.properties.contains(CharacteristicProperty.write),
        noAck: c.properties.contains(CharacteristicProperty.writeWithoutResponse),
      );
      if (isPrinterService) preferred = true;
      break;
    }
  }
  return pick;
}

/// Connect, write [bytes] chunk by chunk (never larger than the MTU less the
/// 3-byte ATT header, or a cheap printer rejects it as a long write), disconnect.
Future<void> _bleSend(String deviceId, Uint8List bytes) async {
  await _ensureBleOn();
  try {
    await UniversalBle.connect(deviceId, timeout: const Duration(seconds: 15));
  } catch (_) {
    throw const ThermalPrintException('Could not connect to the Bluetooth printer. Is it on, in range and not connected to another device?');
  }
  try {
    var mtu = 23;
    try {
      mtu = await UniversalBle.requestMtu(deviceId, 512);
    } catch (_) {
      // Keep the safe default.
    }
    final chunk = (mtu - 3).clamp(20, 509);
    final target = _pickWritable(await UniversalBle.discoverServices(deviceId));
    if (target == null) {
      throw const ThermalPrintException('This Bluetooth device has no writable channel, so it is probably not a BLE printer.');
    }
    // One chunk at a time. Cheap printers have a tiny input buffer and drop
    // bytes they cannot hold; a dropped byte inside a raster command makes the
    // printer read the rest of the image as text (rows of garbage characters).
    // A write with response only returns once the printer took the chunk, so
    // prefer it; a channel that only takes writes without response is paced.
    //
    // A chunk is never sent twice once the printer may have it: when a write
    // reports an error the data can still have arrived, and resending prints
    // that part of the receipt again. Only "nothing was accepted" outcomes are
    // retried (the link was busy, or the very first chunk was too big).
    var size = chunk;
    var i = 0;
    var tries = 0;
    while (i < bytes.length) {
      final end = (i + size).clamp(0, bytes.length);
      try {
        await UniversalBle.write(
          deviceId,
          target.service,
          target.characteristic,
          Uint8List.fromList(bytes.sublist(i, end)),
          withoutResponse: !target.ack,
        );
        i = end;
        if (!target.ack) await Future<void>.delayed(const Duration(milliseconds: 30));
      } catch (e) {
        final busy = e is UniversalBleException &&
            (e.code == UniversalBleErrorCode.writeRequestBusy || e.code == UniversalBleErrorCode.operationInProgress);
        final firstChunkTooBig = i == 0 && size > 20;
        if ((!busy && !firstChunkTooBig) || ++tries > 5) {
          throw ThermalPrintException(
            'The Bluetooth printer stopped accepting data after $i of ${bytes.length} bytes: $e',
          );
        }
        if (firstChunkTooBig && !busy) size = (size ~/ 2).clamp(20, size);
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }
    }
  } on ThermalPrintException {
    rethrow;
  } catch (e) {
    throw ThermalPrintException('The Bluetooth printer stopped accepting data ($e).');
  } finally {
    try {
      await UniversalBle.disconnect(deviceId);
    } catch (_) {}
  }
}
