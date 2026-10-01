import { type BessSystem, type OdooConfig, type SalesPoint } from "@shared/schema";

const API_BASE = "/api";

export async function testOdooConnection() {
  const response = await fetch(`${API_BASE}/odoo/test-connection`, {
    method: "POST",
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.message || "Connection test failed");
  }
  
  return data;
}

export async function syncFromOdoo() {
  const response = await fetch(`${API_BASE}/odoo/sync`, {
    method: "POST",
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to sync from Odoo");
  }
  
  return response.json();
}

export async function getSalesPoints(): Promise<{
  source: "odoo" | "fallback";
  salesPoints: SalesPoint[];
  warning?: string;
}> {
  const response = await fetch(`${API_BASE}/sales-points`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch sales points");
  }
  return data;
}

// BESS Systems API
export async function getBessSystems(): Promise<BessSystem[]> {
  const response = await fetch(`${API_BASE}/systems`);
  
  if (!response.ok) {
    throw new Error("Failed to fetch BESS systems");
  }
  
  return response.json();
}

export async function createBessSystem(system: Omit<BessSystem, "id" | "lastSync">) {
  const response = await fetch(`${API_BASE}/systems`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(system),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to create system");
  }
  
  return response.json();
}
