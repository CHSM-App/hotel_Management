# Desktop rollout tracker (Phase 0)

Status legend: `todo` nothing tier-aware today · `partial` already uses some kit (from the earlier desktop pass, only width >= 800 logic, no tablet/laptop/wide split) · `done` verified against the matrix (none yet).
"Kit" counts = hits of `isDesktop | screenSize | AdaptiveGrid | TableSheet | formMaxWidth | LayoutBuilder | MediaQuery.sizeOf | gutter` in the file.
Per-tier plan uses the brief's tiers: P phone (unchanged) · T tablet 600-1023 · L laptop 1024-1439 · D desktop 1440-1919 · W wide >=1920.

## A. Old breakpoint usages to migrate (each one deliberately)

| # | Symbol / literal | Where | Count | Plan |
|---|---|---|---|---|
| A1 | `AppTheme.isCompact` (shortestSide < 600) | `shell/dashboard_shell.dart:148, 634` (drawer vs rail, `_ResponsiveBody`); definition `theme.dart:186` | 2 callers | Replace with `tier == phone`. **Hazard:** a phone in landscape (e.g. 850x390) is `isCompact == true` but `isDesktop == true` today. Width-only (rule 1) would move it to the tablet tier. See D7. |
| A2 | `AppTheme.isDesktop` (width >= 800) CTA colour pair `cta/ctaInk` vs `accent/white` | 27 + 27 sites (FAB/Add buttons in assets, expenses, income, food, services, events...) | 54 | One helper `AppTheme.ctaStyle(context)`; web-colour decision moves to `tier >= tablet`. Mechanical, phone unchanged. |
| A3 | `isDesktop` as density / sizing / shape (searchRadius 10 vs pill, compactPadding, font 13.5 vs 14, minHeight, shadows) | `theme.dart:101-102, 250`, `widgets/neu.dart:86, 844, 856, 881, 1039`, `widgets/pill_tabs.dart:38` | ~14 | Keep in shared widgets; flip the condition to `tier >= laptop` for mouse density, **not** tablet (touch targets >= 48). |
| A4 | `isDesktop` as card-vs-table / row-vs-column layout switch | `food/orders_screen.dart` (9), `bookings/take_booking_screen.dart` (6), `customers/customers_screen.dart` (5), `staff/staff_roles_screen.dart` (4), `services/*` (7), `bookings/register_screen.dart` (3), `rooms/rooms_panel.dart` (2), expenses/income/events/assets/food panels (~2 each) | ~34 | Per-screen, in its batch. Decide table-vs-cards by **pane width** (`LayoutBuilder`), not window width (rule 8). |
| A5 | `isDesktop` max-width literals `440 / 560 / 640 : infinity` | `food/orders_screen.dart:763` and 4 others | 5 | Replace with `formMaxWidth` / dialog sizes from the new wrapper. |
| A6 | `isDesktop` shell chrome | `shell/sidebar.dart:77, 643` (web sidebar look), `dashboard_shell.dart:635, 820` (top bar 64 vs 56), `DeskPageTransitions` (`theme.dart:30`) | 5 | Phase 1 shell work. |
| A7 | `screenSize()` / `ScreenSize.mobile` | `widgets/form_grid.dart:83` (+ `theme.dart` `pick`) | 1 caller | Rename enum to the brief's 5 tiers; `FormGrid` keeps phone = stacked. |
| A8 | `pageMaxWidth` / `maxContentWidth` | `rooms/rooms_panel.dart:64`, `dashboard_shell.dart:642` | 2 | Fold into tier caps (D1). |
| A9 | `dashMaxWidth` 1360 | `theme.dart:36, 107`, `dashboard_shell.dart:642` | 3 | D1 decision. |
| A10 | `gutter()` (>=1280: 32, >=800: 24, else 16) | 22 call sites | 22 | Keep API, back it by tier. Phone 16 unchanged. |
| A11 | `bpMedium` 600 / `bpExpanded` 840 / `bpTablet` / `bpDesktopTier` / `bpLarge` | `theme.dart`, `food/orders_screen.dart:697-712` (grid columns) | 2 files | Delete after migration; orders grid -> `AdaptiveGrid`. |
| A12 | Raw `MediaQuery.sizeOf(context).width >= 1100` | `bookings/bookings_screen.dart:41`, `bookings/tape_chart.dart:623` (+ `< 1300 ? 190 : 250` at :3244) | 3 | Becomes `tier >= desktop`-style by pane width. Tape chart is the riskiest single file (3409 lines). |
| A13 | Raw `width < 600` | `customers/customers_screen.dart:98` (cards vs table default) | 1 | `tier == phone`. |
| A14 | Raw `width >= 700` | `events/events_diary_panel.dart:509` | 1 | Pane-width `LayoutBuilder`. |
| A15 | `MediaQuery.of(context).size...` for heights | `food/counter_order_screen.dart:872`, `h_scroll_table.dart:285` (rows cap 60% screen height) | 2 | Height, not tier; leave unless it misbehaves at 960x600. |
| A16 | `main.dart:68` text scaler clamp 0.9-1.25 | `main.dart` | 1 | D5 -> 1.3. |
| A17 | `Platform.is*` / `kIsWeb` | `core/printing/*`, `core/update/updater.dart`, `data/db/app_database.dart` | 6 | **Not UI layout**; legitimate platform capability checks. Leave. Rule 1 is not violated inside screens (0 hits under `lib/screens`). |

