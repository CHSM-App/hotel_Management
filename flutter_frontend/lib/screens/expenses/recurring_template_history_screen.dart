import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'expense_form_screen.dart';

/// Every expense a recurring template has generated, oldest to newest — how
/// a variable-amount recurring bill (electricity, sometimes salaries) gets
/// reviewed against past cycles. Mirrors openTemplateHistory in
/// ExpensesPanel.jsx.
Future<void> showRecurringTemplateHistoryScreen(BuildContext context, {required RecurringTemplate template}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => RecurringTemplateHistoryScreen(template: template)),
  );
}

class RecurringTemplateHistoryScreen extends ConsumerStatefulWidget {
  final RecurringTemplate template;
  const RecurringTemplateHistoryScreen({super.key, required this.template});

  @override
  ConsumerState<RecurringTemplateHistoryScreen> createState() => _RecurringTemplateHistoryScreenState();
}

class _RecurringTemplateHistoryScreenState extends ConsumerState<RecurringTemplateHistoryScreen> {
  List<Expense>? _expenses;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final expenses = await ref.read(expensesViewModelProvider.notifier).templateHistory(widget.template.id);
    if (!mounted) return;
    setState(() {
      _expenses = expenses;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final template = widget.template;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(template.title, overflow: TextOverflow.ellipsis),
            Text(
              '${template.categoryName} · ${kFrequencyLabel[template.frequency] ?? template.frequency}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
      floatingActionButton: template.isActive
          ? FloatingActionButton.extended(
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Log this month'),
              onPressed: () async {
                await showLogOccurrenceFormSheet(context, template: template);
                _load();
              },
            )
          : null,
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                color: AppTheme.accent,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 88),
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: [
                    if ((_expenses ?? const []).isEmpty)
                      const NeuNotice(
                        icon: Icons.event_repeat_rounded,
                        message: 'No occurrences logged yet. "Log this month" records one with its own amount and vendor.',
                      )
                    else
                      for (final e in _expenses!)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppTheme.s8),
                          child: _OccurrenceCard(
                            expense: e,
                            onChanged: _load,
                          ),
                        ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _OccurrenceCard extends StatelessWidget {
  final Expense expense;
  final VoidCallback onChanged;
  const _OccurrenceCard({required this.expense, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final statusLabel = kPaymentStatusLabel[expense.paymentStatus];
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      onTap: () async {
        await showExpenseFormSheet(context, expense: expense, viewMode: true);
        onChanged();
      },
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(formatIsoDate(expense.expenseDate), style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        expense.vendorName ?? kPaymentMethodLabel[expense.paymentMethod] ?? expense.paymentMethod,
                        style: Theme.of(context).textTheme.bodySmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (statusLabel != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                        decoration: BoxDecoration(
                          color: (expense.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: expense.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          Text(formatPrice(expense.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
        ],
      ),
    );
  }
}
