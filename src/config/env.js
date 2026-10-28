// Fails the boot when the environment can't support a working app.
//
// The failure this prevents is the quiet one. Without JWT_SECRET the process
// starts fine, answers /health with {ok:true}, and then throws on every single
// sign-in — jsonwebtoken refuses to sign with an undefined secret, so it
// surfaces as a 500 with a generic message rather than anything naming the
// cause. A missing DB_PORT is worse: Number(undefined) is NaN, and the pool
// only discovers it on the first request. Both look like "the app is up and
// the app is broken", which is the hardest state to diagnose from outside.
//
// Checking here converts all of that into one loud message before the port is
// bound.

const REQUIRED = [
  ['DB_SERVER', 'SQL Server hostname'],
  ['DB_PORT', 'SQL Server port'],
  ['DB_NAME', 'database name'],
  ['DB_USER', 'database user'],
  ['DB_PASSWORD', 'database password'],
  ['JWT_SECRET', 'secret used to sign session tokens'],
];

// Long enough that guessing it is not a strategy. A short secret is worse than
// a missing one, because it fails silently rather than at boot.
const MIN_JWT_SECRET_LENGTH = 32;

function validateEnv() {
  const problems = [];

  for (const [name, description] of REQUIRED) {
    if (!process.env[name] || !String(process.env[name]).trim()) {
      problems.push(`${name} is not set (${description}).`);
    }
  }

  if (process.env.DB_PORT && Number.isNaN(Number(process.env.DB_PORT))) {
    problems.push(`DB_PORT must be a number, got "${process.env.DB_PORT}".`);
  }

  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim().length < MIN_JWT_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET is too short — ${secret.trim().length} characters, minimum ${MIN_JWT_SECRET_LENGTH}. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    // Without an origin allowlist every browser cross-origin request is refused
    // and the deployed SPA can't talk to its own API. app.js falls back to a
    // permissive host match *outside* production only, so there is nothing to
    // catch this in production but this check.
    if (!process.env.ALLOWED_ORIGINS || !process.env.ALLOWED_ORIGINS.trim()) {
      problems.push('ALLOWED_ORIGINS must list the site origin(s) in production, e.g. https://hotel.example.com');
    }
    // Behind a proxy with this unset, every request carries the proxy's address,
    // so the guest-PIN limiter buckets the whole property under one key — any
    // guest could then block food ordering for everyone. See app.js.
    if (!process.env.TRUST_PROXY) {
      problems.push(
        'TRUST_PROXY must be set in production (1 for a single nginx/Passenger). ' +
          'Without it the rate limiters see the proxy address instead of real clients.'
      );
    }
  }

  if (problems.length > 0) {
    const lines = problems.map((p) => `  - ${p}`).join('\n');
    throw new Error(
      `Refusing to start — the environment is incomplete:\n${lines}\n\n` +
        'Copy backend/.env.example to backend/.env and fill in the missing values.'
    );
  }
}

module.exports = { validateEnv };
