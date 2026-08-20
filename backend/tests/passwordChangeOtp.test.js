const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

// Same preamble as the other suites: src/app.js pulls in the connection config
// at require time, so the environment has to be valid before it loads. None of
// these tests reach SQL Server.
process.env.DB_SERVER ||= 'localhost';
process.env.DB_PORT ||= '1433';
process.env.DB_NAME ||= 'lodge_test';
process.env.DB_USER ||= 'sa';
process.env.DB_PASSWORD ||= 'test';
process.env.JWT_SECRET ||= 'a'.repeat(40);
process.env.UPLOAD_ROOT ||= path.join(require('os').tmpdir(), 'lms-test-uploads');

const app = require('../src/app');
const { changePasswordSchema, sendPasswordOtpSchema } = require('../src/modules/me/me.schema');
const { generateOtp, MAX_ATTEMPTS, OTP_TTL_MS } = require('../src/modules/me/otp.service');
const { normalisePhone, isConfigured } = require('../src/config/whatsapp');
const { REDACT_PATHS } = require('../src/config/logger');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

test('generates a six-digit code, zero-padded', () => {
  for (let i = 0; i < 500; i++) {
    const otp = generateOtp();
    assert.match(otp, /^\d{6}$/, 'got ' + otp);
  }
});

test('code generation covers the low end of the range', () => {
  // padStart is the part that is easy to get wrong: without it a draw below
  // 100000 yields a short code the six-digit input silently cannot hold.
  // 2000 draws make a value under 100000 near-certain (p = 1 - 0.9^2000).
  const codes = Array.from({ length: 2000 }, generateOtp);
  assert.ok(
    codes.some((c) => c.startsWith('0')),
    'expected at least one zero-padded code'
  );
  assert.ok(new Set(codes).size > 1000, 'codes should not repeat heavily');
});

test('codes are drawn from crypto, not Math.random', () => {
  // The college backend this flow was modelled on uses Math.random() here. It
  // is a predictable PRNG and explicitly not for secrets — this code authorises
  // a password change, so the source has to be crypto.
  const src = read('src/modules/me/otp.service.js');
  assert.match(src, /crypto\.randomInt/);
  // Comments stripped first — the file explains why Math.random() is wrong, and
  // naming it in prose must not read as using it.
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Math\.random/.test(code), 'otp.service.js must not use Math.random');
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

test('the change request requires a six-digit code', () => {
  const base = { currentPassword: 'old-password', newPassword: 'new-password-1' };

  assert.strictEqual(changePasswordSchema.safeParse(base).success, false, 'missing otp must fail');
  assert.strictEqual(changePasswordSchema.safeParse({ ...base, otp: '12345' }).success, false, 'five digits');
  assert.strictEqual(changePasswordSchema.safeParse({ ...base, otp: '1234567' }).success, false, 'seven digits');
  assert.strictEqual(changePasswordSchema.safeParse({ ...base, otp: 'abcdef' }).success, false, 'letters');
  assert.strictEqual(changePasswordSchema.safeParse({ ...base, otp: '123456' }).success, true);
});

test('a pasted code keeps working when it arrives with whitespace', () => {
  // The code is copied out of a WhatsApp message, which brings spaces with it
  // more often than not.
  const parsed = changePasswordSchema.safeParse({
    currentPassword: 'old-password',
    newPassword: 'new-password-1',
    otp: '  123456 ',
  });
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.data.otp, '123456');
});

test('the send-code request asks only for the current password', () => {
  assert.strictEqual(sendPasswordOtpSchema.safeParse({ currentPassword: 'x' }).success, true);
  assert.strictEqual(sendPasswordOtpSchema.safeParse({}).success, false);
});

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

test('both password endpoints require a session', async () => {
  // The code is a second factor, not a replacement for the first: an
  // unauthenticated caller must not be able to make the server send a code to
  // someone else's phone, nor to spend one.
  await request(app).post('/me/password/otp').send({ currentPassword: 'x' }).expect(401);
  await request(app)
    .patch('/me/password')
    .send({ currentPassword: 'x', newPassword: 'new-password-1', otp: '123456' })
    .expect(401);
});

