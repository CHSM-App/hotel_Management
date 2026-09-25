import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'expense_form_screen.dart';
import 'recurring_template_form_screen.dart';
import 'recurring_template_history_screen.dart';

/// Expenses > Recurring — mirrors the Recurring tab in ExpensesPanel.jsx: a
/// repeat schedule only, no amount or vendor on the template itself. Those
/// are entered each cycle via "Log this month", which is also the only way
/// an occurrence gets created — there is no background job that generates
/// due expenses on its own.
class ExpensesRecurringPanel extends ConsumerWidget {
  const ExpensesRecurringPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(expensesViewModelProvider);
    final sorted = [...state.templates]..sort((a, b) => a.nextDueDate.compareTo(b.nextDueDate));

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(expensesViewModelProvider.notifier).loadCatalogue(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.catalogueLoading && state.templates.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (sorted.isEmpty)
                const NeuNotice(
                  icon: Icons.event_repeat_rounded,
                  message: 'No recurring expenses set up. Add rent, electricity or any other bill that repeats on a '
                      'schedule — "Log this month" records each occurrence by hand, with its own amount and vendor, '
                      'once it\'s actually due.',
                )
              else
                for (final t in sorted)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _TemplateCard(template: t),
                  ),
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            onPressed: () => showRecurringTemplateFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _TemplateCard extends ConsumerWidget {
  final RecurringTemplate template;
  const _TemplateCard({required this.template});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final daysUntilDue = template.nextDueDate.isEmpty
        ? null
        : DateTime.tryParse(template.nextDueDate)?.difference(DateTime.now()).inDays;
    final Color dueColor;
    final String dueLabel;
    if (daysUntilDue == null) {
      dueColor = AppTheme.muted;
      dueLabel = formatIsoDate(template.nextDueDate);
    } else if (daysUntilDue < 0) {
      dueColor = AppTheme.danger;
      dueLabel = 'Overdue since ${formatIsoDate(template.nextDueDate)}';
    } else if (daysUntilDue == 0) {
      dueColor = AppTheme.danger;
      dueLabel = 'Due today';
    } else if (daysUntilDue <= 7) {
      dueColor = const Color(0xFFB7791F);
      dueLabel = 'Due in $daysUntilDue day${daysUntilDue == 1 ? '' : 's'}';
    } else {
      dueColor = AppTheme.checkout;
      dueLabel = 'Due in $daysUntilDue day${daysUntilDue == 1 ? '' : 's'}';
    }

    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      onTap: () => showRecurringTemplateHistoryScreen(context, template: template),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            template.title,
                            style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 14),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (!template.isActive) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(6)),
                            child: const Text('Paused', style: TextStyle(color: AppTheme.muted, fontSize: 10)),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${template.categoryName} · ${kFrequencyLabel[template.frequency] ?? template.frequency}',
                      style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                decoration: BoxDecoration(color: dueColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                child: Text(dueLabel, style: TextStyle(color: dueColor, fontSize: 10.5, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              if (template.isActive) ...[
                Expanded(
                  child: NeuButton(
                    primary: true,
                    expand: true,
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4, vertical: AppTheme.s8),
                    onPressed: () => showLogOccurrenceFormSheet(context, template: template),
                    child: const Text('Log this month'),
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
              ],
              TextButton(
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: () => showRecurringTemplateFormScreen(context, template: template),
                child: const Text('Edit'),
              ),
              TextButton(
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: () => ref.read(expensesViewModelProvider.notifier).toggleTemplate(template),
                child: Text(template.isActive ? 'Pause' : 'Resume'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
