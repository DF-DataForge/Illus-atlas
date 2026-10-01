import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const odooConfig = pgTable("odoo_config", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  database: text("database").notNull(),
  username: text("username").notNull(),
  apiKey: text("api_key").notNull(),
  isActive: integer("is_active").notNull().default(1),
  lastTested: timestamp("last_tested"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bessSystems = pgTable("bess_systems", {
  id: serial("id").primaryKey(),
  odooId: integer("odoo_id").unique(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  capacity: doublePrecision("capacity").notNull(),
  power: doublePrecision("power").notNull(),
  soc: doublePrecision("soc").notNull(),
  health: doublePrecision("health").notNull(),
  temperature: doublePrecision("temperature").notNull(),
  acRatedPower: integer("ac_rated_power"),
  acMaxPower: integer("ac_max_power"),
  acGridType: text("ac_grid_type"),
  acThdi: text("ac_thdi"),
  acRatedGridVoltage: integer("ac_rated_grid_voltage"),
  acGridFreqMin: integer("ac_grid_freq_min"),
  acGridFreqMax: integer("ac_grid_freq_max"),
  dcRatedVoltage: integer("dc_rated_voltage"),
  dcVoltageRangeMin: integer("dc_voltage_range_min"),
  dcVoltageRangeMax: integer("dc_voltage_range_max"),
  dcRatedCapacity: integer("dc_rated_capacity"),
  dcRatedEnergy: integer("dc_rated_energy"),
  chargeDischargeRate: doublePrecision("charge_discharge_rate"),
  degreeOfProtection: text("degree_of_protection"),
  operationTempMin: integer("operation_temp_min"),
  operationTempMax: integer("operation_temp_max"),
  storageTempMin: integer("storage_temp_min"),
  storageTempMax: integer("storage_temp_max"),
  altitude: text("altitude"),
  relativeHumidity: text("relative_humidity"),
  coolingMethod: text("cooling_method"),
  fireSuppressionSystem: text("fire_suppression_system"),
  communication: text("communication"),
  dimensionLength: integer("dimension_length"),
  dimensionWidth: integer("dimension_width"),
  dimensionHeight: integer("dimension_height"),
  weight: doublePrecision("weight"),
  warranty: text("warranty"),
  batteryType: text("battery_type"),
  imageUrls: text("image_urls").array(),
  lastSync: timestamp("last_sync").defaultNow().notNull(),
});

// Insert schemas
export const insertOdooConfigSchema = createInsertSchema(odooConfig).omit({
  id: true,
  createdAt: true,
});

export const insertBessSystemSchema = createInsertSchema(bessSystems).omit({
  id: true,
  lastSync: true,
});

// Types
export type InsertOdooConfig = z.infer<typeof insertOdooConfigSchema>;
export type OdooConfig = typeof odooConfig.$inferSelect;
export type InsertBessSystem = z.infer<typeof insertBessSystemSchema>;
export type BessSystem = typeof bessSystems.$inferSelect;

export interface SalesPoint {
  id: number;
  name: string;
  street: string;
  street2?: string;
  zip: string;
  city: string;
  country: string;
  phone?: string;
  email?: string;
  website?: string;
  latitude: number;
  longitude: number;
}
