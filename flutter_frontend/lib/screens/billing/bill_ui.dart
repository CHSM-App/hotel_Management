import 'package:flutter/material.dart';

import '../../widgets/format.dart';
import '../theme.dart';

/// Shared pieces of the food and service issue-bill pages, styled to match
/// the room bill ([IssueBillScreen]): white header, bordered document card,
/// compact rows.

AppBar billAppBar({
  required String title,
  String? subtitle,
  required VoidCallback onBack,
}) {
  return AppBar(
    leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: AppTheme.heading),
          onPressed: onBack,
        ),
    title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: AppTheme.heading,
                fontSize: 16,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.2,
              ),
            ),
            if (subtitle != null && subtitle.isNotEmpty)
              Text(
                subtitle,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
          ],
        ),
  );
}

/// The bordered white card a bill is written on.
class BillCard extends StatelessWidget {
  final List<Widget> children;

  const BillCard({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }
}

/// Top of the bill: document type, GST chip, who it is for, and the total.
class BillHero extends StatelessWidget {
  final String label;
  final String chip;
  final String? title;
  final String? subtitle;
  final num total;

  const BillHero({
    super.key,
    required this.label,
    required this.chip,
    required this.total,
    this.title,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long_rounded, color: AppTheme.muted, size: 14),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: AppTheme.muted,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppTheme.sidebarBrandWash,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  chip,
                  style: const TextStyle(
                    color: AppTheme.sidebarBrandInk,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (title != null && title!.isNotEmpty)
                      Text(
                        title!,
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.2,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    if (subtitle != null && subtitle!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text(
                    'GRAND TOTAL',
                    style: TextStyle(
                      color: AppTheme.muted,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                    ),
                  ),
                  Text(
                    formatPrice(total),
                    style: const TextStyle(
                      color: AppTheme.heading,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.4,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class BillSectionLabel extends StatelessWidget {
  final String text;

  const BillSectionLabel(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 2, bottom: 6),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          color: AppTheme.muted,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.7,
        ),
      ),
    );
  }
}

const billHairline = Divider(height: 14, thickness: 0.8, color: AppTheme.border);

/// One itemised line: name, "qty × price" beneath, amount on the right.
class BillItemRow extends StatelessWidget {
  final String name;
  final String detail;
  final num value;

  const BillItemRow({super.key, required this.name, required this.detail, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                if (detail.isNotEmpty)
                  Text(detail, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(value),
            style: const TextStyle(
              color: AppTheme.heading,
              fontSize: 13,
              fontWeight: FontWeight.w700,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class BillRowLine extends StatelessWidget {
  final String label;
  final num value;
  final bool strong;
  final bool muted;

  const BillRowLine({
    super.key,
    required this.label,
    required this.value,
    this.strong = false,
    this.muted = false,
  });

  @override
  Widget build(BuildContext context) {
    final colour = strong
        ? AppTheme.heading
        : muted
        ? AppTheme.muted
        : AppTheme.text;
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: colour,
                fontSize: strong ? 14.5 : (muted ? 12 : 13),
                fontWeight: strong ? FontWeight.w700 : FontWeight.w400,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(value),
            style: TextStyle(
              color: colour,
              fontSize: strong ? 15 : (muted ? 12 : 13),
              fontWeight: strong ? FontWeight.w800 : FontWeight.w500,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class BillBalanceBox extends StatelessWidget {
  final num balance;

  const BillBalanceBox({super.key, required this.balance});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.sidebarBrandWash,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.sidebarBrandWashEdge),
      ),
      child: Row(
        children: [
          const Text(
            'BALANCE DUE',
            style: TextStyle(
              color: AppTheme.sidebarBrandInk,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
            ),
          ),
          const Spacer(),
          Text(
            formatPrice(balance),
            style: const TextStyle(
              color: AppTheme.sidebarBrandInk,
              fontWeight: FontWeight.w800,
              fontSize: 17,
              letterSpacing: -0.3,
            ),
          ),
        ],
      ),
    );
  }
}

/// "Record payment" heading with what is due on the right.
class BillPaymentHeader extends StatelessWidget {
  final bool nothingDue;
  final num balanceDue;

  const BillPaymentHeader({super.key, required this.nothingDue, required this.balanceDue});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppTheme.accent,
                borderRadius: BorderRadius.circular(7),
              ),
              child: const Icon(Icons.payments_rounded, color: Colors.white, size: 13),
            ),
            const SizedBox(width: 10),
            const Text(
              'Record payment',
              style: TextStyle(color: AppTheme.heading, fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const Spacer(),
            Text(
              nothingDue ? 'Nothing due' : '${formatPrice(balanceDue)} due',
              style: TextStyle(
                color: nothingDue ? AppTheme.vacant : AppTheme.accent,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Padding(
          padding: const EdgeInsets.only(left: 34),
          child: Text(
            nothingDue
                ? 'Nothing is left to collect — issue it as it stands.'
                : 'Choose the payment type for each amount taken.',
            style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
          ),
        ),
      ],
    );
  }
}

/// White bordered wrapper for the payment rows.
class BillPanel extends StatelessWidget {
  final Widget child;

  const BillPanel({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: child,
    );
  }
}
