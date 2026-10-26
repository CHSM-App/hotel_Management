import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/customer.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/customers_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/h_scroll_table.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'customer_detail_screen.dart';
import 'customer_feedback_panel.dart';
import 'customer_form_screen.dart';

/// Customers this property has done business with — mirrors Customers.jsx's
/// shell: two tabs (Customers, Customer Feedback), the first a stats row, a
/// search box with an opted-in filter, and a list that opens a profile on
/// tap, as either cards or a spreadsheet-style table. Same /customers
/// endpoint, same client-side filter, same cards/table toggle
/// ExpensesListPanel and AssetsListPanel each carry.
class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});

  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  final _search = TextEditingController();

  /// 'table' is the landing view — scanning every customer's stays/spend at
  /// once, same default ExpensesListPanel lands on. 'cards' is one customer
  /// at a time, easier to read on a phone, a toggle away.
  String? _view;

  /// Which of the two tabs is showing — mirrors Customers.jsx's own
  /// `activeTab` state ('customers' | 'feedback').
  String _tab = 'customers';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(customersViewModelProvider.notifier).loadAll());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(customersViewModelProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: _CustomerSubTabs(
            selected: _tab,
            feedbackCount: state.feedback?.totals.count,
            onSelect: (t) {
              setState(() => _tab = t);
              if (t == 'feedback') {
                ref.read(customersViewModelProvider.notifier).loadFeedback();
              }
            },
          ),
        ),
        Expanded(
          child: _tab == 'feedback'
              ? const CustomerFeedbackPanel()
              : _buildCustomersTab(context, state),
        ),
      ],
    );
  }

  Widget _buildCustomersTab(BuildContext context, CustomersState state) {
    if (state.error != null && state.customers.isEmpty) {
      return NeuNotice(
        message: state.error!,
        icon: Icons.cloud_off_rounded,
        action: NeuButton(
          onPressed: () => ref.read(customersViewModelProvider.notifier).loadAll(),
          child: const Text('Try again'),
        ),
      );
    }
    if (state.isLoading && state.customers.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    final filtered = state.filtered;
    // Phones get cards by default — the table needs sideways scrolling there.
    final view = _view ?? (MediaQuery.of(context).size.width < 600 ? 'cards' : 'table');

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          // In table view the scroll is the rows', a level below the
          // table's horizontal scroller.
          notificationPredicate: (n) => n.metrics.axis == Axis.vertical,
          onRefresh: () => ref.read(customersViewModelProvider.notifier).loadAll(),
          color: AppTheme.accent,
          child: TablePageBody(
            table: view == 'table',
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 88),
            children: [
              _StatsRow(stats: state.stats, inView: filtered.length),
              const SizedBox(height: AppTheme.s8),
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
                              onChanged: (v) =>
                                  ref.read(customersViewModelProvider.notifier).setSearch(v),
                              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                              decoration: const InputDecoration(
                                hintText: 'Search name, phone, email or tags',
                                hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                                border: InputBorder.none,
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(vertical: 10),
                              ),
                            ),
                          ),
                          if (_search.text.isNotEmpty)
                            GestureDetector(
                              onTap: () {
                                _search.clear();
                                ref.read(customersViewModelProvider.notifier).setSearch('');
                                setState(() {});
                              },
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
                  _ViewToggleButton(view: view, onSelect: (v) => setState(() => _view = v)),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              _OptedInFilterChip(
                selected: state.optedInOnly,
                onTap: () => ref
                    .read(customersViewModelProvider.notifier)
                    .setOptedInOnly(!state.optedInOnly),
              ),
              const SizedBox(height: AppTheme.s8),
              if (filtered.isEmpty)
                NeuNotice(
                  icon: Icons.people_outline_rounded,
                  message: state.customers.isEmpty
                      ? 'No customers on file yet. They build up automatically as rooms and events are booked, or add one directly.'
                      : 'No customer matches this filter.',
                )
              else ...[
                _SummaryStrip(count: filtered.length),
                const SizedBox(height: AppTheme.s12),
                if (view == 'table')
                  _CustomerTable(customers: filtered)
                else
                  _CustomerCardsGrid(customers: filtered),
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
            tooltip: 'Add customer',
            onPressed: () => showCustomerFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

/// Customers / Feedback switcher — shared [PillTabs], with the feedback tab's
/// response count badged the same way the web does.
class _CustomerSubTabs extends StatelessWidget {
  final String selected;
  final int? feedbackCount;
  final ValueChanged<String> onSelect;

  const _CustomerSubTabs({required this.selected, required this.onSelect, this.feedbackCount});

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: [
        const PillTab('customers', 'Customers', Icons.groups_rounded),
        PillTab('feedback', 'Feedback', Icons.star_rounded, count: feedbackCount),
      ],
    );
  }
}

/// Three equal-width KPI tiles in one row — same tinted-icon-badge + value +
/// label construction the app's other stat tiles use, forced to identical
/// height/width via [Expanded] so the row reads as one steady strip rather
/// than three cards sized by how long their own number happens to be.
class _StatsRow extends StatelessWidget {
  final CustomersStats stats;
  final int inView;

  const _StatsRow({required this.stats, required this.inView});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _StatTile(icon: Icons.groups_rounded, color: AppTheme.accent, value: '${stats.total}', label: 'Total'),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: _StatTile(icon: Icons.campaign_rounded, color: AppTheme.checkout, value: '${stats.optedIn}', label: 'Opted in'),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: _StatTile(icon: Icons.filter_alt_rounded, color: AppTheme.edit, value: '$inView', label: 'In view'),
        ),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String value;
  final String label;

  const _StatTile({required this.icon, required this.color, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 52,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 24,
            height: 24,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(icon, size: 13, color: color),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppTheme.heading, fontSize: 15, fontWeight: FontWeight.w800),
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppTheme.muted, fontSize: 10, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A single tappable pill — whole row toggles the filter, not just a tiny
/// checkbox target, and fills solid once active so "filtering" is visible at
/// a glance rather than read off a small tick mark.
class _OptedInFilterChip extends StatelessWidget {
  final bool selected;
  final VoidCallback onTap;

  const _OptedInFilterChip({required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent.withValues(alpha: 0.10) : AppTheme.card,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? AppTheme.accent.withValues(alpha: 0.4) : AppTheme.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              selected ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
              size: 15,
              color: selected ? AppTheme.accent : AppTheme.muted,
            ),
            const SizedBox(width: 6),
            Text(
              'Opted in only',
              style: TextStyle(
                color: selected ? AppTheme.accent : AppTheme.text,
                fontSize: 12,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cards vs. spreadsheet — same toggle construction as
/// ExpensesListPanel/AssetsListPanel so every register in the app reads as
/// one language.
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

/// A quick "N customers" line above the list, reflecting whatever search and
/// opted-in filter are currently narrowing it — same spot ExpensesListPanel
/// puts its own running total.
class _SummaryStrip extends StatelessWidget {
  final int count;
  const _SummaryStrip({required this.count});

  @override
  Widget build(BuildContext context) {
    return Text(
      '$count customer${count == 1 ? '' : 's'}',
      style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w500),
    );
  }
}

// ── Spreadsheet view ────────────────────────────────────────────────────

class _CustomerTableColumn {
  final String key;
  final String label;
  final double width;
  final TextAlign align;

  const _CustomerTableColumn(this.key, this.label, {this.width = 100, this.align = TextAlign.left});
}

const _kCustomerTableColumns = [
  _CustomerTableColumn('name', 'Name', width: 150),
  _CustomerTableColumn('phone', 'Phone', width: 110),
  _CustomerTableColumn('stays', 'Stays', width: 70, align: TextAlign.right),
  _CustomerTableColumn('spend', 'Spend', width: 100, align: TextAlign.right),
  _CustomerTableColumn('lastVisit', 'Last visit', width: 100),
  _CustomerTableColumn('tags', 'Tags', width: 120),
  _CustomerTableColumn('offers', 'Offers', width: 90),
];

/// The sheet-style view — every customer's name/phone/stays/spend/last
/// visit/tags/opt-in in one scrollable grid, same tinted header + shaded
/// rows as [_ExpenseTable] in expenses_list_panel.dart.
class _CustomerTable extends StatelessWidget {
  final List<Customer> customers;
  const _CustomerTable({required this.customers});

  @override
  Widget build(BuildContext context) {
    final width = _kCustomerTableColumns.fold<double>(0, (sum, c) => sum + c.width) + 36;

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
                      for (final c in _kCustomerTableColumns)
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
                      for (var i = 0; i < customers.length; i++)
                        _CustomerTableRow(customer: customers[i], shaded: i.isOdd),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CustomerTableRow extends StatelessWidget {
  final Customer customer;
  final bool shaded;

  const _CustomerTableRow({required this.customer, required this.shaded});

  @override
  Widget build(BuildContext context) {
    final stays = customer.totalStays + customer.totalEvents;
    final lastVisit = customer.lastStayDate ?? customer.lastEventDate;
    final cells = {
      'name': customer.name,
      'phone': customer.phone,
      'stays': '$stays',
      'spend': formatPrice(customer.totalSpend),
      'lastVisit': lastVisit != null ? formatIsoDate(lastVisit) : '—',
      'tags': (customer.tags != null && customer.tags!.isNotEmpty) ? customer.tags! : '—',
    };

    return GestureDetector(
      onTap: () => showCustomerDetailScreen(context, customer.id),
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
          border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (final c in _kCustomerTableColumns)
              SizedBox(
                width: c.width,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                  child: c.key == 'offers'
                      ? Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(
                              color: (customer.marketingOptIn ? AppTheme.checkout : AppTheme.muted)
                                  .withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              customer.marketingOptIn ? 'Opted in' : 'Opted out',
                              style: TextStyle(
                                color: customer.marketingOptIn ? AppTheme.checkout : AppTheme.muted,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
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
                            fontWeight: c.key == 'name' ? FontWeight.w600 : FontWeight.w400,
                          ),
                        ),
                ),
              ),
            SizedBox(
              width: 36,
              child: NeuActionMenu<String>(
                iconSize: 18,
                actions: const [
                  NeuMenuAction('view', Icons.person_outline_rounded, 'View profile'),
                ],
                onSelected: (v) {
                  if (v == 'view') showCustomerDetailScreen(context, customer.id);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Card view ───────────────────────────────────────────────────────────

/// Responsive card grid — one column on a phone-width screen, two on a
/// wider phone/tablet, three past that. Same measure-once-with-LayoutBuilder
/// approach as [_ExpenseCardsGrid]/[_AssetCardsGrid].
class _CustomerCardsGrid extends StatelessWidget {
  final List<Customer> customers;
  const _CustomerCardsGrid({required this.customers});

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
            for (final c in customers) SizedBox(width: width, child: _CustomerCard(customer: c)),
          ],
        );
      },
    );
  }
}

/// A compact, modern card: avatar initials + name + phone, a tinted spend
/// badge, a thin divider, then a tight stays/last-visit/offers row — same
/// construction as [_ExpenseCard] so every register shares one card
/// language across the app.
class _CustomerCard extends StatelessWidget {
  final Customer customer;
  const _CustomerCard({required this.customer});

  @override
  Widget build(BuildContext context) {
    final stays = customer.totalStays + customer.totalEvents;
    final lastVisit = customer.lastStayDate ?? customer.lastEventDate;

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
          onTap: () => showCustomerDetailScreen(context, customer.id),
          child: Padding(
            padding: const EdgeInsets.all(AppTheme.s12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(color: AppTheme.sidebarBrandWash, shape: BoxShape.circle),
                      child: Text(
                        customer.name.isNotEmpty ? customer.name[0].toUpperCase() : '?',
                        style: const TextStyle(color: AppTheme.sidebarBrandInk, fontWeight: FontWeight.w700, fontSize: 14),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(customer.name, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                          Text(customer.phone, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                        ],
                      ),
                    ),
                    Container(
                      margin: const EdgeInsets.only(left: AppTheme.s8),
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                      child: Text(
                        formatPrice(customer.totalSpend),
                        style: const TextStyle(color: AppTheme.accent, fontSize: 11, fontWeight: FontWeight.w800),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppTheme.s8),
                Container(height: 1, color: AppTheme.border),
                const SizedBox(height: AppTheme.s8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: _Field(label: 'Stays', value: '$stays'),
                    ),
                    Expanded(
                      flex: 2,
                      child: _Field(label: 'Last visit', value: lastVisit != null ? formatIsoDate(lastVisit) : '—'),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                      decoration: BoxDecoration(
                        color: (customer.marketingOptIn ? AppTheme.checkout : AppTheme.muted).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        customer.marketingOptIn ? 'Opted in' : 'Opted out',
                        style: TextStyle(
                          color: customer.marketingOptIn ? AppTheme.checkout : AppTheme.muted,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                if (customer.tags != null && customer.tags!.isNotEmpty) ...[
                  const SizedBox(height: AppTheme.s8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      for (final tag in customer.tags!.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty))
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(color: AppTheme.edit.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                          child: Text(tag, style: const TextStyle(color: AppTheme.edit, fontSize: 10, fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A labelled fact, same construction as _Field in expenses_list_panel.dart.
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
