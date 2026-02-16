// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { PgColumnBuilderBase, PgSchema, PgTable, PgTransaction } from 'drizzle-orm/pg-core';
import type { Context } from './http';

import { sql } from 'drizzle-orm';
import { pgPolicy, pgSchema, pgTable } from 'drizzle-orm/pg-core';

import { Application } from './app';
import { Database } from './database';
import { Middleware } from './middleware';

// ============================================================================
// Types
// ============================================================================

/**
 * The tenancy mode for the application.
 * - `schema`: Each tenant has their own Postgres schema.
 * - `rls`: Row-Level Security with a shared schema and a tenant column.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type TenancyMode = 'schema' | 'rls';

/**
 * Global tenancy configuration for the application.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface TenancyConfig {
	/**
	 * The tenancy mode to use.
	 */
	mode: TenancyMode;

	/**
	 * Configuration specific to RLS mode.
	 */
	rls?: {
		/**
		 * The PostgreSQL session variable used to store the current tenant.
		 * @default 'app.current_tenant'
		 */
		sessionVariable?: string;

		/**
		 * The default column name used for tenant isolation in RLS policies.
		 * @default 'tenant_id'
		 */
		defaultColumn?: string;
	};

	/**
	 * Configuration specific to schema-based tenancy.
	 */
	schema?: {
		/**
		 * Whether to automatically create tenant schemas on first use.
		 */
		autoCreate?: boolean;
	};
}

/**
 * Per-model tenancy configuration, used to control how a specific model
 * interacts with the tenancy system.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface ModelTenancyConfig {
	/**
	 * Whether tenancy is enabled for this model.
	 */
	enabled: boolean;

	/**
	 * Override the global tenancy mode for this model.
	 */
	mode?: TenancyMode;

	/**
	 * The column name used for RLS tenant isolation in this model.
	 */
	column?: string;

	/**
	 * Custom RLS policy name for this model.
	 */
	policyName?: string;
}

// ============================================================================
// Internal State
// ============================================================================

let _config: TenancyConfig = { mode: 'schema' };
const tenantSchemas: Map<string, PgTable> = new Map();
const schemaRegistry: Map<string, PgSchema> = new Map();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Sets the global tenancy configuration.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param config The tenancy configuration to apply.
 */
export const configure = (config: TenancyConfig): void => {
	_config = config;
};

/**
 * Gets the current global tenancy configuration.
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns The current tenancy configuration.
 */
export const getConfig = (): TenancyConfig => _config;

// ============================================================================
// Context Management
// ============================================================================

/**
 * Gets the current tenant from the async context.
 * @author Axel Nana <axel.nana@workbud.com>
 * @returns The current tenant identifier, or `null` if not set.
 */
export const getCurrentTenant = (): string | null => {
	if (!Application.instance || !Application.context.getStore) {
		return null;
	}
	const store = Application.context.getStore();
	return (store?.get('tenant') ?? null) as string | null;
};

/**
 * Runs a callback within the context of a specific tenant.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier to set.
 * @param callback The function to execute within the tenant context.
 * @returns The return value of the callback.
 */
export const withTenant = <T>(tenant: string, callback: () => T): T => {
	const currentStore = Application.context.getStore();
	const newStore = new Map(currentStore);
	newStore.set('tenant', tenant);
	return Application.context.run(newStore, callback);
};

// ============================================================================
// Schema-based Tenancy
// ============================================================================

/**
 * Gets the Drizzle `PgSchema` for the given tenant.
 * Creates and registers the schema if it doesn't exist yet.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The name of the tenant.
 * @returns The Postgres schema for the tenant.
 */
export const getTenantSchema = (tenant: string): PgSchema => {
	return schemaRegistry.get(tenant) ?? registerTenantSchema(tenant);
};

/**
 * Registers a new Postgres schema for a tenant.
 * If the schema is already registered, returns the existing one.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The name of the tenant.
 * @returns The newly created or existing tenant schema.
 */
