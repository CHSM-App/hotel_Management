const sharp = require('sharp');
const { getPool, sql } = require('../../config/connection');
const { getSettings } = require('../../config/lodgeSettings');
const { logger } = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { ID_PROOF_TYPES } = require('./bookings.schema');

const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 90 * 1000;
// Below this the model is guessing — leave the fields blank for staff to type.
const MIN_CONFIDENCE = 0.6;

const PROMPT = `These are photos of Indian ID cards (Aadhaar, PAN, passport, driving licence, voter ID), possibly the front and back of the same card, in any order. Each person is one entry: group the images that belong to the same card or person. For each person report the full name as printed, the ID type, the ID number exactly as printed, which images (0-based, in the order given) show their card, and your confidence from 0 to 1. Use null for anything you cannot read clearly. Never guess or invent digits. A masked Aadhaar (XXXX XXXX 1234) has no usable number: return null for it.`;

const TOOL = {
  name: 'report_ids',
  description: 'Report the people found on the ID card photos.',
  input_schema: {
    type: 'object',
    properties: {
      guests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'] },
            idProofType: { type: ['string', 'null'], enum: [...ID_PROOF_TYPES, null] },
            idProofNumber: { type: ['string', 'null'] },
            imageIndexes: { type: 'array', items: { type: 'integer' } },
            confidence: { type: 'number' },
          },
          required: ['name', 'idProofType', 'idProofNumber', 'imageIndexes', 'confidence'],
        },
      },
    },
    required: ['guests'],
  },
};

// The model's answer -> what the app may trust. Pure, so it is unit-tested.
// Never throws on bad model output: a bad entry just loses its fields.
function normalizeScan(raw, imageCount) {
  const list = Array.isArray(raw?.guests) ? raw.guests : [];
  return list.slice(0, imageCount).map((g) => {
    const type = ID_PROOF_TYPES.includes(g?.idProofType) ? g.idProofType : null;
    let number = typeof g?.idProofNumber === 'string' ? g.idProofNumber.replace(/[\s-]+/g, '').toUpperCase() : '';
    if (type === 'AADHAAR' && !/^\d{12}$/.test(number)) number = '';
    if (number.length > 50) number = '';
    const name = typeof g?.name === 'string' ? g.name.trim().slice(0, 100) : '';
    const confidence = Math.min(1, Math.max(0, Number(g?.confidence) || 0));
    const imageIndexes = [...new Set((Array.isArray(g?.imageIndexes) ? g.imageIndexes : [])
      .filter((i) => Number.isInteger(i) && i >= 0 && i < imageCount))];
    const trusted = confidence >= MIN_CONFIDENCE;
    return {
      name: trusted ? name : '',
      idProofType: trusted ? type : null,
      idProofNumber: trusted ? number : '',
      confidence,
      imageIndexes,
      // Staff must type or fix something on this row.
      needsReview: !trusted || !name || !number,
    };
  });
}

async function monthlyUsage(pool, lodgeId) {
  const { recordset } = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT ISNULL(SUM(image_count), 0) AS n FROM dbo.ai_scan_log
      WHERE lodge_id = @lodgeId AND status = 'OK'
        AND created_at >= DATEFROMPARTS(YEAR(SYSDATETIMEOFFSET()), MONTH(SYSDATETIMEOFFSET()), 1)
    `);
  return recordset[0].n;
}

async function logScan(pool, lodgeId, userId, imageCount, usage, status) {
  try {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('userId', sql.BigInt, userId ?? null)
      .input('imageCount', sql.Int, imageCount)
      .input('inTok', sql.Int, usage?.input_tokens ?? null)
      .input('outTok', sql.Int, usage?.output_tokens ?? null)
      .input('status', sql.NVarChar, status)
      .query(`INSERT INTO dbo.ai_scan_log (lodge_id, user_id, image_count, input_tokens, output_tokens, status)
              VALUES (@lodgeId, @userId, @imageCount, @inTok, @outTok, @status)`);
  } catch (err) {
    // Counting is bookkeeping — never fail a finished scan over it.
    logger.warn({ err }, 'ai_scan_log insert failed');
  }
}

async function scanIds({ lodgeId, userId, files }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ApiError('AI scan is not set up on the server.', 503);
  if (!files.length) throw new ApiError('Choose at least one ID photo.', 400);
  if (!(await getSettings(lodgeId)).aiIdScan) {
    throw new ApiError('AI ID scan is not enabled for this property.', 403);
  }

  const pool = await getPool();
  const cap = Number(process.env.AI_SCAN_MONTHLY_CAP) || 300;
  if ((await monthlyUsage(pool, lodgeId)) + files.length > cap) {
    throw new ApiError('This month’s AI scan limit is reached. Please enter the IDs by hand.', 429);
  }

  // Smaller images = fewer tokens; 1568px is where Claude stops downscaling.
  const blocks = await Promise.all(
    files.map(async (f) => {
      const jpeg = await sharp(f.buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } };
    })
  );

  let body;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_SCAN_MODEL || 'claude-haiku-5-5',
        max_tokens: 4000,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: [...blocks, { type: 'text', text: PROMPT }] }],
      }),
    });
    if (!res.ok) {
      // Status only — the body can echo request details, and these are ID cards.
      logger.warn({ status: res.status }, 'AI scan: Claude API error');
      throw new Error(`status ${res.status}`);
    }
    body = await res.json();
  } catch (err) {
    await logScan(pool, lodgeId, userId, files.length, null, 'FAILED');
    if (err instanceof ApiError) throw err;
    throw new ApiError('Could not read the ID cards right now. Please enter them by hand.', 502);
  }

  const raw = body.content?.find((c) => c.type === 'tool_use')?.input;
  await logScan(pool, lodgeId, userId, files.length, body.usage, 'OK');
  return { guests: normalizeScan(raw, files.length), imageCount: files.length };
}

module.exports = { scanIds, normalizeScan };