Total of tier-relevant call sites: ~115 (isDesktop 102 + isCompact 4 + screenSize 3 + raw widths ~6).

## B. Screen inventory

`web` = matching file in `frontend/src/pages/lodge` (or `components`). `gaps` are structural, from reading the code at Phase 0 depth; the per-batch side-by-side in Phase 2 will refine them.

### B1. Shell, login, profile
| Flutter file | Web | Type | Gaps vs web | Plan | Status |
|---|---|---|---|---|---|
| shell/dashboard_shell.dart | OwnerDashboard.jsx | shell | no tablet icon rail default, no laptop auto-collapse, top bar lacks property name + profile chip, rail 72 vs 60 | P drawer as-is; T icon rail; L icon rail (Ctrl+B / hover expand); D/W expanded + web top bar | partial (1,867) |
| shell/sidebar.dart | OwnerDashboard sidebar | nav | web look only `>=800`; no hover-expand | tier-driven width, hover expand on L | partial |
| shell/staff_alerts_bell.dart | StaffAlertsBell.jsx | popover | not width-aware | popover width cap | todo |
| shell/sync_center_screen.dart | **none** (offline feature) | list | n/a | formMaxWidth | todo |
| shell/sign_out_dialog.dart | ConfirmDialog | dialog | uses dialogTheme | shared dialog wrapper | todo |
| shell/offline_scope.dart, feature.dart | — | logic | not UI | skip | n/a |
| login_screen.dart | auth/Login.jsx, LoginSplash | form | no split-screen / splash layout on wide | P as-is; T+ centred card + brand panel | todo (0,458) |
| profile/profile_screen.dart | ProfileMenu, HotelProfileModal | form/settings | 2076 lines, single column | formMaxWidth + 2-col sections at L+ | partial |
| profile/whatsapp_settings_screen.dart | WhatsAppSettingsPanel | form | | formMaxWidth | partial |
| printing/printer_settings_screen.dart | **none** | form | | formMaxWidth | partial |

