import { type OdooConfig, type SalesPoint } from "@shared/schema";

export interface OdooBessRecord {
  id: number;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  system_type: string;
  status: string;
  capacity_mwh: number;
  power_mw: number;
  state_of_charge: number;
  state_of_health: number;
  temperature: number;
  acRatedPower?: number;
  acMaxPower?: number;
  acGridType?: string;
  acThdi?: string;
  acRatedGridVoltage?: number;
  acGridFreqMin?: number;
  acGridFreqMax?: number;
  dcRatedVoltage?: number;
  dcVoltageRangeMin?: number;
  dcVoltageRangeMax?: number;
  dcRatedCapacity?: number;
  dcRatedEnergy?: number;
  chargeDischargeRate?: number;
  degreeOfProtection?: string;
  operationTempMin?: number;
  operationTempMax?: number;
  storageTempMin?: number;
  storageTempMax?: number;
  altitude?: string;
  relativeHumidity?: string;
  coolingMethod?: string;
  fireSuppressionSystem?: string;
  communication?: string;
  dimensionLength?: number;
  dimensionWidth?: number;
  dimensionHeight?: number;
  weight?: number;
  warranty?: string;
  batteryType?: string;
  imageUrls?: string[];
}

interface OdooBatterySystemRaw {
  id: number;
  x_studio_title?: string;
  name?: string;
  customer: [number, string] | false;
  product_id?: [number, string] | false; // Product for battery type
  x_studio_status?: string;
  state?: string;
  capacity?: number;
  power?: number;
  soc?: number;
  soh?: number;
  temperature?: number;
}

interface OdooPartnerRaw {
  id: number;
  name: string;
  partner_latitude?: number;
  partner_longitude?: number;
  city?: string;
  country_id?: [number, string] | false;
}

export class OdooClient {
  private config: OdooConfig;
  private uid?: number;

  constructor(config: OdooConfig) {
    this.config = config;
  }

