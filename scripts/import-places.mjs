#!/usr/bin/env node
/**
 * import-places.mjs — fill Firestore with the landmarks around Palç.
 * ------------------------------------------------------------------
 * Pulls every *named* point of interest within a radius of the village
 * (the Koman ferry port, guesthouses, peaks, springs, churches, restaurants,
 * schools, viewpoints, …) from OpenStreetMap's Overpass API — free, legal and
 * the same data the map already renders — and writes them to the `places`
 * collection. Re-running is safe: each landmark has a deterministic id
 * (osm_<type>_<id>), so it upserts instead of duplicating.
 *
 * WHY NOT GOOGLE MAPS? Scraping Google's map data violates their Terms of
 * Service, needs a paid Places API key, and breaks whenever they change their
 * markup. OpenStreetMap is open data, so this stays free and reproducible.
 *
 * ── Setup ─────────────────────────────────────────────────────────
 *   1. npm install firebase-admin           (once)
 *   2. Firebase console → Project settings → Service accounts →
 *      "Generate new private key" → save it as  scripts/serviceAccountKey.json
 *      (or set GOOGLE_APPLICATION_CREDENTIALS to its path)
 *
 * ── Run ───────────────────────────────────────────────────────────
 *   node scripts/import-places.mjs                 # import (default 12 km)
 *   node scripts/import-places.mjs --dry-run       # preview, write nothing
 *   node scripts/import-places.mjs --clear         # wipe `places` first, then import
 *   RADIUS_KM=20 node scripts/import-places.mjs    # widen the radius
 *
 * Switching Firebase projects later? Just drop in that project's
 * serviceAccountKey.json and run it again — nothing else changes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────
// Palçi village centre (OSM village node), Lekbibaj — Bashkia Tropojë
const PALC = { lat: 42.2585186, lng: 19.898662 };
const RADIUS_KM = Number(process.env.RADIUS_KM || 12);
const COLLECTION = process.env.COLLECTION || 'places';
// Keep only the most important landmarks so the map stays clean (env override).
const MAX_PLACES = Number(process.env.MAX_PLACES || 50);

// Lower = more important. Villages and generic peaks rank last (the base map
// already labels them), so ports, guesthouses, attractions etc. win the slots.
const PRIORITY = {
  ferry: 1, health: 1, lodging: 2, attraction: 2, historic: 2, viewpoint: 3,
  worship: 3, food: 3, waterfall: 3, cave: 4, camp: 4, spring: 5, water: 5,
  leisure: 5, fuel: 6, school: 6, tower: 7, shop: 7, peak: 8, place: 9,
};

function rankAndCap(places, max) {
  return [...places]
    .sort((a, b) =>
      (PRIORITY[a.category] ?? 99) - (PRIORITY[b.category] ?? 99) ||
      a.name.localeCompare(b.name))
    .slice(0, max);
}

// emoji + colour per category (shared with the app's map rendering)
const CATEGORY_META = {
  ferry: { emoji: '⛴️', color: '#1f6fb0' }, lodging: { emoji: '🏨', color: '#7a5c28' },
  camp: { emoji: '⛺', color: '#3f7d3f' }, viewpoint: { emoji: '🔭', color: '#8a6d2f' },
  attraction: { emoji: '🎯', color: '#b06a1f' }, peak: { emoji: '⛰️', color: '#6b5a3a' },
  spring: { emoji: '💧', color: '#2f8fbf' }, waterfall: { emoji: '🌊', color: '#2f8fbf' },
  cave: { emoji: '🕳️', color: '#5a5044' }, water: { emoji: '🏞️', color: '#2f8fbf' },
  historic: { emoji: '🏛️', color: '#8a6d2f' }, worship: { emoji: '⛪', color: '#7a5c28' },
  food: { emoji: '🍽️', color: '#b3282d' }, fuel: { emoji: '⛽', color: '#4a4a4a' },
  school: { emoji: '🏫', color: '#555555' }, health: { emoji: '🏥', color: '#b3282d' },
  shop: { emoji: '🛒', color: '#7a5c28' }, leisure: { emoji: '🌳', color: '#3f7d3f' },
  tower: { emoji: '🗼', color: '#5a5044' }, place: { emoji: '🏘️', color: '#6b5a3a' },
};

/**
 * Hand-curated landmarks OSM doesn't have (or that you want to guarantee).
 * Read from scripts/custom-places.json — always included, always ranked top.
 * Each entry: { "name", "category", "lat", "lng" }.
 */
