# Palç map data scripts

## `import-places.mjs` — fill the map with landmarks around Palç

Pulls every **named** point of interest within a radius of the village (the
Koman ferry **port**, guesthouses/hotels, mountain peaks, springs, churches,
restaurants, schools, viewpoints…) from **OpenStreetMap's Overpass API** —
free, legal, and the same data the map already renders — and writes them to the
Firestore **`places`** collection. Each landmark shows on the map as a
Google-style category pin (icon + name).

> **Why not Google Maps?** Scraping Google's map data breaks their Terms of
> Service, needs a paid API key, and stops working whenever they change their
> markup. OpenStreetMap is open data, so this stays free and reproducible.

### One-time setup

```bash
npm install                       # firebase-admin is already in devDependencies
```

Get an admin key:
1. Firebase console → **Project settings → Service accounts**
2. **Generate new private key**
3. Save it as **`scripts/serviceAccountKey.json`** (already git-ignored)
   - or set `GOOGLE_APPLICATION_CREDENTIALS` to its full path

### Run

```bash
npm run import:places              # import landmarks (default 12 km radius)

# or with options:
node scripts/import-places.mjs --dry-run    # preview only, writes nothing
node scripts/import-places.mjs --clear      # wipe `places` first, then import
RADIUS_KM=20 node scripts/import-places.mjs # widen the search radius
COLLECTION=places node scripts/import-places.mjs
```

Re-running is **safe** — every landmark has a deterministic id
(`osm_<type>_<id>`), so it updates in place instead of creating duplicates.

### Switching Firebase projects later

Just drop in the new project's `serviceAccountKey.json` and run it again.
Nothing else changes — that's the whole point.

### Firestore rule

The app reads `places` publicly; only this admin script writes them (the Admin
SDK bypasses rules). Add to your rules:

```
match /places/{placeId} {
  allow read: if true;
  allow write: if isAdmin();
}
```
