import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBessSystemSchema } from "@shared/schema";
import { createOdooClient } from "./odoo-client";
import { getOdooConfigFromEnvironment } from "./odoo-config";
import { geocodeSalesPoints } from "./geocoding";
import { z } from "zod";
import type { SalesPoint } from "@shared/schema";

const fallbackSalesPoints: SalesPoint[] = [
  { id: 1, name: "Objet Trouve", street: "Zeewindstraat 4", zip: "8300", city: "Knokke", country: "Belgium", website: "https://objettrouve.be", latitude: 51.3559105, longitude: 3.3030539 },
  { id: 2, name: "Items – Bea Mombaers", street: "Kustlaan 289", zip: "8300", city: "Knokke", country: "Belgium", latitude: 51.3558075, longitude: 3.3041284 },
  { id: 3, name: "Torp", street: "Nieuwpoortsteenweg 68", zip: "8670", city: "Koksijde", country: "Belgium", latitude: 51.1174625, longitude: 2.6929782 },
  { id: 4, name: "Dupont Sanitair", street: "Oudenaardsesteenweg 266", zip: "8500", city: "Kortrijk", country: "Belgium", latitude: 50.820213, longitude: 3.2904197 },
  { id: 5, name: "Objet Trouve", street: "Tacklaan 2", zip: "8500", city: "Kortrijk", country: "Belgium", latitude: 50.8237908, longitude: 3.2674764 },
  { id: 6, name: "Holvoet Design", street: "Oudenaardseweg 269", zip: "8500", city: "Kortrijk", country: "Belgium", latitude: 50.8246, longitude: 3.2713 },
  { id: 7, name: "Geraldine Van Heuverswyn", street: "Gentsesteenweg 20", zip: "9750", city: "Zingem", country: "Belgium", latitude: 50.9047, longitude: 3.6532 },
  { id: 8, name: "Classo", street: "Antwerpsesteenweg 97", zip: "9080", city: "Lochristi", country: "Belgium", latitude: 51.0879369, longitude: 3.8074228 },
  { id: 9, name: "Fierens keuken en interieur", street: "Brusselsesteenweg 740", zip: "1731", city: "Zellik", country: "Belgium", latitude: 50.8826425, longitude: 4.276766 },
  { id: 10, name: "Moka Tales", street: "Aldestraat 45", zip: "3500", city: "Hasselt", country: "Belgium", latitude: 50.9306222, longitude: 5.335277 },
  { id: 11, name: "La Quincaillerie", street: "4, 7, 15 Boulevard Saint-Germain", zip: "75005", city: "Paris", country: "France", latitude: 48.8493326, longitude: 2.3537214 },
  { id: 12, name: "Maison Amanes", street: "Zone Artisanale du D559, Gourbenet", zip: "83420", city: "La Croix-Valmer", country: "France", latitude: 43.2138745, longitude: 6.5692044 },
  { id: 13, name: "ROOMSERVICE", street: "Lehmweg 56", zip: "20251", city: "Hamburg", country: "Germany", latitude: 53.5832959, longitude: 9.9807269 },
  { id: 14, name: "Baden Baden", street: "Valkenburgerstraat 201a", zip: "1011 MJ", city: "Amsterdam", country: "Netherlands", latitude: 52.3689747, longitude: 4.9058939 },
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Local liveness check: does not query Odoo, geocoding, or PostgreSQL.
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok" });
  });
  
  // Odoo Configuration Routes

  app.get("/api/sales-points", async (_req, res) => {
    try {
      const config = getOdooConfigFromEnvironment();
      const client = await createOdooClient(config);
      const salesPoints = await client.fetchSalesPoints();
      const enriched = await geocodeSalesPoints(salesPoints);
      res.json({ source: "odoo", ...enriched });
    } catch (error) {
      console.error("Error fetching Odoo sales points:", error);
      res.json({
        source: "fallback",
        salesPoints: fallbackSalesPoints,
        warning: "Odoo is currently unavailable; showing PDF sales points.",
      });
    }
  });
  
  // Report safe Odoo backend configuration metadata; never return credentials.
  app.get("/api/odoo/config", (_req, res) => {
    try {
      const config = getOdooConfigFromEnvironment();
      res.json({ url: config.url, database: config.database, configured: true, source: "backend" });
    } catch (error) {
      console.error("Error fetching Odoo config:", error);
      res.status(503).json({ message: "Odoo is not fully configured on the server." });
    }
  });
  
  // Credentials are managed only through server environment variables/secrets.
  app.post("/api/odoo/config", (_req, res) => {
    res.status(405).json({ message: "Configure Odoo through the server environment, not through the app." });
  });

  app.patch("/api/odoo/config/target", (_req, res) => {
    res.status(405).json({ message: "Configure Odoo through the server environment, not through the app." });
  });
  
  // POST test Odoo connection
  app.post("/api/odoo/test-connection", async (req, res) => {
    try {
      const config = getOdooConfigFromEnvironment();
      const client = await createOdooClient(config);
      const result = await client.testConnection();
      
      if (result.success) {
        res.json({ success: true, message: "Successfully connected to Odoo" });
      } else {
        res.status(400).json({ success: false, message: result.error || "Failed to connect to Odoo. Please check credentials." });
      }
    } catch (error) {
      console.error("Error testing Odoo connection:", error);
      res.status(500).json({ success: false, message: "Connection test failed" });
    }
  });
  
  // POST sync BESS systems from Odoo
  app.post("/api/odoo/sync", async (req, res) => {
    try {
      const config = getOdooConfigFromEnvironment();
      const client = await createOdooClient(config);
      const odooSystems = await client.fetchBessSystems();
      
      // Transform Odoo records to our schema
      const systems = odooSystems.map(record => ({
        odooId: record.id,
        externalId: `ODOO-${record.id}`,
        name: record.name,
        location: record.location,
        latitude: record.latitude,
        longitude: record.longitude,
        type: record.system_type.toUpperCase(),
        status: record.status,
        capacity: record.capacity_mwh,
        power: record.power_mw,
        soc: record.state_of_charge,
        health: record.state_of_health,
        temperature: record.temperature,
        acRatedPower: record.acRatedPower,
        acMaxPower: record.acMaxPower,
        acGridType: record.acGridType,
        acThdi: record.acThdi,
        acRatedGridVoltage: record.acRatedGridVoltage,
        acGridFreqMin: record.acGridFreqMin,
        acGridFreqMax: record.acGridFreqMax,
        dcRatedVoltage: record.dcRatedVoltage,
        dcVoltageRangeMin: record.dcVoltageRangeMin,
        dcVoltageRangeMax: record.dcVoltageRangeMax,
        dcRatedCapacity: record.dcRatedCapacity,
        dcRatedEnergy: record.dcRatedEnergy,
        chargeDischargeRate: record.chargeDischargeRate,
        degreeOfProtection: record.degreeOfProtection,
        operationTempMin: record.operationTempMin,
        operationTempMax: record.operationTempMax,
        storageTempMin: record.storageTempMin,
        storageTempMax: record.storageTempMax,
        altitude: record.altitude,
        relativeHumidity: record.relativeHumidity,
        coolingMethod: record.coolingMethod,
        fireSuppressionSystem: record.fireSuppressionSystem,
        communication: record.communication,
        dimensionLength: record.dimensionLength,
        dimensionWidth: record.dimensionWidth,
        dimensionHeight: record.dimensionHeight,
        weight: record.weight,
        warranty: record.warranty,
        batteryType: record.batteryType,
        imageUrls: record.imageUrls,
      }));
      
      await storage.syncBessSystems(systems);
      
      res.json({ 
        success: true, 
        message: `Successfully synced ${systems.length} systems from Odoo`,
        count: systems.length 
      });
    } catch (error) {
      console.error("Error syncing from Odoo:", error);
      res.status(500).json({ message: "Failed to sync data from Odoo" });
    }
  });
  
  // GET raw Odoo fields (debug endpoint)
  app.get("/api/odoo/fields", async (req, res) => {
    try {
      const config = getOdooConfigFromEnvironment();
      const client = await createOdooClient(config);
      const fields = await client.getModelFields('battery.system');
      
      res.json(fields);
    } catch (error) {
      console.error("Error fetching Odoo fields:", error);
      res.status(500).json({ message: "Failed to fetch fields from Odoo" });
    }
  });
  
  // GET raw Odoo battery system data (debug endpoint)
  app.get("/api/odoo/raw-systems", async (req, res) => {
    try {
      const config = getOdooConfigFromEnvironment();
      const client = await createOdooClient(config);
      const rawData = await client.fetchRawBessSystems();
      
      res.json(rawData);
    } catch (error) {
      console.error("Error fetching raw Odoo data:", error);
      res.status(500).json({ message: "Failed to fetch raw data from Odoo" });
    }
  });
  
  // BESS Systems Routes
  
  // GET all BESS systems
  app.get("/api/systems", async (req, res) => {
    try {
      const systems = await storage.getAllBessSystems();
      res.json(systems);
    } catch (error) {
      console.error("Error fetching systems:", error);
      res.status(500).json({ message: "Failed to fetch systems" });
    }
  });
  
  // POST create/update BESS system
  app.post("/api/systems", async (req, res) => {
    try {
      const validatedData = insertBessSystemSchema.parse(req.body);
      const system = await storage.upsertBessSystem(validatedData);
      res.json(system);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid system data", errors: error.errors });
      }
      console.error("Error creating/updating system:", error);
      res.status(500).json({ message: "Failed to save system" });
    }
  });

  return httpServer;
}