test('the password change consumes an OTP before writing the new hash', () => {
  // A regression guard with teeth: the whole point of this feature is that the
  // UPDATE cannot be reached without a code. If someone reorders this function
  // so the write happens first, or drops the call, this fails.
  const src = read('src/modules/me/me.service.js');
  const fn = src.slice(src.indexOf('async function changePassword('));
  const verifyAt = fn.indexOf('verifyAndConsumeOtp');
  const updateAt = fn.indexOf('UPDATE dbo.users SET password_hash');

  assert.ok(verifyAt > -1, 'changePassword must verify an OTP');
  assert.ok(updateAt > -1, 'changePassword must update the password hash');
  assert.ok(verifyAt < updateAt, 'the OTP must be verified before the password is written');
});

test('the current password is proved on both steps', () => {
  const src = read('src/modules/me/me.service.js');
  for (const name of ['sendPasswordChangeOtp', 'changePassword']) {
    const body = src.slice(src.indexOf('async function ' + name + '('));
    const end = body.indexOf('\n}\n');
    assert.match(body.slice(0, end), /assertCurrentPassword/, name + ' must re-check the current password');
  }
});

test('a wrong code is capped, and the cap burns the code', () => {
  // Six digits is a million guesses, and the guesser is already signed in. The
  // ceiling is what makes the code strong, so both halves are asserted: that a
  // limit exists, and that hitting it marks the row used rather than leaving it
  // alive for the next request to start counting again.
  const src = read('src/modules/me/otp.service.js');
  assert.ok(MAX_ATTEMPTS > 0 && MAX_ATTEMPTS <= 10, 'unexpected MAX_ATTEMPTS: ' + MAX_ATTEMPTS);
  const branch = src.slice(src.indexOf('if (attempts >= MAX_ATTEMPTS)'));
  assert.match(branch.slice(0, 400), /await burn\(\)/);
});

test('codes expire, and the window is short', () => {
  assert.ok(OTP_TTL_MS > 0 && OTP_TTL_MS <= 15 * 60 * 1000, 'unexpected TTL: ' + OTP_TTL_MS);
});

test('issuing a code retires any code still outstanding', () => {
  // Otherwise "resend" leaves two live codes and doubles the guessing surface.
  const src = read('src/modules/me/otp.service.js');
  const issue = src.slice(src.indexOf('async function issueOtp('));
  const retireAt = issue.indexOf('UPDATE dbo.otp_store SET used = 1');
  const insertAt = issue.indexOf('INSERT INTO dbo.otp_store');
  assert.ok(retireAt > -1 && insertAt > -1);
  assert.ok(retireAt < insertAt, 'outstanding codes must be retired before a new one is stored');
});

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

test('normalises the phone shapes people actually type', () => {
  assert.strictEqual(normalisePhone('9876543210'), '919876543210');
  assert.strictEqual(normalisePhone('09876543210'), '919876543210');
  assert.strictEqual(normalisePhone('919876543210'), '919876543210');
  assert.strictEqual(normalisePhone('+91 98765 43210'), '919876543210');
  assert.strictEqual(normalisePhone(''), null);
  assert.strictEqual(normalisePhone(null), null);
});

test('configuration is checked before a code is stored', () => {
  // A server with no provider says so, instead of leaving the user waiting for
  // a message that is never coming.
  assert.strictEqual(typeof isConfigured(), 'boolean');
  const src = read('src/modules/me/me.service.js');
  const fn = src.slice(src.indexOf('async function sendPasswordChangeOtp('));
  assert.ok(fn.indexOf('isConfigured') < fn.indexOf('issueOtp'), 'configuration must be checked first');
});

test('the code never reaches the log', () => {
  // It is stored hashed, so the log would be the one place a live code could
  // survive in clear next to the account it belongs to.
  assert.ok(REDACT_PATHS.includes('otp'), 'otp must be redacted');
  assert.ok(REDACT_PATHS.includes('req.body.otp'), 'req.body.otp must be redacted');

  const whatsappSrc = read('src/config/whatsapp.js');
  const logCalls = whatsappSrc.match(/logger\.\w+\([^)]*\)/g) || [];
  for (const call of logCalls) {
    assert.ok(!/\botp\b|otpCode/.test(call), 'log call may leak the code: ' + call);
  }
});

test('the provider reason is logged but not returned to the caller', () => {
  // It can name the destination number and the template, and the caller can do
  // nothing with it either way.
  const src = read('src/modules/me/me.service.js');
  const fn = src.slice(src.indexOf('async function sendPasswordChangeOtp('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /logger\.error\(\{ err/);
  assert.match(body, /Could not send the code right now/);
  assert.ok(!/ApiError\([^)]*err\)/.test(body), 'the provider error must not be handed to ApiError');
});
