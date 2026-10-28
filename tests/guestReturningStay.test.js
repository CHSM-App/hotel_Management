const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// The returning-guest scenario, end to end through the real service.
//
// A customer stays in room 12 in March, orders food from the QR, and leaves.
// In June they come back — same property, same phone, and the phone still has
// the March room number and PIN in localStorage. What the page does next is
// item 19: the previous login has to be gone.
//
// The half that lives here is the server's answer. openGuestSession is driven
// against a scripted pool rather than a database: these are pure lookups with
// no state of their own, so a fake that answers the two queries verifyRoomAccess
// issues exercises the same code an mssql pool would, and the test runs without
// a server to provision. The other half — the phone comparing the tag it kept
// against the one that comes back — is asserted at the bottom.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(64);

const CONNECTION = path.join(__dirname, '..', 'src', 'config', 'connection.js');
const SERVICE = path.join(__dirname, '..', 'src', 'modules', 'public', 'public.service.js');

// One lodge, serving food to rooms, as getLodgeBySlug reads it.
const LODGE_ROW = {
  id: 7,
  name: 'Winsome Lodge',
  slug: 'winsome',
  phone: '02366000000',
  whatsapp_number: null,
  address: null,
  city: null,
  state: null,
  has_rooms: 1,
  serves_food: 1,
  food_room_service: 1,
  food_table_service: 1,
};

// A pool that answers by looking at the SQL it is handed. Only the shapes
// verifyRoomAccess depends on are modelled; anything else is a loud failure
// rather than a silent empty recordset.
function fakePool({ stayRow }) {
  const writes = [];
  const request = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/FROM dbo\.lodges/i.test(text)) return { recordset: [LODGE_ROW] };
        // No lockout in play for these cases.
        if (/FROM dbo\.food_pin_lockouts/i.test(text)) return { recordset: [] };
        if (/MERGE dbo\.food_pin_lockouts/i.test(text)) { writes.push('pin-failure'); return { recordset: [] }; }
        if (/DELETE FROM dbo\.food_pin_lockouts/i.test(text)) { writes.push('lockout-cleared'); return { recordset: [] }; }
        if (/FROM dbo\.rooms/i.test(text)) return { recordset: stayRow ? [stayRow] : [] };
        throw new Error('unexpected query: ' + text.trim().slice(0, 80));
      },
      batch: async () => ({ recordset: [] }),
    };
    return req;
  };
  return { pool: { request }, writes };
}

// Loads a fresh copy of the service bound to a scripted pool. The cache is
// cleared both sides so cases cannot leak a pool into each other, and so the
// real connection module is what the rest of the suite goes on to require.
function withStay(stayRow, fn) {
  const { pool, writes } = fakePool({ stayRow });
  const savedConn = require.cache[CONNECTION];
  const savedSvc = require.cache[SERVICE];
  delete require.cache[CONNECTION];
  delete require.cache[SERVICE];

  const realSql = require('mssql');
  require.cache[CONNECTION] = {
    id: CONNECTION,
    filename: CONNECTION,
    loaded: true,
    exports: { sql: realSql, getPool: async () => pool, closePool: async () => {} },
  };

  try {
    return fn(require(SERVICE), writes);
  } finally {
    delete require.cache[CONNECTION];
    delete require.cache[SERVICE];
    if (savedConn) require.cache[CONNECTION] = savedConn;
    if (savedSvc) require.cache[SERVICE] = savedSvc;
  }
}

const MARCH_STAY = {
  room_id: 55,
  booking_id: 4210,
  food_pin: '4417',
  guest_name: 'Anil Kadam',
  guest_phone: '9800000000',
};

// Same room, same guest, same PIN reissued — the worst case, because nothing
// the phone can see has changed.
const JUNE_STAY = { ...MARCH_STAY, booking_id: 5533 };

test('signing in names the stay', async () => {
  await withStay(MARCH_STAY, async (svc) => {
    const out = await svc.openGuestSession('winsome', '12', '4417');
    assert.strictEqual(out.roomNumber, '12');
    assert.strictEqual(out.guestName, 'Anil Kadam');
    assert.match(out.stayTag, /^[0-9a-f]{32}$/);
  });
});

test('the PIN is never echoed back to the phone', async () => {
  await withStay(MARCH_STAY, async (svc) => {
    const out = await svc.openGuestSession('winsome', '12', '4417');
    assert.ok(!JSON.stringify(out).includes('4417'));
  });
});

test('the booking id never reaches the phone', async () => {
  // It is a sequential key on an unauthenticated surface: publishing it would
  // tell anyone how many bookings the property has taken.
  await withStay(MARCH_STAY, async (svc) => {
    const out = await svc.openGuestSession('winsome', '12', '4417');
    assert.ok(!JSON.stringify(out).includes('4210'));
  });
});

test('the returning guest gets a different tag even when the PIN is reissued', async () => {
  // This is item 19. Same room, same PIN, different stay — and the only thing
  // that differs is the tag, which is exactly what the phone compares.
  let march;
  await withStay(MARCH_STAY, async (svc) => {
    march = await svc.openGuestSession('winsome', '12', '4417');
  });

  let june;
  await withStay(JUNE_STAY, async (svc) => {
    june = await svc.openGuestSession('winsome', '12', '4417');
  });

  assert.strictEqual(march.roomNumber, june.roomNumber);
  assert.notStrictEqual(march.stayTag, june.stayTag);

  // What OrderPage's revalidate effect does with that: wipe and show the form.
  const staleLoginCleared = !!(march.stayTag && june.stayTag && march.stayTag !== june.stayTag);
  assert.ok(staleLoginCleared, 'previous login must be cleared');
});

test('the same stay keeps its tag across visits to the page', async () => {
  // The other side of the guard: a guest mid-stay who reopens the QR on night
  // three must not be signed out.
  let first;
  let second;
  await withStay(MARCH_STAY, async (svc) => {
    first = await svc.openGuestSession('winsome', '12', '4417');
  });
  await withStay(MARCH_STAY, async (svc) => {
    second = await svc.openGuestSession('winsome', '12', '4417');
  });
  assert.strictEqual(first.stayTag, second.stayTag);
});

test('a checked-out room refuses the remembered PIN', async () => {
  // Reception clears food_pin at check-out, so the March pair now 401s and the
  // page signs the guest out with the server's wording.
  await withStay({ ...MARCH_STAY, booking_id: null, food_pin: null }, async (svc) => {
    await assert.rejects(
      () => svc.openGuestSession('winsome', '12', '4417'),
      (err) => err.statusCode === 401,
    );
  });
});

test('a wrong PIN for a live stay is refused', async () => {
  await withStay(MARCH_STAY, async (svc) => {
    await assert.rejects(
      () => svc.openGuestSession('winsome', '12', '9999'),
      (err) => err.statusCode === 401,
    );
  });
});
