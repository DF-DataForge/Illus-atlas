import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SalesPoint } from "@shared/schema";

type Coordinates = { latitude: number; longitude: number };
type CacheEntry = { expiresAt: number; coordinates: Coordinates | null };
type PhotonFeature = {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: { street?: string; housenumber?: string; postcode?: string; country?: string; countrycode?: string };
};

const normalize = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeHouse = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "").replace(/[–—]/g, "-");
const countryAliases: Record<string, string> = {
  belgium: "be", belgie: "be", belgique: "be", belgien: "be",
  netherlands: "nl", nederland: "nl", paysbas: "nl",
  france: "fr", frankrijk: "fr", frankreich: "fr",
  germany: "de", duitsland: "de", deutschland: "de", allemagne: "de",
};
const normalizeCountry = (value: string) => countryAliases[normalize(value)] || normalize(value);

function parseStreet(value: string): { street: string; house: string } | null {
  const housePattern = "(\\d+\\s*[a-z]?(?:\\s*[/-]\\s*\\d+[a-z]?)?)";
  const suffix = value.trim().match(new RegExp(`^(.*?)\\s+${housePattern}$`, "i"));
  if (suffix && suffix[1].trim()) return { street: suffix[1], house: suffix[2] };
  const prefix = value.trim().match(new RegExp(`^${housePattern}\\s+(.+)$`, "i"));
  if (prefix) return { street: prefix[2], house: prefix[1] };
  return null;
}

export function hasCoordinates(point: Coordinates): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
    && !(point.latitude === 0 && point.longitude === 0);
}

export function buildAddressQuery(point: SalesPoint): string | null {
  if (!point.street.trim() || !point.country.trim() || (!point.zip.trim() && !point.city.trim())) return null;
  // Odoo sometimes stores the postal code in both zip and city.
  const city = point.city.replace(/^\s*\d{4,6}\s+/, "").trim();
  return [point.street.trim(), point.zip.trim(), city, point.country.trim()].filter(Boolean).join(", ");
}

function matchingCoordinates(feature: PhotonFeature, point: SalesPoint): Coordinates | null {
  const properties = feature.properties;
  const coords = feature.geometry?.coordinates;
  if (feature.geometry?.type !== "Point" || !coords || coords.length < 2 || !properties) return null;
  const coordinates = { longitude: coords[0], latitude: coords[1] };
  if (!hasCoordinates(coordinates)) return null;
  if (point.zip && normalize(properties.postcode || "") !== normalize(point.zip)) return null;
  const requestedCountry = normalizeCountry(point.country);
  if (normalizeCountry(properties.country || "") !== requestedCountry
    && normalize(properties.countrycode || "") !== requestedCountry) return null;
  const address = parseStreet(point.street);
  // Unsupported or numberless addresses fail closed; never use a town/street centroid.
  if (!address) return null;
  if (normalizeHouse(properties.housenumber || "") !== normalizeHouse(address.house)) return null;
  if (normalize(properties.street || "") !== normalize(address.street)) return null;
  return coordinates;
}

