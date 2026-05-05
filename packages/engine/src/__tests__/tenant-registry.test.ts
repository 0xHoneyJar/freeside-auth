/**
 * Tests for TenantRegistry: yaml load · validation · adapter factory dispatch ·
 * lazy instantiation · unknown-tenant errors.
 */

import { describe, expect, it } from 'bun:test';
import type { TenantAdapter } from '@freeside-auth/ports';
import {
  TenantRegistry,
  TenantRegistryConfigError,
  UnknownTenantError,
  type TenantAdapterFactory,
} from '../tenant-registry';
import type { TenantConfig } from '../tenant-config';

// Mock adapter for tests
const mockAdapter = (config: TenantConfig): TenantAdapter => ({
  id: config.id,
  config: {
    id: config.id,
    name: config.name,
    substrate: config.substrate,
    shape: config.shape,
    chains: config.chains,
    dynamic_user_id_present: config.dynamic_user_id_present,
    archive_only: config.archive_only,
    connection: config.connection,
    user_table: config.user_table,
  },
  resolveCredential: async () => null,
  fetchClaims: async () => ({}),
  ping: async () => ({ ok: true, latency_ms: 1, substrate: config.substrate }),
});

const factory: TenantAdapterFactory = mockAdapter;

const miberaConfig: TenantConfig = {
  id: 'mibera',
  name: 'Mibera',
  substrate: 'postgres',
  shape: 'split',
  chains: ['ethereum'],
  dynamic_user_id_present: true,
  connection: { env_var: 'TENANT_MIBERA_DATABASE_URL' },
  user_table: {
    name: 'midi_profiles',
    wallet_column: 'wallet_address',
    dynamic_user_id_column: 'dynamic_user_id',
  },
  archive_only: false,
};

const cubquestConfig: TenantConfig = {
  id: 'cubquest',
  name: 'CubQuests',
  substrate: 'postgres',
  shape: 'unified',
  chains: ['ethereum', 'solana'],
  dynamic_user_id_present: true,
  connection: { env_var: 'TENANT_CUBQUEST_DATABASE_URL' },
  user_table: {
    name: 'profiles',
    wallet_column: 'address',
    sol_address_column: 'sol_address',
    dynamic_user_id_column: 'dynamic_user_id',
  },
  archive_only: false,
};

describe('TenantRegistry.fromConfigs', () => {
  it('constructs from valid configs', () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig, cubquestConfig], factory);
    expect(registry.list()).toEqual(['mibera', 'cubquest']);
  });

  it('rejects invalid tenant_id pattern', () => {
    const bad = { ...miberaConfig, id: 'MIBERA' };
    expect(() => TenantRegistry.fromConfigs([bad], factory)).toThrow();
  });

  it('rejects unknown shape', () => {
    const bad = { ...miberaConfig, shape: 'mystery' as never };
    expect(() => TenantRegistry.fromConfigs([bad], factory)).toThrow();
  });

  it('default archive_only=false applied when omitted', () => {
    const minimal: TenantConfig = {
      id: 'test',
      name: 'Test',
      substrate: 'postgres',
      shape: 'config',
      chains: [],
      dynamic_user_id_present: false,
      connection: { env_var: 'TEST_URL' },
      archive_only: false,
    };
    const registry = TenantRegistry.fromConfigs([minimal], factory);
    expect(registry.getConfig('test').archive_only).toBe(false);
  });
});

describe('TenantRegistry.fromFile', () => {
  it('loads packaged tenants.yaml without throwing', () => {
    const registry = TenantRegistry.fromFile(TenantRegistry.defaultYamlPath(), factory);
    const tenants = registry.list();
    expect(tenants).toContain('mibera');
    expect(tenants).toContain('cubquest');
    expect(tenants).toContain('apdao');
    expect(tenants.length).toBeGreaterThanOrEqual(8);
  });

  it('loaded mibera config matches foundation doc', () => {
    const registry = TenantRegistry.fromFile(TenantRegistry.defaultYamlPath(), factory);
    const m = registry.getConfig('mibera');
    expect(m.shape).toBe('split');
    expect(m.chains).toEqual(['ethereum']);
    expect(m.dynamic_user_id_present).toBe(true);
    expect(m.user_table?.name).toBe('midi_profiles');
    expect(m.user_table?.wallet_column).toBe('wallet_address');
    expect(m.user_table?.dynamic_user_id_column).toBe('dynamic_user_id');
  });

  it('loaded cubquest config has multi-chain wallets', () => {
    const registry = TenantRegistry.fromFile(TenantRegistry.defaultYamlPath(), factory);
    const c = registry.getConfig('cubquest');
    expect(c.shape).toBe('unified');
    expect(c.chains).toContain('ethereum');
    expect(c.chains).toContain('solana');
    expect(c.user_table?.sol_address_column).toBe('sol_address');
  });

  it('loaded apdao config is shape=config no user_table', () => {
    const registry = TenantRegistry.fromFile(TenantRegistry.defaultYamlPath(), factory);
    const a = registry.getConfig('apdao');
    expect(a.shape).toBe('config');
    expect(a.dynamic_user_id_present).toBe(false);
    expect(a.user_table).toBeUndefined();
  });

  it('loaded henlo-old config is archive_only=true', () => {
    const registry = TenantRegistry.fromFile(TenantRegistry.defaultYamlPath(), factory);
    const h = registry.getConfig('henlo-old');
    expect(h.shape).toBe('legacy');
    expect(h.archive_only).toBe(true);
  });
});

describe('TenantRegistry.getAdapter', () => {
  it('returns adapter for known tenant', () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], factory);
    const adapter = registry.getAdapter('mibera');
    expect(adapter.id).toBe('mibera');
    expect(adapter.config.shape).toBe('split');
  });

  it('caches adapter on second call (singleton per tenant)', () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], factory);
    const a1 = registry.getAdapter('mibera');
    const a2 = registry.getAdapter('mibera');
    expect(a1).toBe(a2);
  });

  it('throws UnknownTenantError for unregistered tenant', () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig], factory);
    expect(() => registry.getAdapter('unknown')).toThrow(UnknownTenantError);
  });

  it('UnknownTenantError carries known list for diagnostics', () => {
    const registry = TenantRegistry.fromConfigs([miberaConfig, cubquestConfig], factory);
    try {
      registry.getAdapter('xenon');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownTenantError);
      const err = e as UnknownTenantError;
      expect(err.tenantId).toBe('xenon');
      expect(err.known).toContain('mibera');
      expect(err.known).toContain('cubquest');
    }
  });
});

describe('TenantRegistry.filter', () => {
  it('filters by archive_only=false', () => {
    const registry = TenantRegistry.fromFile(TenantRegistry.defaultYamlPath(), factory);
    const live = registry.filter((c) => !c.archive_only);
    expect(live.some((c) => c.id === 'mibera')).toBe(true);
    expect(live.some((c) => c.id === 'henlo-old')).toBe(false);
  });

  it('filters by chain support', () => {
    const registry = TenantRegistry.fromFile(TenantRegistry.defaultYamlPath(), factory);
    const solanaCapable = registry.filter((c) => c.chains.includes('solana'));
    expect(solanaCapable.some((c) => c.id === 'cubquest')).toBe(true);
    expect(solanaCapable.some((c) => c.id === 'mibera')).toBe(false);
  });
});

describe('TenantRegistry duplicate detection', () => {
  it('rejects duplicate tenant_id from yaml', () => {
    const dup = TenantRegistry.fromConfigs;
    expect(() => dup([miberaConfig, miberaConfig], factory)).toThrow(
      TenantRegistryConfigError,
    );
  });
});