### B2. Rooms / bookings / billing
| Flutter file | Web | Type | Gaps | Plan | Status |
|---|---|---|---|---|---|
| bookings/bookings_screen.dart + tape_chart.dart | Bookings.jsx (room chart) | dashboard | 3 raw width tests (A12); side panel is push/sheet | L: chart + quick-peek as modal; D: chart + side panel pane | partial |
| bookings/tape_quick_peek_sheet.dart | StayViewModal | modal | bottom sheet only | wrapper -> centred dialog T+ | todo |
| bookings/take_booking_screen.dart | Bookings.jsx form, RoomChooser, ExtraRoomCard, StaySummary | form | 5397 lines; 6 isDesktop branches | formMaxWidth + 2-col at D; keep phone tree | partial |
| bookings/booking_detail_screen.dart | StayDetails / StayViewModal | detail | | master-detail from the chart at D | partial |
| bookings/check_in_sheet.dart, check_in_room_status.dart | Bookings check-in, CheckInRoomStatus | modal | sheet | dialog wrapper | todo |
| bookings/cancel_booking_sheet.dart | Bookings cancel | modal | sheet | dialog wrapper | todo |
| bookings/billed_edit_panels.dart | Bookings edit-after-bill | panel | | dialog/inline | todo |
| bookings/advance_receipt_screen.dart | AdvanceReceiptModal/Document | document | | preview dialog | todo (1,1121) |
| bookings/id_proof_viewer_screen.dart | Bookings id viewer | detail | | dialog | todo |
| bookings/register_screen.dart | GuestRegister.jsx | table | 3 isDesktop | TableSheet + priority cols | partial |
| billing/billing_screen.dart | Billing.jsx | list/table | 8 hits; web has 1300px layouts | L compact, D full | partial |
| billing/issue_bill_screen.dart, issue_event_bill_screen, issue_food_bill_screen, issue_service_bill_screen | Billing.jsx issue flows | form | | formMaxWidth, 2-col summary at D | partial |
| billing/bill_receipt_screen.dart, invoice_preview_screen.dart, advance_receipt_screen.dart | BillDocument.jsx | document | | preview dialog | todo/partial |
| billing/event_billing_screen.dart | Billing/Events | list | | as billing | partial |
| billing/numbering_screen.dart | BillNumberingPanel | form | | formMaxWidth | partial |
| rooms/rooms_rates_screen.dart, rooms_panel.dart, add_room_page.dart, room_form_sheet.dart, room_form_pieces.dart | RoomsAndRates, RoomsPanel | list/form | `pageMaxWidth` literal | AdaptiveGrid + dialog form | partial |
| rooms/price_chart_panel.dart, price_simulator_panel.dart, checkout_policy_panel.dart | PriceChartPanel, PriceSimulatorPanel, CheckoutPolicyPanel | panel | | formMaxWidth | partial |
| rooms/quotation_screen.dart, saved_quotations_panel.dart | Quotations, SavedQuotations | form/list | | formMaxWidth / TableSheet | todo / partial |

### B3. Customers, enquiries, events
| Flutter file | Web | Type | Gaps | Plan | Status |
|---|---|---|---|---|---|
| customers/customers_screen.dart | Customers.jsx | table/cards | raw `<600` default view | table from T up | partial |
| customers/customer_detail_screen.dart, customer_form_screen.dart, customer_feedback_panel.dart | Customers.jsx detail | detail/form | | master-detail at D | partial |
| enquiries/enquiries_screen.dart | Enquiries.jsx | list | | AdaptiveGrid / table | partial |
| events/events_screen.dart, events_list_panel, events_diary_panel, events_setup_panel | Events.jsx | list/diary | raw 700; web container query 1010 | pane-width logic | partial |
| events/event_detail_screen.dart, event_form_screen.dart | EventDetail, EventForm | detail/form | | formMaxWidth | partial |