function loadCustomPlaces() {
  const path = resolve(__dirname, 'custom-places.json');
  if (!existsSync(path)) return [];
  let arr;
  try { arr = JSON.parse(readFileSync(path, 'utf8')); }
  catch { console.warn('  ! custom-places.json is not valid JSON — skipped'); return []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const c of arr) {
    if (!c || !c.name || typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
    const category = c.category || 'attraction';
    const meta = CATEGORY_META[category] || CATEGORY_META.attraction;
    const slug = String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    out.push({
      id: 'custom_' + slug,
      name: c.name,
      category,
      emoji: meta.emoji,
      color: meta.color,
      rank: 0,                       // curated places always win the top slots
      lat: +c.lat.toFixed(6),
      lng: +c.lng.toFixed(6),
      source: 'custom',
    });
  }
  return out;
}
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const DRY_RUN = process.argv.includes('--dry-run');
const CLEAR   = process.argv.includes('--clear');

// ── Firebase Admin ──────────────────────────────────────────────────
function initFirebase() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || resolve(__dirname, 'serviceAccountKey.json');
  if (!existsSync(keyPath)) {
    console.error(
      `\n✖ Service account key not found.\n` +
      `  Expected: ${keyPath}\n` +
      `  Firebase console → Project settings → Service accounts → Generate new private key,\n` +
      `  save it as scripts/serviceAccountKey.json (or set GOOGLE_APPLICATION_CREDENTIALS).\n`
    );
    process.exit(1);
  }
  const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  initializeApp({ credential: cert(serviceAccount) });
  return getFirestore();
}

// ── OSM tag → category / emoji / colour ─────────────────────────────
function classify(t) {
  if (t.amenity === 'ferry_terminal' || t.waterway === 'ferry' || t.man_made === 'pier' || t.route === 'ferry')
    return { category: 'ferry', emoji: '⛴️', color: '#1f6fb0' };
  if (['hotel', 'guest_house', 'hostel', 'chalet', 'apartment', 'motel'].includes(t.tourism))
    return { category: 'lodging', emoji: '🏨', color: '#7a5c28' };
  if (t.tourism === 'camp_site' || t.tourism === 'caravan_site')
    return { category: 'camp', emoji: '⛺', color: '#3f7d3f' };
  if (t.tourism === 'viewpoint')
    return { category: 'viewpoint', emoji: '🔭', color: '#8a6d2f' };
  if (['attraction', 'artwork', 'museum', 'gallery'].includes(t.tourism))
    return { category: 'attraction', emoji: '🎯', color: '#b06a1f' };
  if (t.natural === 'peak')          return { category: 'peak',      emoji: '⛰️', color: '#6b5a3a' };
  if (t.natural === 'spring')        return { category: 'spring',    emoji: '💧', color: '#2f8fbf' };
  if (t.natural === 'waterfall' || t.waterway === 'waterfall')
    return { category: 'waterfall', emoji: '🌊', color: '#2f8fbf' };
  if (t.natural === 'cave_entrance') return { category: 'cave',      emoji: '🕳️', color: '#5a5044' };
  if (t.natural === 'water' || t.water)
    return { category: 'water', emoji: '🏞️', color: '#2f8fbf' };
  if (t.historic)                    return { category: 'historic',  emoji: '🏛️', color: '#8a6d2f' };
  if (t.amenity === 'place_of_worship')
    return { category: 'worship', emoji: t.religion === 'muslim' ? '🕌' : '⛪', color: '#7a5c28' };
  if (['restaurant', 'cafe', 'bar', 'fast_food', 'pub'].includes(t.amenity))
    return { category: 'food', emoji: '🍽️', color: '#b3282d' };
  if (t.amenity === 'fuel')          return { category: 'fuel',   emoji: '⛽', color: '#4a4a4a' };
  if (['school', 'kindergarten', 'college', 'university'].includes(t.amenity))
    return { category: 'school', emoji: '🏫', color: '#555555' };
  if (['hospital', 'clinic', 'pharmacy', 'doctors'].includes(t.amenity))
    return { category: 'health', emoji: '🏥', color: '#b3282d' };
  if (t.amenity === 'marketplace' || t.shop)
    return { category: 'shop', emoji: '🛒', color: '#7a5c28' };
  if (['resort', 'park', 'pitch', 'sports_centre', 'stadium', 'garden'].includes(t.leisure))
    return { category: 'leisure', emoji: '🌳', color: '#3f7d3f' };
  if (t.man_made === 'tower' || t.tower)
    return { category: 'tower', emoji: '🗼', color: '#5a5044' };
  if (['village', 'hamlet', 'town', 'suburb', 'locality'].includes(t.place))
    return { category: 'place', emoji: '🏘️', color: '#6b5a3a' };
  return null;
}

function nameOf(t) {
  return (t['name:sq'] || t.name || t['name:en'] || '').trim();
}

