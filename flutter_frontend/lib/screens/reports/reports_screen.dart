import 'package:flutter/material.dart';
import '../../widgets/compact_date_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../domain/models/income.dart';
import '../../domain/models/me.dart';
import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/reports_viewmodel.dart';
import '../../widgets/neu.dart';
import '../bookings/receipt_download.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'asset_report_excel.dart';
import 'asset_report_pdf.dart';
import 'assets_report_tab.dart';
import 'bills_report_panel.dart';
import 'booking_report_excel.dart';
import 'booking_report_pdf.dart';
import 'bookings_report_panel.dart';
import 'event_report_excel.dart';
import 'event_report_pdf.dart';
import 'events_report_panel.dart';
import 'expense_report_excel.dart';
import 'expense_report_pdf.dart';
import 'expenses_report_tab.dart';
import 'food_order_report_excel.dart';
import 'food_order_report_pdf.dart';
import 'food_orders_report_panel.dart';
import 'gst_report_excel.dart';
import 'gst_report_pdf.dart';
import 'gst_report_panel.dart';
import 'income_report_excel.dart';
import 'income_report_pdf.dart';
import 'income_report_tab.dart';
import 'laundry_report_excel.dart';
import 'laundry_report_panel.dart';
import 'laundry_report_pdf.dart';
import 'overview_report_panel.dart';
import 'profit_loss_panel.dart';
import 'report_widgets.dart';
import 'services_report_excel.dart';
import 'services_report_panel.dart';
import 'services_report_pdf.dart';

enum _ReportFormat { pdf, excel }

/// One entry of the tab strip — mirrors `ALL_TABS` in
/// frontend/src/pages/lodge/ReportsPanel.jsx field for field, so the two
/// clients can't quietly drift about which tabs exist or how each is gated.
class _ReportTab {
  final String key;
  final String label;

  /// The lodge capability this tab needs, or null for the universal ones
  /// (Overview, Tax & GST).
  final String? capability;

  /// The permission this tab needs beyond the outer Reports gate
  /// (reports.view, already checked to reach this screen at all).
  final String? permission;

  /// Extra permissions ALL of which are required alongside [permission] —
  /// only Profit & Loss uses this (profitLoss.view AND expenses.manage).
  final List<String> requiresAll;

  const _ReportTab({
    required this.key,
    required this.label,
    this.capability,
    this.permission,
    this.requiresAll = const [],
  });

  bool availableTo(Me me) {
    if (capability != null && !_hasCapability(me.lodge, capability!)) return false;
    if (permission != null && !me.user.can(permission!)) return false;
    for (final p in requiresAll) {
      if (!me.user.can(p)) return false;
    }
    return true;
  }

  static bool _hasCapability(Lodge lodge, String capability) => switch (capability) {
    'hasRooms' => lodge.hasRooms,
    'servesFood' => lodge.servesFood,
    'hasEvents' => lodge.hasEvents,
    'hasAssets' => lodge.hasAssets,
    'hasExpenses' => lodge.hasExpenses,
    'hasOtherServices' => lodge.hasOtherServices,
    'hasLaundry' => lodge.hasLaundry,
    _ => true,
  };
}

/// The four sidebar sections under Reports & Analytics, and the tabs each
/// holds — mirrors frontend/src/lib/reportSections.js's REPORT_SECTIONS. A
/// section shows only the tabs the property and the login can use, and no
/// tab strip at all when just one is left.
const _kReportSections = <String, List<String>>{
  'overview': ['overview'],
  'sales': ['bookings', 'events', 'food', 'services', 'laundry'],
  'finance': ['bills', 'profitLoss', 'expenses', 'income', 'gst'],
  'assets': ['assets'],
};