export const registerTenantSchema = (tenant: string): PgSchema => {
	if (schemaRegistry.has(tenant)) {
		return schemaRegistry.get(tenant)!;
	}
	const tenantSchema = pgSchema(tenant);
	schemaRegistry.set(tenant, tenantSchema);
	return tenantSchema;
};

/**
 * Wraps a table definition within a tenant's Postgres schema.
 * For the `public` tenant, returns a standard `pgTable`.
 * Results are cached for performance.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier.
 * @param tableName The name of the table.
 * @param columns The table columns definition.
 * @returns A `PgTable` scoped to the tenant's schema.
 */
export const wrapTenantSchema = <
	TTableName extends string,
	TColumnsMap extends Record<string, PgColumnBuilderBase>
>(
	tenant: string,
	tableName: TTableName,
	columns: TColumnsMap
): PgTable => {
	if (tenant === 'public') {
		return pgTable(tableName, columns);
	}

	const fullTableName = `${tenant}.${tableName}`;
	if (tenantSchemas.has(fullTableName)) {
		return tenantSchemas.get(fullTableName)!;
	}

	const tenantSchema = getTenantSchema(tenant);
	const schemaTable = tenantSchema.table(tableName, columns);
	tenantSchemas.set(fullTableName, schemaTable);

	return schemaTable;
};

// ============================================================================
// RLS-based Tenancy (Drizzle-native)
// ============================================================================

/**
 * Execute a callback within a transaction that has the tenant context set
 * via PostgreSQL session variable.
 *
 * Uses `set_config(varName, value, true)` which:
 * - Sets the variable value as a proper GUC parameter (not an identifier)
 * - The `true` flag makes it transaction-local (reverts on commit/rollback)
 *
 * The transaction handle (`tx`) is passed to the callback so all
 * queries execute within the same transaction where `set_config` was called.
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier, or `null` for the public tenant.
 * @param callback A function receiving the transaction handle.
 * @param connectionName The database connection to use.
 * @returns The return value of the callback.
 */
export const withRLS = async <T>(
	tenant: string | null,
	callback: (tx: PgTransaction<any, any, any>) => Promise<T>,
	connectionName: string = 'default'
): Promise<T> => {
	const db = Database.getConnection(connectionName);
	const varName = _config.rls?.sessionVariable ?? 'app.current_tenant';
	const value = tenant ?? 'public';

	return (db as any).transaction(async (tx: PgTransaction<any, any, any>) => {
		await tx.execute(sql`SELECT set_config(${varName}, ${value}, true)`);
		return callback(tx);
	});
};

/**
 * Sets the tenant for the current database connection (session-level, not transaction-local).
 * Useful for long-lived connections or connection pools.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tenant The tenant identifier, or `null` for the public tenant.
 * @param connectionName The database connection to use.
 */
export const setConnectionTenant = async (
	tenant: string | null,
	connectionName: string = 'default'
): Promise<void> => {
	const db = Database.getConnection(connectionName);
	const varName = _config.rls?.sessionVariable ?? 'app.current_tenant';
	const value = tenant ?? 'public';

	await (db as any).execute(sql`SELECT set_config(${varName}, ${value}, false)`);
};

/**
 * Reads the current tenant from the PostgreSQL session variable.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param connectionName The database connection to use.
 * @returns The current tenant identifier, or `null` if not set.
 */
export const getSessionTenant = async (
	connectionName: string = 'default'
): Promise<string | null> => {
	const db = Database.getConnection(connectionName);
	const varName = _config.rls?.sessionVariable ?? 'app.current_tenant';

	const result = await (db as any).execute(sql`SELECT current_setting(${varName}, true) as tenant`);
	return (result as any)?.rows?.[0]?.tenant ?? null;
};

/**
 * Create an RLS policy for tenant isolation.
 *
 * Always specifies `for` and `to` for deterministic behavior:
 * - `for: 'all'` — policy applies to SELECT, INSERT, UPDATE, DELETE
 * - `to: 'public'` — policy applies to all roles
 *
 * @author Axel Nana <axel.nana@workbud.com>
 * @param tableName The name of the table to create the policy for.
 * @param columnName The column that holds the tenant identifier. Defaults to the global config.
 * @param policyName Custom name for the policy. Defaults to `{tableName}_tenant_isolation`.
 * @returns A Drizzle `pgPolicy` definition.
 */
