const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

const { createRateLimiter } = require('../src/middleware/rateLimit');
const { errorHandler } = require('../src/middleware/errorHandler');

// The login limiters are the only thing standing between /auth/admin-login and
// unlimited password guessing — there is no account lockout behind them. These
// tests pin the three properties that make them work, each of which is easy to
// break with a well-meaning refactor.
//
// A fresh limiter per test: the real ones hold state in a module-level Map, so
// sharing them across tests would make the order matter.
function appWith(limiter, handler) {
  const app = express();
  app.use(express.json());
  app.post('/login', limiter, handler);
  app.use(errorHandler);
  return app;
}

const rejects = (req, res) => res.status(401).json({ error: 'bad credentials' });
const accepts = (req, res) => res.json({ token: 'ok' });

test('blocks once the failure budget is spent', async () => {
  const app = appWith(
    createRateLimiter({
      windowMs: 60000,
      max: 3,
      message: 'Too many failed sign-in attempts.',
      countWhen: (res) => res.statusCode === 401,
    }),
    rejects
  );

  for (let i = 0; i < 3; i++) {
    await request(app).post('/login').send({}).expect(401);
  }
  const blocked = await request(app).post('/login').send({}).expect(429);
  assert.match(blocked.body.error, /Too many failed sign-in attempts/);
});

test('successful sign-ins never consume budget', async () => {
  // Load-bearing rather than a nicety: staff sign in from one desk on a shared
  // connection, and charging success would let a shift change lock the property
  // out of its own system.
  const app = appWith(
    createRateLimiter({
      windowMs: 60000,
      max: 3,
      message: 'Too many failed sign-in attempts.',
      countWhen: (res) => res.statusCode === 401,
    }),
    accepts
  );

  for (let i = 0; i < 25; i++) {
    await request(app).post('/login').send({}).expect(200);
  }
});

test('sends Retry-After so a client knows how long to wait', async () => {
  const app = appWith(
    createRateLimiter({
      windowMs: 60000,
      max: 1,
      message: 'Too many failed sign-in attempts.',
      countWhen: (res) => res.statusCode === 401,
    }),
    rejects
  );

  await request(app).post('/login').send({}).expect(401);
  const blocked = await request(app).post('/login').send({}).expect(429);
  const retryAfter = Number(blocked.headers['retry-after']);
  assert.ok(retryAfter > 0 && retryAfter <= 60, `unexpected Retry-After: ${retryAfter}`);
});

test('the budget frees up again once the window passes', async () => {
  const app = appWith(
    createRateLimiter({
      windowMs: 120,
      max: 1,
      message: 'Too many failed sign-in attempts.',
      countWhen: (res) => res.statusCode === 401,
    }),
    rejects
  );

  await request(app).post('/login').send({}).expect(401);
  await request(app).post('/login').send({}).expect(429);
  await new Promise((resolve) => setTimeout(resolve, 200));
  // A lockout that never lifts is an outage, so this is the other half of the
  // behaviour and worth pinning too.
  await request(app).post('/login').send({}).expect(401);
});

test('the real auth routes are rate limited', async () => {
  // Guards the regression itself: the limiters existed but were never wired to
  // /auth, which is what made unlimited guessing possible.
  const routes = require('../src/modules/auth/auth.routes');
  const layers = routes.stack.filter((l) => l.route);
  assert.ok(layers.length >= 2, 'expected /login and /admin-login to be registered');
  for (const layer of layers) {
    const names = layer.route.stack.map((s) => s.name);
    assert.ok(
      names.includes('rateLimit'),
      `${layer.route.path} has no rate limiter (handlers: ${names.join(', ')})`
    );
  }
});