const _kAllReportTabs = <_ReportTab>[
  _ReportTab(key: 'overview', label: 'Overview'),
  _ReportTab(key: 'bookings', label: 'Room Bookings', capability: 'hasRooms'),
  _ReportTab(key: 'events', label: 'Events & functions', capability: 'hasEvents'),
  _ReportTab(key: 'food', label: 'Restaurant', capability: 'servesFood'),
  _ReportTab(key: 'services', label: 'Other services', capability: 'hasOtherServices'),
  _ReportTab(key: 'laundry', label: 'Laundry', capability: 'hasLaundry'),
  _ReportTab(key: 'bills', label: 'Bills'),
  _ReportTab(key: 'gst', label: 'Tax & GST'),
  _ReportTab(
    key: 'profitLoss',
    label: 'Profit & Loss',
    capability: 'hasExpenses',
    requiresAll: ['profitLoss.view', 'expenses.manage'],
  ),
  _ReportTab(key: 'expenses', label: 'Expenses', capability: 'hasExpenses', permission: 'expenses.manage'),
  _ReportTab(key: 'income', label: 'Other Income', capability: 'hasExpenses', permission: 'income.manage'),
  _ReportTab(key: 'assets', label: 'Assets', capability: 'hasAssets', permission: 'assets.manage'),
];

/// Reports: the full tab set the website's Reports/Analysis page offers,
/// gated the same way — see [_kAllReportTabs] and
/// frontend/src/pages/lodge/ReportsPanel.jsx's ALL_TABS.
class ReportsScreen extends ConsumerStatefulWidget {
  /// Set when this screen was reached from the bottom bar's "More" list —
  /// renders a back arrow merged into the same row as the title and the
  /// download buttons. Null when Reports is a primary bottom-bar tab of its
  /// own, which needs no way back to anywhere.
  final VoidCallback? onBack;

  /// Which sidebar section opened this screen — one of [_kReportSections]'
  /// keys ('overview', 'sales', 'finance', 'assets'), mirroring the web's own
  /// `only` prop on ReportsPanel. Null keeps every tab, same as before these
  /// four sidebar rows existed.
  final String? only;

  /// When set, the PDF/Excel download icons are pushed up into the shell's
  /// own top bar (next to the section title) instead of this screen opening
  /// a second header row underneath for them. Set by DashboardShell; left
  /// null for any other host, which gets the local row as before.
  final ValueNotifier<Widget?>? headerActions;

  const ReportsScreen({super.key, this.onBack, this.only, this.headerActions});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

/// Tabs whose data is fetched over the shared date range (and so need the
/// range picker on screen); Expenses/Other Income/Assets report their full
/// history instead, the same distinction ReportsPanel.jsx draws.
const _kDateRangedTabs = {'overview', 'bookings', 'events', 'food', 'services', 'laundry', 'gst', 'profitLoss'};

/// Tabs that load their full history once and filter it client-side —
/// still shown with the same From/To range picker above the tab strip as
/// the server-ranged tabs, just wired to a locally held range instead of
/// the shared [ReportsState].
const _kLocalRangedTabs = {'expenses', 'income', 'assets', 'bills'};

/// Tabs with a matching PDF/Excel builder, same parity as the web's own
/// preview/export buttons for Bookings/Events/Food/GST/Expenses/Other
/// Income/Assets. Profit & Loss has no PDF/Excel on the website either, so it
/// stays data-only.
const _kDownloadableTabs = {'bookings', 'events', 'food', 'services', 'laundry', 'gst', 'expenses', 'income', 'assets'};

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  String _tab = 'overview';
  _ReportFormat? _downloading;

  /// Expenses/Other Income/Assets' own From/To — held here (not in
  /// [ReportsState]) since it only filters an already-loaded list rather
  /// than triggering a refetch, but shown in the same header spot as the
  /// server-ranged tabs' picker.
  String _localFromDate = startOfMonthIso();
  String _localToDate = todayIso();

  List<_ReportTab> _visibleTabs(Me me) {
    final section = widget.only == null ? null : _kReportSections[widget.only];
    return _kAllReportTabs
        .where((t) => t.availableTo(me) && (section == null || section.contains(t.key)))
        .toList();
  }

  bool _canDownload(ReportsState state) => switch (_tab) {
    'events' => state.events is AsyncData,
    'food' => state.foodOrders is AsyncData,
    'services' => state.services is AsyncData,
    'laundry' => state.laundry is AsyncData,
    'gst' => state.gst is AsyncData,
    'bookings' => state.bookings is AsyncData,
    'expenses' => state.expensesReport is AsyncData,
    'income' => state.incomeReport is AsyncData,
    'assets' => state.assetsReport is AsyncData,
    _ => false,
  };

