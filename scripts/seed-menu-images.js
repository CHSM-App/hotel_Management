/**
 * Fetches a photo for every dish on a lodge's menu from Wikimedia Commons and
 * points menu_items.image_filename at it.
 *
 *   node scripts/seed-menu-images.js --phone 8263829478 --name "Hotel Renuka Palace"
 *
 * The lodge is identified by phone AND name for the same reason as seed-menu.js:
 * writing a hundred photos onto the wrong property is not a mistake you notice
 * quickly. There is no default lodge.
 *
 * Commons rather than a stock-photo API because it needs no key and states a
 * licence per file. Almost everything there is CC BY / CC BY-SA, which is free
 * to use commercially but requires crediting the photographer — so every file
 * written here is also recorded in uploads/menu-image-credits.json with its
 * author, licence and source page. That file is the attribution record; do not
 * delete it while these images are still on the menu.
 *
 * Idempotent and additive: an item that already has an image is skipped, so a
 * photo a hotelier uploaded by hand is never overwritten by a re-run. Pass
 * --force to replace existing images too (the superseded file is deleted).
 *
 * Search results are matched, not trusted. "Chicken Biryani" will happily return
 * a photo of mutton biryani and "Butter Roti" returns a peanut butter sandwich,
 * so candidates whose filename mentions a protein or a dish form the dish itself
 * doesn't (see CONFLICT_WORDS) are rejected before download. Anything that only
 * matched after relaxing that check is listed at the end of the run as needing a
 * human glance — a wrong photo on a public menu is worse than no photo.
 *
 * Flags:
 *   --force      replace images that are already set
 *   --dry-run    resolve and report matches, download and write nothing
 *   --limit N    only process the first N items needing an image (for a trial run)
 *   --only A,B   only these dishes, by name; implies --force. Filenames only tell
 *                you so much — a photo captioned "Chilli Scrambled Eggs" can turn
 *                out to have a stranger eating in the background — so this exists
 *                to re-fetch the handful you reject after actually looking.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { getPool, sql } = require('../src/config/connection');
// Reuse the upload middleware's directory rather than rebuilding the path here,
// so a photo seeded by this script and one uploaded through the panel always
// land in the same place.
const { UPLOAD_DIR } = require('../src/middleware/menuImageUpload');

const CREDITS_FILE = path.join(__dirname, '..', 'uploads', 'menu-image-credits.json');

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const LODGE_PHONE = readArg('--phone');
const LODGE_NAME = readArg('--name');
const ONLY = (readArg('--only') || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const FORCE = process.argv.includes('--force') || ONLY.length > 0;
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = Number(readArg('--limit')) || Infinity;

if (!LODGE_PHONE || !LODGE_NAME) {
  console.error('Usage: node scripts/seed-menu-images.js --phone <number> --name "<lodge name>"');
  console.error('Example: node scripts/seed-menu-images.js --phone 8263829478 --name "Hotel Renuka Palace"');
  process.exit(1);
}

// Commons is searched by dish name by default. These are the names where that
// plainly fails — either the words mean something else entirely ("Dal Fry"
// returns Yugoslavian flag maps, "Egg 65" returns a village in Austria), or the
// dish is a menu coinage with no photos under that exact phrase.
const QUERY_OVERRIDES = {
  'Dal Fry': 'dal fry lentil curry indian',
  'Veg Handi': 'vegetable handi',
  'Egg Masala': 'anda masala egg curry indian',
  'Egg Kolhapuri': 'egg curry spicy indian gravy',
  'Mutton Handi': 'mutton curry indian gravy',
  'Chicken Schezwan Rice': 'schezwan fried rice',
  'Schezwan Fried Rice': 'schezwan fried rice vegetable',
  'Veg Manchurian Gravy': 'veg manchurian gravy',
  'Steamed Rice': 'cooked white rice bowl',
  'Butter Roti': 'tandoori roti indian flatbread',
  'Veg Clear Soup': 'vegetable clear soup',
  'Sweet Corn Soup': 'corn soup bowl',
  'Cheese Sandwich': 'grilled cheese sandwich',
  'French Fries': 'french fries plate',
  'Ice Cream': 'ice cream scoops bowl',
  'Fruit Salad': 'fruit salad bowl',
  Tea: 'masala chai glass',
  Coffee: 'cup of coffee',
  'Fresh Lime Water': 'nimbu pani',
  'Fresh Lime Soda': 'nimbu soda lemon',
  'Soft Drink': 'cola glass ice drink',
  'Mineral Water': 'drinking water bottle',
  'Crispy Corn': 'crispy fried corn snack',
  // Searching the dish name returns a hand holding a slice with a rival chain's
  // cup in shot; this returns a whole pizza on a board.
  'Veg Pizza': 'vegetarian pizza whole',
  // Both of these name words that appear in the one good photo's filename
  // ("cropped", "chips salad") purely so the matcher stops treating them as a
  // conflicting dish form and picks that file. The alternative in each case was
  // a worse photo: an uncropped frame with a stranger eating in the background,
  // and a Japanese omurice.
  'Chilli Egg': 'chilli scrambled eggs cropped',
  'Chicken Omelette': 'chicken omelette chips salad',
  'Prawns Fry': 'fried prawns indian',
  'Chicken Clear Soup': 'clear chicken soup bowl',
  'Mix Veg': 'mixed vegetable curry indian',
  'Veg Kolhapuri': 'veg kolhapuri',
};

// Dishes Commons has no usable photo of, left deliberately without one for the
// hotelier to shoot and upload. Searching anyway would not fail — it would
// return something confidently wrong, which on a public menu is worse than a
// blank tile. Each entry records what the search actually returns, so nobody
// re-adds it later assuming it was an oversight.
const NO_PHOTO = {
  'Egg 65': 'no photo of the dish on Commons — "Egg 65" matches a hamlet in Switzerland',
  'Mineral Water': 'every candidate is a close-up of a branded bottle, and none of the brands are ones this hotel sells',
};

// A filename mentioning any of these is about that thing. If the dish doesn't
// mention it too, the photo is of a different dish — reject it. This is what
// stops "Chicken Biryani" landing a mutton biryani, "Ice Cream" landing an apple
// cake and "Steamed Rice" landing Chinese noodle rolls.
//
// Split in two because the two mismatches are not equally bad. Serving a photo
// of beef against "Chilli Egg", or fish against a dish a Jain guest is ordering,
// is a different order of wrong from a photo that happens to have rice beside
// the curry — so a wrong protein is never tolerated, while a wrong dish form is
// only tolerated when nothing better exists (and is then flagged for review).
const HARD_CONFLICTS = [
  'chicken', 'mutton', 'lamb', 'beef', 'pork', 'bacon', 'ham', 'fish', 'prawn',
  'prawns', 'shrimp', 'crab', 'clam', 'clams', 'seafood', 'squid', 'egg', 'eggs',
  'paneer', 'gobi', 'cauliflower', 'mushroom', 'potato', 'aloo', 'palak', 'spinach',
  'brinjal', 'eggplant', 'chickpea', 'peanut', 'kimchi', 'vindaloo',
];

const SOFT_CONFLICTS = [
  'sandwich', 'burger', 'pizza', 'soup', 'biryani', 'biriyani', 'pulao', 'noodle',
  'noodles', 'salad', 'cake', 'brownie', 'dosa', 'idli', 'vada', 'paratha', 'naan',
  'roti', 'chapati', 'samosa', 'pakora', 'tikka', 'manchurian', 'lassi', 'coffee',
  'tea', 'rice', 'fries', 'omelette', 'omelet', 'curry', 'jelly', 'cereal', 'waffle',
];

// Rejected outright, at any level of relaxation. A menu photo is a photo of
// food; a search for "mineral water" returning a picture of a naked woman is a
// thing Commons will genuinely do, and it must not reach a guest's phone.
const BANNED_TOKENS = new Set([
  'naked', 'nude', 'nudity', 'topless', 'bikini', 'lingerie', 'erotic', 'sex',
  'woman', 'women', 'man', 'men', 'girl', 'boy', 'child', 'children', 'baby',
  'portrait', 'selfie', 'model', 'protest', 'funeral', 'corpse', 'blood',
  'toilet', 'urinal', 'vomit', 'garbage', 'waste', 'sewage', 'flag', 'map',
  'logo', 'poster', 'diagram', 'chart', 'advertisement',
]);

// Words too generic to prove a match — a hit is not "about" the dish just
// because both say "veg" or "indian".
const WEAK_WORDS = new Set([
  'veg', 'vegetable', 'vegetarian', 'indian', 'india', 'fresh', 'plain', 'hot',
  'sweet', 'sour', 'with', 'and', 'the', 'of', 'in', 'a', 'style', 'special',
  'dish', 'food', 'recipe', 'homemade', 'home', 'made', 'bowl', 'plate', 'glass',
  'cup', 'plain', 'mix', 'mixed', 'masala', 'butter', 'cheese', 'crispy', 'soft',
]);

// Naive singularisation, applied to both sides of every comparison. Without it
// "Chilli Scrambled Eggs" reads as a protein conflict against a dish named
// "Chilli Egg" — the photo is rejected for containing the very thing it should.
// Both sides go through the same function, so it only has to be consistent, not
// linguistically right.
function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

const normalise = (words) => [...words].map((w) => tokens(w)[0]);

// The word lists are compared against singularised title tokens, so they have to
// be singularised the same way rather than matched raw.
const HARD = normalise(HARD_CONFLICTS);
const SOFT = normalise(SOFT_CONFLICTS);
const BANNED = new Set(normalise(BANNED_TOKENS));
const WEAK = new Set(normalise(WEAK_WORDS));

function httpsGet(url, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          // Commons asks for a descriptive agent with a contact address; an
          // anonymous scraper is what gets an IP range blocked.
          'User-Agent': 'HotelManagement-MenuImageSeeder/1.0 (support@vengurlatech.com)',
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(httpsGet(new URL(res.headers.location, url).href, { binary }));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Timed out fetching ${url}`)));
  });
}

async function searchCommons(term) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
    `&gsrsearch=${encodeURIComponent(`${term} filetype:bitmap`)}` +
    '&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900';
  const body = await httpsGet(url);
  const json = JSON.parse(body);
  if (!json.query || !json.query.pages) return [];

  return Object.values(json.query.pages)
    .sort((a, b) => a.index - b.index)
    .map((page) => {
      const info = page.imageinfo && page.imageinfo[0];
      if (!info) return null;
      const meta = info.extmetadata || {};
      const strip = (v) => (v ? String(v.value).replace(/<[^>]*>/g, '').trim() : null);
      return {
        title: page.title.replace(/^File:/, ''),
        thumbUrl: info.thumburl,
        pageUrl: info.descriptionurl,
        license: strip(meta.LicenseShortName) || 'unknown',
        artist: strip(meta.Artist) || 'unknown',
      };
    })
    .filter((c) => c && c.thumbUrl);
}

// Returns { candidate, relaxed } — relaxed marks a match that only survived
// because the strict conflict check found nothing, so the caller can flag it.
function pickCandidate(candidates, query) {
  const queryTokens = new Set(tokens(query));
  const strong = [...queryTokens].filter((t) => !WEAK.has(t) && t.length > 2);

  const scored = candidates
    .map((candidate) => {
      const titleTokens = new Set(tokens(candidate.title));
      return {
        candidate,
        banned: [...titleTokens].some((t) => BANNED.has(t)),
        hard: HARD.filter((w) => titleTokens.has(w) && !queryTokens.has(w)).length,
        soft: SOFT.filter((w) => titleTokens.has(w) && !queryTokens.has(w)).length,
        overlap: strong.filter((t) => titleTokens.has(t)).length,
        noise: titleTokens.size,
      };
    })
    // A wrong protein or a banned subject disqualifies a candidate outright, so
    // drop those before either pass rather than merely ranking them last.
    .filter((s) => !s.banned && s.hard === 0);

  // Best match: nothing conflicting at all, and it actually shares a distinctive
  // word with the dish. Ties break toward the least busy filename, which
  // correlates well with a photo of one plated dish rather than a table spread.
  const clean = scored
    .filter((s) => s.soft === 0 && (s.overlap > 0 || strong.length === 0))
    .sort((a, b) => b.overlap - a.overlap || a.noise - b.noise);
  if (clean.length > 0) return { candidate: clean[0].candidate, relaxed: false };

  // Nothing clean: allow a wrong dish form, prefer the fewest, and say so.
  const fallback = scored
    .filter((s) => s.overlap > 0)
    .sort((a, b) => a.soft - b.soft || b.overlap - a.overlap || a.noise - b.noise)[0];
  if (fallback) return { candidate: fallback.candidate, relaxed: true };

  return { candidate: null, relaxed: false };
}

const EXT_BY_SUFFIX = { '.jpg': '.jpg', '.jpeg': '.jpg', '.png': '.png', '.webp': '.webp' };

function extensionFor(url) {
  const clean = url.split('?')[0].toLowerCase();
  const dot = clean.lastIndexOf('.');
  // Commons renders thumbnails of exotic source formats as JPEG, so an
  // unrecognised suffix is safe to store as .jpg.
  return (dot === -1 ? null : EXT_BY_SUFFIX[clean.slice(dot)]) || '.jpg';
}

async function resolveLodge(request) {
  const result = await request
    .input('phone', sql.NVarChar, LODGE_PHONE)
    .input('lodgeName', sql.NVarChar, LODGE_NAME)
    .query('SELECT id FROM dbo.lodges WHERE phone = @phone AND name = @lodgeName');

  if (result.recordset.length === 0) {
    throw new Error(`No lodge found with phone ${LODGE_PHONE} named "${LODGE_NAME}".`);
  }
  if (result.recordset.length > 1) {
    throw new Error(`Phone ${LODGE_PHONE} matches more than one lodge — refusing to guess.`);
  }
  return result.recordset[0].id;
}

function loadCredits() {
  try {
    return JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const pool = await getPool();
  const lodgeId = await resolveLodge(pool.request());

  const itemsResult = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT i.id, i.name, i.image_filename, c.name AS section
      FROM dbo.menu_items i
      JOIN dbo.menu_categories c ON c.id = i.category_id
      WHERE i.lodge_id = @lodgeId AND i.is_active = 1
      ORDER BY c.sort_order, i.sort_order
    `);

  const all = itemsResult.recordset;
  if (ONLY.length > 0) {
    const known = new Set(all.map((i) => i.name.toLowerCase()));
    const unknown = ONLY.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      throw new Error(`--only names no dish on this menu: ${unknown.join(', ')}`);
    }
  }
  const pending = all
    .filter((item) => (ONLY.length > 0 ? ONLY.includes(item.name.toLowerCase()) : FORCE || !item.image_filename))
    .slice(0, LIMIT);
  const skipped = all.length - pending.length;

  console.log(
    `Seeding dish photos for "${LODGE_NAME}" (lodge id ${lodgeId}): ` +
      `${pending.length} to fetch, ${skipped} skipped${FORCE ? '' : ' (already have an image)'}` +
      `${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}`
  );

  const credits = loadCredits();
  // Two sections share a few dish names (Aloo Paratha, Egg Fried Rice, Chicken
  // Sandwich). Cache the search so the API is hit once per query; each item
  // still gets its own file so they can be replaced independently later.
  const searchCache = new Map();
  const needsReview = [];
  const failures = [];
  const deliberate = [];
  let written = 0;

  for (const item of pending) {
    if (NO_PHOTO[item.name]) {
      // A dish can land here after already being seeded, if looking at the
      // downloaded photo is what revealed it had no usable match. Clear it, so
      // the skip list is the same decision whether or not the run is a first one.
      if (item.image_filename && !DRY_RUN) {
        await pool
          .request()
          .input('id', sql.BigInt, item.id)
          .query('UPDATE dbo.menu_items SET image_filename = NULL WHERE id = @id');
        fs.rmSync(path.join(UPLOAD_DIR, item.image_filename), { force: true });
        delete credits[item.image_filename];
      }
      deliberate.push({ item, reason: NO_PHOTO[item.name] });
      console.log(`  – ${item.section} / ${item.name} — left without a photo (${NO_PHOTO[item.name]})`);
      continue;
    }

    const query = QUERY_OVERRIDES[item.name] || item.name;
    try {
      if (!searchCache.has(query)) {
        searchCache.set(query, await searchCommons(query));
        await sleep(200); // be a polite API citizen
      }
      const { candidate, relaxed } = pickCandidate(searchCache.get(query), query);

      if (!candidate) {
        failures.push({ item, reason: 'no usable search result' });
        console.log(`  ✗ ${item.section} / ${item.name} — no usable match for "${query}"`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  · ${item.section} / ${item.name} → ${candidate.title}${relaxed ? '  [REVIEW]' : ''}`);
        if (relaxed) needsReview.push({ item, candidate });
        continue;
      }

      const buffer = await httpsGet(candidate.thumbUrl, { binary: true });
      const filename = `${crypto.randomUUID()}${extensionFor(candidate.thumbUrl)}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);

      const previous = item.image_filename;
      await pool
        .request()
        .input('id', sql.BigInt, item.id)
        .input('filename', sql.NVarChar, filename)
        .query('UPDATE dbo.menu_items SET image_filename = @filename WHERE id = @id');

      // Only after the row points at the new file — a crash between the two
      // leaves an orphaned file, which is harmless, whereas the other order
      // leaves a row pointing at a file that no longer exists.
      if (previous) {
        fs.rmSync(path.join(UPLOAD_DIR, previous), { force: true });
        delete credits[previous];
      }

      credits[filename] = {
        dish: item.name,
        section: item.section,
        title: candidate.title,
        artist: candidate.artist,
        license: candidate.license,
        source: candidate.pageUrl,
      };

      written += 1;
      if (relaxed) needsReview.push({ item, candidate });
      console.log(
        `  ✓ ${item.section} / ${item.name} → ${candidate.title} (${candidate.license})${relaxed ? '  [REVIEW]' : ''}`
      );
      await sleep(150);
    } catch (err) {
      failures.push({ item, reason: err.message });
      console.log(`  ✗ ${item.section} / ${item.name} — ${err.message}`);
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(CREDITS_FILE, `${JSON.stringify(credits, null, 2)}\n`);
  }

  console.log(
    `\nDone — ${written} photos written, ${deliberate.length} deliberately left blank, ${failures.length} failed.`
  );
  if (!DRY_RUN) console.log(`Attribution written to ${path.relative(process.cwd(), CREDITS_FILE)}`);

  if (needsReview.length > 0) {
    console.log(`\n${needsReview.length} matched only after relaxing the check — eyeball these:`);
    for (const { item, candidate } of needsReview) {
      console.log(`  ${item.section} / ${item.name} → ${candidate.title}`);
    }
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} without a photo:`);
    for (const { item, reason } of failures) console.log(`  ${item.section} / ${item.name} — ${reason}`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
