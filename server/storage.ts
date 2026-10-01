import { 
  type User, 
  type InsertUser,
  type OdooConfig,
  type InsertOdooConfig,
  type BessSystem,
  type InsertBessSystem,
  users,
  odooConfig,
  bessSystems,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, desc } from "drizzle-orm";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Odoo Config methods
  getActiveOdooConfig(): Promise<OdooConfig | undefined>;
  saveOdooConfig(config: InsertOdooConfig): Promise<OdooConfig>;
  updateActiveOdooTarget(target: { url: string; database: string }): Promise<OdooConfig | undefined>;
  updateOdooConfigLastTested(id: number): Promise<void>;
  
  // BESS Systems methods
  getAllBessSystems(): Promise<BessSystem[]>;
  getBessSystemByExternalId(externalId: string): Promise<BessSystem | undefined>;
  upsertBessSystem(system: InsertBessSystem): Promise<BessSystem>;
  syncBessSystems(systems: InsertBessSystem[]): Promise<void>;
}

// Presentational city reassignment so projects are spread across Belgium.
// Applied at read time so it works in every environment (the production
// database still holds the original clustered locations, and an Odoo
// re-sync would overwrite manual data edits).
const LOCATION_OVERRIDES: Record<number, { location: string; latitude: number; longitude: number }> = {
  2: { location: "Aalter, Belgium", latitude: 51.0906, longitude: 3.447 },
  3: { location: "Gent, Belgium", latitude: 51.0543, longitude: 3.7174 },
  4: { location: "Mechelen, Belgium", latitude: 51.0259, longitude: 4.4776 },
  7: { location: "Brugge, Belgium", latitude: 51.2093, longitude: 3.2247 },
  9: { location: "Antwerpen, Belgium", latitude: 51.2194, longitude: 4.4025 },
  10: { location: "Hasselt, Belgium", latitude: 50.9307, longitude: 5.3378 },
  11: { location: "Leuven, Belgium", latitude: 50.8796, longitude: 4.7009 },
  12: { location: "Oostende, Belgium", latitude: 51.2154, longitude: 2.9286 },
  13: { location: "Knokke, Belgium", latitude: 51.3496, longitude: 3.287 },
  14: { location: "Genk, Belgium", latitude: 50.965, longitude: 5.5 },
};

const withLocationOverride = (system: BessSystem): BessSystem => {
  const override = LOCATION_OVERRIDES[system.id];
  return override ? { ...system, ...override } : system;
};

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  // Odoo Config methods
  async getActiveOdooConfig(): Promise<OdooConfig | undefined> {
    const result = await db
      .select()
      .from(odooConfig)
      .where(eq(odooConfig.isActive, 1))
      .orderBy(desc(odooConfig.createdAt))
      .limit(1);
    return result[0];
  }

  async saveOdooConfig(config: InsertOdooConfig): Promise<OdooConfig> {
    // Deactivate all existing configs
    await db.update(odooConfig).set({ isActive: 0 });
    
    // Insert new config as active
    const result = await db.insert(odooConfig).values(config).returning();
    return result[0];
  }

  async updateActiveOdooTarget(target: { url: string; database: string }): Promise<OdooConfig | undefined> {
    const active = await this.getActiveOdooConfig();
    if (!active) return undefined;
    const result = await db
      .update(odooConfig)
      .set({ ...target, lastTested: null })
      .where(eq(odooConfig.id, active.id))
      .returning();
    return result[0];
  }

  async updateOdooConfigLastTested(id: number): Promise<void> {
    await db
      .update(odooConfig)
      .set({ lastTested: new Date() })
      .where(eq(odooConfig.id, id));
  }

  // BESS Systems methods
  async getAllBessSystems(): Promise<BessSystem[]> {
    const rows = await db.select().from(bessSystems);
    return rows.map(withLocationOverride);
  }

  async getBessSystemByExternalId(externalId: string): Promise<BessSystem | undefined> {
    const result = await db
      .select()
      .from(bessSystems)
      .where(eq(bessSystems.externalId, externalId));
    return result[0];
  }

  async upsertBessSystem(system: InsertBessSystem): Promise<BessSystem> {
    const existing = await this.getBessSystemByExternalId(system.externalId);
    
    if (existing) {
      const result = await db
        .update(bessSystems)
        .set({ ...system, lastSync: new Date() })
        .where(eq(bessSystems.externalId, system.externalId))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(bessSystems).values(system).returning();
      return result[0];
    }
  }

  async syncBessSystems(systems: InsertBessSystem[]): Promise<void> {
    for (const system of systems) {
      await this.upsertBessSystem(system);
    }
  }
}

export const storage = new DatabaseStorage();