  Future<void> _download(ReportsState state, _ReportFormat format) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = format);
    try {
      final lodge = ref.read(authViewModelProvider).me?.lodge;
      final String path;
      switch (_tab) {
        case 'events':
          final report = (state.events as AsyncData<EventsReport>).value;
          path = format == _ReportFormat.pdf
              ? await EventReportPdf.download(report)
              : await EventReportExcel.download(report);
        case 'food':
          final report = (state.foodOrders as AsyncData<FoodOrdersReport>).value;
          path = format == _ReportFormat.pdf
              ? await FoodOrderReportPdf.download(report)
              : await FoodOrderReportExcel.download(report);
        case 'services':
          final report = (state.services as AsyncData<ServicesReport>).value;
          path = format == _ReportFormat.pdf
              ? await ServicesReportPdf.download(report, lodgeName: lodge?.name)
              : await ServicesReportExcel.download(report, lodgeName: lodge?.name);
        case 'laundry':
          final report = (state.laundry as AsyncData<LaundryReport>).value;
          final guestLaundry = lodge?.hasOtherServices ?? false;
          path = format == _ReportFormat.pdf
              ? await LaundryReportPdf.download(report, guestLaundry: guestLaundry)
              : await LaundryReportExcel.download(report, guestLaundry: guestLaundry);
        case 'gst':
          final report = (state.gst as AsyncData<GstSummaryReport>).value;
          final gstin = lodge?.isGstRegistered == true ? lodge?.gstin : null;
          path = format == _ReportFormat.pdf
              ? await GstReportPdf.download(report, lodgeName: lodge?.name, gstin: gstin)
              : await GstReportExcel.download(report, lodgeName: lodge?.name, gstin: gstin);
        case 'expenses':
          final expenses = (state.expensesReport as AsyncData<List<Expense>>).value;
          path = format == _ReportFormat.pdf
              ? await ExpenseReportPdf.download(expenses, lodgeName: lodge?.name)
              : await ExpenseReportExcel.download(expenses, lodgeName: lodge?.name);
        case 'income':
          final income = (state.incomeReport as AsyncData<List<IncomeEntry>>).value;
          path = format == _ReportFormat.pdf
              ? await IncomeReportPdf.download(income, lodgeName: lodge?.name)
              : await IncomeReportExcel.download(income, lodgeName: lodge?.name);
        case 'assets':
          final data = (state.assetsReport as AsyncData<AssetsReportData>).value;
          path = format == _ReportFormat.pdf
              ? await AssetReportPdf.download(data.assets, data.workOrders, lodgeName: lodge?.name)
              : await AssetReportExcel.download(data.assets, data.workOrders, lodgeName: lodge?.name);
        default:
          final report = (state.bookings as AsyncData<BookingsReport>).value;
          path = format == _ReportFormat.pdf
              ? await BookingReportPdf.download(report)
              : await BookingReportExcel.download(report);
      }
      if (!mounted) return;
      final ext = format == _ReportFormat.pdf ? 'pdf' : 'xlsx';
      messenger.showSnackBar(
        SnackBar(
          content: Text(format == _ReportFormat.pdf ? 'PDF saved.' : 'Excel file saved.'),
          backgroundColor: AppTheme.heading,
          action: canOpenSavedFile
              ? SnackBarAction(
                  label: 'Open',
                  textColor: Colors.white,
                  onPressed: () => openSavedFile(path, 'report.$ext'),
                )
              : null,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('Could not build the file: $e')),
      );
    } finally {
      if (mounted) setState(() => _downloading = null);
    }
  }

  @override
  void dispose() {
    // Scheduled for after this build, not before — if the frame never runs
    // (disposed mid-build) there's nothing to cancel, and clearing here
    // just stops a stale icon pair lingering in the shell's bar once this
    // section isn't showing anymore.
    widget.headerActions?.value = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authViewModelProvider).me;
    final state = ref.watch(reportsViewModelProvider);

    if (me == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final tabs = _visibleTabs(me);
    if (tabs.isEmpty) {
      return const NeuNotice(
        icon: Icons.lock_outline_rounded,
        message: 'This login cannot see any report yet.\nAsk the owner to grant it a role.',
      );
    }
    if (!tabs.any((t) => t.key == _tab)) {
      _tab = tabs.first.key;
    }

    final showRange = _kDateRangedTabs.contains(_tab);
    final showLocalRange = _kLocalRangedTabs.contains(_tab);
    final showDownload = _kDownloadableTabs.contains(_tab);
    final canDownload = _canDownload(state);

    if (widget.headerActions != null) {
      final actions = showDownload
          ? _DownloadActions(
              canDownload: canDownload,
              downloading: _downloading,
              onDownload: (format) => _download(state, format),
            )
          : null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.headerActions!.value = actions;
      });
    }

    return Column(
      children: [
        if (widget.headerActions == null)
          _ReportsTitleBar(
            onBack: widget.onBack,
            showDownload: showDownload,
            canDownload: canDownload,
            downloading: _downloading,
            onDownload: (format) => _download(state, format),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s16,
            AppTheme.s8,
            AppTheme.s16,
            AppTheme.s8,
          ),
          child: Column(
            children: [
              if (tabs.length > 1) ...[
                _SubTabs(tabs: tabs, selected: _tab, onSelect: (t) => setState(() => _tab = t)),
                const SizedBox(height: AppTheme.s12),
              ],
              if (showRange) ...[
                _RangePicker(state: state),
              ] else if (showLocalRange) ...[
                ReportDateRangeFilter(
                  fromDate: _localFromDate,
                  toDate: _localToDate,
                  onFromChanged: (v) => setState(() => _localFromDate = v),
                  onToChanged: (v) => setState(() => _localToDate = v),
                ),
              ],
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.read(reportsViewModelProvider.notifier).refresh(),
            color: AppTheme.accent,
            child: (showRange && !state.validRange)
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: const [
                      NeuNotice(
                        icon: Icons.date_range_rounded,
                        message: 'Choose a valid date range.',
                      ),
                    ],
                  )
                : switch (_tab) {
                    'bookings' => const BookingsReportPanel(),
                    'events' => const EventsReportPanel(),
                    'food' => const FoodOrdersReportPanel(),
                    'services' => const ServicesReportPanel(),
                    'laundry' => const LaundryReportPanel(),
                    'gst' => const GstReportPanel(),
                    'profitLoss' => const ProfitLossPanel(),
                    'expenses' => ExpensesReportTab(fromDate: _localFromDate, toDate: _localToDate),
                    'income' => IncomeReportTab(fromDate: _localFromDate, toDate: _localToDate),
                    'assets' => AssetsReportTab(fromDate: _localFromDate, toDate: _localToDate),
                    'bills' => BillsReportPanel(fromDate: _localFromDate, toDate: _localToDate),
                    _ => const OverviewReportPanel(),
                  },
          ),
        ),
      ],
    );
  }
}

