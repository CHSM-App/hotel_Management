import 'package:flutter/material.dart';

/// The flat palette: a grey-50 surface with white cards sitting on it.
///
/// Depth comes from a plain surface change and a soft drop shadow, not
/// simulated light — a raised element is simply a white [card] on top of
/// [bg], edged with a hairline [border] and a shadow cast straight down.
/// There is no pressed/inset state to fake here; a tap is shown by opacity or
/// a filled variant instead. Named `shadowDark`/`shadowLight` are kept as
/// aliases so call sites built against the old neumorphic tokens still
/// resolve to the right flat colours without per-screen edits.
class AppTheme {
  // ── Surface ───────────────────────────────────────────────────────────────
  static const Color bg = Color(0xFFFAFAFA);
  static const Color card = Color(0xFFFFFFFF);
  static const Color border = Color(0xFFF0F1F3);

  /// Aliases for the old neumorphic tokens — still referenced by shadow
  /// lists and a handful of screens' `Border.all(color: ...)` calls.
  static const Color shadowDark = Color(0xFFE4E6EA);
  static const Color shadowLight = Color(0xFFFFFFFF);

  // ── Text ──────────────────────────────────────────────────────────────────
  static const Color text = Color(0xFF4A5568);
  static const Color heading = Color(0xFF1A1D23);
  static const Color muted = Color(0xFF8B8F99);

  // ── Accent ────────────────────────────────────────────────────────────────
  static const Color accent = Color(0xFF5A67D8);

  // ── Status ────────────────────────────────────────────────────────────────
  // The tape chart's own vocabulary, carried over so a room reads the same on
  // the phone as it does on the wall screen at the desk.
  static const Color vacant = Color(0xFF6FA57C);
  static const Color reserved = Color(0xFFC0392B);
  static const Color checkedIn = Color(0xFF2E6DA4);
  static const Color stayed = Color(0xFF8A94A0);
  static const Color draft = Color(0xFFD4A70C);
  static const Color danger = Color(0xFFB42318);

  // ── Spacing ───────────────────────────────────────────────────────────────
  static const double s4 = 4;
  static const double s8 = 8;
  static const double s12 = 12;
  static const double s16 = 16;
  static const double s24 = 24;
  static const double s32 = 32;
  static const double s48 = 48;

  // ── Radius ────────────────────────────────────────────────────────────────
  /// Inputs and small buttons.
  static const double rSmall = 8;

  /// Buttons and cards.
  static const double rMedium = 12;

  /// Containers and heroes.
  static const double rLarge = 20;

  // ── Shadows ───────────────────────────────────────────────────────────────
  //
  // A single soft shadow cast straight down, the way a card sitting a few
  // millimetres off a flat surface actually reads — no counter-highlight,
  // no dual light source.

  /// Raised — the default state of anything sitting on the surface.
  static const List<BoxShadow> extruded = [
    BoxShadow(color: Color(0x0A101828), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0x08101828), offset: Offset(0, 1), blurRadius: 3),
  ];

  /// Raised further — a card being dragged or otherwise lifted.
  static const List<BoxShadow> elevated = [
    BoxShadow(color: Color(0x14101828), offset: Offset(0, 8), blurRadius: 20),
  ];

  /// Barely raised — list rows, where full extrusion on every row is noise.
  static const List<BoxShadow> subtle = [
    BoxShadow(color: Color(0x06101828), offset: Offset(0, 1), blurRadius: 2),
  ];

  static ThemeData get light {
    const scheme = ColorScheme.light(
      primary: accent,
      onPrimary: Colors.white,
      surface: bg,
      onSurface: text,
      error: danger,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      // No fontFamily on purpose: the platform default is the face.
      //
      // Inter is the reference in the web client, but naming it here without
      // bundling the file did nothing at all — Flutter resolves an unknown
      // family to the default, so the line read as a choice while having no
      // effect. The weights below are what actually carry the design; bundle
      // Inter and name it here if the face itself ever has to match the web.
      textTheme: const TextTheme(
        headlineSmall: TextStyle(
          color: heading,
          fontWeight: FontWeight.w500,
          fontSize: 22,
        ),
        titleMedium: TextStyle(
          color: heading,
          fontWeight: FontWeight.w500,
          fontSize: 16,
        ),
        bodyMedium: TextStyle(color: text, fontWeight: FontWeight.w400),
        bodySmall: TextStyle(color: muted, fontWeight: FontWeight.w400),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: heading,
          fontSize: 20,
          fontWeight: FontWeight.w500,
        ),
        iconTheme: IconThemeData(color: text),
      ),
      splashFactory: NoSplash.splashFactory,
      highlightColor: Colors.transparent,
    );
  }
}
