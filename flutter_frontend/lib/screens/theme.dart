import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
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
/// Window-width tiers, defined once; see [AppTheme.tier]. Width only, never
/// platform or orientation: phone <600, tablet 600-1023, laptop 1024-1439,
/// desktop 1440-1919, wide >=1920.
enum Tier { phone, tablet, laptop, desktop, wide }

/// Desktop page transition that also keeps every pushed (non-first) screen to
/// the web's 1360px content width on the web's page background — one place
/// instead of a cap on each of the screens that never had one.
class DeskPageTransitions extends PageTransitionsBuilder {
  const DeskPageTransitions();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final wrapped = (!route.isFirst && AppTheme.isDesktop(context))
        ? ColoredBox(
            color: AppTheme.paper,
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: AppTheme.contentMaxWidth(context)),
                child: child,
              ),
            ),
          )
        : child;
    return const FadeForwardsPageTransitionsBuilder()
        .buildTransitions(route, context, animation, secondaryAnimation, wrapped);
  }
}

class AppTheme {
  // ── Surface ───────────────────────────────────────────────────────────────
  static const Color bg = Color(0xFFF4F6FA);
  static const Color card = Color(0xFFFFFFFF);
  static const Color border = Color(0xFFE3E8F0);

  /// A noticeably darker hairline than [border] — too-light to read as an
  /// edge against a plain white card. Used where a box must visibly
  /// separate from a white surface it sits inside (an extra room's card
  /// inside the "Stay & room" card, say), mirroring the web form's own
  /// `--border` (#E3E8F0), which is this same step darker than its page
  /// background for the same reason.
  static const Color border2 = Color(0xFFDDE3EC);

  // ── Web dashboard tokens (index.css) — used by the desktop (>=800) layout
  // only, so the Windows app reads as the same product as the website while
  // the phone keeps its own look.
  /// Page background on desktop (`--paper`).
  static const Color paper = Color(0xFFF3F4F6);

