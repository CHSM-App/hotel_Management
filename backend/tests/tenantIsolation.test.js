const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Multi-tenant isolation is the property with the worst failure mode in this
// system: one property reading or editing another's bookings, guests and
// invoices. It holds today because lodgeId is taken from the verified JWT and
// never from anything the caller sends.
//
// That is a convention, not something the type system enforces, so it is one
// plausible refactor away from breaking — `const { lodgeId } = req.body` reads
// perfectly naturally and would be catastrophic. These tests are static checks
// over the source: no database required, and they fail the build the moment the
// convention is broken.

const MODULES_DIR = path.join(__dirname, '..', 'src', 'modules');

function sourceFiles(dir, suffix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

// Strips comments so a line discussing lodgeId in prose is not read as code.
function code(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('no controller takes lodgeId from the request body, query or params', () => {
  const offenders = [];
  for (const file of sourceFiles(MODULES_DIR, '.js')) {
    // Matched per line, not across the file: a destructure spanning several
    // lines would otherwise let a greedy pattern swallow unrelated code and
    // report a false positive.
    const patterns = [
      // req.body.lodgeId / req.query.lodge_id
      /req\.(body|query|params)\.(lodgeId|lodge_id)\b/,
      // const { lodgeId } = req.body  — single-line destructure
      /\{[^}\n]*\b(lodgeId|lodge_id)\b[^}\n]*\}\s*=\s*req\.(body|query|params)\b/,
    ];

    code(file)
      .split('\n')
      .forEach((line, index) => {
        for (const pattern of patterns) {
          const match = line.match(pattern);
          if (match) {
            offenders.push(
              `${path.relative(MODULES_DIR, file)}:${index + 1}: ${match[0].trim()}`
            );
          }
        }
      });
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `lodgeId must come from the verified JWT (req.user.lodgeId), never from caller input:\n  ${offenders.join('\n  ')}`
  );
});

test('every non-public route file requires authentication', () => {
  // public.routes.js is the deliberate exception — the guest ordering surface —
  // and auth.routes.js is where sessions are created.
  const EXEMPT = new Set(['public/public.routes.js', 'auth/auth.routes.js']);

  const offenders = [];
  for (const file of sourceFiles(MODULES_DIR, '.routes.js')) {
    const rel = path.relative(MODULES_DIR, file).split(path.sep).join('/');
    if (EXEMPT.has(rel)) continue;

    const src = code(file);
    const routeLines = src
      .split('\n')
      .filter((line) => /router\.(get|post|put|patch|delete)\s*\(/.test(line));

    // Multi-line route registrations put the middleware on following lines, so
    // a file-level check is what is meaningful here.
    if (routeLines.length > 0 && !/\bauthenticate\b/.test(src)) {
      offenders.push(rel);
    }
  }

  assert.deepStrictEqual(offenders, [], `route files with no authenticate middleware: ${offenders.join(', ')}`);
});

test('the public route file stays deliberately unauthenticated', () => {
  // Inverse guard: if someone adds `authenticate` here it means a guest-facing
  // route has quietly become staff-only, which breaks food ordering.
  const src = code(path.join(MODULES_DIR, 'public', 'public.routes.js'));
  assert.ok(
    !/\bauthenticate\b/.test(src),
    'public.routes.js should not use authenticate — these are the guest-facing routes'
  );
});

// Which tables carry a lodge_id, read out of schema.sql rather than listed
// here. A new tenant-scoped table is covered by the query test below from the
// moment it is created, without anyone having to remember to register it.
function lodgeScopedTables() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'schema.sql'), 'utf8');
  const tables = new Set();
  // The closing paren is indented when the CREATE sits inside an IF block, so
  // the terminator has to allow leading whitespace — matching on a bare "\n)"
  // runs past the end of such a table and into the next one, which silently
  // mislabels both.
  const create = /CREATE TABLE\s+dbo\.(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  let match;
  while ((match = create.exec(schema))) {
    if (/\blodge_id\b/i.test(match[2])) tables.add(match[1]);
  }
  const added = /ALTER TABLE\s+dbo\.(\w+)\s+ADD\s+lodge_id/gi;
  while ((match = added.exec(schema))) tables.add(match[1]);
  return tables;
}

