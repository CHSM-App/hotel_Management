const test = require('node:test');
const assert = require('node:assert');
const pino = require('pino');
const { Writable } = require('stream');

const { REDACT_PATHS } = require('../src/config/logger');

// The regression these guard is specific and was live: errorHandler did
// `console.error(err)`, and for an mssql driver error that object carries the
// failing statement and its bound parameters — guest names, phone numbers, ID
// proof references — into an unrotated file.
//
// The real logger writes to stdout, so these build one with the same redaction
// config over a capture stream.
function captureLogger() {
  const lines = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  const logger = pino(
    { redact: { paths: REDACT_PATHS, censor: '[redacted]' }, base: null },
    stream
  );
  return { logger, lines };
}

test('redacts passwords wherever they appear', () => {
  const { logger, lines } = captureLogger();
  logger.info({ password: 'hunter2', req: { body: { password: 'hunter2' } } }, 'signin');
  const [line] = lines;
  assert.strictEqual(line.password, '[redacted]');
  assert.strictEqual(line.req.body.password, '[redacted]');
  assert.ok(!JSON.stringify(line).includes('hunter2'), 'password leaked into the log');
});

test('redacts password hashes', () => {
  const { logger, lines } = captureLogger();
  logger.info({ user: { password_hash: '$2a$10$abcdefg' } }, 'user');
  assert.ok(
    !JSON.stringify(lines[0]).includes('$2a$10$abcdefg'),
    'password hash leaked into the log'
  );
});

test('redacts the Authorization header', () => {
  const { logger, lines } = captureLogger();
  logger.info({ req: { headers: { authorization: 'Bearer secret.jwt.token' } } }, 'req');
  assert.strictEqual(lines[0].req.headers.authorization, '[redacted]');
});

test('redacts the guest food PIN', () => {
  const { logger, lines } = captureLogger();
  logger.info({ pin: '4821', req: { body: { pin: '4821' } } }, 'order');
  const dumped = JSON.stringify(lines[0]);
  assert.ok(!dumped.includes('4821'), 'food PIN leaked into the log');
});

test('redacts the driver internals that carry SQL and bound parameters', () => {
  // The exact shape of an mssql failure: originalError.info holds the statement
  // and the values bound to it.
  const { logger, lines } = captureLogger();
  logger.error(
    {
      err: {
        name: 'RequestError',
        message: 'Violation of UNIQUE KEY constraint',
        originalError: {
          info: {
            message: "INSERT INTO dbo.bookings (guest_name, guest_phone) VALUES ('Priya Sharma', '9876543210')",
          },
        },
      },
    },
    'db failure'
  );

  const dumped = JSON.stringify(lines[0]);
  assert.ok(!dumped.includes('Priya Sharma'), 'guest name leaked from driver internals');
  assert.ok(!dumped.includes('9876543210'), 'guest phone leaked from driver internals');
  // The useful part survives: an operator still learns what failed.
  assert.match(dumped, /Violation of UNIQUE KEY constraint/);
});

test('keeps the diagnostic fields that make an error useful', () => {
  const { logger, lines } = captureLogger();
  logger.error({ err: { name: 'RequestError', message: 'Timeout expired', code: 'ETIMEOUT' } }, 'db');
  const dumped = JSON.stringify(lines[0]);
  assert.match(dumped, /Timeout expired/);
  assert.match(dumped, /ETIMEOUT/);
});