  /// Primary call-to-action: the web's amber (`--accent`, `--color-cta-*`).
  static const Color cta = Color(0xFFFFC107);
  static const Color ctaFrom = Color(0xFFFFCD3C);
  static const Color ctaInk = Color(0xFF16212E);
  static const Color accentInk = Color(0xFF8A5B00);
  static const Gradient ctaGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [ctaFrom, cta],
  );

  /// Focus / selected state (`--focus`, `--focus-wash`, `--link`).
  static const Color focus = Color(0xFF00B0FF);
  static const Color focusWash = Color(0xFFE3F6FD);
  static const Color focusWashEdge = Color(0xFFB8E6FA);
  static const Color link = Color(0xFF0077B6);

  /// Form field outline (`--field-border`, `--field-border-hover`).
  static const Color fieldBorder = Color(0xFFDDE3EC);
  static const Color fieldBorderHover = Color(0xFFB6BFD0);

  /// `--shadow-raised` / `--shadow-card` for web-style cards.
  static const List<BoxShadow> raised = [
    BoxShadow(color: Color(0x0D16212E), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0x0F16212E), offset: Offset(0, 4), blurRadius: 10, spreadRadius: -2),
  ];
  static const List<BoxShadow> cardShadow = [
    BoxShadow(color: Color(0x0D16212E), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0x2116212E), offset: Offset(0, 10), blurRadius: 28, spreadRadius: -8),
  ];

  /// Search box shape: the web's 10px field with `--field-border` on desktop,
  /// the phone's pill elsewhere. Shared by every list toolbar's search box.
  static BorderRadius searchRadius(BuildContext context) =>
      BorderRadius.circular(isDesktop(context) ? 10 : 999);
  static Border searchBorder(BuildContext context) => isDesktop(context)
      ? Border.all(color: fieldBorder)
      : Border.all(color: shadowDark, width: 1.3);

  /// `.dash-main` on the web: content capped at 1360 with 22/32/32 padding.
  static const double dashMaxWidth = 1360;

  /// Aliases for the old neumorphic tokens — still referenced by shadow
  /// lists and a handful of screens' `Border.all(color: ...)` calls.
  static const Color shadowDark = Color(0xFFDCE1EC);
  static const Color shadowLight = Color(0xFFFFFFFF);

  // ── Text ──────────────────────────────────────────────────────────────────
  static const Color text = Color(0xFF48566A);
  static const Color heading = Color(0xFF16212E);
  static const Color muted = Color(0xFF78859A);

  /// The label above a form field — dark and bold so it reads clearly.
  static TextStyle? fieldLabel(BuildContext context) =>
      Theme.of(context).textTheme.bodySmall?.copyWith(color: heading, fontWeight: FontWeight.w700);

  // ── Accent ────────────────────────────────────────────────────────────────
  static const Color accent = Color(0xFF1457AD);

  /// The web navbar's own dark navy (OwnerDashboard.css --brand) — the top bar only.
  static const Color navbar = Color(0xFF0B2E5C);
  static const Color brandLift = Color(0xFF1457AD);
  static const Color gold = Color(0xFFC79A3A);

  /// The sidebar's own brand tokens — lifted straight from the web
  /// dashboard's OwnerDashboard.css / index.css (--brand, --brand-ink,
  /// --brand-wash, --brand-wash-edge) so the rail reads as the same surface
  /// on both clients rather than a phone-flavoured guess at it.
  static const Color sidebarBrand = Color(0xFF0B2E5C);
  static const Color sidebarBrandInk = Color(0xFF071E3D);
  static const Color sidebarBrandWash = Color(0xFFEAF1FB);
  static const Color sidebarBrandWashEdge = Color(0xFFBBD2EC);
  static const Color sidebarText = Color(0xFF48566A);
  static const Color sidebarTextMuted = Color(0xFF78859A);
  static const Color sidebarBorder = Color(0xFFE5E7EB);

  /// The booking-detail action row's own "edit" and "checkout" fills — kept
  /// apart from [accent] and [danger] so all three action buttons read as
  /// distinct at a glance.
  static const Color edit = Color(0xFF319795);
  static const Color checkout = Color(0xFFDD6B20);

  // ── Status ────────────────────────────────────────────────────────────────
  // The tape chart's own vocabulary, carried over so a room reads the same on
  // the phone as it does on the wall screen at the desk.
  static const Color vacant = Color(0xFF087A50);
  static const Color reserved = Color(0xFFE0453C);
  static const Color checkedIn = Color(0xFF2F7FE4);
  static const Color stayed = Color(0xFF8695A3);
  static const Color draft = Color(0xFFF2C31D);
  static const Color danger = Color(0xFFEA4335);

  /// A problem worth flagging but not stopping the desk over — over
  /// capacity being the first use, where Save still has to work. Mirrors
  /// .form-banner--warning / --color-warning in forms.css.
  static const Color warningWash = Color(0xFFFBF1DA);
  static const Color warningInk = Color(0xFF8A6710);

  // ── Spacing ───────────────────────────────────────────────────────────────
  static const double s4 = 4;
  static const double s8 = 8;
  static const double s12 = 12;
  static const double s16 = 16;
  static const double s24 = 24;
  static const double s32 = 32;
  static const double s48 = 48;

  // ── Breakpoints ───────────────────────────────────────────────────────────
  // The one tier definition. Everything layout-related asks [tier] (or the
  // [isPhone]/[atLeast] shorthands) instead of reading MediaQuery itself.
  static const double bpTablet = 600;
  static const double bpLaptop = 1024;
  static const double bpDesktopTier = 1440;
  static const double bpWide = 1920;

  // Content-specific, deliberately not tiers: the room chart fits a whole month
  // across the window from 1100 (compact rows), and gives its room column more
  // space from 1300. Named here so no screen carries the raw numbers.
  static const double bpChartMonth = 1100;
  static const double bpChartRoomy = 1300;

  // Kept for orders_screen's card-column count until its batch migrates it.
  static const double bpMedium = 600;
  static const double bpExpanded = 840;

  static Tier tierOfWidth(double w) {
    if (w >= bpWide) return Tier.wide;
    if (w >= bpDesktopTier) return Tier.desktop;
    if (w >= bpLaptop) return Tier.laptop;
    if (w >= bpTablet) return Tier.tablet;
    return Tier.phone;
  }

  static Tier tier(BuildContext context) =>
      tierOfWidth(MediaQuery.sizeOf(context).width);

  static bool isPhone(BuildContext context) => tier(context) == Tier.phone;

  static bool atLeast(BuildContext context, Tier t) =>
      tier(context).index >= t.index;

  /// Content cap inside the shell: the web's 1360 (`.dash-main`) up to a
  /// desktop, 1600 on a wide window where the extra room becomes margin.
  static double contentMaxWidth(BuildContext context) =>
      tier(context) == Tier.wide ? 1600 : dashMaxWidth;

  /// Low-priority table columns (tags, notes, secondary dates) are dropped on
  /// a tablet or laptop, where width is scarce; a phone scrolls the whole sheet
  /// sideways as it always has, and a desktop has the room for all of them.
  static bool showLowPriorityColumns(BuildContext context) {
    final t = tier(context);
    return t != Tier.tablet && t != Tier.laptop;
  }

  /// The primary action's colours: the web's amber from tablet up, the phone's
  /// blue on a phone.
  static Color ctaBg(BuildContext context) => isPhone(context) ? accent : cta;
  static Color ctaFg(BuildContext context) => isPhone(context) ? Colors.white : ctaInk;

  /// A phone-width column for anything meant to be read top to bottom (a
  /// form, a detail page) — centered rather than stretched once the surface
  /// is wider than a phone.
  static const double maxContentWidth = 640;

  /// Legacy 800 px cutoff the web dashboard uses for its permanent sidebar.
  /// New code asks [tier]; the remaining callers migrate with their batch.
  /// A desktop-sized window — same cutoff. By width (not shortest side) so a window dragged short
  /// but still wide does not fall back to the phone layout. Pages use the full
  /// width on desktop; see [pageMaxWidth].
  static const double bpDesktop = 800;
  static bool isDesktop(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= bpDesktop;

  /// Side padding of a page: roomier on a wide window.
  static double gutter(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    return w >= 1280 ? 32 : (w >= bpDesktop ? 24 : 16);
  }

  /// What a self-capped form/detail page should use instead of
  /// [maxContentWidth]: the phone column on a phone, the whole window on
  /// desktop (pages lay their sections out in columns there).
  static double pageMaxWidth(BuildContext context) =>
      isDesktop(context) ? double.infinity : maxContentWidth;

  /// Mobile-sized controls (tall fields, fat buttons, roomy cards) take too much
  /// of a desktop window. The shared widgets pass their padding through this:
  /// on desktop the vertical part shrinks by [factor], the horizontal stays.
  static EdgeInsetsGeometry compactPadding(BuildContext context, EdgeInsetsGeometry padding, [double factor = 0.6]) {
    if (!isDesktop(context)) return padding;
    final e = padding.resolve(TextDirection.ltr);
    return EdgeInsets.fromLTRB(e.left, e.top * factor, e.right, e.bottom * factor);
  }

  /// A form or detail page: the phone column on a phone, a comfortable
  /// reading width (centered) on desktop — a field stretched across a 1900 px
  /// window is harder to use, not easier. The maximize view still fills the
  /// window for the data screens that benefit.
  static const double formWidthDesktop = 960;
  static double formMaxWidth(BuildContext context) =>
      isDesktop(context) ? formWidthDesktop : maxContentWidth;

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

  /// A tinted, floating shadow for the one or two accent-colored elements
  /// per screen that should visibly sit above everything else (a primary
  /// FAB, say) — colored by the element itself rather than plain black, the
  /// way a modern SaaS dashboard lifts its single most important control.
  static List<BoxShadow> floating(Color tint) => [
    BoxShadow(color: tint.withValues(alpha: 0.35), offset: const Offset(0, 6), blurRadius: 16),
    BoxShadow(color: tint.withValues(alpha: 0.18), offset: const Offset(0, 2), blurRadius: 4),
  ];

  /// The accent's own two-stop gradient — used sparingly for the single
  /// highlighted surface on a screen (today's date chip, the primary FAB)
  /// so the flat palette gets one deliberate moment of richness rather than
  /// a flat fill everywhere.
  static const Gradient accentGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [accent, sidebarBrandInk],
  );

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
      // Desktop builds get the compact density a mouse-driven app wants
      // (tighter list tiles, buttons, fields); phones are unchanged.
      visualDensity: VisualDensity.adaptivePlatformDensity,
      // A pushed page fades up on desktop instead of Android's zoom, which
      // reads as a phone gesture on a wide window. Phones keep their own.
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: ZoomPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.windows: DeskPageTransitions(),
          TargetPlatform.linux: DeskPageTransitions(),
          TargetPlatform.macOS: DeskPageTransitions(),
        },
      ),
      // Keyboard focus and mouse hover are visible, as the web's 2px focus
      // ring and hover wash are.
      focusColor: accent.withValues(alpha: 0.18),
      hoverColor: accent.withValues(alpha: 0.06),
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      // No fontFamily on purpose: the platform default is the face.
      //
      // Inter is the reference in the web client, but naming it here without
      // bundling the file did nothing at all — Flutter resolves an unknown
      // family to the default, so the line read as a choice while having no
      // effect. The weights below are what actually carry the design; bundle
      // Inter and name it here if the face itself ever has to match the web.
      //
      // The full named scale, so a screen reaches for
      // `Theme.of(context).textTheme.X` instead of a one-off TextStyle —
      // every size and weight below is one already in use somewhere in the
      // app, just given one shared name instead of forty slightly different
      // literals.
      textTheme: const TextTheme(
        displaySmall: TextStyle(
          color: heading,
          fontWeight: FontWeight.w700,
          fontSize: 28,
        ),
        headlineMedium: TextStyle(
          color: heading,
          fontWeight: FontWeight.w600,
          fontSize: 24,
        ),
        headlineSmall: TextStyle(
          color: heading,
          fontWeight: FontWeight.w500,
          fontSize: 22,
        ),
        titleLarge: TextStyle(
          color: heading,
          fontWeight: FontWeight.w600,
          fontSize: 18,
        ),
        titleMedium: TextStyle(
          color: heading,
          fontWeight: FontWeight.w500,
          fontSize: 16,
        ),
        titleSmall: TextStyle(
          color: heading,
          fontWeight: FontWeight.w600,
          fontSize: 14,
        ),
        bodyLarge: TextStyle(
          color: text,
          fontWeight: FontWeight.w400,
          fontSize: 16,
        ),
        bodyMedium: TextStyle(
          color: text,
          fontWeight: FontWeight.w400,
          fontSize: 14,
        ),
        bodySmall: TextStyle(
          color: muted,
          fontWeight: FontWeight.w400,
          fontSize: 12,
        ),
        labelLarge: TextStyle(
          color: heading,
          fontWeight: FontWeight.w600,
          fontSize: 14,
        ),
        labelMedium: TextStyle(
          color: text,
          fontWeight: FontWeight.w500,
          fontSize: 12,
        ),
        labelSmall: TextStyle(
          color: muted,
          fontWeight: FontWeight.w500,
          fontSize: 11,
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        toolbarHeight: 56,
        titleSpacing: 0,
        shape: AccentLineBorder(),
        titleTextStyle: TextStyle(
          color: heading,
          fontSize: 16,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.2,
        ),
        iconTheme: IconThemeData(color: heading),
      ),
      splashFactory: NoSplash.splashFactory,
      highlightColor: Colors.transparent,
      dialogTheme: const DialogThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(rLarge)),
        ),
        elevation: 8,
        titleTextStyle: TextStyle(
          color: heading,
          fontSize: 18,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.2,
        ),
        contentTextStyle: TextStyle(color: text, fontSize: 14, height: 1.4),
        actionsPadding: EdgeInsets.fromLTRB(16, 0, 16, 16),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStatePropertyAll(accent),
          textStyle: WidgetStatePropertyAll(
            TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
          ),
        ),
      ),
      // Every screen's date field now opens `showAppDatePicker` (see
      // widgets/compact_date_picker.dart) — a small custom calendar card
      // instead of Material's big banner dialog — so `datePickerTheme` has
      // no call sites left to style and was removed.
    );
  }
}


