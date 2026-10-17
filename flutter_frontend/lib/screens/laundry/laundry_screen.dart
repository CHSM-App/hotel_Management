import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/reports_viewmodel.dart' show startOfMonthIso, todayIso;
import '../bookings/receipt_download.dart';
import '../reports/laundry_report_excel.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'guest_laundry_tab.dart';
import 'linen_tab.dart';

/// Laundry — mirrors LaundryPanel.jsx: the hotel's own linen through the
/// wash, and guests' laundry taken in at the desk. Guest laundry bills
/// through Other services, so its tab only shows once that add-on is on too.
class LaundryScreen extends ConsumerStatefulWidget {
  /// Pushed an Excel-download icon into the shell's own top bar while the
  /// Guest laundry tab is open — see ServicesScreen's own [headerActions]
  /// for the full story.
  final ValueNotifier<Widget?>? headerActions;

  const LaundryScreen({super.key, this.headerActions});

  @override
  ConsumerState<LaundryScreen> createState() => _LaundryScreenState();
}

class _LaundryScreenState extends ConsumerState<LaundryScreen> {
  String _tab = 'linen';
  bool _downloading = false;

  @override
  void dispose() {
    widget.headerActions?.value = null;
    super.dispose();
  }

  /// This month's own Laundry report — the same file Reports > Laundry
  /// builds, downloaded straight from the Guest laundry tab. Mirrors
  /// ServicesScreen's own _downloadReport().
  Future<void> _downloadReport() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = true);
    try {
      final report = await ref.read(reportsUsecaseProvider).laundryReport(
        fromDate: startOfMonthIso(),
        toDate: todayIso(),
      );
      final path = await LaundryReportExcel.download(report, guestLaundry: true);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: const Text('Excel file saved.'),
          backgroundColor: AppTheme.heading,
          action: canOpenSavedFile
              ? SnackBarAction(label: 'Open', textColor: Colors.white, onPressed: () => openSavedFile(path, 'report.xlsx'))
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
    final guestLaundry = ref.watch(authViewModelProvider).me?.lodge.hasOtherServices ?? false;

    if (widget.headerActions != null) {
      final action = (_tab == 'laundry' && guestLaundry)
          ? _HeaderDownloadButton(tooltip: 'Download this month\'s report (Excel)', loading: _downloading, onTap: _downloadReport)
          : null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.headerActions!.value = action;
      });
    }

    return Column(
      children: [
        if (guestLaundry)
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
            child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
          ),
        Expanded(
          child: _tab == 'laundry' && guestLaundry ? const GuestLaundryTab() : const LinenTab(),
        ),
      ],
    );
  }
}

/// A single round icon button for the shell's top bar — the Laundry
/// equivalent of ServicesScreen's own _HeaderDownloadButton, just for
/// Excel instead of PDF. Kept as its own copy rather than a shared public
/// widget: each screen's icon, tooltip and download call are different
/// enough that a shared one would need as many parameters as a copy has
/// lines, the same reasoning reports_screen.dart's own _DownloadActions
/// already settled on for itself.
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
          : const Icon(Icons.table_chart_rounded),
      iconSize: 19,
      color: Colors.white,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
      visualDensity: VisualDensity.compact,
      style: IconButton.styleFrom(backgroundColor: AppTheme.edit),
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
        PillTab('linen', 'Hotel Laundry', Icons.local_laundry_service_rounded),
        PillTab('laundry', 'Guest laundry', Icons.checkroom_rounded),
      ],
    );
  }
}
