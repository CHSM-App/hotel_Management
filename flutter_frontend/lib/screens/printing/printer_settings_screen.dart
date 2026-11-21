import 'dart:typed_data';

import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../core/printing/receipt_raster.dart';
import '../../core/printing/thermal_printer.dart';
import '../../domain/models/printer_config.dart';
import '../../domain/models/receipt_doc.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'thermal_print_action.dart';

/// Where this device prints thermal receipts: the connection, the roll width,
/// and a test slip. Returns true to the caller when a printer was saved, so a
/// "Thermal print" tap that sent the desk here can carry on printing.
class PrinterSettingsScreen extends ConsumerStatefulWidget {
  const PrinterSettingsScreen({super.key});

  @override
  ConsumerState<PrinterSettingsScreen> createState() => _PrinterSettingsScreenState();
}

class _PrinterSettingsScreenState extends ConsumerState<PrinterSettingsScreen> {
  late PrinterConfig _c;
  final _ip = TextEditingController();
  final _port = TextEditingController(text: '9100');

  List<Printer>? _windowsPrinters;
  List<BtDevice>? _bluetooth;
  bool _scanning = false;
  String? _scanError;

  bool _testing = false;
  ({bool ok, String message})? _result;

  @override
  void initState() {
    super.initState();
    _c = ref.read(printerViewModelProvider);
    final available = ThermalPrinterService.available;
    if (_c.transport == PrinterTransport.none && available.isNotEmpty) {
      _c = _c.copyWith(transport: available.first);
    }
    if (_c.transport == PrinterTransport.network) {
      final hp = PrinterConfig.parseHostPort(_c.address);
      if (hp != null) {
        _ip.text = hp.host;
        _port.text = '${hp.port}';
      }
    }
    if (_c.transport == PrinterTransport.windows) Future.microtask(_loadWindows);
  }

  @override
  void dispose() {
    _ip.dispose();
    _port.dispose();
    super.dispose();
  }

  String get _lodgeName => ref.read(authViewModelProvider).me?.lodge.name ?? 'Receipt';

  /// The config as currently typed — the network fields are folded into the
  /// address here rather than on every keystroke.
  PrinterConfig get _draft {
    if (_c.transport != PrinterTransport.network) return _c;
    final ip = _ip.text.trim();
    final port = _port.text.trim();
    final address = ip.isEmpty ? '' : (port.isEmpty || port == '9100' ? ip : '$ip:$port');
    return _c.copyWith(address: address, name: ip);
  }

  String? get _networkError {
    if (_c.transport != PrinterTransport.network) return null;
    if (_ip.text.trim().isEmpty) return null;
    return PrinterConfig.parseHostPort(_draft.address) == null ? 'Enter a valid IP address and port.' : null;
  }

  bool get _valid {
    final d = _draft;
    if (!d.isSet) return false;
    return d.transport != PrinterTransport.network || PrinterConfig.parseHostPort(d.address) != null;
  }

  void _setTransport(PrinterTransport t) {
    setState(() {
      _c = _c.copyWith(transport: t, name: '', address: '');
      _result = null;
      _scanError = null;
      _ip.clear();
    });
    if (t == PrinterTransport.windows) _loadWindows();
  }