// ── Overpass query + fetch (with endpoint fallback) ─────────────────
function buildQuery() {
  const R = Math.round(RADIUS_KM * 1000);
  const A = `(around:${R},${PALC.lat},${PALC.lng})`;
  const filters = [
    'node["tourism"]', 'way["tourism"]',
    'node["historic"]', 'way["historic"]',
    'node["natural"~"peak|spring|waterfall|cave_entrance|water"]',
    'way["natural"~"water"]',
    'node["amenity"~"restaurant|cafe|bar|fast_food|pub|fuel|place_of_worship|school|kindergarten|hospital|clinic|pharmacy|doctors|marketplace|ferry_terminal"]',
    'way["amenity"~"place_of_worship|school|hospital|marketplace"]',
    'node["leisure"]', 'way["leisure"]',
    'node["man_made"~"pier|tower"]', 'way["man_made"~"pier"]',
    'node["waterway"="ferry"]', 'way["route"="ferry"]',
    'node["place"~"village|hamlet|town|suburb|locality"]',
  ];
  const body = filters.map(f => `  ${f}${A};`).join('\n');
  return `[out:json][timeout:90];\n(\n${body}\n);\nout center tags;`;
}

async function runOverpass(query) {
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      process.stdout.write(`→ Querying Overpass: ${url}\n`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      lastErr = e;
      console.warn(`  ! ${url} failed (${e.message}), trying next…`);
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

// ── Map OSM elements → Place docs ───────────────────────────────────
function toPlaces(elements) {
  const byId = new Map();
  // Collapse the same real place mapped twice (e.g. an OSM node AND an area with
  // the same name a few metres apart). Nodes come first in Overpass output, so
  // the more precise node wins.
  const seen = new Set();
  for (const el of elements) {
    const tags = el.tags || {};
    const name = nameOf(tags);
    if (!name) continue;                     // skip unnamed — keeps the map clean
    const cls = classify(tags);
    if (!cls) continue;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    // ~110 m grid: same name within one cell is treated as one landmark.
    const dedupeKey = `${name.toLowerCase()}@${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const id = `osm_${el.type}_${el.id}`;
    byId.set(id, {
      id,
      name,
      category: cls.category,
      emoji: cls.emoji,
      color: cls.color,
      rank: PRIORITY[cls.category] ?? 99,
      lat: +lat.toFixed(6),
      lng: +lng.toFixed(6),
      osmId: el.id,
      osmType: el.type,
      source: 'osm',
    });
  }
  return [...byId.values()];
}

// ── Firestore writes ────────────────────────────────────────────────
async function clearCollection(db) {
  const snap = await db.collection(COLLECTION).get();
  if (snap.empty) return 0;
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = db.batch();
    snap.docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
    await batch.commit();
    n += Math.min(450, snap.docs.length - i);
  }
  return n;
}

async function writePlaces(db, places) {
  let written = 0;
  for (let i = 0; i < places.length; i += 450) {
    const batch = db.batch();
    for (const p of places.slice(i, i + 450)) {
      batch.set(db.collection(COLLECTION).doc(p.id), p, { merge: true });
    }
    await batch.commit();
    written += Math.min(450, places.length - i);
    process.stdout.write(`  …wrote ${written}/${places.length}\n`);
  }
  return written;
}

// ── Main ────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n🏔  Palç landmark importer`);
  console.log(`   centre: ${PALC.lat}, ${PALC.lng}   radius: ${RADIUS_KM} km   collection: "${COLLECTION}"`);
  if (DRY_RUN) console.log(`   (dry run — nothing will be written)\n`);

  const elements = await runOverpass(buildQuery());
  console.log(`✓ Overpass returned ${elements.length} raw elements`);

  const osmAll = toPlaces(elements);
  const custom = loadCustomPlaces();
  // Drop any OSM entry that duplicates a curated place (same name + area).
  const customKeys = new Set(custom.map(c => `${c.name.toLowerCase()}@${c.lat.toFixed(3)},${c.lng.toFixed(3)}`));
  const osmFiltered = osmAll.filter(p => !customKeys.has(`${p.name.toLowerCase()}@${p.lat.toFixed(3)},${p.lng.toFixed(3)}`));
  const osmCapped = rankAndCap(osmFiltered, Math.max(0, MAX_PLACES - custom.length));
  const places = [...custom, ...osmCapped];
  console.log(`✓ ${osmAll.length} from OSM + ${custom.length} curated → keeping ${places.length} landmarks\n`);

  // Category breakdown
  const byCat = places.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {});
  Object.entries(byCat).sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`   ${String(n).padStart(4)}  ${c}`));
  console.log('');

  if (DRY_RUN) {
    console.log('Sample:');
    places.slice(0, 12).forEach(p => console.log(`   ${p.emoji}  ${p.name}  (${p.category})  ${p.lat},${p.lng}`));
    console.log(`\nDry run complete — ${places.length} landmarks would be written.\n`);
    process.exit(0);
  }

  const db = initFirebase();
  if (CLEAR) {
    const removed = await clearCollection(db);
    console.log(`🧹 Cleared ${removed} existing docs from "${COLLECTION}"`);
  }
  const written = await writePlaces(db, places);
  console.log(`\n✅ Done — ${written} landmarks in "${COLLECTION}".\n`);
  process.exit(0);
})().catch(err => {
  console.error('\n✖ Import failed:', err);
  process.exit(1);
});
