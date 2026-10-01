import test from "node:test";
import assert from "node:assert/strict";
import { OdooClient } from "./odoo-client";
import { getOdooConfigFromEnvironment } from "./odoo-config";
import type { OdooConfig } from "@shared/schema";

const config: OdooConfig = {
  id: -1, url: "https://odoo.example.com/", database: "db", username: "api@example.com",
  apiKey: "secret-key", isActive: 1, lastTested: null, createdAt: new Date(),
};

function mockFetch(handler: (body: any) => unknown) {
  const calls: { url: string; body: any }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    return new Response(JSON.stringify(handler(body)), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("authenticates with the API key on /jsonrpc and reuses the uid for execute_kw", async () => {
  const m = mockFetch((body) => body.params.service === "common"
    ? { jsonrpc: "2.0", id: body.id, result: 7 }
    : { jsonrpc: "2.0", id: body.id, result: [{ id: 1, name: "Shop", partner_latitude: 50, partner_longitude: 4 }] });
  try {
    const points = await new OdooClient(config).fetchSalesPoints();
    assert.equal(points.length, 1);
    assert.equal(m.calls.length, 2);
    assert.ok(m.calls.every((c) => c.url === "https://odoo.example.com/jsonrpc"));
    assert.deepEqual(m.calls[0].body.params.args, ["db", "api@example.com", "secret-key", {}]);
    const [db, uid, key, model, method] = m.calls[1].body.params.args;
    assert.deepEqual([db, uid, key, model, method], ["db", 7, "secret-key", "res.partner", "search_read"]);
  } finally { m.restore(); }
});

test("rejected credentials are reported as an authentication failure", async () => {
  const m = mockFetch((body) => ({ jsonrpc: "2.0", id: body.id, result: false }));
  try {
    const result = await new OdooClient(config).testConnection();
    assert.equal(result.success, false);
    await assert.rejects(new OdooClient(config).fetchSalesPoints(), /Invalid Odoo username or API key/);
  } finally { m.restore(); }
});

test("ODOO_API_KEY is preferred over the ODOO_PASSWORD fallback", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { ODOO_URL: "https://o.example.com", ODOO_DATABASE: "d", ODOO_USERNAME: "u",
      ODOO_API_KEY: "key", ODOO_PASSWORD: "pw" });
    assert.equal(getOdooConfigFromEnvironment().apiKey, "key");
    delete process.env.ODOO_API_KEY;
    assert.equal(getOdooConfigFromEnvironment().apiKey, "pw");
    delete process.env.ODOO_PASSWORD;
    assert.throws(() => getOdooConfigFromEnvironment(), /ODOO_API_KEY/);
  } finally { process.env = saved; }
});
