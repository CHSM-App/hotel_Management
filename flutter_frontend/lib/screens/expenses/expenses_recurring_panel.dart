import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'recurring_template_form_screen.dart';

/// Expenses > Recurring — mirrors the Recurring tab in ExpensesPanel.jsx
/// exactly: a list of templates with their next due date and a "+" to
/// schedule a new one. There is no manual "Generate due" control here on
/// the web either — a template that's come due is turned into a real
/// expense row silently, once, when the Expenses section opens (see
/// ExpensesScreen.initState / generateDueThenLoad in ExpensesPanel.jsx).
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
                const NeuNotice(icon: Icons.event_repeat_rounded, message: 'No recurring expenses yet. Tap + to schedule one.')
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
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      onTap: () => showRecurringTemplateFormScreen(context, template: template),
      child: Row(
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
                        child: const Text('inactive', style: TextStyle(color: AppTheme.muted, fontSize: 10)),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${template.categoryName} · ${kFrequencyLabel[template.frequency] ?? template.frequency} · next ${formatIsoDate(template.nextDueDate)}',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
              ],
            ),
          ),
          Text(formatPrice(template.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5)),
          TextButton(
            onPressed: () => ref.read(expensesViewModelProvider.notifier).toggleTemplate(template),
            child: Text(template.isActive ? 'Pause' : 'Resume'),
          ),
        ],
      ),
    );
  }
}