export function createGeocoder(options: {
  fetchImpl?: typeof fetch;
  cacheFile?: string | null;
  requestIntervalMs?: number;
  fetchTimeoutMs?: number;
  enrichmentTimeoutMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheFile = options.cacheFile === undefined
    ? process.env.GEOCODING_CACHE_FILE || ".cache/geocoding.json"
    : options.cacheFile;
  const interval = options.requestIntervalMs ?? 1100;
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<Coordinates | null>>();
  let queue = Promise.resolve();
  let lastStarted = 0;
  let providerBlockedUntil = 0;
  let loaded: Promise<void> | undefined;

  async function loadCache() {
    if (!cacheFile) return;
    try {
      const entries: Record<string, CacheEntry> = JSON.parse(await readFile(cacheFile, "utf8"));
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.expiresAt > Date.now() && (entry.coordinates === null || hasCoordinates(entry.coordinates))) {
          cache.set(key, entry);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[Geocoding] Could not read persisted cache; using in-memory cache.");
      }
    }
  }

  async function persistCache() {
    if (!cacheFile) return;
    cache.forEach((entry, key) => { if (entry.expiresAt <= Date.now()) cache.delete(key); });
    while (cache.size > 1000) cache.delete(cache.keys().next().value!);
    try {
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(`${cacheFile}.tmp`, JSON.stringify(Object.fromEntries(cache)), { mode: 0o600 });
      await rename(`${cacheFile}.tmp`, cacheFile);
    } catch {
      console.warn("[Geocoding] Could not persist cache; results remain cached in memory.");
    }
  }

  async function locate(point: SalesPoint, deadline: number): Promise<Coordinates | null> {
    const query = buildAddressQuery(point);
    if (!query || !parseStreet(point.street)) return null;
    loaded ??= loadCache();
    await loaded;
    const endpoint = process.env.GEOCODING_URL || "https://photon.komoot.io/api/";
    const key = createHash("sha256").update(`photon-house-v2:${endpoint}:${query.toLowerCase()}`).digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.coordinates;
    const existing = pending.get(key);
    if (existing) return existing;

    const lookup = queue.then(async () => {
      if (Date.now() >= deadline || Date.now() < providerBlockedUntil) return null;
      let coordinates: Coordinates | null = null;
      let ttl = 60 * 60 * 1000;
      try {
        const wait = interval - (Date.now() - lastStarted);
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, Math.min(wait, Math.max(0, deadline - Date.now()))));
        if (Date.now() >= deadline || Date.now() < providerBlockedUntil) return null;
        lastStarted = Date.now();
        const url = new URL(endpoint);
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "3");
        url.searchParams.set("lang", "en");
        const response = await fetchImpl(url, {
          headers: { "User-Agent": "VerkooppuntenMap/1.0 (server-side address geocoding)", Accept: "application/json" },
          signal: AbortSignal.timeout(Math.max(1, Math.min(options.fetchTimeoutMs ?? 4000, deadline - Date.now()))),
        });
        if (!response.ok) throw new Error(`Geocoder HTTP ${response.status}`);
        const data = await response.json() as { features?: PhotonFeature[] };
        if (!Array.isArray(data.features)) throw new Error("Invalid geocoder response");
        coordinates = data.features.map(feature => matchingCoordinates(feature, point)).find(Boolean) ?? null;
        if (coordinates) ttl = 30 * 24 * 60 * 60 * 1000;
      } catch (error) {
        ttl = 5 * 60 * 1000;
        // One failed provider request must not stall an entire contact directory.
        providerBlockedUntil = Date.now() + 60 * 1000;
        console.warn(`[Geocoding] Contact ${point.id}: lookup failed (${error instanceof Error ? error.message : "unknown error"}).`);
      }
      cache.set(key, { coordinates, expiresAt: Date.now() + ttl });
      await persistCache();
      return coordinates;
    });
    queue = lookup.then(() => undefined, () => undefined);
    pending.set(key, lookup);
    try {
      return await lookup;
    } finally {
      pending.delete(key);
    }
  }

  return async (points: SalesPoint[]): Promise<{ salesPoints: SalesPoint[]; warning?: string }> => {
    const deadline = Date.now() + (options.enrichmentTimeoutMs ?? 6000);
    const salesPoints = await Promise.all(points.map(async point => {
      if (hasCoordinates(point)) return point;
      const coordinates = await locate(point, deadline);
      return coordinates ? { ...point, ...coordinates } : point;
    }));
    const unresolved = salesPoints.filter(point => !hasCoordinates(point)).length;
    return {
      salesPoints,
      ...(unresolved ? { warning: `${unresolved} verkooppunt(en): geen betrouwbare kaartcoördinaten beschikbaar; controleer het adres of vul coördinaten in Odoo in.` } : {}),
    };
  };
}

export const geocodeSalesPoints = createGeocoder();