/// The title row above the date range and tab strip — merges the back
/// arrow (when reached from "More") and the PDF/Excel buttons into one row
/// instead of two, so a downloadable tab doesn't print "Reports" twice: once
/// from the shell's own back row and again from a header owned by this
/// screen. Pinned above the (horizontally scrolling, nine-wide) tab strip so
/// the buttons stay in the same place no matter which tab is active or how
/// far the strip has scrolled.
class _ReportsTitleBar extends StatelessWidget {
  final VoidCallback? onBack;
  final bool showDownload;
  final bool canDownload;
  final _ReportFormat? downloading;
  final ValueChanged<_ReportFormat> onDownload;

  const _ReportsTitleBar({
    required this.onBack,
    required this.showDownload,
    required this.canDownload,
    required this.downloading,
    required this.onDownload,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.bg,
      child: InkWell(
        onTap: onBack,
        child: Container(
          padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: AppTheme.border)),
          ),
          child: Row(
            children: [
              if (onBack != null) ...[
                const Icon(Icons.arrow_back_rounded, color: AppTheme.heading),
                const SizedBox(width: AppTheme.s8),
              ],
              Expanded(
                child: Text(
                  'Reports',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
              if (showDownload)
                _DownloadActions(
                  canDownload: canDownload,
                  downloading: downloading,
                  onDownload: onDownload,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The PDF/Excel icon pair — shared between [_ReportsTitleBar]'s own row
/// (used when nothing lifts it elsewhere) and the shell top bar, which
/// [_ReportsScreenState] feeds this same widget through `headerActions`.
class _DownloadActions extends StatelessWidget {
  final bool canDownload;
  final _ReportFormat? downloading;
  final ValueChanged<_ReportFormat> onDownload;

  const _DownloadActions({
    required this.canDownload,
    required this.downloading,
    required this.onDownload,
  });

  static const _size = 36.0;
  static const _iconSize = 19.0;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: 'Download PDF',
          onPressed: !canDownload || downloading != null
              ? null
              : () => onDownload(_ReportFormat.pdf),
          icon: downloading == _ReportFormat.pdf
              ? const SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.picture_as_pdf_rounded),
          iconSize: _iconSize,
          color: Colors.white,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: _size, minHeight: _size),
          visualDensity: VisualDensity.compact,
          style: IconButton.styleFrom(backgroundColor: AppTheme.accent),
        ),
        const SizedBox(width: AppTheme.s4),
        IconButton(
          tooltip: 'Download Excel',
          onPressed: !canDownload || downloading != null
              ? null
              : () => onDownload(_ReportFormat.excel),
          icon: downloading == _ReportFormat.excel
              ? const SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.table_chart_rounded),
          iconSize: _iconSize,
          color: Colors.white,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: _size, minHeight: _size),
          visualDensity: VisualDensity.compact,
          style: IconButton.styleFrom(backgroundColor: AppTheme.edit),
        ),
      ],
    );
  }
}