### B4. Food, bar, services
| Flutter file | Web | Type | Gaps | Plan | Status |
|---|---|---|---|---|---|
| food/orders_screen.dart | FoodSection, OrdersPanel | list/board | 9 isDesktop + bpMedium/bpExpanded columns | AdaptiveGrid board | partial |
| food/counter_order_screen.dart, food_billing_screen.dart | FoodSection counter/billing | form | 2421 lines | 2-pane at L+ | partial |
| food/menu_panel.dart, menu_setup_screen.dart, menu_item_form_page.dart, menu_excel_import.dart | MenuPanel, MenuExcelImport | list/form | | TableSheet | partial |
| food/recipes_panel.dart, inventory_panel.dart, tables_panel.dart, qr_codes_panel.dart, food_settings_panel.dart | RecipesPanel, InventoryPanel, TablesPanel, QrCodesPanel, FoodSettingsPanel | panels | qr + settings 0 hits | | partial / todo |
| bar/* (bar_screen, orders, billing, history, setup, take_order, bill) | BarSection, BarTakeOrder, BarBilling, BarHistory, BarSetup, BarAddToRoom | mixed | `bar_common`, `bar_bill_screen` 0 hits | | partial |
| services/* (services_screen, catalogue, usage, form, start_usage) | ServicesPanel | list/form | web 1300px layout | | partial |

### B5. Housekeeping, laundry
| Flutter file | Web | Type | Gaps | Plan | Status |
|---|---|---|---|---|---|
| housekeeping/housekeeping_screen.dart, rooms_tab, issues_tab, housekeeping_parts, finish_cleaning_screen, out_of_order_sheet | HousekeepingPanel, HousekeepingIssues, HousekeepingParts | board/list | web two-pane at 1101; 3 files 0 hits | AdaptiveGrid + master-detail | todo / partial |
| laundry/laundry_screen, linen_tab, guest_laundry_tab, laundry_parts, linen_* forms, guest_laundry_* forms | LaundryPanel | list/form | 7 files 0 hits | | todo / partial |

### B6. Finance and management
| Flutter file | Web | Type | Gaps | Plan | Status |
|---|---|---|---|---|---|
| expenses/* (screen, list, recurring, vendors, categories, forms) | ExpensesPanel, VendorDirectory | table/form | `expenses_screen`, `expense_form_screen` (1075), `expenses_categories_panel` 0 hits | | partial |
| income/* (screen, list, payers, recurring, interest, forms) | IncomePanel | table/form | `income_screen`, `income_combo_fields` 0 hits | | partial |
| assets/* (screen, list, detail, form sheet, vendors, work orders, depreciation, dead stock, retire) | AssetsPanel | table/detail | `assets_screen` 0 hits, detail 1388 lines | | partial |
| staff/* (staff_roles, staff_form, role_form) | StaffAndRoles | table/form | | | partial |

### B7. Reports (all 0 hits except report_widgets / bar_report_panel)
| Flutter file | Web | Type | Plan | Status |
|---|---|---|---|---|
| reports/reports_screen.dart (680) + report_widgets.dart (charts) | ReportsPanel, AnalyticsCharts | report shell | KPI row + chart grid, filters in popover | todo / partial |
| overview_report_panel, occupancy_report_panel, profit_loss_panel | AnalyticsOverview, RoomsAnalytics, FunctionsAnalytics | dashboard | KPI 4-up at D | todo |
| bookings_, bills_, gst_, events_, food_orders_, laundry_, services_, bar_ report panels; assets_, expenses_, income_ tabs | *ReportPanel, ReportPreviewModal, ReportDownloadMenu | report/table | TableSheet + export menu | todo |
| `*_pdf.dart`, `*_excel.dart`, `receipt_*`, `bill_pdf`, `thermal_*` | report*File.js | file generation | **no UI**, out of scope | n/a |

### B8. Web pages with no Flutter screen / Flutter screens with no web page
- **Web, no Flutter:** UserGuide (`/guide`), public pages (LodgePublicPage, OrderPage, FeedbackPage, AssetQrPage, PrivacyPolicy, DeleteAccount), internal admin (`/vtadmin`, `/vt-internal/*`), MenuCardDesigner, PriceChartPanel variants, AnalyticsCharts pieces. All out of scope for the Flutter rollout; none require action.
- **Flutter, no web:** sync_center_screen, printer_settings_screen, thermal print UI, updater dialog, offline strip. Treated as "Flutter-only", designed to the same tokens.

## C. Batch plan (each batch ends with matrix + your approval)

| Batch | Contents | Why this order |
|---|---|---|
| 0 | **Foundation** (Phase 1): tier enum + helpers, CTA helper (A2), shell/rail/top bar, modal wrapper, filter popover, KPI row, page scaffold, state view, master-detail pane, `TableCol` priority. Verify on **Customers, Expenses list, Reports overview**. | Everything else depends on it |
| 1 | shell + login + profile + dashboard-like landing (Reports overview) + sync center | Highest-visibility, small |
| 2 | List/table screens: Customers, Enquiries, Guest Register, Expenses list, Income list, Assets list, Staff | Same pattern; proves `TableCol` priority |
| 3 | Card/board screens: Housekeeping, Laundry, Food orders, Bar, Services | AdaptiveGrid + master-detail |
| 4 | Forms: Take booking, Expense/Income/Asset/Room/Staff/Role forms, billing issue flows | formMaxWidth + 2-col |
| 5 | Detail + dialogs/sheets: booking detail, check-in, cancel, quick-peek, advance receipt, asset detail, event detail, customer detail | Modal wrapper adoption |
| 6 | Billing screen, Events (list/diary/setup), Rooms & rates | Heavier, last |
| 7 | **Tape chart** + Reports panels (all) | Largest/riskiest files, isolated |

## D. Open decisions (also in the spec): D1 wide cap 1360 vs 1600 · D2 adopt brief's tiers · D3 skip pagination · D4 Inter font · D5 text-scale 1.3 · D6 rail width 60/64/72 · **D7 phone tier by width (brief) vs shortestSide (today)** — a landscape phone at >=600 wide would leave the phone tier.

## E. Progress log

**Phase 1 foundation (2026-11-23)** — decisions applied: width-only tiers (D7), 1360/1600 cap (D1), 600/1024/1440/1920 (D2), no pagination (D3), platform font (D4), text scale 1.3 (D5), rail 64 (D6).
- Done: `Tier` + `AppTheme.tier/isPhone/atLeast/contentMaxWidth/showLowPriorityColumns`, `ctaBg/ctaFg` (A2 migrated, 54 sites), A1/A7/A16 migrated, shell rail follows tier (icons on tablet/laptop, open from desktop, Ctrl+B override), `showAppDialog`, `PageHeader`, `KpiRow`, `StateView`, `MasterDetail`, `FilterPopover`, `SearchShortcut` (Ctrl+F), `DeskColumn.lowPriority`.
- Not yet: hover-expand rail, web top bar (property name + profile chip), themed toast width, selectable text, A3-A6/A8-A12/A14 (per batch), `KpiRow`/`MasterDetail`/`FilterPopover`/`PageHeader` adopted by a real screen.
- Visual harness: `flutter_frontend/tool/visual_shots_test.dart` (no login needed).

| Screen | Status | Evidence |
|---|---|---|
| customers/customers_screen.dart | **verified (list)** | Rendered at 360, 768, 1024, 1366, 1440, 1920, 960x600: no overflow; Tags/Offers dropped on tablet+laptop and header/rows stay aligned; Ctrl+F focuses search; **phone render byte-identical to HEAD** (cmp). Not yet: detail/form screens, feedback tab, text-scale 1.3 and 125/150% scaling runs. |

**Phase 1 closed (2026-11-23).** Added after the first entry: web-style top bar profile chip (laptop: avatar; desktop+: property + user, opens Profile), hover-expand icon rail (overlays content, mouse only, toggle/Ctrl+B do the same), floating 420px toast from tablet up (phone untouched), `TableSheet` stretch cap by tier (wide 2.2x, otherwise 3x), the report `KpiRow` is now tier-aware (2/2/3/4/4) and the duplicate I had added in `page_kit.dart` was removed, Ctrl+F + low-priority columns on Expenses (Vendor, Paid hidden on tablet/laptop).
Deferred to the batches (needs a screen to adopt them): `PageHeader`, `FilterPopover`, `MasterDetail`, `StateView`, `showAppDialog`; selectable phone/ID text (a global `SelectionArea` fights the mouse-drag scrolling the app enables, so it goes onto detail screens individually); text-scale 1.3 and 125/150% runs (run per batch in the matrix).

| Screen | Status | Evidence |
|---|---|---|
| expenses/expenses_list_panel.dart | **verified (list)** | Rendered 360/768/1024/1366/1440/1920/960x600, no exceptions; Vendor + Paid dropped on tablet/laptop, columns aligned; Ctrl+F. Phone path untouched (no phone-branch edits). |
| reports/report_widgets.dart `KpiRow` | **verified by test** | 2 on tablet, 3 on laptop, 4 on desktop (`tier_kit_test`). Overview panel not screenshot-verified (needs analytics fixtures). |

## F. Batch 1 (2026-11-23): login, profile, WhatsApp settings, sync center, printer settings

| Screen | Change | Status |
|---|---|---|
| login_screen.dart | tablet+: brand navy fills the whole window (phone keeps the top wash); footer text light on navy | done (verified) |
| profile/profile_screen.dart | laptop+: two columns (identity + property left, settings right), max 1040; below laptop and on phone the same single column as before | done (verified) |
| profile/whatsapp_settings_screen.dart | already `formMaxWidth`; tablet gets 48px Auto/Manual segments | done (verified) |
| shell/sync_center_screen.dart | list capped to `formMaxWidth`, centred | done (code only: needs the offline SQLite store, not in the screenshot harness) |
| printing/printer_settings_screen.dart | already two-pane at >=900 from the earlier pass; no change | not re-verified: harness cannot settle (scan spinner) at >=1024. Known pre-existing: a `ListTile` inside a coloured `DecoratedBox` debug assertion fires at every size, phone included |
| shell + top bar + rail | Phase 1 | done |

Evidence: 7 sizes (360, 768x1024, 1024x768, 1366, 1440, 1920, 960x600) rendered for login/profile/whatsapp with no exceptions; text scale 1.3 run on login, profile, whatsapp, customers, expenses at all 7 sizes with no overflow; **phone renders byte-identical to HEAD for login, profile, whatsapp**. Windows 125/150% is the same as the 1280/1024 logical widths in this matrix (physical 1920 at 150% = 1280 logical).

## G. Batch 2 (2026-11-23): list/table screens

| Screen | Change | Status |
|---|---|---|
| income/income_list_panel.dart | low-priority cols (Payer, Received) hidden on tablet/laptop; Ctrl+F | done (verified) |
| assets/assets_list_panel.dart | Location, Warranty, AMC hidden on tablet/laptop; Ctrl+F | done (verified) |
| enquiries/enquiries_screen.dart | Reference, Received hidden on tablet/laptop; Ctrl+F | done (verified) |
| bookings/register_screen.dart | Booking no., Left hidden on tablet/laptop; Ctrl+F | done (verified) |
| staff/staff_roles_screen.dart | staff + role cards in `AdaptiveGrid` (spacing 8 = phone unchanged) | done (verified) |
| customers, expenses | Phase 1 | done |

Evidence: Income and Enquiries rendered at 7 sizes, no exceptions; text scale 1.3 no overflow; phone byte-identical to HEAD for both. `flutter analyze lib` 13 issues (all pre-existing, none in touched files); shell_test: same 6 baseline failures.

Batch 2 follow-up: Assets, Guest Register and Staff now rendered at 7 sizes (no exceptions), text scale 1.3 no overflow, phone byte-identical to HEAD.

## H. Batch 3 (2026-11-23): card/board screens

| Screen | Change | Status |
|---|---|---|
| housekeeping/rooms_tab.dart | Notes column hidden on tablet/laptop | done (verified) |
| housekeeping/issues_tab.dart | Reported-by column hidden on tablet/laptop | done (code; Issues tab not rendered, only the Rooms tab is) |
| services/services_catalogue_panel.dart, service_usage_panel.dart | table layout from tablet (was >=800), GST column low priority; toolbar search now shrinks with the pane (was a fixed 460 that overflowed 154px at 768) | done (verified: toolbar; tables empty in fakes) |
| bar/bar_orders_panel.dart | card columns by pane width (1 / 2 at >=700 / 3 at >=1140), phone always 1 | done (verified at 768; 2-col not reachable at 768 because of the tablet content cap, see below) |
| laundry/*, food/orders_screen.dart | already Wrap/`_ResponsiveCards`/TableSheet by pane width; no code change | not rendered (needs laundry + food fakes) |

Known deviation: the shell caps content at 640px below 800px window width (`_ResponsiveBody`, old phone-column rule), so a 768px tablet shows 1 column in card grids where the brief wants 2. Changing that cap affects every screen and needs your OK.
Evidence: housekeeping/services/bar at 7 sizes, no exceptions after the services fix; text scale 1.3 no overflow; phone byte-identical to HEAD for all three.

## I. Batch 4 (2026-11-23): forms

Audit of 27 form screens: 20 were already capped with `formMaxWidth`; the 6 that were not are now capped (centred, 960 from tablet up, phone untouched since the cap is 640 below 600).

| Screen | Change | Status |
|---|---|---|
| laundry/linen_send_screen, linen_receive_screen, linen_item_form_screen | capped with `formMaxWidth` | done (send + item verified: 7 sizes, 1.3x text, phone byte-identical; receive same edit, not rendered) |
| events/event_form_screen.dart | capped with `formMaxWidth` | done (code + analyze only; needs event/catalogue fakes) |
| bookings/check_in_sheet.dart | check-in page capped with `formMaxWidth` | done (code + analyze only) |
| expenses/expense_form_screen.dart | already a 640 cap; left | n/a |
| bookings/cancel_booking_sheet.dart | already a dialog (`showDialog`) | n/a |
| the other 20 forms | already `formMaxWidth` (customer form also uses `FormGrid`) | no change, not re-rendered |

Not done (deviations, need your call): forms stay single-column at 960 (only the customer form uses `FormGrid` 2-col); Save is full-width in the linen forms rather than `FormActions` right-aligned; `take_booking_screen` (5,397 lines) not restructured into a 2-column layout. These are bigger rewrites than "minimum diff per screen".

## J. Batch 5 (2026-11-23): details and dialogs

| Screen | Change | Status |
|---|---|---|
| widgets/neu.dart `showNeuFilterSheet` (shared by every list's filter) | from tablet up opens as a centred 480px dialog (no drag handle); phone keeps the bottom sheet | done (verified on Customers at 768 + 1440; phone byte-identical to HEAD) |
| assets/asset_detail_screen.dart | detail and renewal view capped with `formMaxWidth`; the existing facts/QR side-by-side now keys off the capped width | done (verified: 7 sizes, 1.3x, phone identical) |
| billing/bill_receipt_screen.dart, billing/advance_receipt_screen.dart | PDF preview capped with `formMaxWidth` (was full window) | done (code + analyze) |
| bookings/booking_detail_screen.dart | already splits at >=1100 pane width | no change |
| customers/customer_detail_screen.dart, events/event_detail_screen.dart | already capped (960) | no change |
| tape_quick_peek_sheet, cancel_booking_sheet, out_of_order_sheet | already `showDialog` | no change |
| other bottom sheets (bar, events diary, recipes, price chart, saved quotations, photo source) | M3 sheets / explicit constraints already cap them at 560-640 | no change |

Blocked: while rendering asset detail, `lib/screens/bookings/take_booking_screen.dart:1642` stopped compiling ("Required named parameter 'reason' must be provided"). That file, `booking_viewmodel.dart`, `billed_edit_panels.dart` and `check_in_sheet`-adjacent code carry uncommitted changes that are not from this rollout (WIP by the project owner); left untouched.

Update: the compile break in take_booking_screen was transient (the owner's WIP) and is gone. Rendering asset detail exposed a **pre-existing crash at HEAD**: on any window >= 640 wide the detail page threw "LayoutBuilder does not support returning intrinsic dimensions" (an `IntrinsicHeight` row around the facts card). Fixed by replacing it with a top-aligned `Row` (cards no longer forced to equal height).

## K. Batch 6 (2026-11-23): billing, events, rooms & rates

| Screen | Change | Status |
|---|---|---|
| billing/billing_screen.dart | queue table: Info hidden; invoice table: Room + Document hidden on tablet/laptop; header, rows and the totals row all read the same visible-column list so they stay aligned | done (code + analyze; not rendered: needs billing fakes) |
| events/events_list_panel.dart (Event register) | full-width card per event -> `AdaptiveGrid` (spacing kept) | done (verified: 7 sizes, 1.3x text, phone byte-identical) |
| billing/event_billing_screen.dart, events diary/setup, rooms/* | already `TableSheet` / `formMaxWidth` / `AdaptiveGrid` by width; `rooms_panel` `pageMaxWidth` is infinite from 800 | no change, not rendered |

Environment note: `BookingRepository.bookingEdits` was added upstream (uncommitted WIP, not part of this rollout), so `test/shell_test.dart` and `tape_chart_scroll_test.dart` no longer compile (their fakes lack it). Not touched; the shell tests are unrunnable until those fakes are updated.

## L. Batch 7 (2026-11-23): tape chart and reports

| Screen | Change | Status |
|---|---|---|
| bookings/tape_chart.dart, bookings_screen.dart, theme.dart | the raw 1100/1300 width tests are now `AppTheme.bpChartMonth` / `bpChartRoomy` (content-specific, deliberately not tiers: the chart needs 1100 to fit a month). Date-header cell scales down at large text; toolbar buttons right-aligned in a scale-down box instead of overflowing | done (verified: 7 sizes, 1.3x text clean, phone byte-identical to HEAD). Pre-existing: at 1.3x text HEAD threw ~119 one-pixel overflows in the date header and a 41px toolbar overflow at 1440 |
| reports/overview_report_panel.dart | donut / bar lists / payment mix in `AdaptiveGrid` (2+ across) from tablet; phone keeps the stacked list | done (code + analyze; not rendered: needs analytics fixtures) |
| reports/report_widgets.dart `KpiRow` | tier-aware (Phase 1) | done |
| other report panels (bookings, bills, gst, events, food, laundry, services, bar, occupancy, P&L, assets, expenses, income) | already `TableSheet`; no change | not touched, not rendered |

Status of the whole programme: Phase 0, Phase 1 and Batches 1-7 are done at the depth recorded per row. Not done anywhere: take_booking two-column layout, `FormGrid`/`FormActions` adoption across forms, the 640px content cap below 800 (decision pending), native Windows checks (maximize-on-start, 960x600 min), unrendered screens (billing, rooms & rates, laundry, food orders, report panels, event form, check-in), and `shell_test`/`tape_chart_scroll_test` compile breaks from the owner's uncommitted `bookingEdits` change.

## M. Completion pass (2026-11-23)

- **Tablet cap removed** (`_ResponsiveBody`): a 600-799 window now gets the whole pane (up to 1360/1600) instead of a 640 phone column. Bar orders now show 2 columns at 768. Verified: 12 screens at 768 with text scale 1.3, no overflow/exception; phone path unchanged (`_ResponsiveBody` returns the child on a phone).
- **Linen send / receive / item forms** use `FormActions` (full width on phone as before, right-aligned natural-width from tablet). Phone byte-identical to HEAD.
- **Test fakes** (`shell_test`, `tape_chart_scroll_test`) got a `bookingEdits` stub (returns `[]`) so they compile again against the owner's uncommitted `bookingEdits` API.
- **Hover/right-click audit**: no `onSecondaryTap`; the only hover use is a row highlight (`register_screen`); long-press (tape chart, event diary) is a touch gesture and works by press-and-hold with a mouse. No essential action depends on hover or right-click.

Test status after this pass: `shell_test` + `tape_chart_scroll_test` fail 9 tests; HEAD fails 7 of those. The 2 extra ("every section lays out at 1920 / 400") stall in `pumpAndSettle` on the Room billing section. Reverting my billing change does not clear it; the working tree also carries the owner's uncommitted network-interceptor and booking changes, so the cause is unconfirmed.

Still not done: native Windows checks (no Visual Studio); take_booking two-column rewrite; `FormGrid` adoption beyond the customer form; screens never rendered (billing, rooms & rates, laundry, food orders, most report panels, event form, check-in, receipt previews).