test('every service either filters by lodge or is excused by name', () => {
  // Deny by default, which is the entire point of this test.
  //
  // The version this replaces listed the seven services it checked. Its comment
  // claimed that naming them "forces a decision" when a service is added —
  // nothing forced anything: a new service simply wasn't in the list and was
  // covered by no assertion at all. Nine services that do scope correctly
  // (categories, drafts, pricing, public, reports, roles, seasons,
  // switchableCharges, tables) were unguarded, so any of them could have lost
  // its filter without a test noticing.
  //
  // Inverting it means forgetting produces a failing build rather than silent
  // absence of cover, and excusing a service costs a written reason.
  const EXEMPT = new Map([
    [
      'auth/auth.service.js',
      'Signs people in by email or phone across every lodge. The lodge is a result of authenticating, not an input to it.',
    ],
    [
      'lodges/lodges.service.js',
      'SUPERADMIN-only management of the lodge records themselves — it operates above the tenant boundary rather than inside one.',
    ],
    [
      'me/me.service.js',
      "Scoped by the caller's own user id from the JWT; the lodge follows from that row, so a lodge filter would be redundant.",
    ],
  ]);

  const present = new Set();
  const offenders = [];
  for (const file of sourceFiles(MODULES_DIR, '.service.js')) {
    const rel = path.relative(MODULES_DIR, file).split(path.sep).join('/');
    present.add(rel);
    if (EXEMPT.has(rel)) continue;
    const src = code(file);
    // "lodge_id = @lodgeId" is the usual form. "id = @lodgeId" is the same
    // guarantee for a query against dbo.lodges itself, where the tenant key is
    // the primary key — checkoutPolicy.service.js reads and writes it that way.
    if (!/\blodge_id\s*=\s*@lodgeId\b/.test(src) && !/\bid\s*=\s*@lodgeId\b/.test(src)) {
      offenders.push(rel);
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'These services never filter by lodge. Either add the filter, or add the file to EXEMPT ' +
      `with a reason it does not need one:\n  ${offenders.join('\n  ')}`
  );

  // A renamed or deleted service must not leave an entry behind quietly
  // excusing nothing — the next file to take that path would inherit the pass.
  const stale = [...EXEMPT.keys()].filter((rel) => !present.has(rel));
  assert.deepStrictEqual(stale, [], `EXEMPT names services that no longer exist: ${stale.join(', ')}`);
});

// Every SQL string handed to .query()/.batch(), in all three quote styles.
// Restricting this to template literals — the obvious first guess, since the
// long queries use them — would skip the 110 single-quoted one-liners in
// src/modules, and a short query is exactly where a forgotten lodge filter
// hides. Single- and double-quoted JS strings cannot span a raw newline, hence
// the narrower bodies.
const QUERY_LITERAL = /\.(?:query|batch)\(\s*(`[\s\S]*?`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")\s*\)/g;

function queriesIn(src) {
  const out = [];
  const re = new RegExp(QUERY_LITERAL.source, 'g');
  let match;
  while ((match = re.exec(src))) out.push({ sql: match[1].slice(1, -1), index: match.index });
  return out;
}

// The top-level function a given offset sits in. Ownership is established per
// function, so "was this row proven to belong to the caller" has to be asked of
// the function doing the write, not of the file around it.
function enclosingFunction(src, index) {
  const decl = /^(?:async\s+)?function\s+\w+\s*\(/gm;
  let from = 0;
  let match;
  while ((match = decl.exec(src))) {
    if (match.index <= index) from = match.index;
    else return src.slice(from, match.index);
  }
  return src.slice(from);
}

test('every query touching a lodge-scoped table filters by lodge', () => {
  // The per-query half. Checking that a file mentions lodge_id *somewhere* —
  // which is all the previous version of this test did — passes a file with
  // fifty scoped queries and one that forgot, and the one that forgot is the
  // entire problem.
  const scopedTables = lodgeScopedTables();
  assert.ok(
    scopedTables.size > 15,
    `expected to find the lodge-scoped tables in schema.sql, found ${scopedTables.size}`
  );

  // A query keyed on a parent row's id inherits that parent's scoping: the
  // parent was fetched with a lodge filter, so its id cannot have come from
  // another property. Child tables (booking_guests, food_order_items) are
  // reached this way throughout and are deliberately not scoped themselves.
  const PARENT_KEYS = [
    'booking_id', 'order_id', 'invoice_id', 'item_id', 'material_id', 'role_id',
    'category_id', 'room_id', 'user_id', 'charge_id', 'season_id', 'portion_id',
    'draft_id', 'table_id', 'menu_item_id',
  ];

  // Queries that legitimately reach across every lodge, each with its reason.
  // `match` is a fragment identifying the query; every entry is asserted to
  // still match something below, so a stale excuse fails rather than rots.
  const ACKNOWLEDGED = [
    {
      file: 'orders/orders.service.js',
      match: '${filters.join',
      why: 'The WHERE clause is assembled in JS and always starts with "o.lodge_id = @lodgeId" — scoped, but behind an interpolation this scan cannot read through.',
    },
    {
      file: 'public/public.service.js',
      match: 'public_token = @token',
      why: 'Guest order tracking, reached by an unguessable random token rather than a session. There is no lodge context to filter by — the token is the capability.',
    },
    {
      file: 'staff/staff.service.js',
      match: '@email IS NOT NULL AND email = @email',
      why: 'Deliberately global, on both the create and the edit path: phone and email are unique across the whole platform (uq_users_email), so these uniqueness checks must see every lodge or the INSERT fails on the index instead of with a readable message.',
    },
    {
      file: 'roles/roles.service.js',
      match: 'UPDATE dbo.roles SET',
      why: 'Fetch-then-act, but keyed on role_key rather than id: the id written here comes from a SELECT two statements earlier filtered on lodge_id = @lodgeId AND role_key, so the row is already proven to belong to the caller.',
    },
    {
      file: 'lodges/lodges.service.js',
      match: 'SELECT id FROM dbo.users WHERE phone = @phone',
      why: 'Same global uniqueness rule, checked before SUPERADMIN creates a property owner. Scoping it to one lodge would let a duplicate through to the unique index.',
    },
  ];

  const used = new Set();
  const offenders = [];

  for (const file of sourceFiles(MODULES_DIR, '.js')) {
    const rel = path.relative(MODULES_DIR, file).split(path.sep).join('/');
    const src = code(file);

    for (const { sql: query, index } of queriesIn(src)) {
      const touches = [];
      const tables = /\b(?:FROM|JOIN|UPDATE|INSERT INTO|DELETE FROM)\s+dbo\.(\w+)/gi;
      let table;
      while ((table = tables.exec(query))) {
        if (scopedTables.has(table[1])) touches.push(table[1]);
      }
      if (touches.length === 0) continue;

      // Scoped outright.
      if (/\blodge_id\b/i.test(query)) continue;

      // Scoped to the caller's own row, which is a stronger guarantee than a
      // lodge filter rather than a weaker one — /me reads and writes the
      // signed-in user by the id carried in the verified JWT.
      if (/\bid\s*=\s*@userId\b/i.test(query)) continue;

      // Reached through a parent whose own query was lodge-filtered.
      if (PARENT_KEYS.some((key) => new RegExp(`\\b${key}\\s*(?:=\\s*@|IN\\s*\\()`, 'i').test(query))) continue;

      // Fetch-then-act: this function already proved the row belongs to the
      // caller before writing to it by bare id. That is how every delete and
      // rename here is written — categories, menu, rooms, tables, charges — and
      // it is a real guarantee, not an absence of one.
      //
      // What counts as proof is deliberately narrow. It must be a query against
      // the *same table* that both pins a single row (id = @something) and
      // carries the lodge filter. Accepting any lodge-filtered mention of the
      // table is not enough: listAvailableRoomsForBooking reads dbo.bookings
      // inside a NOT EXISTS as "b.id <> @bookingId", with the lodge filter
      // sitting on the rooms alias beside it — that query proves nothing about
      // the booking row, and a looser rule lets an unscoped read of another
      // property's stay next to it pass unnoticed.
      const block = enclosingFunction(src, index);
      const proofs = queriesIn(block).map((q) => q.sql);
      const proven = touches.some((t) =>
        proofs.some(
          (q) =>
            new RegExp(`\\bdbo\\.${t}\\b`, 'i').test(q) &&
            /\blodge_id\s*=\s*@lodgeId\b/i.test(q) &&
            /\bid\s*=\s*@\w+/i.test(q)
        )
      );
      if (proven) continue;

      const excuse = ACKNOWLEDGED.find((a) => a.file === rel && query.includes(a.match));
      if (excuse) {
        used.add(excuse.match);
        continue;
      }

      offenders.push(
        `${rel} [${[...new Set(touches)].join(', ')}]: ${query.replace(/\s+/g, ' ').trim().slice(0, 120)}`
      );
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'These queries read or write a lodge-scoped table without a lodge filter, a parent-id key, ' +
      `an ownership check in the same function, or an entry in ACKNOWLEDGED:\n  ${offenders.join('\n  ')}`
  );

  const stale = ACKNOWLEDGED.filter((a) => !used.has(a.match)).map((a) => `${a.file} (${a.match})`);
  assert.deepStrictEqual(
    stale,
    [],
    `ACKNOWLEDGED excuses queries that no longer exist or are now scoped — delete them:\n  ${stale.join('\n  ')}`
  );
});
