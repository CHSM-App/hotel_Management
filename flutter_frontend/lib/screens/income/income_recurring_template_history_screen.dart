import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/income.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'income_form_screen.dart';

/// Every income entry a recurring template has generated, oldest to newest —
/// how a variable-amount recurring receipt gets reviewed against past
/// cycles. Mirrors openTemplateHistory in IncomePanel.jsx.
Future<void> showIncomeRecurringTemplateHistoryScreen(BuildContext context, {required IncomeRecurringTemplate template}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => IncomeRecurringTemplateHistoryScreen(template: template)),
  );
}

class IncomeRecurringTemplateHistoryScreen extends ConsumerStatefulWidget {
  final IncomeRecurringTemplate template;
  const IncomeRecurringTemplateHistoryScreen({super.key, required this.template});

  @override
  ConsumerState<IncomeRecurringTemplateHistoryScreen> createState() => _IncomeRecurringTemplateHistoryScreenState();
}

class _IncomeRecurringTemplateHistoryScreenState extends ConsumerState<IncomeRecurringTemplateHistoryScreen> {
  List<IncomeEntry>? _income;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final income = await ref.read(incomeViewModelProvider.notifier).templateHistory(widget.template.id);
    if (!mounted) return;
    setState(() {
      _income = income;
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
                await showLogIncomeOccurrenceFormSheet(context, template: template);
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
                    if ((_income ?? const []).isEmpty)
                      const NeuNotice(
                        icon: Icons.event_repeat_rounded,
                        message: 'No occurrences logged yet. "Log this month" records one with its own amount and payer.',
                      )
                    else
                      for (final e in _income!)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppTheme.s8),
                          child: _OccurrenceCard(
                            income: e,
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
  final IncomeEntry income;
  final VoidCallback onChanged;
  const _OccurrenceCard({required this.income, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final statusLabel = kIncomeStatusLabel[income.paymentStatus];
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      onTap: () async {
        await showIncomeFormSheet(context, income: income, viewMode: true);
        onChanged();
      },
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(formatIsoDate(income.incomeDate), style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        income.payerName ?? kPaymentMethodLabel[income.paymentMethod] ?? income.paymentMethod,
                        style: Theme.of(context).textTheme.bodySmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (statusLabel != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                        decoration: BoxDecoration(
                          color: (income.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: income.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout,
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
          Text(formatPrice(income.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
        ],
      ),
    );
  }
}
