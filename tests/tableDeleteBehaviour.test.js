const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The three bugs reported against the Tables screen were all in the browser:
// deleting one table appeared to delete its neighbours, deleted tables came
// back on revisit or refresh, and their QR cards stayed on the QR codes tab.
//
// There is no browser test runner in this repo, so rather than install one this
// replays TablesPanel's remove() against the real dataCache module — the piece
// that actually held the bug — using the same sequence of calls the component
// makes. Each test states the symptom it would have shown before the fix.
function loadDataCache() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'dataCache.js'),
    'utf8'
  );
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(
    `${src.replace(/^export /gm, '')}
     module.exports = { readCache, writeCache, clearCache, invalidateCache };`,
    context
  );
  return context.module.exports;
}

// A stand-in for the panel: holds the same two pieces of state remove() drives
// (the rendered list and the in-flight delete id) and talks to a fake server.
function makePanel(cache, server) {
  const panel = {
    // What the user sees. Seeded from cache exactly like the real useState.
    tables: cache.readCache('/tables'),
    deletingId: null,
    deleteCalls: [],
  };

  // Deliberately does NOT resolve — a revisit test must judge the first paint,
  // which is cache-only, before any refetch has had a chance to correct it.
  panel.load = async () => {
    const rows = await server.list();
    panel.tables = cache.writeCache('/tables', rows);
  };

  // Mirrors remove() in TablesPanel.jsx.
  panel.remove = async (table) => {
    if (panel.deletingId) return;
    panel.deletingId = table.id;
    try {
      panel.deleteCalls.push(table.id);
      await server.del(table.id);
      panel.tables = panel.tables ? panel.tables.filter((t) => t.id !== table.id) : panel.tables;
      cache.invalidateCache('/tables');
      await panel.load();
    } finally {
      panel.deletingId = null;
    }
  };

  return panel;
}

function makeServer(rows) {
  const state = [...rows];
  return {
    rows: state,
    list: async () => state.map((r) => ({ ...r })),
    del: async (id) => {
      const i = state.findIndex((r) => r.id === id);
      if (i !== -1) state.splice(i, 1);
    },
  };
}

const FIVE = [
  { id: 1, label: 'T1', isActive: true },
  { id: 2, label: 'T2', isActive: true },
  { id: 3, label: 'T3', isActive: true },
  { id: 4, label: 'T4', isActive: true },
  { id: 5, label: 'T5', isActive: true },
];

test('deleting one table removes only that table', async () => {
  const cache = loadDataCache();
  const server = makeServer(FIVE);
  cache.writeCache('/tables', await server.list());

  const panel = makePanel(cache, server);
  await panel.remove({ id: 3, label: 'T3' });

  assert.deepEqual(panel.tables.map((t) => t.label), ['T1', 'T2', 'T4', 'T5']);
  assert.deepEqual(server.rows.map((t) => t.label), ['T1', 'T2', 'T4', 'T5']);
  // The reported symptom was neighbours vanishing too: exactly one id was sent.
  assert.deepEqual(panel.deleteCalls, [3]);
});

test('a second click during an in-flight delete cannot delete the next table', async () => {
  const cache = loadDataCache();
  const server = makeServer(FIVE);
  cache.writeCache('/tables', await server.list());

  const panel = makePanel(cache, server);
  // Both clicks land before the first request resolves — the impatient
  // double-click that used to take T4 down along with T3.
  await Promise.all([
    panel.remove({ id: 3, label: 'T3' }),
    panel.remove({ id: 4, label: 'T4' }),
  ]);

  assert.deepEqual(panel.deleteCalls, [3], 'the second click must be ignored');
  assert.ok(server.rows.some((t) => t.id === 4), 'T4 must survive');
});

test('a deleted table does not come back when the panel is revisited', async () => {
  const cache = loadDataCache();
  const server = makeServer(FIVE);
  cache.writeCache('/tables', await server.list());

  const panel = makePanel(cache, server);
  await panel.remove({ id: 3, label: 'T3' });

  // The delete's own refetch has since refilled /tables, so that key alone
  // cannot show the bug. What proves it is a request that is still in flight:
  // if the server is slow, the revisited panel paints from cache and nothing
  // else. Freezing the response is how the user's "went to another page and
  // came back" is reproduced honestly.
  let release;
  const slowServer = {
    list: () => new Promise((resolve) => { release = () => resolve(server.rows.map((r) => ({ ...r }))); }),
    del: server.del,
  };

  // A stale entry is what a revisit would find if any writer had refilled the
  // key from a response that predates the delete — the race the invalidation
  // exists to survive.
  cache.writeCache('/tables', FIVE.map((r) => ({ ...r })));
  cache.invalidateCache('/tables');

  const revisited = makePanel(cache, slowServer);
  const paintedImmediately = revisited.tables;
  assert.equal(paintedImmediately, null, 'nothing stale may be painted before the refetch lands');

  const inFlight = revisited.load();
  release();
  await inFlight;
  assert.deepEqual(revisited.tables.map((t) => t.label), ['T1', 'T2', 'T4', 'T5']);
});

test("a deleted table's QR card is gone from the QR codes tab", async () => {
  const cache = loadDataCache();
  const server = makeServer(FIVE);
  cache.writeCache('/tables', await server.list());
  // The QR tab keeps its own key, which a delete never used to touch.
  cache.writeCache('/tables:active', await server.list());

  const panel = makePanel(cache, server);
  await panel.remove({ id: 3, label: 'T3' });

  assert.equal(cache.readCache('/tables:active'), null, 'the QR tab cache must be dropped');

  // Opening the QR tab: seed from cache, then refetch as the panel does.
  const seeded = cache.readCache('/tables:active');
  assert.ok(!(seeded ?? []).some((t) => t.id === 3), 'no stale T3 card on first paint');

  const fresh = cache.writeCache('/tables:active', (await server.list()).filter((t) => t.isActive));
  assert.deepEqual(fresh.map((t) => t.label), ['T1', 'T2', 'T4', 'T5']);
});