export const createRLSPolicy = (tableName: string, columnName?: string, policyName?: string) => {
	const varName = _config.rls?.sessionVariable ?? 'app.current_tenant';
	const column = columnName ?? _config.rls?.defaultColumn ?? 'tenant_id';
	const name = policyName ?? `${tableName}_tenant_isolation`;

	return pgPolicy(name, {
		for: 'all',
		to: 'public',
		using: sql`${sql.identifier(column)} = current_setting(${varName}, true)::text`,
		withCheck: sql`${sql.identifier(column)} = current_setting(${varName}, true)::text`
	});
};

// ============================================================================
// TenantMiddleware Base Class
// ============================================================================

/**
 * Base class for tenant-aware middleware.
 *
 * The middleware extracts the tenant identifier from an HTTP header and
 * sets `ctx.tenant`. For RLS mode, route handlers should use `withRLS()`
 * to wrap their queries in a tenant-scoped transaction.
 *
 * @example
 * ```typescript
 * class OrganizationMiddleware extends TenantMiddleware {
 *   protected header = 'x-organization-id';
 *   protected allowPublic = false;
 *
 *   protected async validateTenant(orgId: string): Promise<boolean> {
 *     return Organization.exists(orgId);
 *   }
 * }
 * ```
 *
 * @author Axel Nana <axel.nana@workbud.com>
 */
export abstract class TenantMiddleware extends Middleware {
	/**
	 * The HTTP header name from which the tenant ID is read.
	 */
	protected header: string = 'x-tenant-id';

	/**
	 * Whether requests without a tenant ID are allowed (defaulting to 'public').
	 */
	protected allowPublic: boolean = true;

	/**
	 * The database connection name used for tenant operations.
	 */
	protected connectionName: string = 'default';

	/**
	 * Validates that a tenant identifier is legitimate.
	 * Override this to check against your data store.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param _tenant The tenant identifier to validate.
	 * @returns `true` if the tenant is valid, `false` otherwise.
	 */
	protected async validateTenant(_tenant: string): Promise<boolean> {
		return true;
	}

	/**
	 * Hook called after a tenant has been successfully resolved.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param _tenant The resolved tenant identifier.
	 * @param _ctx The request context.
	 */
	protected async onTenantResolved(_tenant: string, _ctx: Context): Promise<void> {}

	/**
	 * Called when the tenant cannot be determined or is invalid.
	 * Throws an appropriate error by default.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param reason Whether the tenant is 'missing' or 'invalid'.
	 * @param _ctx The request context.
	 */
	protected onTenantError(reason: 'missing' | 'invalid', _ctx: Context): never {
		if (reason === 'missing') {
			throw new Error('Tenant ID required');
		} else {
			throw new Error('Invalid tenant');
		}
	}

	/**
	 * Extracts and validates the tenant from the incoming request.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param ctx The request context.
	 */
	public async onRequest(ctx: Context): Promise<any> {
		const tenantId = ctx.request.headers.get(this.header);

		if (!tenantId || tenantId === 'public') {
			if (this.allowPublic) {
				(ctx as any).tenant = 'public';
				return;
			}
			return this.onTenantError('missing', ctx);
		}

		const isValid = await this.validateTenant(tenantId);
		if (!isValid) {
			return this.onTenantError('invalid', ctx);
		}

		(ctx as any).tenant = tenantId;
		await this.onTenantResolved(tenantId, ctx);
	}
}

/**
 * A simple tenant middleware that allows public access by default.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class SimpleTenantMiddleware extends TenantMiddleware {}

/**
 * A strict tenant middleware that rejects requests without a tenant ID.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class StrictTenantMiddleware extends TenantMiddleware {
	protected allowPublic = false;
}
