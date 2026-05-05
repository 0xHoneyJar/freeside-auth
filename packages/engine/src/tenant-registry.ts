/**
 * TenantRegistry — singleton loaded from tenants.yaml at boot.
 *
 * Validates entries against TenantConfigSchema. Indexes by tenant_id. Returns
 * the right TenantAdapter for each request via getAdapter(tenant_id).
 *
 * Adapters live in @freeside-auth/adapters; the registry needs a factory
 * function that knows how to construct each shape. Slice-B ships PostgresSplit
 * (mibera) and PostgresUnified (cubquest); others get config/legacy stubs.
 *
 * Per SDD §12.4: registry orchestrates · adapters implement · ports define.
 *
 * Per [[freeside-as-identity-spine]] doctrine: the spine knows ALL tenants;
 * each adapter knows its OWN tenant. Cross-tenant reasoning happens here at
 * the L4 composition point, not inside adapters.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TenantAdapter } from '@freeside-auth/ports';
import {
  TenantConfigSchema,
  TenantRegistryFileSchema,
  type TenantConfig,
} from './tenant-config';

/**
 * Factory function that produces a TenantAdapter for a given config.
 * Provided by callers (typically @freeside-auth/adapters or app boot).
 *
 * Slice-B wiring example:
 * ```ts
 * import { PostgresSplitAdapter, PostgresUnifiedAdapter } from '@freeside-auth/adapters';
 *
 * const factory: TenantAdapterFactory = (config) => {
 *   if (config.shape === 'split') return new PostgresSplitAdapter(config);
 *   if (config.shape === 'unified') return new PostgresUnifiedAdapter(config);
 *   if (config.shape === 'config') return new PostgresConfigAdapter(config);
 *   throw new Error(`Unsupported shape: ${config.shape}`);
 * };
 * const registry = TenantRegistry.fromFile(yamlPath, factory);
 * ```
 */
export type TenantAdapterFactory = (config: TenantConfig) => TenantAdapter;

export class TenantRegistry {
  private readonly adapters = new Map<string, TenantAdapter>();
  private readonly configs = new Map<string, TenantConfig>();

  private constructor(
    configs: TenantConfig[],
    private readonly factory: TenantAdapterFactory,
  ) {
    // Duplicate detection runs in the constructor so both fromFile + fromConfigs catch it.
    const seen = new Set<string>();
    for (const config of configs) {
      if (seen.has(config.id)) {
        throw new TenantRegistryConfigError(
          `duplicate tenant_id in registry: ${config.id}`,
        );
      }
      seen.add(config.id);
      this.configs.set(config.id, config);
      // Lazy adapter init: create on first getAdapter call to avoid
      // connecting to all DBs at boot. Per Lock-3 (I3 Spine Seam) +
      // ALEXANDER craft (defer side effects to L4 boundary).
    }
  }

  /**
   * Load + validate tenants.yaml and construct registry.
   *
   * Throws ConfigError on invalid yaml / schema validation failure /
   * duplicate tenant_id.
   */
  static fromFile(yamlPath: string, factory: TenantAdapterFactory): TenantRegistry {
    const raw = readFileSync(yamlPath, 'utf-8');
    const parsed = parseYaml(raw) as unknown;
    const validated = TenantRegistryFileSchema.parse(parsed);
    return new TenantRegistry(validated.tenants, factory);
  }

  /** Construct from a pre-parsed config array (test convenience · skips yaml load). */
  static fromConfigs(
    configs: TenantConfig[],
    factory: TenantAdapterFactory,
  ): TenantRegistry {
    // Re-validate to catch programmatic mistakes
    const validated = configs.map((c) => TenantConfigSchema.parse(c));
    return new TenantRegistry(validated, factory);
  }

  /**
   * Default tenants.yaml path resolution. Used when caller does not supply
   * an explicit path. Resolves to packages/engine/src/tenants.yaml.
   */
  static defaultYamlPath(): string {
    return join(__dirname, 'tenants.yaml');
  }

  /** Retrieve a TenantAdapter for the given tenant_id. Lazy-instantiates on first call. */
  getAdapter(tenantId: string): TenantAdapter {
    let adapter = this.adapters.get(tenantId);
    if (adapter) return adapter;

    const config = this.configs.get(tenantId);
    if (!config) {
      throw new UnknownTenantError(tenantId, [...this.configs.keys()]);
    }

    adapter = this.factory(config);
    this.adapters.set(tenantId, adapter);
    return adapter;
  }

  /** Retrieve a tenant's config without instantiating an adapter. */
  getConfig(tenantId: string): TenantConfig {
    const config = this.configs.get(tenantId);
    if (!config) {
      throw new UnknownTenantError(tenantId, [...this.configs.keys()]);
    }
    return config;
  }

  /** List all tenant IDs registered (active + declarative). */
  list(): string[] {
    return [...this.configs.keys()];
  }

  /** Filter to tenants matching a predicate (e.g., active-only · non-archive). */
  filter(predicate: (config: TenantConfig) => boolean): TenantConfig[] {
    return [...this.configs.values()].filter(predicate);
  }
}

export class TenantRegistryConfigError extends Error {
  constructor(message: string) {
    super(`[tenant-registry] ${message}`);
    this.name = 'TenantRegistryConfigError';
  }
}

export class UnknownTenantError extends Error {
  constructor(public readonly tenantId: string, public readonly known: string[]) {
    super(
      `[tenant-registry] unknown tenant_id: ${tenantId} (known: ${known.join(', ')})`,
    );
    this.name = 'UnknownTenantError';
  }
}
