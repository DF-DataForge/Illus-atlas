import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAddressQuery, createGeocoder, hasCoordinates } from "./geocoding";
import type { SalesPoint } from "@shared/schema";

const point: SalesPoint = {
  id: 1, name: "Test verkooppunt", street: "Waregemseweg 32", zip: "9790",
  city: "9790 Wortegem", country: "Belgium", latitude: 0, longitude: 0,
};
const feature = {
  geometry: { type: "Point", coordinates: [3.504929, 50.8540706] },
  properties: { street: "Waregemseweg", housenumber: "32", postcode: "9790", country: "Belgium", countrycode: "BE" },
};
const response = (features: unknown[] = [feature]) =>
  new Response(JSON.stringify({ features }), { headers: { "Content-Type": "application/json" } });

test("address query removes a duplicated postcode and skips incomplete addresses", () => {
  assert.equal(buildAddressQuery(point), "Waregemseweg 32, 9790, Wortegem, Belgium");
  assert.equal(buildAddressQuery({ ...point, street: "" }), null);
});

test("existing Odoo coordinates remain unchanged, including a zero on one axis", async () => {
  const geocode = createGeocoder({ cacheFile: null, fetchImpl: async () => { throw new Error("must not fetch"); } });
  const located = { ...point, latitude: 50, longitude: 0 };
  const result = await geocode([located]);
  assert.equal(result.salesPoints[0], located);
  assert.equal(result.warning, undefined);
  assert.equal(hasCoordinates({ latitude: 91, longitude: 4 }), false);
});

test("missing coordinates are resolved, cached, and shared between concurrent requests", async () => {
  let calls = 0;
  const geocode = createGeocoder({
    cacheFile: null, requestIntervalMs: 0,
    fetchImpl: async (url) => {
      calls++;
      assert.equal(new URL(String(url)).searchParams.get("q"), buildAddressQuery(point));
      return response();
    },
  });
  const [first, second] = await Promise.all([geocode([point]), geocode([point])]);
  assert.equal(calls, 1);
  assert.equal(first.salesPoints[0].latitude, 50.8540706);
  assert.equal(first.salesPoints[0].longitude, 3.504929);
  assert.deepEqual(first, second);
  assert.equal(point.latitude, 0, "original Odoo data must not be mutated");
  await geocode([point]);
  assert.equal(calls, 1);
});

test("an updated address triggers a fresh lookup", async () => {
  let calls = 0;
  const geocode = createGeocoder({ cacheFile: null, requestIntervalMs: 0, fetchImpl: async () => { calls++; return response([]); } });
  await geocode([point]);
  await geocode([{ ...point, street: "Waregemseweg 34" }]);
  assert.equal(calls, 2);
});

test("house, street, and postcode mismatches never generate a marker", async () => {
  for (const properties of [
    { ...feature.properties, housenumber: "30" },
    { ...feature.properties, street: "Andere straat" },
    { ...feature.properties, postcode: "9000" },
    { ...feature.properties, country: "Germany", countrycode: "DE" },
  ]) {
    const geocode = createGeocoder({ cacheFile: null, requestIntervalMs: 0, fetchImpl: async () => response([{ ...feature, properties }]) });
    const result = await geocode([point]);
    assert.equal(result.salesPoints[0].latitude, 0);
    assert.ok(result.warning);
  }
});

test("prefix house numbers are supported and ambiguous addresses fail closed", async () => {
  const geocode = createGeocoder({ cacheFile: null, requestIntervalMs: 0, fetchImpl: async () => response() });
  assert.equal((await geocode([{ ...point, street: "32 Waregemseweg" }])).salesPoints[0].latitude, 50.8540706);
  for (const street of ["Waregemseweg", "Waregemseweg 32 bis"]) {
    const unsupported = createGeocoder({
      cacheFile: null, requestIntervalMs: 0,
      fetchImpl: async () => { assert.fail("ambiguous address must not be looked up"); },
    });
    assert.equal((await unsupported([{ ...point, street }])).salesPoints[0].latitude, 0);
  }
});

