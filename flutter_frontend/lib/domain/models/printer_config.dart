import 'dart:convert';

/// How the receipt printer is reached.
enum PrinterTransport { none, windows, network, bluetooth }

/// How a bill is laid out on the roll.
///
/// [boxed] is a bordered receipt with a ruled Item / Qty / Price / Total table,
/// drawn as a picture. [plain] is plain text lines, which a printer prints
/// itself: much less data, so faster, but no borders.
enum ReceiptStyle { boxed, plain }

/// Roll width. [dots] is the printable width in printer dots at 203 dpi
/// (72mm of an 80mm roll, 48mm of a 58mm one).
enum ThermalPaper {
  mm58(58, 384, 32),
  mm80(80, 576, 48);

  final int mm;
  final int dots;

  /// Characters per line in the printer's normal font — what text mode wraps to.
  final int cols;
  const ThermalPaper(this.mm, this.dots, this.cols);

  String get label => '${mm}mm';
}

/// The receipt printer one device prints to. Per device, never synced: a
/// printer belongs to the counter it sits on, not to the lodge.
class PrinterConfig {
  final PrinterTransport transport;

  /// Display name — the Windows printer, the Bluetooth device, or what the
  /// desk called the network printer.
  final String name;

  /// Windows: the printer's url. Network: `host` or `host:port`. Bluetooth:
  /// the device MAC address.
  final String address;
  final ThermalPaper paper;
  final bool autoCut;

  /// 1-255. A pixel darker than this prints. Plain 128 suits text (dithering
  /// fuzzes thin strokes); raise it for faint receipts.
  final int threshold;
  final ReceiptStyle style;

  const PrinterConfig({
    this.transport = PrinterTransport.none,
    this.name = '',
    this.address = '',
    this.paper = ThermalPaper.mm80,
    this.autoCut = true,
    this.threshold = 128,
    this.style = ReceiptStyle.boxed,
  });

  bool get isSet => transport != PrinterTransport.none && address.trim().isNotEmpty;

  /// Short label for status chips: "Counter printer · 80mm".
  String get summary => '${name.isEmpty ? address : name} · ${paper.label}';

  PrinterConfig copyWith({
    PrinterTransport? transport,
    String? name,
    String? address,
    ThermalPaper? paper,
    bool? autoCut,
    int? threshold,
    ReceiptStyle? style,
  }) => PrinterConfig(
    transport: transport ?? this.transport,
    name: name ?? this.name,
    address: address ?? this.address,
    paper: paper ?? this.paper,
    autoCut: autoCut ?? this.autoCut,
    threshold: threshold ?? this.threshold,
    style: style ?? this.style,
  );

  Map<String, dynamic> toJson() => {
    'transport': transport.name,
    'name': name,
    'address': address,
    'paper': paper.name,
    'autoCut': autoCut,
    'threshold': threshold,
    'style': style.name,
  };

  factory PrinterConfig.fromJson(Map<String, dynamic> j) => PrinterConfig(
    transport: PrinterTransport.values.firstWhere(
      (t) => t.name == j['transport'],
      orElse: () => PrinterTransport.none,
    ),
    name: j['name']?.toString() ?? '',
    address: j['address']?.toString() ?? '',
    paper: ThermalPaper.values.firstWhere(
      (p) => p.name == j['paper'],
      orElse: () => ThermalPaper.mm80,
    ),
    autoCut: j['autoCut'] is bool ? j['autoCut'] as bool : true,
    style: ReceiptStyle.values.firstWhere(
      (s) => s.name == j['style'],
      orElse: () => ReceiptStyle.boxed,
    ),
    threshold: (j['threshold'] is num ? (j['threshold'] as num).toInt() : 128).clamp(1, 255),
  );

  String encode() => jsonEncode(toJson());

  static PrinterConfig decode(String? raw) {
    if (raw == null || raw.isEmpty) return const PrinterConfig();
    try {
      return PrinterConfig.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return const PrinterConfig();
    }
  }

  /// Splits a network address into host and port (default 9100). Null when it
  /// is not a usable `host` / `host:port`.
  static ({String host, int port})? parseHostPort(String input) {
    final s = input.trim();
    if (s.isEmpty) return null;
    final i = s.lastIndexOf(':');
    var host = s;
    var port = 9100;
    if (i > 0) {
      host = s.substring(0, i);
      final p = int.tryParse(s.substring(i + 1));
      if (p == null || p < 1 || p > 65535) return null;
      port = p;
    }
    if (host.isEmpty || host.contains(RegExp(r'\s')) || host.contains('/')) return null;
    return (host: host, port: port);
  }
}

/// How a receipt is laid out as a PDF (the Windows driver and the preview):
/// the full roll width, the margin left to the driver.
class ReceiptSpec {
  final ThermalPaper paper;

  const ReceiptSpec(this.paper);

  double get pageWidth => paper.mm * 72 / 25.4;
  double get margin => 9;

  /// 58mm gets a smaller face so a line holds a similar number of characters.
  double get font => paper == ThermalPaper.mm58 ? 8 : 9.5;
}
