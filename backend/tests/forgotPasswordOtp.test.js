const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

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

require('../src/app');
const { sendForgotPasswordOtpSchema, forgotPasswordSchema } = require('../src/modules/auth/auth.schema');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

test('the send-code request asks only for an identifier', () => {
  assert.strictEqual(sendForgotPasswordOtpSchema.safeParse({ identifier: '9876543210' }).success, true);
  assert.strictEqual(sendForgotPasswordOtpSchema.safeParse({}).success, false);
});

test('the reset request requires a six-digit code', () => {
  const base = { identifier: '9876543210', newPassword: 'new-password-1' };

  assert.strictEqual(forgotPasswordSchema.safeParse(base).success, false, 'missing otp must fail');
  assert.strictEqual(forgotPasswordSchema.safeParse({ ...base, otp: '12345' }).success, false, 'five digits');
  assert.strictEqual(forgotPasswordSchema.safeParse({ ...base, otp: '1234567' }).success, false, 'seven digits');
  assert.strictEqual(forgotPasswordSchema.safeParse({ ...base, otp: 'abcdef' }).success, false, 'letters');
  assert.strictEqual(forgotPasswordSchema.safeParse({ ...base, otp: '123456' }).success, true);
});

test('a pasted code keeps working when it arrives with whitespace', () => {
  const parsed = forgotPasswordSchema.safeParse({
    identifier: '9876543210',
    newPassword: 'new-password-1',
    otp: '  123456 ',
  });
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.data.otp, '123456');
});

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

test('the reset writes the new password only after an OTP is consumed', () => {
  // A regression guard with teeth: the whole point of this feature is that the
  // UPDATE cannot be reached without a code. If someone reorders this function
  // so the write happens first, or drops the call, this fails.
  //
  // resetPasswordByIdentifier and resetAdminPasswordByIdentifier are thin
  // wrappers around this shared implementation, so that's where the logic
  // (and the regression guard) actually lives.
  const src = read('src/modules/auth/auth.service.js');
  const fn = src.slice(src.indexOf('async function resetPasswordByIdentifierFor('));
  const verifyAt = fn.indexOf('verifyAndConsumeOtp');
  const updateAt = fn.indexOf('UPDATE dbo.users SET password_hash');

  assert.ok(verifyAt > -1, 'resetPasswordByIdentifierFor must verify an OTP');
  assert.ok(updateAt > -1, 'resetPasswordByIdentifierFor must update the password hash');
  assert.ok(verifyAt < updateAt, 'the OTP must be verified before the password is written');
});

test('the forgot-password and password-change codes use different purposes', () => {
  // They share one table (dbo.otp_store) — a code issued for one flow must
  // never be redeemable against the other.
  const authSrc = read('src/modules/auth/auth.service.js');
  const meSrc = read('src/modules/me/me.service.js');
  assert.match(authSrc, /FORGOT_PASSWORD = 'forgot_password'/);
  assert.match(meSrc, /PASSWORD_CHANGE = 'password_change'/);
});

test('the OTP is bound to the looked-up account, not the typed identifier', () => {
  const src = read('src/modules/auth/auth.service.js');
  const sendFn = src.slice(
    src.indexOf('async function sendForgotPasswordOtpFor('),
    src.indexOf('async function resetPasswordByIdentifierFor(')
  );
  assert.match(sendFn, /issueOtp\(\{ userId: user\.id/);
});

test('configuration is checked before a code is stored', () => {
  // A server with no provider says so, instead of leaving the user waiting for
  // a message that is never coming.
  const src = read('src/modules/auth/auth.service.js');
  const fn = src.slice(src.indexOf('async function sendForgotPasswordOtpFor('));
  assert.ok(fn.indexOf('isConfigured') < fn.indexOf('issueOtp'), 'configuration must be checked first');
});

test('the provider reason is logged but not returned to the caller', () => {
  const src = read('src/modules/auth/auth.service.js');
  const fn = src.slice(src.indexOf('async function sendForgotPasswordOtpFor('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /logger\.error\(\{ err/);
  assert.match(body, /Could not send the code right now/);
  assert.ok(!/ApiError\([^)]*err\)/.test(body), 'the provider error must not be handed to ApiError');
});

test('a wrong or missing code counts against the same lockout as a wrong password', () => {
  const src = read('src/modules/auth/auth.service.js');
  const fn = src.slice(src.indexOf('async function resetPasswordByIdentifierFor('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const invalidAt = body.indexOf("if (!valid)");
  const recordAt = body.indexOf('recordFailure', invalidAt);
  assert.ok(invalidAt > -1 && recordAt > -1 && recordAt > invalidAt, 'an invalid code must record a lockout failure');
});