test("house number separators are meaningful and cannot match a different house", async () => {
  for (const [requested, actual] of [["12/1", "121"], ["12-14", "1214"]]) {
    const geocode = createGeocoder({
      cacheFile: null, requestIntervalMs: 0,
      fetchImpl: async () => response([{ ...feature, properties: { ...feature.properties, housenumber: actual } }]),
    });
    assert.equal((await geocode([{ ...point, street: `Waregemseweg ${requested}` }])).salesPoints[0].latitude, 0);
  }
});

test("provider outage opens the circuit and promptly retains the whole directory", async () => {
  let calls = 0;
  const geocode = createGeocoder({
    cacheFile: null, requestIntervalMs: 0,
    fetchImpl: async () => { calls++; return new Response("unavailable", { status: 503 }); },
  });
  const points = Array.from({ length: 50 }, (_, i) => ({ ...point, id: i, street: `Waregemseweg ${i + 1}` }));
  const result = await geocode(points);
  assert.equal(calls, 1);
  assert.deepEqual(result.salesPoints, points);
  assert.ok(result.warning);
});

test("enrichment deadline skips queued lookups once the request budget is exhausted", async () => {
  let calls = 0;
  const geocode = createGeocoder({
    cacheFile: null, requestIntervalMs: 0, enrichmentTimeoutMs: 10,
    fetchImpl: async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return response();
    },
  });
  const result = await geocode([point, { ...point, id: 2, street: "Waregemseweg 34" }]);
  assert.equal(calls, 1);
  assert.equal(result.salesPoints[1].latitude, 0);
  assert.ok(result.warning);
});

test("distinct lookups are serialized and throttled", async () => {
  const starts: number[] = [];
  let active = 0;
  const geocode = createGeocoder({
    cacheFile: null, requestIntervalMs: 25,
    fetchImpl: async () => {
      starts.push(Date.now());
      assert.equal(++active, 1);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return response([]);
    },
  });
  await geocode([point, { ...point, id: 2, street: "Waregemseweg 34" }]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 23);
});

test("a slow provider is aborted without delaying every contact", async () => {
  let calls = 0;
  let aborted = false;
  const geocode = createGeocoder({
    cacheFile: null, requestIntervalMs: 0, fetchTimeoutMs: 20, enrichmentTimeoutMs: 100,
    fetchImpl: async (_url, init) => {
      calls++;
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(response()), 1000);
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(timer);
          reject(new Error("Request aborted"));
        }, { once: true });
      });
    },
  });
  const points = Array.from({ length: 50 }, (_, i) => ({ ...point, id: i, street: `Waregemseweg ${i + 1}` }));
  const started = performance.now();
  const result = await geocode(points);
  assert.ok(aborted);
  assert.equal(calls, 1);
  assert.ok(performance.now() - started < 500);
  assert.deepEqual(result.salesPoints, points);
  assert.ok(result.warning);
});

test("empty or failed lookups retain contacts and warn, with failed lookups cached", async () => {
  for (const failure of [response([]), new Response("unavailable", { status: 503 })]) {
    let calls = 0;
    const geocode = createGeocoder({ cacheFile: null, requestIntervalMs: 0, fetchImpl: async () => { calls++; return failure; } });
    const result = await geocode([point]);
    assert.deepEqual(result.salesPoints, [point]);
    assert.ok(result.warning);
    await geocode([point]);
    assert.equal(calls, 1);
  }
});

test("incomplete addresses do not call the external service", async () => {
  let calls = 0;
  const geocode = createGeocoder({ cacheFile: null, fetchImpl: async () => { calls++; return response(); } });
  const result = await geocode([{ ...point, street: "" }]);
  assert.equal(calls, 0);
  assert.ok(result.warning);
});

test("persisted cache survives a geocoder restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sales-geocoding-"));
  try {
    const cacheFile = join(directory, "cache.json");
    await createGeocoder({ cacheFile, requestIntervalMs: 0, fetchImpl: async () => response() })([point]);
    const restarted = createGeocoder({ cacheFile, fetchImpl: async () => { throw new Error("cached address must not fetch"); } });
    const result = await restarted([point]);
    assert.equal(result.salesPoints[0].latitude, 50.8540706);
    assert.equal(result.warning, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});