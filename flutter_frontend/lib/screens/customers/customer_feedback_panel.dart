import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/customer.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Customer Feedback tab — mirrors Customers.jsx's feedback tab: two KPI
/// cards (responses on file, average rating) then a Guest/Checked out/
/// Rating/Comment/Submitted table. Feedback is only ever submitted by the
/// guest via their checkout link, so this tab is read-only, same as the web.
class CustomerFeedbackPanel extends ConsumerWidget {
  const CustomerFeedbackPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(customersViewModelProvider);
    final result = state.feedback;

    if (state.feedbackError != null && result == null) {
      return NeuNotice(
        message: state.feedbackError!,
        icon: Icons.cloud_off_rounded,
        action: NeuButton(
          onPressed: () => ref.read(customersViewModelProvider.notifier).loadFeedback(force: true),
          child: const Text('Try again'),
        ),
      );
    }
    if (state.feedbackLoading && result == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final responses = result?.responses ?? const <CustomerFeedbackResponse>[];

    return RefreshIndicator(
      onRefresh: () => ref.read(customersViewModelProvider.notifier).loadFeedback(force: true),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 88),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _FeedbackStatsRow(totals: result?.totals ?? const CustomerFeedbackTotals()),
          const SizedBox(height: AppTheme.s12),
          if (responses.isEmpty)
            const NeuNotice(
              icon: Icons.reviews_outlined,
              message: 'No feedback submitted yet. Guests can leave a rating and comment from the link sent after checkout.',
            )
          else
            _FeedbackTable(responses: responses),
        ],
      ),
    );
  }
}

class _FeedbackStatsRow extends StatelessWidget {
  final CustomerFeedbackTotals totals;
  const _FeedbackStatsRow({required this.totals});

  @override
  Widget build(BuildContext context) {
    final avg = totals.averageRating;
    return Row(
      children: [
        Expanded(
          child: _FeedbackStatTile(
            icon: Icons.forum_rounded,
            color: AppTheme.accent,
            value: '${totals.count}',
            label: 'Responses',
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: _FeedbackStatTile(
            icon: Icons.star_rounded,
            color: AppTheme.checkout,
            value: avg == null ? '—' : '${avg.toStringAsFixed(1)} / 5',
            label: 'Average rating',
          ),
        ),
      ],
    );
  }
}

class _FeedbackStatTile extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String value;
  final String label;

  const _FeedbackStatTile({required this.icon, required this.color, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(icon, size: 14, color: color),
          ),
          const SizedBox(height: AppTheme.s8),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppTheme.heading, fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppTheme.muted, fontSize: 11, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}

class _FeedbackColumn {
  final String key;
  final String label;
  final double width;

  const _FeedbackColumn(this.key, this.label, {this.width = 100});
}

const _kFeedbackColumns = [
  _FeedbackColumn('guest', 'Guest', width: 140),
  _FeedbackColumn('checkedOut', 'Checked out', width: 100),
  _FeedbackColumn('rating', 'Rating', width: 100),
  _FeedbackColumn('comment', 'Comment', width: 220),
  _FeedbackColumn('submitted', 'Submitted', width: 100),
];

/// Sheet-style table — same tinted header + shaded rows as [_CustomerTable]
/// in customers_screen.dart, scaled to the feedback response's columns.
class _FeedbackTable extends StatelessWidget {
  final List<CustomerFeedbackResponse> responses;
  const _FeedbackTable({required this.responses});

  @override
  Widget build(BuildContext context) {
    final width = _kFeedbackColumns.fold<double>(0, (sum, c) => sum + c.width);

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: width,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                  ),
                  child: Row(
                    children: [
                      for (final c in _kFeedbackColumns)
                        SizedBox(
                          width: c.width,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                            child: Text(
                              c.label.toUpperCase(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppTheme.sidebarBrandInk,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.3,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                // Only the rows scroll vertically, so the header above stays
                // pinned however long the list gets.
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(context).height * 0.6,
                  ),
                  child: ListView(
                    shrinkWrap: true,
                    padding: EdgeInsets.zero,
                    children: [
                      for (var i = 0; i < responses.length; i++)
                        _FeedbackRow(response: responses[i], shaded: i.isOdd),
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
}

class _FeedbackRow extends StatelessWidget {
  final CustomerFeedbackResponse response;
  final bool shaded;

  const _FeedbackRow({required this.response, required this.shaded});

  @override
  Widget build(BuildContext context) {
    final rating = response.rating.clamp(0, 5).toInt();
    final stars = '★' * rating + '☆' * (5 - rating);
    final checkedOut = formatIsoDate(response.checkOutDate);
    final submitted = formatIsoDate(response.submittedAt);
    final cells = {
      'guest': response.guestName ?? '—',
      'checkedOut': checkedOut.isEmpty ? '—' : checkedOut,
      'rating': stars,
      'comment': response.comment.isNotEmpty ? response.comment : '—',
      'submitted': submitted.isEmpty ? '—' : submitted,
    };

    return Container(
      decoration: BoxDecoration(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          for (final c in _kFeedbackColumns)
            SizedBox(
              width: c.width,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                child: c.key == 'rating'
                    ? Text(
                        cells[c.key] ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.checkout, fontSize: 13, fontWeight: FontWeight.w600),
                      )
                    : Text(
                        cells[c.key] ?? '',
                        maxLines: c.key == 'comment' ? 3 : 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppTheme.text,
                          fontSize: 12.5,
                          fontWeight: c.key == 'guest' ? FontWeight.w600 : FontWeight.w400,
                        ),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}
