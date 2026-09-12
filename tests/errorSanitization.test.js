const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const createHttpError = require('http-errors');
const { ApiError, errorHandler } = require('../src/middleware/errorHandler');

// A leaked error message is a free map of the server. This one was real: a
// missing ID proof made res.sendFile raise an http-errors 404 whose message is
// the raw ENOENT — absolute path and all — and because the status was 404
// rather than 500, the old handler repeated it verbatim into the browser.
//
// The rule these pin down: only messages this codebase wrote are ever sent on.
// Status is preserved; wording is not inherited from anything we did not write.

function appThrowing(err) {
  const app = express();
  app.get('/boom', (req, res, next) => next(err));
  app.use(errorHandler);
  return app;
}

test('an ApiError message is passed through — it was written to be read', async () => {
  const res = await request(appThrowing(new ApiError('Room 204 is already booked.', 409))).get('/boom');
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'Room 204 is already booked.');
});

test('a sendFile ENOENT never reaches the client, path and all', async () => {
  // Exactly what `send` produces: a 404 carrying the fs error's message.
  const enoent = new Error(
    "ENOENT: no such file or directory, stat 'D:\\VengurlaTech\\hotel_Management\\backend\\uploads\\id-proofs\\ee01a425.png'"
  );
  enoent.code = 'ENOENT';
  const res = await request(appThrowing(createHttpError(404, enoent))).get('/boom');

  assert.strictEqual(res.status, 404, 'a real 404 should stay a 404');
  assert.ok(!/ENOENT/.test(res.body.error), `leaked the error code: ${res.body.error}`);
  assert.ok(!/uploads|id-proofs/i.test(res.body.error), `leaked the upload path: ${res.body.error}`);
  assert.ok(!/VengurlaTech|[A-Z]:\\/.test(res.body.error), `leaked a server path: ${res.body.error}`);
  assert.strictEqual(res.body.error, 'Not found.');
});

test('a driver error keeps its status but not its words', async () => {
  // mssql's shape: a message naming columns and statements, with a code.
  const dbErr = new Error("Invalid column name 'id_proof_number'.");
  dbErr.code = 'EREQUEST';
  dbErr.statusCode = 400;
  const res = await request(appThrowing(dbErr)).get('/boom');

  assert.strictEqual(res.status, 400);
  assert.ok(!/id_proof_number|column/i.test(res.body.error), `leaked schema: ${res.body.error}`);
});

test('an unlabelled error is still a 500 saying nothing', async () => {
  const res = await request(appThrowing(new Error('connect ECONNREFUSED 10.0.0.4:1433'))).get('/boom');
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, 'Something went wrong.');
  assert.ok(!/ECONNREFUSED|1433/.test(res.body.error));
});

test('field only rides along on an ApiError', async () => {
  const withField = new ApiError('Enter the guest name.', 400, 'guestName');
  const ok = await request(appThrowing(withField)).get('/boom');
  assert.strictEqual(ok.body.field, 'guestName');

  // An untrusted error must not be able to name a form field either — that is
  // attacker-influenced text rendered next to an input.
  const spoof = new Error('nope');
  spoof.statusCode = 400;
  spoof.field = 'password';
  const bad = await request(appThrowing(spoof)).get('/boom');
  assert.strictEqual(bad.body.field, undefined);
});

// ---------------------------------------------------------------------------
// The same rule, enforced across the whole surface rather than one handler.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // src/public is the built SPA — minified vendor code, not ours to police.
    if (entry.name === 'public') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no response body is built out of an error message', () => {
  // errorHandler is the one place allowed to read err.message onto a response,
  // and it only does so for an ApiError. Anywhere else, a res.json() carrying
  // err.message hands the caller whatever a library chose to say — a driver
  // naming columns and hosts, or an fs error printing an absolute path.
  //
  // This existed: /health answered an unauthenticated caller with the raw
  // connection failure, which names the database host, its port and often the
  // login it tried.
  const ALLOWED = ['middleware/errorHandler.js'];

  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    if (ALLOWED.includes(rel)) continue;

    const src = fs.readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (!/\bres\s*\.\s*(json|send|status)\b/.test(line)) return;
      if (/\b(err|error|e)\s*\.\s*(message|stack|sql|originalError|precedingErrors)\b/.test(line)) {
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'These build a response out of an error the app did not write. Throw an ApiError ' +
      `with a message meant for a person, and log the original instead:\n  ${offenders.join('\n  ')}`
  );
});

test('the error handler is the last thing mounted, so nothing routes around it', () => {
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  const handlerAt = app.indexOf('app.use(errorHandler)');
  assert.ok(handlerAt > 0, 'errorHandler is no longer mounted');
  assert.ok(
    app.indexOf('app.use(', handlerAt + 1) === -1,
    'something is mounted after errorHandler — errors raised there would fall to ' +
      "Express's default handler, which renders the stack trace in development"
  );
});