class _SubTabs extends StatelessWidget {
  final List<_ReportTab> tabs;
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.tabs, required this.selected, required this.onSelect});

  static const _icons = {
    'overview': Icons.dashboard_rounded,
    'bookings': Icons.bed_rounded,
    'events': Icons.celebration_rounded,
    'food': Icons.restaurant_rounded,
    'services': Icons.room_service_rounded,
    'laundry': Icons.local_laundry_service_rounded,
    'bills': Icons.receipt_long_rounded,
    'gst': Icons.account_balance_rounded,
    'profitLoss': Icons.trending_up_rounded,
    'expenses': Icons.payments_rounded,
    'income': Icons.savings_rounded,
    'assets': Icons.inventory_2_rounded,
  };

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: [
        for (final t in tabs) PillTab(t.key, t.label, _icons[t.key] ?? Icons.bar_chart_rounded),
      ],
    );
  }
}

/// From/To date fields plus a month shortcut, the same three controls the
/// web filter bar offers.
class _RangePicker extends ConsumerWidget {
  final ReportsState state;

  const _RangePicker({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(reportsViewModelProvider.notifier);

    return Row(
      children: [
        Expanded(
          child: _DateField(
            label: 'From',
            value: state.fromDate,
            onPick: (picked) => vm.setRange(picked, state.toDate),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: _DateField(
            label: 'To',
            value: state.toDate,
            minDate: state.fromDate,
            onPick: (picked) => vm.setRange(state.fromDate, picked),
          ),
        ),
      ],
    );
  }
}

class _DateField extends StatelessWidget {
  final String label;
  final String value;
  final String? minDate;
  final ValueChanged<String> onPick;

  const _DateField({
    required this.label,
    required this.value,
    required this.onPick,
    this.minDate,
  });

  @override
  Widget build(BuildContext context) {
    final parsed = DateTime.tryParse(value);
    return GestureDetector(
      onTap: () async {
        final now = DateTime.now();
        final min = minDate != null ? DateTime.tryParse(minDate!) : null;
        final picked = await showAppDatePicker(
          context: context,
          initialDate: parsed ?? now,
          firstDate: min ?? DateTime(now.year - 5),
          lastDate: DateTime(now.year + 1),
        );
        if (picked == null) return;
        final iso =
            '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
        onPick(iso);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 10),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rLarge),
          border: Border.all(color: AppTheme.border),
          boxShadow: AppTheme.subtle,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                color: AppTheme.accent,
                borderRadius: BorderRadius.circular(7),
              ),
              child: const Icon(Icons.calendar_today_rounded, size: 12, color: Colors.white),
            ),
            const SizedBox(width: AppTheme.s8),
            Flexible(
              child: Text(
                parsed == null ? label : '${parsed.day} ${_monthShort(parsed.month)} ${parsed.year}',
                style: TextStyle(
                  color: parsed == null ? AppTheme.muted : AppTheme.heading,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _monthShort(int month) => const [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][month - 1];
}
