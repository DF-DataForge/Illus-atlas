import type { OdooConfig } from "@shared/schema";

export function getOdooConfigFromEnvironment(): OdooConfig {
  const url = process.env.ODOO_URL?.trim();
  const database = process.env.ODOO_DATABASE?.trim();
  const username = process.env.ODOO_USERNAME?.trim();
  const password = process.env.ODOO_PASSWORD;

  const missing = [
    !url && "ODOO_URL",
    !database && "ODOO_DATABASE",
    !username && "ODOO_USERNAME",
    !password && "ODOO_PASSWORD",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing Odoo backend configuration: ${missing.join(", ")}`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url!);
  } catch {
    throw new Error("ODOO_URL must be a valid absolute URL.");
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("ODOO_URL must use HTTP or HTTPS.");
  }

  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
  if (parsedUrl.pathname.toLowerCase() === "/odoo") parsedUrl.pathname = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return {
    id: -1,
    url: parsedUrl.toString().replace(/\/$/, ""),
    database: database!,
    username: username!,
    apiKey: password!,
    isActive: 1,
    lastTested: null,
    createdAt: new Date(),
  };
}