  private normalizeUrl(url: string): string {
    let normalized = url.trim();
    while (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    if (normalized.endsWith('/odoo')) {
      normalized = normalized.slice(0, -5);
    }
    return normalized;
  }

  /**
   * Calls Odoo's external JSON-RPC endpoint (/jsonrpc). Unlike the web-session
   * endpoint, this accepts an Odoo API key in place of the user's password.
   */
  private async jsonRpc(service: string, method: string, args: unknown[]): Promise<any> {
    const baseUrl = this.normalizeUrl(this.config.url);
    const response = await fetch(`${baseUrl}/jsonrpc`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        id: Math.floor(Math.random() * 1000000),
        params: { service, method, args },
      }),
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[Odoo] Non-JSON response (${response.status}): ${text.substring(0, 200)}`);
      throw new Error(
        'Odoo returned a non-JSON response. Make sure ODOO_URL is the base Odoo URL (e.g., https://your-instance.odoo.com) without /odoo or other paths.',
      );
    }

    const data = await response.json();
    if (data.error) {
      console.error(`[Odoo] JSON-RPC error in ${service}.${method}:`, data.error.message);
      throw new Error(data.error.data?.message || data.error.message || 'Odoo API error');
    }
    return data.result;
  }

  async authenticate(): Promise<{ success: boolean; error?: string }> {
    if (this.uid) return { success: true };

    console.log(`[Odoo] Authenticating via ${this.normalizeUrl(this.config.url)}/jsonrpc (database: ${this.config.database})`);
    try {
      const uid = await this.jsonRpc('common', 'authenticate', [
        this.config.database,
        this.config.username,
        this.config.apiKey,
        {},
      ]);

      if (typeof uid === 'number' && uid > 0) {
        this.uid = uid;
        console.log(`[Odoo] Authentication successful. UID: ${uid}`);
        return { success: true };
      }

      console.error('[Odoo] Authentication failed: invalid credentials');
      return { success: false, error: 'Invalid Odoo username or API key' };
    } catch (error) {
      console.error('[Odoo] Authentication error:', error instanceof Error ? error.message : error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    this.uid = undefined;
    return await this.authenticate();
  }

  private async callOdoo(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    if (!this.uid) {
      const authResult = await this.authenticate();
      if (!authResult.success) throw new Error(`Authentication failed: ${authResult.error}`);
    }

    console.log(`[Odoo] Calling ${model}.${method}`);
    return await this.jsonRpc('object', 'execute_kw', [
      this.config.database,
      this.uid,
      this.config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  async getModelFields(model: string): Promise<Record<string, any>> {
    const authResult = await this.authenticate();
    if (!authResult.success) {
      throw new Error(`Authentication failed: ${authResult.error}`);
    }
    
    return await this.callOdoo(
      model,
      'fields_get',
      [],
      { attributes: ['string', 'type', 'relation', 'help'] }
    );
  }
  
  async fetchRawBessSystems(): Promise<any[]> {
    const authResult = await this.authenticate();
    if (!authResult.success) {
      throw new Error(`Authentication failed: ${authResult.error}`);
    }
    
    return await this.callOdoo(
      'battery.system',
      'search_read',
      [[]],
      {}
    );
  }

  async fetchSalesPoints(): Promise<SalesPoint[]> {
    const authResult = await this.authenticate();
    if (!authResult.success) {
      throw new Error(`Authentication failed: ${authResult.error}`);
    }

    const partners: any[] = await this.callOdoo(
      "res.partner",
      "search_read",
      [[["category_id.name", "=", "verkooppunt"], ["active", "=", true]]],
      {
        fields: [
          "name",
          "street",
          "street2",
          "zip",
          "city",
          "country_id",
          "phone",
          "email",
          "website",
          "partner_latitude",
          "partner_longitude",
        ],
        order: "name asc",
      },
    );

    return partners.map((partner): SalesPoint => ({
        id: partner.id,
        name: partner.name || `Sales point ${partner.id}`,
        street: partner.street || "",
        street2: partner.street2 || undefined,
        zip: partner.zip || "",
        city: partner.city || "",
        country: Array.isArray(partner.country_id) ? partner.country_id[1] : "",
        phone: partner.phone || undefined,
        email: partner.email || undefined,
        website: partner.website || undefined,
        latitude: Number(partner.partner_latitude) || 0,
        longitude: Number(partner.partner_longitude) || 0,
      }));
  }

  async fetchBessSystems(): Promise<OdooBessRecord[]> {
    const authResult = await this.authenticate();
    if (!authResult.success) {
      console.error('[Odoo] Cannot fetch systems - authentication failed:', authResult.error);
      return [];
    }
    
    console.log('[Odoo] Fetching battery.system records...');
    
    try {
      // First, discover all available fields on battery.system
      console.log('[Odoo] Discovering fields on battery.system...');
      const fieldsInfo = await this.callOdoo(
        'battery.system',
        'fields_get',
        [],
        { attributes: ['string', 'type', 'relation'] }
      );
      console.log(`[Odoo] Available fields on battery.system:`, Object.keys(fieldsInfo).join(', '));
      
      // Step 1: Fetch all battery.system records - let Odoo return all fields
      const batterySystems: any[] = await this.callOdoo(
        'battery.system',
        'search_read',
        [[]],
        {}  // No field filter - get all fields
      );
      
      console.log(`[Odoo] Raw battery systems data:`, JSON.stringify(batterySystems).substring(0, 2000));

      console.log(`[Odoo] Found ${batterySystems.length} battery systems`);
      
      if (batterySystems.length === 0) {
        return [];
      }

      // Step 2: Extract unique customer (partner) IDs
      const partnerIds = batterySystems
        .filter(sys => sys.customer && Array.isArray(sys.customer))
        .map(sys => (sys.customer as [number, string])[0]);
      
      const uniquePartnerIds = Array.from(new Set(partnerIds));
      console.log(`[Odoo] Fetching ${uniquePartnerIds.length} partner records for locations...`);

      // Step 3: Fetch partner records with location data
      let partners: OdooPartnerRaw[] = [];
      if (uniquePartnerIds.length > 0) {
        partners = await this.callOdoo(
          'res.partner',
          'search_read',
          [[['id', 'in', uniquePartnerIds]]],
          {
            fields: [
              'name',
              'partner_latitude',
              'partner_longitude',
              'city',
              'country_id',
            ],
          }
        );
      }
      
      console.log(`[Odoo] Fetched ${partners.length} partner records`);

      // Step 4: Create a map of partner ID to partner data
      const partnerMap = new Map<number, OdooPartnerRaw>();
      for (const partner of partners) {
        partnerMap.set(partner.id, partner);
      }

      // Step 5: Transform battery systems to our format
      const result: OdooBessRecord[] = [];
      
      for (const system of batterySystems) {
        let latitude = 50.8503; // Default to Brussels
        let longitude = 4.3517;
        let location = 'Unknown';

        if (system.customer && Array.isArray(system.customer)) {
          const partner = partnerMap.get(system.customer[0]);
          if (partner) {
            if (partner.partner_latitude && partner.partner_longitude) {
              latitude = partner.partner_latitude;
              longitude = partner.partner_longitude;
            }
            location = partner.city || partner.name || 'Unknown';
            if (partner.country_id && Array.isArray(partner.country_id)) {
              location += `, ${partner.country_id[1]}`;
            }
          }
        }

        // Use x_studio_title as name, product_tmpl_id name as battery type
        const systemName = system.x_studio_title || system.name || `System ${system.id}`;
        const batteryType = system.product_tmpl_id && Array.isArray(system.product_tmpl_id) 
          ? system.product_tmpl_id[1] 
          : 'BESS';
        const status = 'active'; // Default to active since no status field exists
        
        result.push({
          id: system.id,
          name: systemName,
          location,
          latitude,
          longitude,
          system_type: batteryType,
          status: status.toLowerCase(),
          capacity_mwh: system.capacity || 0,
          power_mw: system.power || 0,
          state_of_charge: system.soc || 0,
          state_of_health: system.soh || 100,
          temperature: system.temperature || 25,
          acRatedPower: system.df_ac_rated_power || undefined,
          acMaxPower: system.df_ac_maximum_power || undefined,
          acGridType: system.df_ac_grid_type || undefined,
          acThdi: system.df_ac_thdi || undefined,
          acRatedGridVoltage: system.df_ac_rated_grid_volate || undefined,
          acGridFreqMin: system.df_ac_grid_freq_min || undefined,
          acGridFreqMax: system.df_ac_grid_freq_max || undefined,
          dcRatedVoltage: system.df_dc_rated_voltage || undefined,
          dcVoltageRangeMin: system.df_dc_voltage_range || undefined,
          dcVoltageRangeMax: system.df_dc_voltage_range_max || undefined,
          dcRatedCapacity: system.df_dc_rated_capacity || undefined,
          dcRatedEnergy: system.df_dc_rated_energy || undefined,
          chargeDischargeRate: system.df_charge_discharge_rate || undefined,
          degreeOfProtection: system.df_degree_of_protection || undefined,
          operationTempMin: system.df_operation_temperature_min || undefined,
          operationTempMax: system.df_operation_temperature_max || undefined,
          storageTempMin: system.df_storage_temperature_min || undefined,
          storageTempMax: system.df_storage_temperature_max || undefined,
          altitude: system.df_altitude || undefined,
          relativeHumidity: system.df_relative_humidity || undefined,
          coolingMethod: system.df_cooling_method || undefined,
          fireSuppressionSystem: system.df_fire_suppression_system || undefined,
          communication: system.df_communication || undefined,
          dimensionLength: system.df_d_length || undefined,
          dimensionWidth: system.df_d_width || undefined,
          dimensionHeight: system.df_d_height || undefined,
          weight: system.df_weight || undefined,
          warranty: system.df_warranty || undefined,
          batteryType: system.df_battery_type || undefined,
          imageUrls: [], // Images need special handling
        });
      }

      console.log(`[Odoo] Transformed ${result.length} systems for map display`);
      return result;
    } catch (error) {
      console.error('[Odoo] Error fetching BESS systems:', error);
      return [];
    }
  }
}

export async function createOdooClient(config: OdooConfig): Promise<OdooClient> {
  return new OdooClient(config);
}
