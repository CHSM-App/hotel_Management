const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// dataCache is a frontend ES module with no React or DOM dependency — it is a
// Map and three functions. Rather than pull a bundler in just for this, the
// source is read, its `export` keywords stripped, and the result run in a plain
// VM context. That keeps the test honest about the real file: if somebody
// changes the matching rule in invalidateCache, this test sees it.
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

test('invalidateCache clears every key for a resource, including suffixed ones', () => {
  const { readCache, writeCache, invalidateCache } = loadDataCache();

  writeCache('/tables', [{ id: 1 }, { id: 2 }]);
  writeCache('/tables:active', [{ id: 1 }]);
  writeCache('/rooms', [{ id: 9 }]);

  invalidateCache('/tables');

  // The deleted table must not survive in either tables key: the QR codes tab
  // seeds itself from /tables:active, which is how a deleted table's QR card
  // stayed on screen.
  assert.equal(readCache('/tables'), null);
  assert.equal(readCache('/tables:active'), null);
  // An unrelated resource is untouched — invalidation is not a cache flush.
  assert.deepEqual(readCache('/rooms'), [{ id: 9 }]);
});

test('invalidateCache clears query-string keys for the resource', () => {
  const { readCache, writeCache, invalidateCache } = loadDataCache();

  writeCache('/bookings?fromDate=2026-01-01&toDate=2026-01-31', [{ id: 1 }]);
  writeCache('/bookings/drafts', [{ id: 2 }]);

  invalidateCache('/bookings');

  assert.equal(readCache('/bookings?fromDate=2026-01-01&toDate=2026-01-31'), null);
  // A sibling path is a different resource, not a suffix of this one — it must
  // survive, or invalidating one list would silently blank another panel.
  assert.deepEqual(readCache('/bookings/drafts'), [{ id: 2 }]);
});

test('a prefix does not clear a different resource that merely starts the same', () => {
  const { readCache, writeCache, invalidateCache } = loadDataCache();

  writeCache('/tables', [{ id: 1 }]);
  writeCache('/tablesettings', [{ id: 5 }]);

  invalidateCache('/tables');

  assert.equal(readCache('/tables'), null);
  assert.deepEqual(readCache('/tablesettings'), [{ id: 5 }]);
});
