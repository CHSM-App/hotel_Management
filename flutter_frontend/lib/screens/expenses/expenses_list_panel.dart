import 'dart:typed_data';

import 'package:flutter/material.dart';
import '../../widgets/compact_date_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/h_scroll_table.dart';
import '../../widgets/neu.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../theme.dart';
import 'expense_form_screen.dart';

/// Expenses > Expenses — mirrors the Log tab in ExpensesPanel.jsx: a search
/// box and every logged spend, either as cards or as a spreadsheet-style
/// table, newest first.
class ExpensesListPanel extends ConsumerStatefulWidget {
  const ExpensesListPanel({super.key});

  @override
  ConsumerState<ExpensesListPanel> createState() => _ExpensesListPanelState();
}

class _ExpensesListPanelState extends ConsumerState<ExpensesListPanel> {
  final _search = TextEditingController();

  // 'table' is the landing view — the sheet-style view for scanning every
  // expense's amount/category/status at once, mirroring the asset
  // register's toggle. 'cards' is one expense at a time, easier to read on
  // a phone, a toggle away.
  String _view = 'table';

  String? _fromDate;
  String? _toDate;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(expensesViewModelProvider.notifier).loadExpenses());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _pickRangeBound({required bool isFrom}) async {
    final now = DateTime.now();
    final current = isFrom ? _fromDate : _toDate;
    final earliest = DateTime(now.year - 5);
    // The to-date can't precede whatever from-date is already set.
    final firstDate = isFrom ? earliest : (DateTime.tryParse(_fromDate ?? '') ?? earliest);
    var initialDate = current != null ? (DateTime.tryParse(current) ?? now) : now;
    if (initialDate.isBefore(firstDate)) initialDate = firstDate;
    final picked = await showAppDatePicker(
      context: context,
      firstDate: firstDate,
      lastDate: DateTime(now.year + 1),
      initialDate: initialDate,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    final iso = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    setState(() {
      if (isFrom) {
        _fromDate = iso;
      } else {
        _toDate = iso;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(expensesViewModelProvider);
    final needle = _search.text.trim().toLowerCase();
    final shown = [...state.expenses]
      ..removeWhere((e) =>
          (_fromDate != null && e.expenseDate.compareTo(_fromDate!) < 0) ||
          (_toDate != null && e.expenseDate.compareTo(_toDate!) > 0) ||
          (needle.isNotEmpty &&
              !e.title.toLowerCase().contains(needle) &&
              !e.categoryName.toLowerCase().contains(needle) &&
              !(e.vendorName ?? '').toLowerCase().contains(needle)))
      ..sort((a, b) => b.expenseDate.compareTo(a.expenseDate));

    final shownTotal = shown.fold<double>(0, (sum, e) => sum + e.amount);

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          // In table view the scroll is the rows', a level below the
          // table's horizontal scroller.
          notificationPredicate: (n) => n.metrics.axis == Axis.vertical,
          onRefresh: () => ref.read(expensesViewModelProvider.notifier).loadExpenses(),
          color: AppTheme.accent,
          child: TablePageBody(
            table: _view == 'table',
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 88),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Container(
                      height: 40,
                      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
                      decoration: BoxDecoration(
                        color: AppTheme.card,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: AppTheme.shadowDark, width: 1.3),
                        boxShadow: AppTheme.subtle,
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 28,
                            height: 28,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: AppTheme.accent.withValues(alpha: 0.10),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.search_rounded, size: 15, color: AppTheme.accent),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            child: TextField(
                              controller: _search,
                              onChanged: (_) => setState(() {}),
                              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                              decoration: const InputDecoration(
                                hintText: 'Search expenses…',
                                hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                                border: InputBorder.none,
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(vertical: 10),
                              ),
                            ),
                          ),
                          if (_search.text.isNotEmpty)
                            GestureDetector(
                              onTap: () => setState(() => _search.clear()),
                              behavior: HitTestBehavior.opaque,
                              child: Container(
                                width: 26,
                                height: 26,
                                margin: const EdgeInsets.only(right: 2),
                                alignment: Alignment.center,
                                decoration: const BoxDecoration(color: AppTheme.bg, shape: BoxShape.circle),
                                child: const Icon(Icons.close_rounded, size: 15, color: AppTheme.muted),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  _ViewToggleButton(view: _view, onSelect: (v) => setState(() => _view = v)),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              _DateRangeBar(
                fromLabel: _fromDate == null ? 'From' : formatIsoDate(_fromDate),
                toLabel: _toDate == null ? 'To' : formatIsoDate(_toDate),
                fromActive: _fromDate != null,
                toActive: _toDate != null,
                onTapFrom: () => _pickRangeBound(isFrom: true),
                onTapTo: () => _pickRangeBound(isFrom: false),
                onClearFrom: _fromDate == null ? null : () => setState(() => _fromDate = null),
                onClearTo: _toDate == null ? null : () => setState(() => _toDate = null),
              ),
              const SizedBox(height: AppTheme.s8),
              if (state.isLoading && state.expenses.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && state.expenses.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (shown.isEmpty)
                NeuNotice(
                  icon: Icons.receipt_long_outlined,
                  message: state.expenses.isEmpty
                      ? 'Nothing logged yet. Log the first bill — electricity, salaries, a repair — and it starts showing up here.'
                      : 'No expense matches this search.',
                )
              else ...[
                _SummaryStrip(count: shown.length, total: shownTotal),
                const SizedBox(height: AppTheme.s12),
                if (_view == 'table')
                  _ExpenseTable(
                    expenses: shown,
                    onEdit: (e) async {
                      await showExpenseFormSheet(context, expense: e);
                      ref.read(expensesViewModelProvider.notifier).loadExpenses();
                    },
                    onView: (e) async {
                      await showExpenseFormSheet(context, expense: e, viewMode: true);
                      ref.read(expensesViewModelProvider.notifier).loadExpenses();
                    },
                    onDelete: (e) => _confirmDelete(context, ref, e),
                  )
                else
                  _ExpenseCardsGrid(expenses: shown),
              ],
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            elevation: 2,
            onPressed: () async {
              await showExpenseFormSheet(context);
              ref.read(expensesViewModelProvider.notifier).loadExpenses();
            },
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref, Expense expense) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Delete this expense?', style: TextStyle(color: AppTheme.heading)),
        content: Text('"${expense.title}" · ${formatPrice(expense.amount)}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(expensesViewModelProvider.notifier).deleteExpense(expense.id);
    }
  }
}

/// A single pill spanning From → To, styled to match the search bar right
/// above it (same height, rounded-999 card, border and soft shadow) instead
/// of looking like a bolted-on filter — a small accent-tinted calendar badge
/// per side, a divider down the middle, and an inline clear "x" once a side
/// is picked.
class _DateRangeBar extends StatelessWidget {
  final String fromLabel;
  final String toLabel;
  final bool fromActive;
  final bool toActive;
  final VoidCallback onTapFrom;
  final VoidCallback onTapTo;
  final VoidCallback? onClearFrom;
  final VoidCallback? onClearTo;

  const _DateRangeBar({
    required this.fromLabel,
    required this.toLabel,
    required this.fromActive,
    required this.toActive,
    required this.onTapFrom,
    required this.onTapTo,
    this.onClearFrom,
    this.onClearTo,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _DateSegment(
            label: fromLabel,
            active: fromActive,
            onTap: onTapFrom,
            onClear: onClearFrom,
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: _DateSegment(
            label: toLabel,
            active: toActive,
            onTap: onTapTo,
            onClear: onClearTo,
          ),
        ),
      ],
    );
  }
}

/// A standalone rounded pill — one per side, each with its own border and
/// shadow (rather than two halves of one bar split by a divider), matching
/// the separated "From" / "To" chip look used elsewhere in the app.
class _DateSegment extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  final VoidCallback? onClear;

  const _DateSegment({
    required this.label,
    required this.active,
    required this.onTap,
    this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: active ? AppTheme.accent.withValues(alpha: 0.4) : AppTheme.shadowDark, width: 1.3),
        boxShadow: AppTheme.subtle,
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: Row(
            children: [
              Container(
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: active ? AppTheme.accent : AppTheme.accent.withValues(alpha: 0.10),
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.event_rounded, size: 13, color: active ? Colors.white : AppTheme.accent),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: active ? AppTheme.heading : AppTheme.muted,
                    fontSize: 13,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
              if (onClear != null)
                GestureDetector(
                  onTap: onClear,
                  behavior: HitTestBehavior.opaque,
                  child: const Padding(
                    padding: EdgeInsets.only(left: 4),
                    child: Icon(Icons.close_rounded, size: 14, color: AppTheme.muted),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Cards vs. spreadsheet — mirrors the toggle-group in AssetsListPanel,
/// sitting where the search bar's filter icon used to be.
class _ViewToggleButton extends StatelessWidget {
  final String view;
  final ValueChanged<String> onSelect;

  const _ViewToggleButton({required this.view, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    Widget seg(String v, IconData icon) {
      final isSelected = v == view;
      return GestureDetector(
        onTap: () => onSelect(v),
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.accent : Colors.transparent,
            borderRadius: BorderRadius.circular(AppTheme.rSmall - 2),
          ),
          child: Icon(icon, size: 17, color: isSelected ? Colors.white : AppTheme.muted),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          seg('cards', Icons.view_agenda_outlined),
          seg('table', Icons.table_rows_outlined),
        ],
      ),
    );
  }
}

/// A quick "N expenses · ₹total" line above the list — mirrors the running
/// total a desk clerk would otherwise have to add up by eye, and reflects
/// whatever search is currently narrowing the list.
class _SummaryStrip extends StatelessWidget {
  final int count;
  final double total;

  const _SummaryStrip({required this.count, required this.total});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text('$count expense${count == 1 ? '' : 's'}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w500)),
        const Text(' · ', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
        Text(formatPrice(total), style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

/// A stable, category-name-derived color — gives each category a recognizable
/// tint across the list without needing per-category color data from the API.
const _kCategoryPalette = [
  AppTheme.accent,
  AppTheme.edit,
  AppTheme.checkout,
  Color(0xFF9F7AEA),
  Color(0xFF38A169),
  Color(0xFFD53F8C),
];

Color _categoryColor(String name) => _kCategoryPalette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _kCategoryPalette.length];

class _ExpenseTableColumn {
  final String key;
  final String label;
  final double width;
  final TextAlign align;

  const _ExpenseTableColumn(this.key, this.label, {this.width = 100, this.align = TextAlign.left});
}

const _kExpenseTableColumns = [
  _ExpenseTableColumn('date', 'Date', width: 90),
  _ExpenseTableColumn('title', 'Title', width: 150),
  _ExpenseTableColumn('category', 'Category', width: 110),
  _ExpenseTableColumn('vendor', 'Vendor', width: 110),
  _ExpenseTableColumn('amount', 'Amount', width: 90, align: TextAlign.right),
  _ExpenseTableColumn('paid', 'Paid', width: 90, align: TextAlign.right),
  _ExpenseTableColumn('status', 'Status', width: 90),
];

/// The sheet-style view — every expense's date/title/category/vendor/amount/
/// paid/status in one scrollable grid, mirroring the asset register's own
/// table: a tinted header row (no clickable sort — the list is already
/// date-sorted above) and a per-row ⋮ menu for the same actions the card
/// view offers.
class _ExpenseTable extends StatelessWidget {
  final List<Expense> expenses;
  final ValueChanged<Expense> onEdit;
  final ValueChanged<Expense> onView;
  final ValueChanged<Expense> onDelete;

  const _ExpenseTable({
    required this.expenses,
    required this.onEdit,
    required this.onView,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final width = _kExpenseTableColumns.fold<double>(0, (sum, c) => sum + c.width) + 36;

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: HScrollTable(
          rowsScrollbar: true,
          child: SizedBox(
            width: width,
            child: StickyHeaderTable(
              header: Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                  ),
                  child: Row(
                    children: [
                      for (final c in _kExpenseTableColumns)
                        SizedBox(
                          width: c.width,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                            child: Text(
                              c.label.toUpperCase(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: c.align,
                              style: const TextStyle(
                                color: AppTheme.sidebarBrandInk,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.3,
                              ),
                            ),
                          ),
                        ),
                      const SizedBox(width: 36),
                    ],
                  ),
                ),
              rows: [
                      for (var i = 0; i < expenses.length; i++) _ExpenseTableRow(expense: expenses[i], shaded: i.isOdd, parent: this),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ExpenseTableRow extends StatelessWidget {
  final Expense expense;
  final bool shaded;
  final _ExpenseTable parent;

  const _ExpenseTableRow({required this.expense, required this.shaded, required this.parent});

  @override
  Widget build(BuildContext context) {
    final cells = {
      'date': formatIsoDate(expense.expenseDate),
      'title': expense.title,
      'category': expense.categoryName,
      'vendor': expense.vendorName ?? '—',
      'amount': formatPrice(expense.amount),
      'paid': expense.amountPaid != null ? formatPrice(expense.amountPaid) : '—',
    };
    final statusColor = expense.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout;
    final statusLabel = kPaymentStatusLabel[expense.paymentStatus];

    return GestureDetector(
      onTap: () => parent.onView(expense),
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
          border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (final c in _kExpenseTableColumns)
              SizedBox(
                width: c.width,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                  child: c.key == 'status'
                      ? Align(
                          alignment: Alignment.centerLeft,
                          child: statusLabel == null
                              ? const Text('—', style: TextStyle(color: AppTheme.muted, fontSize: 12.5))
                              : Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                                  decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                                  child: Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 10.5, fontWeight: FontWeight.w700)),
                                ),
                        )
                      : c.key == 'category'
                          ? Align(
                              alignment: Alignment.centerLeft,
                              child: Text(
                                cells[c.key] ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(color: _categoryColor(expense.categoryName), fontSize: 12.5, fontWeight: FontWeight.w600),
                              ),
                            )
                          : Text(
                              cells[c.key] ?? '',
                              textAlign: c.align,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: AppTheme.text,
                                fontSize: 12.5,
                                fontWeight: c.key == 'title' ? FontWeight.w600 : FontWeight.w400,
                              ),
                            ),
                ),
              ),
            SizedBox(
              width: 36,
              child: NeuActionMenu<String>(
                iconSize: 18,
                actions: const [
                  NeuMenuAction('view', Icons.visibility_outlined, 'View details'),
                  NeuMenuAction('edit', Icons.edit_outlined, 'Edit expense'),
                  NeuMenuAction('delete', Icons.delete_outline_rounded, 'Delete expense', danger: true),
                ],
                onSelected: (v) => switch (v) {
                  'view' => parent.onView(expense),
                  'edit' => parent.onEdit(expense),
                  'delete' => parent.onDelete(expense),
                  _ => null,
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Responsive card grid — one column on a phone-width screen, two on a
/// wider phone/tablet, three past that. Same measure-once-with-LayoutBuilder
/// approach as [_AssetCardsGrid] in assets_list_panel.dart, so both
/// registers lay their cards out identically.
class _ExpenseCardsGrid extends StatelessWidget {
  final List<Expense> expenses;
  const _ExpenseCardsGrid({required this.expenses});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = AppTheme.s8;
        final cols = constraints.maxWidth >= 920 ? 3 : (constraints.maxWidth >= 520 ? 2 : 1);
        final width = cols == 1 ? constraints.maxWidth : (constraints.maxWidth - gap * (cols - 1)) / cols;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final e in expenses) SizedBox(width: width, child: _ExpenseCard(expense: e)),
          ],
        );
      },
    );
  }
}

/// A compact, modern card: title + tinted category pill + vendor, the
/// amount as a bold badge, a thin divider, then a tight date/payment row —
/// same construction as [_AssetCard] in assets_list_panel.dart, so Assets
/// and Expenses share one card language across the app.
class _ExpenseCard extends ConsumerWidget {
  final Expense expense;
  const _ExpenseCard({required this.expense});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = _categoryColor(expense.categoryName);
    final statusLabel = kPaymentStatusLabel[expense.paymentStatus];
    final statusColor = expense.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout;

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          highlightColor: AppTheme.accent.withValues(alpha: 0.04),
          splashColor: AppTheme.accent.withValues(alpha: 0.08),
          // A tap opens read-only first, not the editable form — mirrors a row
          // click in ExpensesPanel.jsx; "Edit details" inside switches it over.
          onTap: () async {
            await showExpenseFormSheet(context, expense: expense, viewMode: true);
            ref.read(expensesViewModelProvider.notifier).loadExpenses();
          },
          child: Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s4, AppTheme.s8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(expense.title, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Flexible(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                  decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                                  child: Text(
                                    expense.categoryName,
                                    style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                              if (expense.vendorName != null) ...[
                                const SizedBox(width: 6),
                                Flexible(
                                  child: Text(
                                    expense.vendorName!,
                                    style: const TextStyle(color: AppTheme.muted, fontSize: 10.5),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ],
                      ),
                    ),
                    Container(
                      margin: const EdgeInsets.only(left: AppTheme.s8),
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                      child: Text(
                        formatPrice(expense.amount),
                        style: const TextStyle(color: AppTheme.accent, fontSize: 11.5, fontWeight: FontWeight.w800),
                      ),
                    ),
                    _ExpenseRowMenu(
                      showViewReceipt: expense.hasBillDocument,
                      onEdit: () async {
                        await showExpenseFormSheet(context, expense: expense);
                        ref.read(expensesViewModelProvider.notifier).loadExpenses();
                      },
                      onViewReceipt: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => IdProofViewerScreen(
                            title: 'Receipt · ${expense.title}',
                            load: () async {
                              final res = await ref.read(expensesViewModelProvider.notifier).usecase.expenseBill(expense.id);
                              return (Uint8List.fromList(res.data!), res.headers.value('content-type'));
                            },
                          ),
                        ),
                      ),
                      onDelete: () => _confirmDelete(context, ref),
                    ),
                  ],
                ),
                const SizedBox(height: AppTheme.s8),
                Container(height: 1, color: AppTheme.border),
                const SizedBox(height: AppTheme.s8),
                Padding(
                  padding: const EdgeInsets.only(right: AppTheme.s8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Flexible(
                        flex: 3,
                        child: _Field(
                          label: 'Date',
                          value: expense.paymentStatus == 'PENDING'
                              ? formatIsoDate(expense.expenseDate)
                              : '${formatIsoDate(expense.expenseDate)} · ${kPaymentMethodLabel[expense.paymentMethod] ?? expense.paymentMethod}',
                        ),
                      ),
                      const SizedBox(width: AppTheme.s16),
                      if (statusLabel != null)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                          decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                          child: Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 10.5, fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Delete this expense?', style: TextStyle(color: AppTheme.heading)),
        content: Text('“${expense.title}” · ${formatPrice(expense.amount)}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(expensesViewModelProvider.notifier).deleteExpense(expense.id);
    }
  }
}

/// A labelled fact, same construction as _Field in assets_list_panel.dart.
class _Field extends StatelessWidget {
  final String label;
  final String value;

  const _Field({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 10.5, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 1),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppTheme.heading, fontSize: 12, fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

/// The ⋮ row menu — mirrors RowMenu in ExpensesPanel.jsx: "Edit expense",
/// "View receipt" (only when a bill is attached), and "Delete expense".
/// Same elevated, icon-led look as [_AssetRowMenu].
class _ExpenseRowMenu extends StatelessWidget {
  final bool showViewReceipt;
  final VoidCallback onEdit;
  final VoidCallback onViewReceipt;
  final VoidCallback onDelete;

  const _ExpenseRowMenu({
    required this.showViewReceipt,
    required this.onEdit,
    required this.onViewReceipt,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return NeuActionMenu<VoidCallback>(
      iconSize: 20,
      actions: [
        NeuMenuAction(onEdit, Icons.edit_outlined, 'Edit expense'),
        if (showViewReceipt) NeuMenuAction(onViewReceipt, Icons.receipt_outlined, 'View receipt'),
        NeuMenuAction(onDelete, Icons.delete_outline_rounded, 'Delete expense', danger: true),
      ],
      onSelected: (action) => action(),
    );
  }
}

