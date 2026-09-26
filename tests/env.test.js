const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Startup validation. These matter because the failure they prevent is the
// quiet one: without them the app boots, answers its health check, and then
// 500s every sign-in — see src/config/env.js.
//
// validateEnv reads process.env at call time, so each case sets up the
// environment it wants and restores it afterwards. The module cache is cleared
// between requires because uploadRoot resolves UPLOAD_ROOT when it loads.

function withEnv(vars, fn) {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) {
      if (/^(DB_|JWT_|NODE_ENV|ALLOWED_ORIGINS|TRUST_PROXY|UPLOAD_ROOT)/.test(key)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, vars);
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/uploadRoot')];
    return fn(require('../src/config/env').validateEnv);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[require.resolve('../src/config/env')];
    delete require.cache[require.resolve('../src/config/uploadRoot')];
  }
}

const VALID_SECRET = 'a'.repeat(40);
const VALID_DEV = {
  DB_SERVER: 'localhost',
  DB_PORT: '1433',
  DB_NAME: 'lodge',
  DB_USER: 'sa',
  DB_PASSWORD: 'secret',
  JWT_SECRET: VALID_SECRET,
};

test('accepts a complete development environment', () => {
  withEnv(VALID_DEV, (validateEnv) => assert.doesNotThrow(validateEnv));
});

test('rejects a missing JWT_SECRET', () => {
  const { JWT_SECRET, ...rest } = VALID_DEV;
  withEnv(rest, (validateEnv) => {
    assert.throws(validateEnv, /JWT_SECRET is not set/);
  });
});

test('rejects a JWT_SECRET that is too short to be worth having', () => {
  withEnv({ ...VALID_DEV, JWT_SECRET: 'short' }, (validateEnv) => {
    assert.throws(validateEnv, /JWT_SECRET is too short/);
  });
});

test('rejects a non-numeric DB_PORT', () => {
  // Number(undefined) is NaN and the pool only finds out on the first request,
  // which is the failure this check exists to move forward to boot.
  withEnv({ ...VALID_DEV, DB_PORT: 'not-a-port' }, (validateEnv) => {
    assert.throws(validateEnv, /DB_PORT must be a number/);
  });
});

test('reports every problem at once, not just the first', () => {
  // An operator fixing a broken deploy should get the whole list in one go
  // rather than discovering the next missing variable on each restart.
  withEnv({ DB_SERVER: 'localhost' }, (validateEnv) => {
    try {
      validateEnv();
      assert.fail('expected validateEnv to throw');
    } catch (err) {
      for (const name of ['DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET']) {
        assert.match(err.message, new RegExp(name), `expected ${name} in the message`);
      }
    }
  });
});

test('production additionally requires ALLOWED_ORIGINS and TRUST_PROXY', () => {
  withEnv({ ...VALID_DEV, NODE_ENV: 'production' }, (validateEnv) => {
    try {
      validateEnv();
      assert.fail('expected validateEnv to throw');
    } catch (err) {
      assert.match(err.message, /ALLOWED_ORIGINS/);
      assert.match(err.message, /TRUST_PROXY/);
    }
  });
});

test('accepts a complete production environment', () => {
  withEnv(
    {
      ...VALID_DEV,
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://hotel.example.com',
      TRUST_PROXY: '1',
    },
    (validateEnv) => assert.doesNotThrow(validateEnv)
  );
});

test('UPLOAD_ROOT is optional in production — it defaults to backend/uploads', () => {
  // Uploads are rooted in-tree by default, the same way the college-admission
  // backend roots BackEnd/uploads/students. An unset UPLOAD_ROOT is a working
  // default rather than a misconfiguration, so it must not block the boot: a
  // process that exits here is invisible behind IIS, which reports it only as a
  // blank 500 on every URL.
  withEnv(
    {
      ...VALID_DEV,
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://hotel.example.com',
      TRUST_PROXY: '1',
    },
    (validateEnv) => assert.doesNotThrow(validateEnv)
  );
});

test('the default upload root resolves inside backend/, not src/public', () => {
  const prev = process.env.UPLOAD_ROOT;
  delete process.env.UPLOAD_ROOT;
  delete require.cache[require.resolve('../src/config/uploadRoot')];
  try {
    const { UPLOAD_ROOT } = require('../src/config/uploadRoot');
    assert.strictEqual(UPLOAD_ROOT, path.join(__dirname, '..', 'uploads'));
    // Anything under src/public is served statically; ID proofs must never be.
    assert.ok(!UPLOAD_ROOT.includes(path.join('src', 'public')));
  } finally {
    if (prev === undefined) delete process.env.UPLOAD_ROOT;
    else process.env.UPLOAD_ROOT = prev;
    delete require.cache[require.resolve('../src/config/uploadRoot')];
  }
});
