const test = require('node:test');
const assert = require('node:assert');

process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);

const { normalizeScan, scanIds } = require('../src/modules/bookings/idScan.service');

const good = { name: ' Asha Patil ', idProofType: 'AADHAAR', idProofNumber: '1234 5678 9012', imageIndexes: [0, 1], confidence: 0.95 };

test('a clean read is trimmed and the Aadhaar number normalised', () => {
  const [g] = normalizeScan({ guests: [good] }, 2);
  assert.strictEqual(g.name, 'Asha Patil');
  assert.strictEqual(g.idProofNumber, '123456789012');
  assert.deepStrictEqual(g.imageIndexes, [0, 1]);
  assert.strictEqual(g.needsReview, false);
});

test('a masked or short Aadhaar number is dropped and flagged', () => {
  const [g] = normalizeScan({ guests: [{ ...good, idProofNumber: 'XXXX XXXX 9012' }] }, 2);
  assert.strictEqual(g.idProofNumber, '');
  assert.strictEqual(g.needsReview, true);
});

test('low confidence leaves the fields blank instead of guessing', () => {
  const [g] = normalizeScan({ guests: [{ ...good, confidence: 0.3 }] }, 2);
  assert.strictEqual(g.name, '');
  assert.strictEqual(g.idProofNumber, '');
  assert.strictEqual(g.idProofType, null);
  assert.strictEqual(g.needsReview, true);
});

test('unknown types, wild indexes and junk output never throw', () => {
  const [g] = normalizeScan({ guests: [{ ...good, idProofType: 'LIBRARY_CARD', imageIndexes: [0, 7, -1, 'x'] }] }, 2);
  assert.strictEqual(g.idProofType, null);
  assert.deepStrictEqual(g.imageIndexes, [0]);
  assert.deepStrictEqual(normalizeScan(undefined, 2), []);
  assert.deepStrictEqual(normalizeScan({ guests: 'nope' }, 2), []);
});

test('no more guests than photos', () => {
  assert.strictEqual(normalizeScan({ guests: [good, good, good] }, 2).length, 2);
});

test('answers 503 without an API key', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(scanIds({ lodgeId: 1, userId: 1, files: [{}] }), (e) => e.statusCode === 503 || e.status === 503);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});
