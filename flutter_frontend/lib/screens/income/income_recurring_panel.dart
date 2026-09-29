import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/income.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'income_form_screen.dart';
import 'income_recurring_template_form_screen.dart';
import 'income_recurring_template_history_screen.dart';

/// Income > Recurring — mirrors the Recurring tab in IncomePanel.jsx: a
/// repeat schedule only, no amount or payer fixed on the template itself
/// (payer may be pre-filled but is still entered/confirmed each cycle).
/// Those are entered each cycle via "Log this month", which is also the only
/// way an occurrence gets created — there is no background job that
/// generates due income on its own.
class IncomeRecurringPanel extends ConsumerStatefulWidget {
  const IncomeRecurringPanel({super.key});

  @override
  ConsumerState<IncomeRecurringPanel> createState() => _IncomeRecurringPanelState();
}

class _IncomeRecurringPanelState extends ConsumerState<IncomeRecurringPanel> {
  bool _showPaused = false;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(incomeViewModelProvider);
    final pausedCount = state.templates.where((t) => !t.isActive).length;
    final sorted = [...state.templates.where((t) => _showPaused || t.isActive)]
      ..sort((a, b) => a.nextDueDate.compareTo(b.nextDueDate));

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(incomeViewModelProvider.notifier).loadCatalogue(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (pausedCount > 0)
                Padding(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s4, 0, AppTheme.s4, AppTheme.s8),
                  child: GestureDetector(
                    onTap: () => setState(() => _showPaused = !_showPaused),
                    behavior: HitTestBehavior.opaque,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Checkbox(
                          value: _showPaused,
                          onChanged: (v) => setState(() => _showPaused = v ?? false),
                          activeColor: AppTheme.accent,
                          visualDensity: VisualDensity.compact,
                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          'Show paused ($pausedCount)',
                          style: const TextStyle(color: AppTheme.text, fontSize: 13, fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  ),
                ),
              if (state.catalogueLoading && state.templates.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (sorted.isEmpty)
                NeuNotice(
                  icon: Icons.event_repeat_rounded,
                  message: state.templates.isEmpty
                      ? 'No recurring income set up. Add a shop\'s monthly rent or any other receipt that repeats on a '
                          'schedule — "Log this month" records each occurrence by hand, with its own amount and payer, '
                          'once it\'s actually due.'
                      : 'All recurring income is paused. Tick "Show paused" above to see it.',
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
            onPressed: () => showIncomeRecurringTemplateFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _TemplateCard extends ConsumerWidget {
  final IncomeRecurringTemplate template;
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
      onTap: () => showIncomeRecurringTemplateHistoryScreen(context, template: template),
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
                            style: Theme.of(context).textTheme.titleSmall,
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
                      style: Theme.of(context).textTheme.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
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
                    onPressed: () => showLogIncomeOccurrenceFormSheet(context, template: template),
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
                onPressed: () => showIncomeRecurringTemplateFormScreen(context, template: template),
                child: const Text('Edit'),
              ),
              TextButton(
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: () => ref.read(incomeViewModelProvider.notifier).toggleTemplate(template),
                child: Text(template.isActive ? 'Pause' : 'Resume'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
