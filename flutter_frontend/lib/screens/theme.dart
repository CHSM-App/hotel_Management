import 'package:flutter/material.dart';

/// The Neuphorism palette and the shadows that carry it.
///
/// Neumorphism has no borders — depth is simulated light. Every raised surface
/// casts a dark shadow down-right and a light one up-left, from a single light
/// source at the top-left; pressing one inverts both shadows inward so the
/// element reads as pushed into the surface rather than sitting on it.
///
/// The consequence, and the reason this file is a set of tokens rather than a
/// pile of BoxDecorations: the shadow colours are only correct against the one
/// background they were derived from. A card on a white surface with these
/// shadows looks like a smudge. Everything is drawn on [bg].
class AppTheme {
  // ── Surface ───────────────────────────────────────────────────────────────
  static const Color bg = Color(0xFFE6E8ED);
  static const Color shadowDark = Color(0xFFC5C8CE);
  static const Color shadowLight = Color(0xFFFFFFFF);

  // ── Text ──────────────────────────────────────────────────────────────────
  static const Color text = Color(0xFF4A5568);
  static const Color heading = Color(0xFF2D3748);
  static const Color muted = Color(0xFF8B95A5);

  // ── Accent ────────────────────────────────────────────────────────────────
  static const Color accent = Color(0xFF667EEA);

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
  // Scaled down from the reference's 12/24px. Those were written for a desktop
  // page; at phone scale a 24px blur on a list of cards turns the whole screen
  // to fog, and the tokens stop reading as separate surfaces.

  /// Raised — the default state of anything sitting on the surface.
  static const List<BoxShadow> extruded = [
    BoxShadow(color: shadowDark, offset: Offset(6, 6), blurRadius: 12),
    BoxShadow(color: shadowLight, offset: Offset(-6, -6), blurRadius: 12),
  ];

  /// Raised further — a card being dragged or otherwise lifted.
  static const List<BoxShadow> elevated = [
    BoxShadow(color: shadowDark, offset: Offset(8, 8), blurRadius: 16),
    BoxShadow(color: shadowLight, offset: Offset(-8, -8), blurRadius: 16),
  ];

  /// Barely raised — list rows, where full extrusion on every row is noise.
  static const List<BoxShadow> subtle = [
    BoxShadow(color: shadowDark, offset: Offset(3, 3), blurRadius: 6),
    BoxShadow(color: shadowLight, offset: Offset(-3, -3), blurRadius: 6),
  ];

  /// Pressed. Flutter has no inset box-shadow, so a pressed surface is drawn by
  /// [NeuPressed] with a gradient and an inner border instead — see that widget
  /// for why, rather than expecting a token here.

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