  Future<void> _loadWindows() async {
    setState(() {
      _scanning = true;
      _scanError = null;
    });
    try {
      final list = await ThermalPrinterService.windowsPrinters();
      if (mounted) setState(() => _windowsPrinters = list);
    } catch (e) {
      if (mounted) setState(() => _scanError = 'Could not list printers: $e');
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  Future<void> _scanBluetooth() async {
    setState(() {
      _scanning = true;
      _scanError = null;
    });
    try {
      final list = await ThermalPrinterService.bluetoothDevices();
      if (mounted) setState(() => _bluetooth = list);
    } on ThermalPrintException catch (e) {
      if (mounted) setState(() => _scanError = e.message);
    } catch (e) {
      if (mounted) setState(() => _scanError = 'Could not look for printers: $e');
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _result = null;
    });
    try {
      await ThermalPrinterService.print(
        _draft,
        await withLodgeLogo(ref, ReceiptDocs.test(lodgeName: _lodgeName, paper: _draft.paper.label), _draft),
      );
      if (mounted) setState(() => _result = (ok: true, message: 'Test slip sent to ${_draft.name.isEmpty ? 'the printer' : _draft.name}.'));
    } on ThermalPrintException catch (e) {
      if (mounted) setState(() => _result = (ok: false, message: e.message));
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Future<void> _save() async {
    await ref.read(printerViewModelProvider.notifier).save(_draft);
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _remove() async {
    await ref.read(printerViewModelProvider.notifier).clear();
    if (mounted) Navigator.of(context).pop(false);
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  Widget _section(String title, Widget child, {String? hint}) => Padding(
    padding: const EdgeInsets.only(bottom: AppTheme.s16),
    child: NeuCard(
      padding: const EdgeInsets.all(AppTheme.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 15)),
          if (hint != null) ...[
            const SizedBox(height: 2),
            Text(hint, style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
          ],
          const SizedBox(height: AppTheme.s12),
          child,
        ],
      ),
    ),
  );

  Widget _connection() {
    final available = ThermalPrinterService.available;
    const meta = {
      PrinterTransport.windows: ('windows', 'Windows', Icons.desktop_windows_rounded),
      PrinterTransport.network: ('network', 'Network', Icons.wifi_rounded),
      PrinterTransport.bluetooth: ('bluetooth', 'Bluetooth', Icons.bluetooth_rounded),
    };
    if (available.isEmpty) {
      return const Text(
        'Direct thermal printing is not available in the browser. Use the app on Windows or Android.',
        style: TextStyle(color: AppTheme.danger),
      );
    }
    return PillTabs(
      selected: meta[_c.transport]?.$1 ?? meta[available.first]!.$1,
      onSelect: (k) => _setTransport(available.firstWhere((t) => meta[t]!.$1 == k)),
      tabs: [for (final t in available) PillTab(meta[t]!.$1, meta[t]!.$2, meta[t]!.$3)],
    );
  }

  Widget _details() => switch (_c.transport) {
    PrinterTransport.windows => _windows(),
    PrinterTransport.network => _network(),
    PrinterTransport.bluetooth => _bluetoothPicker(),
    PrinterTransport.none => const SizedBox.shrink(),
  };

  Widget _windows() {
    final list = _windowsPrinters;
    final value = (list ?? const []).any((p) => p.url == _c.address) ? _c.address : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (list == null && _scanning)
          const LinearProgressIndicator()
        else if (list != null && list.isEmpty)
          const Text('No printers are installed on this PC. Install the thermal printer\'s driver first.', style: TextStyle(color: AppTheme.muted))
        else
          DropdownButtonFormField<String>(
            initialValue: value,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Printer', border: OutlineInputBorder()),
            items: [for (final p in list ?? const <Printer>[]) DropdownMenuItem(value: p.url, child: Text(p.name, overflow: TextOverflow.ellipsis))],
            onChanged: (v) {
              final p = list!.firstWhere((p) => p.url == v);
              setState(() => _c = _c.copyWith(address: p.url, name: p.name));
            },
          ),
        const SizedBox(height: AppTheme.s8),
        _scanButton('Refresh printers', _loadWindows),
        if (_scanError != null) _error(_scanError!),
      ],
    );
  }

  Widget _network() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 3,
            child: NeuField(
              controller: _ip,
              label: 'Printer IP address',
              hint: '192.168.1.50',
              keyboardType: TextInputType.url,
              errorText: _networkError,
              onChanged: (_) => setState(() {}),
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: NeuField(
              controller: _port,
              label: 'Port',
              keyboardType: TextInputType.number,
              onChanged: (_) => setState(() {}),
            ),
          ),
        ],
      ),
      const SizedBox(height: AppTheme.s8),
      const Text(
        'Print the printer\'s self-test page to see its IP. Most thermal printers listen on port 9100.',
        style: TextStyle(color: AppTheme.muted, fontSize: 12.5),
      ),
    ],
  );

  Widget _bluetoothPicker() {
    final list = _bluetooth;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          defaultTargetPlatform == TargetPlatform.windows
              ? 'Switch the printer on and keep it close, then scan. It must not be connected to a phone. '
                  'If it never appears it is probably classic Bluetooth only: pair it in Windows settings and use the Windows connection instead.'
              : 'Pair the printer in the phone\'s Bluetooth settings first, then find it here.',
          style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
        ),
        const SizedBox(height: AppTheme.s8),
        _scanButton(list == null ? (defaultTargetPlatform == TargetPlatform.windows ? 'Scan for printers' : 'Find paired printers') : 'Search again', _scanBluetooth),
        if (_scanError != null) _error(_scanError!),
        if (list != null && list.isEmpty && _scanError == null)
          const Padding(
            padding: EdgeInsets.only(top: AppTheme.s8),
            child: Text('No paired Bluetooth devices found.', style: TextStyle(color: AppTheme.muted)),
          ),
        if (list != null)
          for (final d in list)
            Padding(
              padding: const EdgeInsets.only(top: AppTheme.s8),
              child: _DeviceTile(
                name: d.name.isEmpty ? d.mac : d.name,
                sub: d.mac,
                selected: _c.address == d.mac,
                onTap: () => setState(() => _c = _c.copyWith(address: d.mac, name: d.name)),
              ),
            ),
      ],
    );
  }

  Widget _scanButton(String label, VoidCallback onTap) => Align(
    alignment: Alignment.centerLeft,
    child: OutlinedButton.icon(
      onPressed: _scanning ? null : onTap,
      icon: _scanning
          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.refresh_rounded, size: 18),
      label: Text(label),
      style: OutlinedButton.styleFrom(foregroundColor: AppTheme.accent, minimumSize: const Size(0, 44)),
    ),
  );

  Widget _error(String m) => Padding(
    padding: const EdgeInsets.only(top: AppTheme.s8),
    child: Text(m, style: const TextStyle(color: AppTheme.danger, fontWeight: FontWeight.w600)),
  );

  Widget _paper() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      PillTabs(
        selected: _c.paper.name,
        onSelect: (k) => setState(() => _c = _c.copyWith(paper: ThermalPaper.values.firstWhere((p) => p.name == k))),
        tabs: [for (final p in ThermalPaper.values) PillTab(p.name, p.label, Icons.receipt_long_rounded)],
      ),
      if (_c.transport != PrinterTransport.windows) ...[
        const SizedBox(height: AppTheme.s8),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _c.autoCut,
          onChanged: (v) => setState(() => _c = _c.copyWith(autoCut: v)),
          title: const Text('Cut paper after printing', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text('Turn off for printers without a cutter.'),
        ),
        const SizedBox(height: AppTheme.s4),
        Text('Print darkness', style: AppTheme.fieldLabel(context)),
        Row(
          children: [
            const Icon(Icons.light_mode_outlined, size: 18, color: AppTheme.muted),
            Expanded(
              child: Slider(
                value: _c.threshold.toDouble(),
                min: 80,
                max: 220,
                divisions: 14,
                onChanged: (v) => setState(() => _c = _c.copyWith(threshold: v.round())),
              ),
            ),
            const Icon(Icons.dark_mode_outlined, size: 18, color: AppTheme.muted),
          ],
        ),
      ],
    ],
  );

  Widget _style() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      PillTabs(
        selected: _c.style.name,
        onSelect: (k) => setState(() => _c = _c.copyWith(style: ReceiptStyle.values.firstWhere((v) => v.name == k))),
        tabs: const [
          PillTab('boxed', 'Boxed', Icons.table_chart_outlined),
          PillTab('plain', 'Plain', Icons.notes_rounded),
        ],
      ),
      const SizedBox(height: AppTheme.s8),
      Text(
        _c.style == ReceiptStyle.boxed
            ? 'A bordered receipt with a ruled Item / Qty / Price / Total table. Sent as a picture, so it takes a little longer.'
            : 'Simple lines of text the printer prints itself. Fastest and smallest, but no borders.',
        style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
      ),
    ],
  );

  Widget _actions() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_result != null)
        Container(
          margin: const EdgeInsets.only(bottom: AppTheme.s12),
          padding: const EdgeInsets.all(AppTheme.s12),
          decoration: BoxDecoration(
            color: (_result!.ok ? AppTheme.vacant : AppTheme.danger).withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
          ),
          child: Row(
            children: [
              Icon(_result!.ok ? Icons.check_circle_rounded : Icons.error_rounded, color: _result!.ok ? AppTheme.vacant : AppTheme.danger, size: 20),
              const SizedBox(width: AppTheme.s8),
              Expanded(child: Text(_result!.message, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600))),
            ],
          ),
        ),
      Row(
        children: [
          Expanded(
            child: NeuButton(
              expand: true,
              onPressed: (_valid && !_testing) ? _test : null,
              child: Text(_testing ? 'Printing…' : 'Test print'),
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: NeuButton(primary: true, expand: true, onPressed: _valid ? _save : null, child: const Text('Save printer')),
          ),
        ],
      ),
      if (ref.read(printerViewModelProvider).isSet)
        TextButton(
          onPressed: _remove,
          style: TextButton.styleFrom(foregroundColor: AppTheme.danger),
          child: const Text('Remove this printer'),
        ),
    ],
  );

  Future<Uint8List> _previewPng() async {
    final doc = ReceiptDocs.test(lodgeName: _lodgeName, paper: _c.paper.label);
    final image = await ReceiptRaster.render(doc, _c.paper.dots, boxed: _c.style == ReceiptStyle.boxed);
    return ReceiptRaster.png(image);
  }

  Widget _preview() => Container(
    color: AppTheme.bg,
    padding: const EdgeInsets.all(AppTheme.s16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Receipt preview · ${_c.paper.label}', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800)),
        const SizedBox(height: AppTheme.s8),
        Expanded(
          child: FutureBuilder<Uint8List>(
            key: ValueKey('${_c.paper.name}-${_c.style.name}'),
            future: _previewPng(),
            builder: (context, snap) {
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              return SingleChildScrollView(
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: AppTheme.border),
                    boxShadow: AppTheme.subtle,
                  ),
                  child: Image.memory(snap.data!, fit: BoxFit.fitWidth, filterQuality: FilterQuality.medium),
                ),
              );
            },
          ),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final form = [
      _section('Connection', _connection(), hint: 'How this device reaches the receipt printer.'),
      if (ThermalPrinterService.available.isNotEmpty) _section('Printer', _details()),
      _section('Receipt style', _style()),
      _section('Paper', _paper(), hint: 'Match the roll in the printer.'),
      _actions(),
    ];
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(title: const Text('Receipt printer')),
      body: LayoutBuilder(
        builder: (context, c) {
          final wide = c.maxWidth >= 900;
          final list = ListView(padding: EdgeInsets.all(AppTheme.gutter(context)), children: form);
          if (!wide) {
            return Align(alignment: Alignment.topCenter, child: ConstrainedBox(constraints: BoxConstraints(maxWidth: AppTheme.formMaxWidth(context)), child: list));
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: Align(alignment: Alignment.topCenter, child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680), child: list))),
              Container(
                width: 380,
                decoration: const BoxDecoration(border: Border(left: BorderSide(color: AppTheme.border))),
                child: _preview(),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _DeviceTile extends StatelessWidget {
  final String name;
  final String sub;
  final bool selected;
  final VoidCallback onTap;

  const _DeviceTile({required this.name, required this.sub, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.rMedium),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s12),
        decoration: BoxDecoration(
          color: selected ? AppTheme.sidebarBrandWash : AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
        ),
        child: Row(
          children: [
            Icon(Icons.print_rounded, color: selected ? AppTheme.accent : AppTheme.muted),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700)),
                  Text(sub, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                ],
              ),
            ),
            if (selected) const Icon(Icons.check_circle_rounded, color: AppTheme.accent),
          ],
        ),
      ),
    ),
  );
}
