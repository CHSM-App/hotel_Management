# Desktop design spec (Phase 0)

Extracted from `frontend/src` (web) and audited against `flutter_frontend/lib`.
Nothing in `lib/` has been changed.

## 1. Web design system → Flutter token map

| Web (source) | Value | Flutter token (`AppTheme`) | Status |
|---|---|---|---|
| `--paper` page bg (index.css) | #F3F4F6 | `paper` | ok |
| `--surface` / card | #FFFFFF | `card` | ok |
| `--border` | #E5E7EB | `sidebarBorder` (same value, odd name); `border` is #E3E8F0 | **mismatch**: two near-identical borders, pick one alias |
| `--field-border` / hover | #DDE3EC / #B6BFD0 | `fieldBorder` / `fieldBorderHover` | ok |
| `--ink` / `--text` / `--text-muted` | #16212E / #48566A / #78859A | `heading` / `text` / `muted` | ok |
| `--accent` (CTA amber), cta gradient | #FFC107, #FFCD3C→#FFC107 | `cta`, `ctaGradient`, `ctaInk` | ok |
| `--brand` dashboard override (OwnerDashboard.css:553) | #0B2E5C, ink #071E3D, wash #EAF1FB, edge #BBD2EC | `sidebarBrand*`, `navbar` | ok. Note index.css `--brand` is #0A3A6B but the dashboard overrides it. |
| `--focus`, `--focus-wash`, `--link` | #00B0FF / #E3F6FD / #0077B6 | `focus`, `focusWash`, `link` | ok |
| `--danger`, `--success`, `--success-bg`, `--danger-bg` | #EA4335 / #28A745 / #E8F6EC / #FDECEA | `danger`; **no success / success-bg / danger-bg** | **add** |
| `--secondary` | #8B5CF6 | none | add only if a screen needs it |
| `--shadow-card` / `--shadow-raised` / `--shadow-elevated` | see index.css:42-49 | `cardShadow`, `raised`; **no elevated-modal shadow** (`elevated` is a different, lighter one) | **add** `modalShadow` |
| `--shadow-well-focus` (3px #00B0FF @28%) | focus ring | theme `focusColor` (accent @18%) | **mismatch**: web ring is cyan 3px; Flutter focus is a faint blue wash |
| `--radius-tile` 14, `--radius-card` 16, fields 10, popover 12, pills 999 | | `rSmall` 8, `rMedium` 12, `rLarge` 20 | **mismatch**: 10/14/16 missing. Add `rField` 10, `rTile` 14, `rCard` 16 (desktop use only) |
| Font `--sans`: Inter, system-ui, Segoe UI | Inter | No `fontFamily` (platform default = Segoe UI on Windows) | **decision needed**: bundle Inter (new asset, not a package) or accept Segoe UI. Theme comment already records this. |
| Spacing | 4/8/12/16/24/32 | `s4…s48` | ok |
| `.dash-sidebar` | 240px open, **60px** icon-only, bg white (open) / `--brand-ink` (icon-only, >800px) | 240 / **72** | **mismatch**: 72 vs 60; icon-only bg is dark navy on web |
| `.dash-topbar` | sticky, z30, navy band, property name in serif at 17px, bell, profile chip, 44px/34px icon buttons | `_TopBar` 64px high on desktop, bell + maximize + title | partially matches; **property name / profile chip not in the bar** (identity lives in the sidebar) |
| `.dash-main` | `max-width: 1360px`, 22/32/32 padding | `dashMaxWidth` 1360, gutter 16/24/32 + 16 | ok for desktop. **Mismatch with your brief:** the brief says cap wide at ~1600 (`pageMaxWidth`). The web caps at 1360. See Decision D1. |
| ActionModal | `max-width: 420px`, padding 24/24/20, icon tile 44px r12, buttons r10 h~40; full-width <480px | none shared. Each flow builds its own `showDialog` / bottom sheet | **add** shared modal wrapper |
| ConfirmDialog | `max-width: 400px`, padding 24/26 | `dialogTheme` (r20, 8 elevation) | mismatch r20 vs web r16/14 |
| FxModal | variable-size form modal (see FxModal.css) | none | add as the "form dialog" size |
| FilterPopover | 300px wide, `max-width: 100vw-32`, r12, count badge pill | none (filters are inline chips / sheets) | **add** |
| Tables | Plain `<table>` in `.dash-table-scroll`: `overflow-x:auto`, sticky nothing; row hover wash; icon action buttons; **no pagination anywhere** (grep: only MenuCard + ServicesPanel have paging words, and those are "menu card pages", not data paging) | `TableSheet`/`TableCol`/`StickyHeaderTable`/`DeskTable`; sticky header (web has none) | Flutter is a superset. **Pagination is not a web feature.** I recommend we do not build it (see D3). |
| KPI cards | `KpiGlyphs.jsx` + `.kpi*` classes per page | per-screen ad-hoc cards (`asset_stat_grid.dart`, report_widgets) | **add** one `KpiRow` |
| Toasts | `Toast.jsx` provider, top-level | SnackBar | add themed floating SnackBar width cap on wide |
| Empty/loading/error | `GlobalLoader`, `PageLoader`, per-page empty text | per-screen | add `StateView` (centred, max 420) |
| Responsive rules | **one real breakpoint: 800px** (permanent sidebar vs drawer). Everything else is per-page (`max-width` 640/560/760/720/480/900/1000, `min-width` 1300 on Billing/Services, 1101 Housekeeping, container 1010 Events) | tiers 600/1024/1440 + `isDesktop` 800 + `isCompact` shortestSide 600 + `isExpanded` shortestSide 840 + ad-hoc 700/1100/1300 | the web has **no tablet/laptop/desktop/wide split** to copy; see D2 |

### What the web does at each width (so the tiers are grounded)
- ≤800: drawer, stacked body.
- 801+: permanent sidebar, `.dash-main` up to 1360 (row of rooms: 4 → 5 per row at ~1600 per the CSS comment).
- 1101: Housekeeping goes two-pane. 1300: Billing/Services get the wider layouts. 1010 (container query): Events.
- Wider than 1360+240: content stops growing and is left-aligned beside the sidebar (web) while Flutter centres it. Minor.

## 2. Flutter layout kit audit (what exists, gaps)

Already built (from earlier desktop work, commit 2ab54e2):
- `AppTheme`: `isDesktop` (width ≥ 800), `isCompact` (shortestSide < 600), `isExpanded` (shortestSide ≥ 840), `screenSize()` → `ScreenSize {mobile, tablet, desktop, large}` at 600/1024/1440, `pick()`, `gutter()`, `formMaxWidth` (960 on desktop / 640), `pageMaxWidth`, `dashMaxWidth` 1360, `compactPadding`, `AppMotion`.
- `TableSheet` / `TableCol` (columns scale up to 3x to fill), `StickyHeaderTable`, `TablePageBody`, `HScrollTable`, `DeskTable`, `AdaptiveGrid`, `FormGrid`.
- Shell: rail 240/72, Ctrl+B collapse, F11 / Ctrl+Shift+F maximize, Esc, drawer on compact, `_ResponsiveBody` cap.
- Windows runner: 960×600 minimum in `win32_window.cpp:206`; initial window 1280×720 at (10,10) in `main.cpp:28-29`. **No maximize-on-start in `main.cpp`** — the memory note says "opens maximized"; that is not in the file. Needs a native build to confirm. Flagged, not claimed.

Gaps against your brief:
1. **Four competing breakpoint systems** (migration list: `desktop-rollout.md` section A): `isCompact` shortestSide<600 (4 uses), `isDesktop` width>=800 (102 uses), `screenSize()` 600/1024/1440 (3 uses), plus raw `MediaQuery` widths 600/700/1100/1300. `isExpanded` (shortestSide>=840) has no real callers (its 24 grep hits are `DropdownButton.isExpanded`). A tablet landscape (1024×768) is `isCompact == false` (shortest 768) but `isExpanded == false` → the shell shows a rail but `isDesktop` is true — there is no real "tablet" behaviour.
2. **Tier names/cutoffs differ from your table.** Existing: mobile/tablet/desktop(1024)/large(1440). Yours: phone/tablet/laptop(1024)/desktop(1440)/wide(1920). `ScreenSize.large` has no 1920 split.
3. **Shell**: rail is 240↔72 and user-toggled; there is no tablet icon rail by default, no laptop auto-collapsed default, no hover-expand, no property-name/profile chip in the top bar, no tablet-orientation handling. Phone drawer is correct.
4. **No shared modal wrapper**, filter popover, KPI row, page scaffold, master-detail pane, state view, themed toast. Every screen builds its own.
5. **No column priority** on `TableCol` (hide-on-laptop is impossible today).
6. **Text scale is clamped** to 0.9–1.25 in `main.dart:68-72`. Your rule: support 1.3 and "fix overflow rather than clamping". Needs your OK to raise the cap; today 1.3 is silently shown as 1.25.
7. **Touch targets**: nothing enforces 48px on tablet; `compactPadding` actively shrinks controls at ≥800 (tablets in landscape get mouse-density).
8. **Hover/right-click dependence**: not audited yet per screen; will be checked per batch (Phase 2).
9. **Page transition wrapper** (`DeskPageTransitions`) caps every pushed route at 1360 on desktop — wide tier will need 1600 or stay 1360 (D1).
10. Tests: `desktop_layout_test.dart` covers table/grid/field only (6 tests). `shell_test` / `kitchen_test` have known stale expectations (not touching).

## 3. Decisions I need from you (before Phase 1)

- **D1 — wide cap: 1360 or 1600?** Web caps `.dash-main` at 1360. Your brief says ~1600 for ≥1920. Matching the web exactly = 1360. Recommend: **1360 at desktop, 1600 at wide** (extra grid column, not stretched fields), accepting a small deliberate deviation from the web.
- **D2 — tier cutoffs.** Web has only 800. Recommend adopting your table exactly (600/1024/1440/1920) and mapping the old 800 "permanent sidebar" to the tablet rail. Costs one migration pass (see migration list).
- **D3 — pagination.** Not in the web; Flutter tables already scroll. Recommend **skip** (it would be new behaviour, not parity).
- **D4 — Inter font.** Bundle Inter as an asset (no package) or keep Segoe UI. Recommend keep platform font for now.
- **D5 — text scale cap** 1.25 → 1.3, changed in the foundation phase.
- **D6 — icon-rail width** 72 → 60 to match the web, and dark navy icon-only background? Recommend 64 and light bg unchanged until you say (touch target friendliness).

## 4. Flags that are not UI work (listed, not in any diff)
- `windows/runner/main.cpp` maximize-on-start unverified (native build needed, no Visual Studio here).
- `git status` shows uncommitted changes in `backend/scripts/clear-lodge-bookings.js`, `flutter_frontend/lib/core/constant.dart`, `frontend/src/lib/api.js` — pre-existing, not mine; I will not touch them.
