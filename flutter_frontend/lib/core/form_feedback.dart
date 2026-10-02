import 'package:flutter/material.dart';

/// Moves keyboard focus to [node] and scrolls it into view, so a validation
/// or "already exists" error on a field the user can't currently see is
/// never silent — this is the one place that wires focus to
/// [Scrollable.ensureVisible], since [FocusNode.requestFocus] alone does
/// not scroll.
void focusFieldWithError(FocusNode node) {
  node.requestFocus();
  WidgetsBinding.instance.addPostFrameCallback((_) {
    final ctx = node.context;
    if (ctx == null) return;
    Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
      alignment: 0.2,
    );
  });
}

/// One field a backend error might point at: the keywords that identify it
/// in the server's message, and the [FocusNode] to land on when it does.
class BackendFieldError {
  final FocusNode node;
  final List<String> keywords;
  const BackendFieldError(this.node, this.keywords);
}

/// Matches a backend error message (e.g. "Vendor name already exists")
/// against a form's fields by keyword, and if one matches, focuses +
/// scrolls to that field instead of leaving the user to re-read a banner
/// with no idea which field it's about. Returns the matched field's label
/// text (first keyword) so the caller can show a field-level error too, or
/// null if no field matched — in which case the caller should fall back to
/// a plain top-of-form banner.
String? focusBackendFieldError(String message, List<BackendFieldError> fields) {
  final lower = message.toLowerCase();
  for (final field in fields) {
    for (final keyword in field.keywords) {
      if (lower.contains(keyword.toLowerCase())) {
        focusFieldWithError(field.node);
        return message;
      }
    }
  }
  return null;
}
