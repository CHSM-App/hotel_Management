import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/reports_viewmodel.dart' show startOfMonthIso, todayIso;
import '../bookings/receipt_download.dart';
import '../reports/services_report_pdf.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'service_usage_panel.dart';
import 'services_catalogue_panel.dart';

/// Other services — mirrors ServicesPanel.jsx's shell: Service use and
/// Services & prices, the same two views the web switches between.
class ServicesScreen extends ConsumerStatefulWidget {
  /// Pushed a PDF-download icon into the shell's own top bar, next to the
  /// "Other services" title — the same slot Reports feeds its own PDF/Excel
  /// icons through — while the Service use tab is open. Null for any host
  /// that doesn't offer the shell's header row.
  final ValueNotifier<Widget?>? headerActions;

  const ServicesScreen({super.key, this.headerActions});

  @override
  ConsumerState<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends ConsumerState<ServicesScreen> {
  String _view = 'usage';
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(lodgeServicesViewModelProvider.notifier).loadUsages();
      ref.read(lodgeServicesViewModelProvider.notifier).loadServices();
      ref.read(lodgeServicesViewModelProvider.notifier).loadInHouseGuests();
    });
  }

  @override
  void dispose() {
    // See ReportsScreen's own dispose(): scheduled for after this build so
    // there's nothing to cancel if the frame never runs, and otherwise
    // clears the icon rather than leaving it stale on whatever section
    // opened next.
    widget.headerActions?.value = null;
    super.dispose();
  }

  /// This month's own Other services report, downloaded straight from the
  /// desk — the same file Reports > Other services builds, without having
  /// to leave this screen to fetch it. Mirrors ReportsScreen's _download().
  Future<void> _downloadReport() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = true);
    try {
      final lodge = ref.read(authViewModelProvider).me?.lodge;
      final report = await ref.read(reportsUsecaseProvider).servicesReport(
        fromDate: startOfMonthIso(),
        toDate: todayIso(),
      );
      final path = await ServicesReportPdf.download(report, lodgeName: lodge?.name);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: const Text('PDF saved.'),
          backgroundColor: AppTheme.heading,
          action: canOpenSavedFile
              ? SnackBarAction(label: 'Open', textColor: Colors.white, onPressed: () => openSavedFile(path, 'report.pdf'))
              : null,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text('Could not build the file: $e')));
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Kept alive here, not just in the sub-tab panels: the two panels are
    // separate widgets that unmount each other on every tab switch, and
    // lodgeServicesViewModelProvider is autoDispose, so without a listener
    // that outlives both of them a switch mid-load tore down the in-flight
    // request (and any already-loaded data) instead of letting it land.
    ref.watch(lodgeServicesViewModelProvider);

    if (widget.headerActions != null) {
      final action = _view == 'usage'
          ? _HeaderDownloadButton(tooltip: 'Download this month\'s report (PDF)', loading: _downloading, onTap: _downloadReport)
          : null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.headerActions!.value = action;
      });
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: _SubTabs(selected: _view, onSelect: (v) => setState(() => _view = v)),
        ),
        Expanded(child: _view == 'catalogue' ? const ServicesCataloguePanel() : const ServiceUsagePanel()),
      ],
    );
  }
}

/// A single round icon button for the shell's top bar — the Services/
/// Laundry equivalent of Reports' own PDF/Excel pair, just the one format
/// each of those screens offers. Swaps to a small spinner while its
/// download is in flight, same as _DownloadActions in reports_screen.dart.
class _HeaderDownloadButton extends StatelessWidget {
  final String tooltip;
  final bool loading;
  final VoidCallback onTap;

  const _HeaderDownloadButton({required this.tooltip, required this.loading, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      onPressed: loading ? null : onTap,
      icon: loading
          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
          : const Icon(Icons.picture_as_pdf_rounded),
      iconSize: 19,
      color: Colors.white,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
      visualDensity: VisualDensity.compact,
      style: IconButton.styleFrom(backgroundColor: AppTheme.accent),
    );
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: const [
        PillTab('usage', 'Service use', Icons.room_service_rounded),
        PillTab('catalogue', 'Services & prices', Icons.sell_rounded),
      ],
    );
  }
}