/// The header every page shares: a hairline under the white bar plus a 3px
/// accent stripe that fades out to the right. Set once as the app bar theme's
/// shape so no screen has to draw its own underline.
class AccentLineBorder extends ShapeBorder {
  const AccentLineBorder();

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.zero;

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) =>
      Path()..addRect(rect);

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) =>
      Path()..addRect(rect);

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    canvas.drawRect(
      Rect.fromLTWH(rect.left, rect.bottom - 1, rect.width, 1),
      Paint()..color = AppTheme.border,
    );
    final stripe = Rect.fromLTWH(rect.left, rect.bottom - 3, rect.width, 3);
    canvas.drawRect(
      stripe,
      Paint()
        ..shader = const LinearGradient(
          colors: [AppTheme.accent, Color(0x001457AD)],
        ).createShader(stripe),
    );
  }

  @override
  ShapeBorder scale(double t) => this;
}

/// Motion tokens for the desktop layout (one set, not a duration per widget).
///
/// Short: motion that confirms something already happening (hover, focus).
/// Medium: layout that rearranges (sidebar, maximize view, section change).
/// Exits are quicker than entrances, and a transition that is interrupted is
/// replaced, not queued — the animated widgets used here all retarget on
/// rebuild. With the system's "reduce motion" on, [of] returns zero.
class AppMotion {
  static const Duration short = Duration(milliseconds: 120);
  static const Duration medium = Duration(milliseconds: 200);
  static const Duration exit = Duration(milliseconds: 140);
  static const Curve enter = Curves.easeOutCubic;
  static const Curve leave = Curves.easeInCubic;

  static Duration of(BuildContext context, [Duration d = medium]) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : d;
}
