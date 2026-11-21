import 'package:flutter/foundation.dart';
import 'package:pdf/pdf.dart';
import 'package:printing/printing.dart';

import '../../domain/models/printer_config.dart';
import '../../domain/models/receipt_doc.dart';
import '../../screens/printing/thermal_receipt_pdf.dart';
import 'escpos.dart';
import 'escpos_text.dart';
import 'receipt_raster.dart';
import 'print_error.dart';
import 'raw_stub.dart' if (dart.library.io) 'raw_io.dart' as raw;

export 'print_error.dart';

/// Sends a receipt to the printer the desk set up — over the Windows driver,
/// the network, or Bluetooth.
///
/// Network and Bluetooth printers get ESC/POS *text* when every character is
/// plain ASCII (a few hundred bytes, nothing to overflow a small printer's
/// buffer), and a rasterised image otherwise. The Windows driver gets a PDF.
class ThermalPrinterService {
  ThermalPrinterService._();

  static bool get windowsSupported => !kIsWeb && defaultTargetPlatform == TargetPlatform.windows;
  static bool get networkSupported => raw.tcpSupported;
  static bool get bluetoothSupported => raw.bluetoothSupported;

  /// The connection kinds this device can actually use.
  static List<PrinterTransport> get available => [
    if (windowsSupported) PrinterTransport.windows,
    if (networkSupported) PrinterTransport.network,
    if (bluetoothSupported) PrinterTransport.bluetooth,
  ];

  static Future<List<Printer>> windowsPrinters() async {
    final list = await Printing.listPrinters();
    return list.where((p) => p.isAvailable).toList();
  }

  static Future<List<BtDevice>> bluetoothDevices() => raw.bluetoothPaired();

  static bool _printing = false;

  static Future<void> print(PrinterConfig c, ReceiptDoc doc) async {
    if (!c.isSet) throw const ThermalPrintException('No printer is set up yet.');
    // A second tap while the first is still going would start a second job on
    // the same printer and print the bill twice (or tangled together).
    if (_printing) throw const ThermalPrintException('A receipt is already being printed. Wait for it to finish.');
    _printing = true;
    try {
      switch (c.transport) {
        case PrinterTransport.windows:
          final spec = ReceiptSpec(c.paper);
          // Plain text can be drawn by the PDF font; anything else is drawn by
          // the text engine and embedded as a picture.
          final pdf = _asImage(c, doc)
              ? await ThermalReceiptPdf.renderImage(await _picture(c, doc), spec)
              : await ThermalReceiptPdf.render(doc, spec);
          final ok = await Printing.directPrintPdf(
            printer: Printer(url: c.address, name: c.name),
            onLayout: (_) async => pdf,
            name: 'Receipt',
            format: PdfPageFormat(spec.pageWidth, 800, marginAll: 0),
            usePrinterSettings: true,
          );
          if (!ok) throw const ThermalPrintException('The printer did not accept the receipt.');
        case PrinterTransport.network:
          final hp = PrinterConfig.parseHostPort(c.address);
          if (hp == null) throw const ThermalPrintException('The printer address is not valid. Use an IP like 192.168.1.50 or 192.168.1.50:9100.');
          await raw.sendTcp(hp.host, hp.port, await escposBytes(c, doc));
        case PrinterTransport.bluetooth:
          await raw.sendBluetooth(c.address, await escposBytes(c, doc));
        case PrinterTransport.none:
          throw const ThermalPrintException('No printer is set up yet.');
      }
    } on ThermalPrintException {
      rethrow;
    } catch (e) {
      throw ThermalPrintException('Could not print: ${_short(e)}');
    } finally {
      _printing = false;
    }
  }

  /// Whether [doc] goes as a picture: the boxed style always does, and any
  /// style does when the text is more than plain ASCII.
  static bool _asImage(PrinterConfig c, ReceiptDoc doc) => c.style == ReceiptStyle.boxed || !doc.isAscii;

  /// The bytes a raw (network / Bluetooth) printer receives for [doc].
  static Future<Uint8List> escposBytes(PrinterConfig c, ReceiptDoc doc) async {
    if (!_asImage(c, doc)) return EscPosText.encode(doc, cols: c.paper.cols, dots: c.paper.dots, cut: c.autoCut);
    final image = await ReceiptRaster.render(doc, c.paper.dots, boxed: c.style == ReceiptStyle.boxed);
    return EscPos.raster(image.width, image.height, await ReceiptRaster.rgba(image), threshold: c.threshold, cut: c.autoCut);
  }

  static Future<({Uint8List png, int width, int height})> _picture(PrinterConfig c, ReceiptDoc doc) async {
    final image = await ReceiptRaster.render(doc, c.paper.dots, boxed: c.style == ReceiptStyle.boxed);
    return (png: await ReceiptRaster.png(image), width: image.width, height: image.height);
  }

  static String _short(Object e) {
    final s = e.toString();
    return s.length > 120 ? '${s.substring(0, 120)}…' : s;
  }
}
