# Lodge Management System

Multi-tenant lodge PMS for small Indian properties. React + Node + SQL Server.
Offline bookings only — no OTA, no payment gateway, no guest login.

> **This file is the single source of truth.** Earlier amendment documents have been folded in.
> If something here contradicts an older file, this wins.

---

## Contents

- [The idea](#the-idea)
- [Status](#status)
- [Commands](#commands)
- [Architecture decisions](#architecture-decisions)
- [Domain model](#domain-model)
- [Pricing engine](#pricing-engine)
- [Billing and GST](#billing-and-gst)
- [Guests, ID and vehicles](#guests-id-and-vehicles)
- [Food ordering and roles](#food-ordering-and-roles)
- [Public enquiry page](#public-enquiry-page)
- [Repo structure](#repo-structure)
- [API surface](#api-surface)
- [Build order](#build-order)
- [Traps](#traps)
- [Glossary](#glossary)
- [Document index](#document-index)

---

## The idea

Property management software for small, family-run lodges in regional Maharashtra — the fifteen-to-forty-room places in Sindhudurg and the wider Konkan that currently run on a handwritten register, a receipt pad and the owner's memory.

It is sold by Vengurla Tech as a subscription, one account per lodge, with onboarding done by hand. The lodge owner and their staff are the users. **The guest never logs in.**

### Who uses it

| Actor | Where | What they do |
|---|---|---|
| Our team | Our office | Take enquiries, register lodges, create the first login, hand over |
| Owner | The lodge | Rates, rooms, staff, reports. Sees the money. |
| Reception | The counter | Bookings, check-in and out, bills, payments. The heaviest use by far. |
| Kitchen | The kitchen | One screen: the food order queue |
| Guest | Walks in, or phones | Scans a QR to order food. Nothing else. |

### Why not just use existing hotel software

Because the products aimed at this market are cut-down versions of hotel systems built for a different kind of business. The realities these lodges actually run on:

- **Stays are billed on a 24-hour cycle**, from the moment of check-in, not to a fixed noon checkout.
- **AC is a purchase, not a property.** The room has a unit; whether it runs depends on what the guest pays. The same room is a ₹900 fan room or a ₹1,400 AC room, and it can change on the second night of a stay.
- **Rates are built from position, not from room type.** Sea-facing costs more than back-facing, first floor more than ground, and a lodge has one or two rooms that have simply always cost a fixed amount regardless of any formula.
- **Rates move with the calendar.** Ganpati, Diwali, summer holidays, monsoon, weekends.
- **Bills come in more than one shape.** A single lodge issues tax invoices for some stays and non-GST bills for others, decided at the counter when the bill is cut. Below the nil threshold a registered lodge issues a bill of supply, which is not the same document as a cash receipt.
- **Price is negotiated at the counter.** Discounts are normal and need to be recorded against whoever gave them.
- **The register is a legal document.** Every occupant named, at least one ID, vehicle numbers, Form C for foreign nationals.
- **Everything is in Marathi and English**, and half the traffic is on a patchy rural connection.

Software that assumes fixed room types, noon checkouts, a single GST treatment and online payment cannot be configured into this. It has to be built for it.

### What it deliberately does not do

These are not gaps. They are the constraints the architecture rests on, and giving any of them up rewrites large parts of the system.

- **No online booking and no payment gateway.** The public page generates WhatsApp enquiries; the lodge confirms and enters the booking. This removes inventory holds, refunds, reconciliation and PCI scope from the entire product.
- **No OTA listings.** No channel manager, no availability sync, no rate parity.
- **No guest app or guest login.** There is nothing to log in to.
- **No restaurant table service** for people not staying, and no kitchen stock control.

### How the pieces fit

Three surfaces over one database:

1. **Admin app** (SPA) — the front desk and the owner. Tape chart, bookings, rate chart, billing, reports.
2. **Public enquiry page** (server-rendered) — one shareable link and QR per lodge. Shows rooms and live rates, hands the guest to WhatsApp with a reference code that staff can look up.
3. **Kitchen screen** — the order queue, and nothing else.

### The design idea everything else hangs off

**Rooms are described by attributes, and the rate is computed.**

A category supplies a base price. Fixed attributes — facing, floor, bathroom — add or subtract amounts. Switchable extras like AC are sold per night on top. Seasons adjust the result by date. Individual rooms can be pinned to a fixed price where the formula does not apply.

The alternative is a flat list of room types, where AC × facing × floor × category becomes thirty-odd types that the owner must price individually and re-price by hand every time anything changes. Adding "sea facing" would double the list.

With attributes, adding a new room is one entry and its rate is already correct. That single property is what makes the product demonstrable in a sales meeting and maintainable a year later.

### The commercial hook

The enquiry funnel — page views, WhatsApp taps, conversions. When an owner asks in month six what they are paying for, "forty-one people looked at your rooms this week, nine messaged you, five booked" is the answer that renews the subscription. It is also what makes owners keep their rates accurate in the system, which is what makes everything else work.

---

## Status

| Area | State |
|---|---|
| Spec | Complete |
| Schema | Not started |
| Pricing engine | Not started |
| Everything else | Not started |

Update this table as milestones land. Keep it honest — it's the first thing anyone reads.

---

## Commands

```bash
pnpm install
pnpm dev              # api + web + public site
pnpm --filter api dev
pnpm --filter pricing test    # run these before touching anything money-related

npx prisma migrate dev      # provider = "sqlserver"
npx prisma studio
```

**Run once on the database, before anything else:**

```sql
ALTER DATABASE lodge_os SET ALLOW_SNAPSHOT_ISOLATION ON;
ALTER DATABASE lodge_os SET READ_COMMITTED_SNAPSHOT ON;
```

Read-committed snapshot isolation stops readers blocking writers. On a read-heavy PMS where the tape chart re-queries constantly, skipping this produces mysterious front-desk freezes under two concurrent users.

---

## Architecture decisions

Ten calls that shape everything. Change any of these only with a very good reason, and record it here.

| # | Decision | Reason |
|---|---|---|
| 1 | **`room_nights` table, one row per room per occupied night** | SQL Server has no exclusion constraints. A primary key on `(room_id, night_date)` restores the same structural guarantee: double-booking becomes impossible at the database, not merely unlikely. |
| 2 | **Attributes, not room types** | AC × facing × floor × category explodes to 32+ flat types. Model attributes separately, compute the rate. |
| 3 | **Attributes split in two** | *Fixed* (facing, floor, bathroom) define the room's signature. *Switchable* (AC, extra bed) are sold per booking-night and can vary within one stay. |
| 4 | **Snapshot the rate, never recompute** | Every `booking_rooms` row carries a frozen `NightBreakdown[]`. Tariff changes must never move an issued bill. |
| 5 | **Pricing and tax are pure packages** | Zero I/O, zero DB. Unit-testable, portable, safe to snapshot. |
| 6 | **Tax slabs live in the DB** | Rates changed in Sept 2025 and will again. A rate change is a row update, not a deploy. |
| 7 | **Accommodation is always CGST + SGST** | Place of supply = property location (IGST Act §12(3)(b)). Never IGST, regardless of guest state. Comment this in code — someone will try to "fix" it. |
| 8 | **Billing side is per-booking** | Decided at the counter when the bill is cut, not stored on the room; the rate decides which document within that side. Two inputs, that order. |
| 9 | **RBAC ships with food ordering** | Kitchen staff cannot have full access. `can()` calls exist from day one but only start evaluating at M7. |
| 10 | **Occupant counts are derived** | `adults`/`children` come from the occupant list, never entered separately, so pricing and the legal register can't disagree. |

---

## Domain model

### Tenancy

```
platform_users        our team
lodges                the tenant
lodge_users           lodge staff
lodge_enquiries       owner leads before a lodge exists
```

Every business table carries `lodge_id`. Enforced by middleware **and** SQL Server Row-Level Security as a second net — a security policy with a predicate function reading `SESSION_CONTEXT('lodge_id')`, set by the tenant middleware at the start of each request. Even a repo method missing its `WHERE lodge_id` returns nothing across tenants.

Two `lodges` fields are effectively immutable after go-live:

- `is_gst_registered` — determines which documents exist at all
- `checkin_mode` — `NIGHT_BASED` or `HOUR_24`. Most Konkan lodges run 24-hour cycles.

Also on `lodges`: `is_specified_premises` (drives the restaurant GST rate), `whatsapp_number` (separate from `phone`), `slug` (immutable once shared).

### Rooms and attributes

```sql
room_categories
  id, lodge_id, name, code, base_price, base_occupancy, max_occupancy,
  extra_adult_price, sort_order

category_child_bands          -- under 5 free, 5-12 half, etc.
  id, category_id, max_age, charge_type('FLAT'|'PERCENT'), charge_value, sort_order

attribute_groups              -- kind distinguishes the two families
  id, lodge_id, name, code, kind('FIXED'|'SWITCHABLE'), affects_price, sort_order

attribute_options
  id, group_id, label, code, sort_order

switchable_charges            -- per-night price of AC, extra bed
  id, lodge_id, option_id, charge_per_night, seasonal_applies(default false)

rooms
  id, lodge_id, room_number, category_id,
  status('AVAILABLE'|'OCCUPIED'|'BLOCKED'|'OUT_OF_ORDER'),
  housekeeping_status('CLEAN'|'CLEANING'|'DIRTY'|'INSPECTED'),
  is_active, notes

room_attributes               -- fixed attributes only
  room_id, option_id

room_capabilities             -- which switchable options this room supports
  room_id, option_id
```

**Room signature** — deterministic key from fixed attributes, sorted by group order:

```
AC is NOT in the signature. Facing and floor are.
FACE:SEA|FLR:1
```

**Two orthogonal states.** `status` (occupancy) and `housekeeping_status` (cleanliness) move independently. A room can be `AVAILABLE` + `DIRTY` — sellable, but no key handover. Merging these is the second most common PMS mistake.

### Bookings

```sql
bookings
  id, lodge_id, booking_code, status, source,
  primary_guest_id, check_in_date, check_out_date,
  actual_check_in_at, actual_check_out_at,
  order_pin,                          -- 4 digits, dies at check-out
  billing_side,                       -- chosen at the counter, when the bill is cut
  notes, created_by, cancelled_at, cancel_reason

booking_rooms
  id, booking_id, room_id, category_id_snapshot, signature_snapshot,
  check_in_date DATE, check_out_date DATE,
  rate_snapshot NVARCHAR(MAX) NOT NULL,   -- frozen NightBreakdown[]
    CONSTRAINT ck_rate_snapshot_json CHECK (ISJSON(rate_snapshot) = 1),
  total_amount DECIMAL(12,2)

room_nights                           -- THE double-booking guard
  room_id BIGINT NOT NULL,
  night_date DATE NOT NULL,
  booking_room_id BIGINT NOT NULL,
  lodge_id BIGINT NOT NULL,
  CONSTRAINT pk_room_nights PRIMARY KEY (room_id, night_date)

booking_room_options                  -- AC on/off, per date range
  id, booking_room_id, option_id, effective_from DATE, effective_to DATE

booking_occupants
  id, booking_id, room_id, name, age_band('ADULT'|'CHILD'|'INFANT'), age,
  relation, is_primary, effective_from DATE, effective_to DATE

booking_vehicles
  id, booking_id, registration_raw, registration_normalised,
  vehicle_type, make_model, colour, driver_name, parking_slot,
  arrived_at, departed_at

guests
  id, lodge_id, name, phone, email, address, city, state, country,
  is_foreign_national, passport_no, visa_no, arrived_from, next_destination

guest_ids
  id, occupant_id, id_type, last4, salted_hash, image_url, uploaded_by
```

### State machine

```
ENQUIRY ──► RESERVED ──► CHECKED_IN ──► CHECKED_OUT ──► INVOICED
              │
              ├──► CANCELLED
              └──► NO_SHOW
```

Walk-ins enter directly at `CHECKED_IN`. **Exits only from `RESERVED`** — there is no cancel once a guest is in the room; early departure is an early check-out. Transitions only via a service method; no route sets `status` directly.

### Double-booking prevention

Every booked night gets a row in `room_nights`, written in the **same transaction** as the booking. The primary key on `(room_id, night_date)` does the rest.

```sql
INSERT INTO room_nights (room_id, night_date, booking_room_id, lodge_id)
SELECT @roomId, d, @bookingRoomId, @lodgeId
FROM   dbo.DateRange(@checkIn, @checkOut);   -- half-open: excludes checkout day
```

A clash raises error **2627** (or 2601). Catch it, roll back, surface *"Room 204 was just booked by Sagar"*, refresh the availability list. There is no window in which two clerks can both succeed.

Two properties this buys for free:

- **The check-out day is never inserted**, so it is automatically available to the next guest. The single most common off-by-one in PMS work stops being possible.
- Availability is an index seek, not a range-overlap scan.

```sql
SELECT r.* FROM rooms r
WHERE  r.lodge_id = @lodgeId AND r.is_active = 1 AND r.status <> 'OUT_OF_ORDER'
  AND NOT EXISTS (
        SELECT 1 FROM room_nights rn
        WHERE rn.room_id = r.id
          AND rn.night_date >= @checkIn
          AND rn.night_date <  @checkOut);
```

Keeping it in step:

| Event | Action on `room_nights` |
|---|---|
| Booking created | INSERT nights `[in, out)` |
| Cancel / no-show | DELETE that booking_room's rows |
| Extend stay | INSERT the new nights — fails if taken |
| Move room | DELETE old rows, INSERT new |
| Early departure | DELETE the unused nights |

**Multi-room bookings must insert ordered by `room_id` ascending.** Two clerks booking overlapping room sets in opposite orders is the one way to deadlock here, and consistent ordering removes it.

Volume is trivial — 40 rooms × 365 nights is under 15,000 rows a year. Archive by lodge and year if it ever matters.

---

## Pricing engine

`packages/pricing` — pure functions, no DB, no `Date.now()`, no side effects. Test it to death.

### Tables

```sql
price_rules          -- fixed-attribute deltas
  id, lodge_id, option_id, category_id NULL, adjust_type('FLAT'|'PERCENT'),
  adjust_value, priority

rate_overrides       -- pins
  id, lodge_id, category_id, signature NULL, room_id NULL,
  price, valid_from NULL, valid_to NULL

rate_seasons
  id, lodge_id, name, starts_on, ends_on, weekday_mask,
  adjust_type, adjust_value, priority, colour
```

### Resolution order — per night, deterministic

```
FOR EACH night in [checkIn, checkOut):

  1. base = category.base_price
  2. room-level pin active?  → rate = pin.price, skip to 4
  3. fixed-attribute deltas:
       flat = Σ FLAT rules
       pct  = Σ PERCENT rules          (applied to BASE, never compounding)
       rate = base + flat + base*pct/100
     signature pin active? → rate = pin.price
  4. season: single highest-priority match on (date, weekday_mask).
     SEASONS DO NOT STACK.
  5. switchable options active this night → += charge_per_night
     ── AFTER the season, unless seasonal_applies is set ──
  6. occupancy: extra adults × extra_adult_price
                children resolved through category_child_bands
  7. manual adjustment (requires reason + actor_id)
  8. round per lodge setting

  → { date, base, lines[], finalRate }
```

**Step 5 placement is load-bearing.** A ₹500 AC charge must stay ₹500 during a +25% festival, not become ₹625. Owners verify this in their head and will report it as a bug otherwise.

Percentages always apply to the category base, never compounding — a matrix an owner can't reproduce mentally is a matrix they won't trust.

---

## Billing and GST

### Which document

Two inputs, in this order:

1. **Booking's `billing_side`** — decided at the counter when the bill is cut, not stored on the room.
2. **The rate charged** — only chooses between the two GST-side documents.

| Document | Condition | GSTIN | In GSTR-1 |
|---|---|---|---|
| Tax invoice | GST side, rate above nil threshold | yes | taxable |
| Bill of supply | GST side, rate below nil threshold | yes | nil-rated |
| Cash receipt | Non-GST side | no | — |

A registered lodge below the threshold issues a **bill of supply**, not a cash slip. It carries the GSTIN and appears in returns as exempt turnover. Only an unregistered lodge issues cash receipts.

### Rates

Current slabs (verify with the lodge's CA — this is why they're rows):

- Accommodation: nil below ₹1,000/night, 5% ₹1,000–₹7,500, 18% above. SAC `996311`.
- Restaurant/food: 5% without ITC for non-specified premises, 18% with ITC for specified. SAC `996331`. Driven by `lodges.is_specified_premises`.

```sql
tax_slabs
  id, lodge_id, supply_type('ACCOMMODATION'|'FOOD'),
  min_amount, max_amount NULL, rate_percent, itc_allowed, sac,
  effective_from, effective_to NULL
```

### Rules

- Tax evaluated **per room, per night** on the actual rate. One stay crossing a season can produce two tax lines.
- Compute CGST and SGST independently at half the rate, round each to 2dp, then round the grand total to the nearest rupee into `round_off`. Do not compute total tax then halve — you get paise mismatches that fail GSTR-1 reconciliation.
- Food is a separate supply on its own SAC. Setting: food follows the room's side, or always goes on a tax invoice. Lodge and CA decide.
- **Mixed bookings produce multiple documents.** Rooms on different sides cannot share a bill. Split the folio into billing groups and show the split *before* generate.
- Override warning: moving a booking to the GST side above threshold means tax now applies. Ask whether it's added on top or the rate is inclusive, and show the figure.

### Numbering

```sql
invoice_series
  id, lodge_id, series_type('GST'|'NON_GST'), prefix,
  financial_year, last_number
  UNIQUE(lodge_id, series_type, financial_year)
```

Allocate inside the invoice transaction. The `UPDATE ... OUTPUT` takes an exclusive lock and is atomic:

```sql
UPDATE invoice_series
SET    last_number = last_number + 1
OUTPUT inserted.prefix, inserted.financial_year, inserted.last_number
WHERE  lodge_id = @lodgeId AND series_type = @type AND financial_year = @fy;
```

Never `SELECT MAX(no)+1`. Never allocate on screen-open or preview. Bills of supply share the GST-side series.

**Issued invoices are immutable.** Void in place, reissue, reference the void. Never delete.

---

## Guests, ID and vehicles

- **Occupants**, not counts. Name + age band are the only required fields. `adults`/`children` for pricing derive from this list.
- Only the **primary guest** is promoted to the `guests` directory. Others stay booking-scoped unless they have ID or a phone — otherwise the directory fills with unmatched duplicates.
- **ID policy per lodge**: `ONE_PER_BOOKING` | `ONE_PER_ROOM` | `ALL_ADULTS`. Foreign nationals always need their own, overriding the setting. Form C generated per foreign national.
- **Never store full Aadhaar.** Field accepts 4 characters. Store last4 + salted hash + image in private storage.
- ID images need a retention purge, `guest.id.view` permission, and an access log. Set the retention period with the lodge.
- **Vehicle plates are normalised on save** (uppercase, separators stripped). `MH07AB1234` / `MH 07 AB 1234` / `MH-07-AB-1234` are one car. Plate search must hit from anywhere.
- **Soft completion.** Booking proceeds with primary guest + ID; the rest is added during the stay, flagged on the dashboard. Optional hard block at bill generation, not at check-in — a queue at 11pm means staff route around the system.

---

## Food ordering and roles

### Ordering

- One QR per room, room number printed in plain text underneath.
- Scanning opens the menu. **Ordering requires the booking PIN**, issued at check-in, expiring at check-out. A room with nobody checked in shows the menu plus a contact-reception message.
- Orders above a configurable amount need reception approval.
- Charge posts **on delivery**, not on placement. Cancelled orders never reach the folio.
- Reception can enter orders manually and correct or remove a wrongly charged one, with a reason.
- Kitchen screen: order number, room number, items, note, elapsed time. Four states. **Audible alert on new orders** — without it the feature fails silently.
- Item availability toggle must be reachable from the kitchen screen, not just admin.

No modifiers in v1 (half and full are separate items). No walk-in table service. No stock control. No payment at order time.

### Roles

```sql
roles / permissions / role_permissions / user_roles
```

```
OWNER      everything
RECEPTION  bookings, guests, billing, payments, orders, day summary
           NOT pricing setup, revenue reports, user management
KITCHEN    order queue only
```

`can('booking.create')` is written at every call site from day one and returns `true` until `RBAC_ENFORCED=true` at M7. Permissions to enforce first: discount above X%, void invoice, edit closed day, view revenue, change pricing, manage users, view ID images.

---

## Public enquiry page

Separate server-rendered app. Unauthenticated, high-read, SEO-relevant.

- `stay.<domain>/{lodge-slug}`, plus `?room=` deep links and date params.
- **Server rendering is load-bearing**: OG meta tags generate the WhatsApp preview card. A client-rendered SPA gives a blank preview and the link dies in the group chat.
- Public API is its own namespace with a whitelisted response shape. Never make auth optional on an admin endpoint. Rate limit by IP, cache computed rates per (lodge, category, range).
- Shows categories only — never room numbers, never availability counts.
- Prices **tax-inclusive by default**, both with and without the switchable charge.
- Every WhatsApp tap writes an enquiry with a reference code *before* redirecting: room, dates, guests, quoted price. Code appears in the guest's message. 30-day TTL.
- Enquiry inbox → one-click convert to booking with fields prefilled.
- Funnel dashboard (views → taps → conversions) is the retention feature. Build it early.
- Budget under 100KB initial load. Resize uploads to three sizes, WebP, CDN.

---

## Repo structure

```
lodge-os/
├── apps/
│   ├── api/src/
│   │   ├── modules/          # feature-first, NOT layer-first
│   │   │   ├── auth/ lodges/ enquiries/ rooms/ categories/ attributes/
│   │   │   ├── pricing/ seasons/ bookings/ guests/ occupants/ vehicles/
│   │   │   ├── invoices/ payments/ menu/ orders/ reports/ rbac/
│   │   │   └── <each>: .routes .controller .service .repo .schema .test
│   │   ├── core/             # db, errors, logger, tenant, audit, validate, rbac
│   │   ├── jobs/             # night audit, no-show sweeper, PIN expiry
│   │   └── server.js
│   ├── web/                  # Vite SPA, admin
│   └── public-site/          # SSR, enquiry page
└── packages/
    ├── shared/               # zod schemas, used by api and web
    ├── pricing/              # PURE
    └── tax/                  # PURE
```

**The rule:** a module may import from `core` and `packages/*`. A module may **never** import another module's `repo` or `service`. Go through a published interface or emit a domain event. This is what stops the codebase setting like concrete at month six.

### Stack

`React 18 · Vite · TanStack Query · React Hook Form + Zod · Tailwind + shadcn/ui · Zustand · dnd-kit · date-fns` — never Moment, never raw `Date` arithmetic.

**Plain JavaScript, no TypeScript.** Zod therefore carries the type contract on its own — parse at every boundary, including API responses on the client and JSON columns read back from the database. Add `jsconfig.json` with `checkJs` and JSDoc anything non-obvious for editor support without a build step. Be strict about two things a compiler would otherwise catch: no dynamic property access on business objects (`obj[key]` from data turns a typo into a silent `undefined` on an invoice), and always `Number()` money explicitly and reject `NaN` at the boundary.

### SQL Server specifics

| Concern | Use |
|---|---|
| ORM | Prisma with `provider = "sqlserver"`, or Knex / `mssql` (tedious) directly |
| Primary keys | `BIGINT IDENTITY`. If GUIDs are wanted, `NEWSEQUENTIALID()` — plain `NEWID()` fragments every clustered index |
| Money | `DECIMAL(12,2)`. **Never the `MONEY` type** — it rounds badly on division |
| Moments in time | `DATETIMEOFFSET`, always UTC |
| Calendar dates | `DATE`. Never store a check-in *date* as a datetime |
| Enums | No native type. `CHECK` constraints for closed sets, lookup tables where the lodge can extend them |
| JSON | `NVARCHAR(MAX)` + `CHECK (ISJSON(col) = 1)`. Read with `JSON_VALUE` / `OPENJSON` |
| Computed columns | `AS (...) PERSISTED` where they need indexing |
| Text | `NVARCHAR` throughout — Marathi guest names and menu items are non-Latin |
| Collation | Default is **case-insensitive**. Codes and room signatures compare loosely unless you force `Latin1_General_BIN2` on those columns |
| Tenant isolation | Row-Level Security policy over `SESSION_CONTEXT('lodge_id')` |

---

## API surface

```
POST   /auth/login
GET    /rooms?floor=&status=
GET    /rooms/availability?from=&to=&categoryId=
PATCH  /rooms/:id/housekeeping
GET    /pricing/matrix?date=            whole studio payload in one call
POST   /pricing/quote                   used by BOTH simulator and booking form
POST   /pricing/bulk-adjust             { scope, adjustType, value, dryRun }
POST   /bookings                        Idempotency-Key required
POST   /bookings/:id/check-in | check-out | cancel
POST   /bookings/:id/occupants | vehicles | rooms
POST   /invoices                        { bookingId, type }
POST   /invoices/:id/void
POST   /payments
GET    /orders/queue                    kitchen
POST   /orders/:id/status
GET    /reports/occupancy | gstr1 | guest-register
GET    /public/v1/lodges/:slug          unauthenticated, whitelisted
POST   /public/v1/enquiries
```

`/pricing/quote` serving both the simulator and the booking form is deliberate — the demo price is provably the charged price.

---

## Build order

| M | Scope |
|---|---|
| M1 | Monorepo, SQL Server, migrations, auth, tenant middleware + RLS, RBAC scaffold (disabled) |
| M2 | Categories, attributes, rooms, room grid, housekeeping |
| M3 | `packages/pricing` + tests, quote endpoint, **Pricing Studio** |
| M4 | Bookings, exclusion constraint, tape chart, occupants, ID, vehicles, check-in/out |
| M5 | `packages/tax`, invoice series, three document types, payments |
| M6 | Reports, GSTR-1, guest register, Form C, audit log, night audit |
| M7 | Menu, QR, PINs, kitchen queue, folio posting — **RBAC switched on** |
| M8 | Public enquiry page, reference codes, enquiry inbox, funnel |

**M3 before M4, always.** A booking created before the pricing engine exists has no frozen rate snapshot and becomes a migration.

---

## Traps

1. Recomputing old bookings' prices. Snapshot at creation, read forever.
2. Inserting the check-out date into `room_nights`. Nights are `[in, out)` — the departure day belongs to the next guest.
3. One status field for occupancy + cleanliness.
4. Timezone drift. `DATETIMEOFFSET` for moments, `DATE` for dates. Never a check-in date as a datetime.
5. Hard-deleting rooms, staff, or invoices. Deactivate.
6. Compounding percentage modifiers.
7. `SELECT MAX(invoice_no)+1`.
8. Money in floats or the `MONEY` type. `DECIMAL(12,2)` only.
9. Applying GST to the stay total instead of per room per night.
10. IGST for out-of-state guests. Never, for accommodation.
11. Editing an issued invoice.
12. Retrofitting RBAC.
13. Storing full Aadhaar.
14. No idempotency on booking creation — a double-tap on a rural connection creates two bookings.
15. Assuming noon checkout.
16. Treating AC as a fixed room attribute.
17. Entering the usual selling price as the category base instead of the cheapest variant.
18. Kitchen screen with no audible alert.
19. A QR that identifies a room with no PIN guard.
20. Reusing a deactivated room number — old bills would attach to the new room.
21. Forgetting to enable read-committed snapshot isolation. The tape chart will block writers.
22. Inserting `room_nights` for a multi-room booking in inconsistent room order — the one deadlock path.
23. Relying on default case-insensitive collation for codes and signatures.
24. Using `MONEY` or `NEWID()` because they look like the obvious choice.

---

## Glossary

Client documents use the right-hand column. Never let the left-hand terms reach a lodge owner.

| Code | Client-facing |
|---|---|
| attribute group | room feature |
| switchable option | extra charge |
| rate matrix | price chart |
| rate override / pin | fixed price for this room |
| rate snapshot | the price saved on the booking |
| tape chart | room chart |
| occupant record | guest name in the party |
| billing side | which type of bill this stay uses, chosen at billing |
| void and reissue | cancel the bill and make a new one |
| tenant | the lodge's account |
| RBAC | staff access limits |
| idempotency, exclusion constraint, migration | *never appears* |

---

## Document index

| File | Audience |
|---|---|
| `README.md` | Developers — this file |
| `lodge-system-complete-details.md` | Client — full system behaviour |
| `VT-LMS-AD-001-Activity-Diagrams.pdf` | Both — 10 numbered process figures |
| `lodge-system-document.tex` | Client — LaTeX source of the details document |
| `client-documentation-pack-guide.md` | Internal — what to produce for clients |

Client documents are written in plain language with no technical terms. Keep them that way.

---

## Decision log

Append here when an architecture decision changes. Date, what changed, why.

| Date | Change | Reason |
|---|---|---|
| — | Initial spec consolidated | Amendments folded into one source of truth |
| — | TypeScript dropped in favour of plain JavaScript | Team preference. Zod becomes the sole runtime contract; see the stack notes. |
| — | PostgreSQL replaced with SQL Server | House stack. Double-booking guarantee moved from an exclusion constraint to a `room_nights` primary key. |
