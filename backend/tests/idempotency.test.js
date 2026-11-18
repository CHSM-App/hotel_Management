const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { idempotent, _seen } = require('../src/middleware/idempotency');

// A just-enough Express: the middleware only reads a header and the user, and
// wraps res.json / listens for finish and close.
function call(key, { lodgeId = 1, answer = { status: 201, body: { id: 7 } } } = {}) {
  const req = { get: (h) => (h === 'Idempotency-Key' ? key : undefined), user: { lodgeId } };
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.sent = null;
  res.set = (k, v) => ((res.headers[k] = v), res);
  res.status = (n) => ((res.statusCode = n), res);
  res.json = (body) => ((res.sent = body), res.emit('finish'), res);
  let reachedHandler = false;
  idempotent(req, res, () => {
    reachedHandler = true;
    // The real handler: sets a status and answers.
    res.statusCode = answer.status;
    res.json(answer.body);
  });
  return { res, reachedHandler };
}

test.beforeEach(() => _seen.clear());

test('a repeat of a finished request gets the same answer and does not run again', () => {
  const first = call('11111111-aaaa', {});
  assert.equal(first.reachedHandler, true);

  const again = call('11111111-aaaa', {});
  assert.equal(again.reachedHandler, false, 'the booking must not be created twice');
  assert.deepEqual(again.res.sent, { id: 7 });
  assert.equal(again.res.statusCode, 201);
  assert.equal(again.res.headers['Idempotent-Replay'], 'true');
});

test('a request the server refused is not remembered: asking again is a new question', () => {
  call('22222222-bbbb', { answer: { status: 409, body: { error: 'taken' } } });
  const again = call('22222222-bbbb', {});
  assert.equal(again.reachedHandler, true);
});

test('a repeat while the first is still running is told to wait', () => {
  const req = { get: () => '33333333-cccc', user: { lodgeId: 1 } };
  const mk = () => {
    const res = new EventEmitter();
    res.status = (n) => ((res.code = n), res);
    res.json = (b) => ((res.sent = b), res);
    res.set = () => res;
    return res;
  };
  idempotent(req, mk(), () => {}); // handler never answers: still in flight
  const second = mk();
  let ran = false;
  idempotent(req, second, () => (ran = true));
  assert.equal(ran, false);
  assert.equal(second.code, 409);
  assert.equal(second.sent.code, 'IN_PROGRESS');
});

test('a dropped connection clears the in-flight mark', () => {
  const req = { get: () => '44444444-dddd', user: { lodgeId: 1 } };
  const res = new EventEmitter();
  res.json = () => res;
  idempotent(req, res, () => {});
  res.emit('close');
  const again = call('44444444-dddd', {});
  assert.equal(again.reachedHandler, true);
});

test('keys are per lodge, and a missing or malformed key changes nothing', () => {
  call('55555555-eeee', { lodgeId: 1 });
  assert.equal(call('55555555-eeee', { lodgeId: 2 }).reachedHandler, true);
  assert.equal(call(undefined, {}).reachedHandler, true);
  assert.equal(call('bad key!', {}).reachedHandler, true);
  assert.equal(call('short', {}).reachedHandler, true);
});

test('the four replay-prone routes are guarded', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../src/modules', p), 'utf8');
  const bookings = read('bookings/bookings.routes.js');
  assert.match(bookings, /router\.post\('\/', authenticate, staff, idempotent, idProofUpload/);
  assert.match(bookings, /router\.patch\('\/:id\/check-in', authenticate, staff, idempotent/);
  const billing = read('billing/billing.routes.js');
  assert.match(billing, /settle-checkout', authenticate, staff, idempotent/);
  assert.match(billing, /advance-receipt', authenticate, staff, idempotent/);
});
