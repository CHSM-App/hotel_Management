const { Router } = require('express');
const lodgesService = require('../lodges/lodges.service');
const { ApiError } = require('../../middleware/errorHandler');

// =============================================================================
// Read-only integration surface for the central Invoice & Subscription Portal
// (a separate app — see Vengurla Tech's Invoice Project). It bills this
// product's actual paying customers: the lodges, not a lodge's own guests.
//
// Deliberately NOT on the site JWT system (authenticate.js / JWT_SECRET) — a
// token minted from that secret would carry real SUPERADMIN session
// semantics and never expire, which is a bigger blast radius than this needs.
// Instead this is its own bearer key, its own env var
// (BILLING_INTEGRATION_API_KEY), checked by its own tiny middleware below.
// Revoking access to the invoice portal means rotating one env var here,
// with no effect on any real admin session.
//
// Response shape is the CustomerAdapter contract the invoice portal expects
// from every product (externalId/name/email/phone/gstNumber/billingAddress),
// so it can use its generic LiveApiCustomerAdapter unmodified — the mapping
// from "lodge" to that shape lives here, once, next to the data it's mapping.
// =============================================================================

const router = Router();

function requireBillingApiKey(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const expected = process.env.BILLING_INTEGRATION_API_KEY;
  if (!expected) {
    // Misconfiguration, not a client error — don't say "unauthorized" for a
    // feature that was never actually turned on.
    return res.status(503).json({ error: 'Billing integration is not configured on this server.' });
  }
  if (!token || token !== expected) {
    return next(new ApiError('Not authorized.', 401));
  }
  next();
}

function toBillingAddress(lodge) {
  if (!lodge.address && !lodge.city && !lodge.state) return null;
  return { line1: lodge.address || null, city: lodge.city || null, state: lodge.state || null, country: 'India' };
}

// No auth — matches the convention of the site's own /health, used so the
// invoice portal's adapter healthCheck() doesn't need the API key just to
// ask "is this reachable at all".
router.get('/health', (req, res) => res.json({ ok: true }));

router.use(requireBillingApiKey);

// GET /internal/billing/customers/search?q=&limit=
router.get('/customers/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const lodges = await lodgesService.listLodges();

    const matches = q
      ? lodges.filter((l) =>
          [l.name, l.lodge_phone, l.owner_name, l.owner_phone, l.owner_email]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q))
        )
      : lodges;

    res.json(
      matches.slice(0, limit).map((l) => ({
        externalId: String(l.id),
        name: l.name,
        ownerName: l.owner_name || null,
        email: l.owner_email || null,
        phone: l.lodge_phone || l.owner_phone || null,
        gstNumber: l.is_gst_registered ? l.gstin || null : null,
        billingAddress: toBillingAddress(l),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /internal/billing/customers/:id
router.get('/customers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError('Lodge not found.', 404);
    }
    const { lodge, staff } = await lodgesService.getLodgeDetail(id);
    const owner = staff.find((s) => s.role === 'OWNER');

    res.json({
      externalId: String(lodge.id),
      name: lodge.name,
      ownerName: owner?.name || null,
      email: owner?.email || null,
      phone: lodge.phone || null,
      gstNumber: lodge.gstin || null,
      billingAddress: toBillingAddress(lodge),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
