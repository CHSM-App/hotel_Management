import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/income.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'income_form_screen.dart';

/// Income > Interest — mirrors the Interest tab in IncomePanel.jsx: every
/// income entry filed under the "Interest Earned" category, with a running
/// total and a shortcut ("+ Add interest voucher") that opens the income form
/// pre-filled so the desk doesn't retype the category/title/method each time
/// the bank credits interest. Bank-interest vouchers are ordinary income
/// entries under one category, so Reports' Other Income picks them up with no
/// extra wiring.
class IncomeInterestPanel extends ConsumerStatefulWidget {
  const IncomeInterestPanel({super.key});

  @override
  ConsumerState<IncomeInterestPanel> createState() => _IncomeInterestPanelState();
}

class _IncomeInterestPanelState extends ConsumerState<IncomeInterestPanel> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(incomeViewModelProvider.notifier).loadIncome());
  }

  Future<void> _addVoucher() async {
    await showInterestVoucherFormSheet(context);
    if (!mounted) return;
    ref.read(incomeViewModelProvider.notifier).loadIncome();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(incomeViewModelProvider);
    final entries = [...state.income.where((e) => e.categoryName.toLowerCase() == kInterestIncomeCategory.toLowerCase())]
      ..sort((a, b) => b.incomeDate.compareTo(a.incomeDate));
    final total = entries.fold<num>(0, (sum, e) => sum + e.amount);

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(incomeViewModelProvider.notifier).loadIncome(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              NeuCard(
                padding: const EdgeInsets.all(AppTheme.s16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Bank interest earned',
                      style: TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 4),
                    Text(formatPrice(total), style: const TextStyle(color: AppTheme.heading, fontSize: 20, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              if (state.isLoading && state.income.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (entries.isEmpty)
                const NeuNotice(
                  icon: Icons.account_balance_rounded,
                  message: 'No interest vouchers yet. Add one when the bank credits interest.',
                )
              else
                for (final e in entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _InterestCard(income: e),
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
            onPressed: _addVoucher,
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _InterestCard extends ConsumerWidget {
  final IncomeEntry income;
  const _InterestCard({required this.income});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      onTap: () async {
        await showIncomeFormSheet(context, income: income, viewMode: true);
        ref.read(incomeViewModelProvider.notifier).loadIncome();
      },
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
            child: const Icon(Icons.account_balance_rounded, size: 19, color: AppTheme.accent),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(income.title, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 3),
                Text(
                  [
                    formatIsoDate(income.incomeDate),
                    if (income.payerName != null) income.payerName!,
                    if (income.description.isNotEmpty) income.description,
                  ].join(' · '),
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(formatPrice(income.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14.5)),
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.danger),
                onPressed: () => _confirmDelete(context, ref),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Delete this income entry?', style: TextStyle(color: AppTheme.heading)),
        content: Text('"${income.title}" · ${formatPrice(income.amount)}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(incomeViewModelProvider.notifier).deleteIncome(income.id);
    }
  }
}
