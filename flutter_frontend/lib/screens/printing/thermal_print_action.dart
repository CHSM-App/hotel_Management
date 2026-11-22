import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/printing/receipt_logo.dart';
import '../../core/printing/thermal_printer.dart';
import '../../domain/models/printer_config.dart';
import '../../domain/models/receipt_doc.dart';
import '../../presentation/providers/view_model_provider.dart';
import 'printer_settings_screen.dart';

/// [doc] with the property's logo on top, whenever the property has one.
///
/// (The Profile switch "show logo on receipt" is for the A4/A5 bills; a thermal
/// receipt carries the logo if there is one.) [onMissing] is told why when the
/// property has a logo that could not be loaded, so the print can say so rather
/// than quietly leaving it off.
Future<ReceiptDoc> withLodgeLogo(
  WidgetRef ref,
  ReceiptDoc doc,
  PrinterConfig config, {
  void Function(String reason)? onMissing,
}) async {
  final url = ref.read(authViewModelProvider).me?.lodge.logoUrl;
  if (url == null || url.trim().isEmpty) return doc;
  final logo = await ReceiptLogoLoader.load(url, config.paper);
  if (logo == null) onMissing?.call(ReceiptLogoLoader.lastError ?? 'it could not be loaded');
  return doc.withLogo(logo);
}

/// "Thermal print" from a bill screen: sends [build]'s receipt to this device's
/// printer, first taking the desk to printer setup if none is saved yet.
///
/// Returns the sentence to tell the desk — success or the reason it failed — or
/// null when they backed out of setup.
Future<String?> runThermalPrint(
  BuildContext context,
  WidgetRef ref,
  ReceiptDoc doc,
) async {
  var config = ref.read(printerViewModelProvider);
  if (!config.isSet) {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const PrinterSettingsScreen()),
    );
    if (saved != true) return null;
    config = ref.read(printerViewModelProvider);
  }
  try {
    String? logoProblem;
    final withLogo = await withLodgeLogo(ref, doc, config, onMissing: (r) => logoProblem = r);
    await ThermalPrinterService.print(config, withLogo);
    final sent = 'Sent to ${config.name.isEmpty ? 'the printer' : config.name}.';
    return logoProblem == null ? sent : '$sent The logo was left off: $logoProblem.';
  } on ThermalPrintException catch (e) {
    return e.message;
  }
}

/// After an order is taken: "Order sent" with an optional **Print KOT** for
/// whoever took it. Resolves when the dialog is dismissed.
Future<void> offerKot(BuildContext context, WidgetRef ref, ReceiptDoc kot, {required String message}) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Order sent'),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done')),
        FilledButton.icon(
          icon: const Icon(Icons.print_rounded, size: 18),
          label: const Text('Print KOT'),
          onPressed: () async {
            final messenger = ScaffoldMessenger.of(context);
            final result = await runThermalPrint(ctx, ref, kot);
            if (ctx.mounted) Navigator.pop(ctx);
            if (result != null) messenger.showSnackBar(SnackBar(content: Text(result)));
          },
        ),
      ],
    ),
  );
}
