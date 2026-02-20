// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import { afterAll, afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import * as d from 'drizzle-orm/pg-core';
import { t } from 'elysia';

import { Application } from '@elysiumjs/core';

import { createSchemaFromDrizzle, Model } from '../src/model';
import * as Tenancy from '../src/tenancy';

const mockColumns = {
	id: d.uuid().primaryKey().defaultRandom(),
	name: d.varchar().notNull(),
	age: d.integer().notNull(),
	email: d.varchar().notNull().unique(),
	is_confirmed: d.boolean().default(false)
};

const mockTable = d.pgTable('users', mockColumns);

class MockModel extends Model('users', mockColumns) {}

const mockStore = new Map([['tenant', 'test-tenant']]);
const mockGetStore = mock(() => mockStore);
mock.module('@elysiumjs/core', () => ({
	Application: {
		...Application,
		context: {
			getStore: mockGetStore,
			run: mock((_, callback) => callback())
		}
	}
}));

describe('Model', () => {
	beforeEach(() => {
		mock.restore();
	});

	afterEach(() => {
		mock.restore();
	});

	afterAll(() => {
		jest.clearAllMocks();
	});

	describe('createSchemaFromDrizzle', () => {
		it('should create a schema for select mode', async () => {
			// Import the mocked modules
			const getTableConfigSpy = spyOn(d, 'getTableConfig');

			// Create a spy on t.Object
			const objectSpy = spyOn(t, 'Object');

			// Call the function
			createSchemaFromDrizzle(mockTable, { mode: 'select' });

			// Check if getTableConfig was called with the mock table
			expect(getTableConfigSpy).toHaveBeenCalledWith(mockTable);

			// Check if t.Object was called with the correct properties
			expect(objectSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.any(Object),
					name: expect.any(Object),
					email: expect.any(Object),
					age: expect.any(Object),
					is_confirmed: expect.any(Object)
				})
			);

			// Restore the spy
			objectSpy.mockRestore();
		});

		it('should create a schema for create mode', async () => {
			// Import the mocked modules
			const getTableConfigSpy = spyOn(d, 'getTableConfig');

			// Create a spy on t.Object
			const objectSpy = spyOn(t, 'Object');

			// Call the function
			createSchemaFromDrizzle(mockTable, { mode: 'create' });

			// Check if getTableConfig was called with the mock table
			expect(getTableConfigSpy).toHaveBeenCalledWith(mockTable);

			// Check if t.Object was called with the correct properties (excluding primary key)
			expect(objectSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					name: expect.any(Object),
					email: expect.any(Object),
					age: expect.any(Object),
					is_confirmed: expect.any(Object)
				})
			);

			// Check that the primary key is not included
			expect(objectSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.any(Object)
				})
			);

			// Restore the spy
			objectSpy.mockRestore();
		});

		it('should create a schema for update mode', async () => {
			// Import the mocked modules
			const getTableConfigSpy = spyOn(d, 'getTableConfig');

			// Create a spy on t.Object
			const objectSpy = spyOn(t, 'Object');

			// Call the function
			createSchemaFromDrizzle(mockTable, { mode: 'update' });

			// Check if getTableConfig was called with the mock table
			expect(getTableConfigSpy).toHaveBeenCalledWith(mockTable);

			// Check if t.Object was called with the correct properties (excluding primary key)
			expect(objectSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					name: expect.any(Object),
					email: expect.any(Object),
					age: expect.any(Object),
					is_confirmed: expect.any(Object)
				})
			);

			// Check that the primary key is not included
			expect(objectSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.any(Object)
				})
			);

			// Restore the spy
			objectSpy.mockRestore();
		});

		it('should return an empty object if columns are undefined', async () => {
			// Import the mocked modules
			const getTableConfigSpy = spyOn(d, 'getTableConfig').mockReturnValueOnce({
				// @ts-expect-error Mocking headaches
				columns: undefined
			});

			// Create a spy on t.Object
			const objectSpy = spyOn(t, 'Object');

			// Call the function
			createSchemaFromDrizzle(mockTable);

			// Check if getTableConfig was called with the mock table
			expect(getTableConfigSpy).toHaveBeenCalledWith(mockTable);

			// Check if t.Object was called with an empty object
			expect(objectSpy).toHaveBeenCalledWith({});

			// Restore the spy
			objectSpy.mockRestore();
		});
	});

	describe('Model mixin', () => {
		it('should create a model class with the correct properties', async () => {
			// Import the mocked modules
			const pgTableSpy = spyOn(d, 'pgTable');

			// Create a mock columns configuration
			const mockColumns = {
				id: d.uuid().primaryKey().defaultRandom(),
				name: d.varchar().notNull()
			};

			// Create a model class
			class UserModel extends Model('users', mockColumns) {}

			// Check if pgTable was called with the correct parameters
			expect(pgTableSpy).toHaveBeenCalledWith('users', mockColumns, undefined);

			// Check if the model class has the correct static properties
			expect(UserModel.tableName).toBe('users');
			expect(UserModel.columns).toBe(mockColumns);
			expect(UserModel.insertSchema).toBeDefined();
			expect(UserModel.updateSchema).toBeDefined();
			expect(UserModel.selectSchema).toBeDefined();
			expect(UserModel.supportTenancy).toBe(false);
			expect(UserModel.$inferSelect).toBeUndefined();
			expect(UserModel.$inferInsert).toBeUndefined();
			expect(UserModel.$inferUpdate).toBeUndefined();
		});
	});

	describe('Tenancy', () => {
		it('should get the current tenant', () => {
			// Call the function
			const tenant = Tenancy.getCurrentTenant();

			// Check if Application.context.getStore was called
			expect(mockGetStore).toHaveBeenCalled();

			// Check if the tenant is correct
			expect(tenant).toBe('test-tenant');
		});

		it('should return null if no tenant is set', () => {
			// Mock getStore to return a map without a tenant
			mockGetStore.mockReturnValueOnce(new Map());

			// Call the function
			const tenant = Tenancy.getCurrentTenant();

			// Check if Application.context.getStore was called
			expect(mockGetStore).toHaveBeenCalled();

			// Check if the tenant is null
			expect(tenant).toBeNull();
		});

		it('should register a new tenant schema', async () => {
			// Import the mocked modules
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			// Call the function
			const schema = Tenancy.registerTenantSchema('new-tenant');

			// Check if pgSchema was called with the correct tenant name
			expect(pgSchemaSpy).toHaveBeenCalledWith('new-tenant');

			// Check if the schema is correct
			expect(schema).toBeDefined();
		});

		it('should wrap a model with a tenant schema', async () => {
			// Import the mocked modules
			const pgTableSpy = spyOn(d, 'pgTable');
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			// Call the function with a non-public tenant
			const table = Tenancy.wrapTenantSchema('test-tenant', MockModel.tableName, MockModel.columns);

			// Check if pgSchema was called with the correct tenant name
			expect(pgSchemaSpy).toHaveBeenCalledWith('test-tenant');

			// Check if the table is correct
			expect(table).toBeDefined();

			// Call the function with the public tenant
			const publicTable = Tenancy.wrapTenantSchema('public', MockModel.tableName, MockModel.columns);

			// Check if pgTable was called with the correct parameters
			expect(pgTableSpy).toHaveBeenCalledWith('users', MockModel.columns);

			// Check if the table is correct
			expect(publicTable).toBeDefined();
		});

		it('should reuse existing tenant schemas', async () => {
			// Import the mocked modules
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			// Register a tenant schema
			Tenancy.registerTenantSchema('existing-tenant');

			// Reset the mock to check if it's called again
			pgSchemaSpy.mockClear();

			// Call the function with the same tenant
			const schema = Tenancy.registerTenantSchema('existing-tenant');

			// Check if pgSchema was not called again
			expect(pgSchemaSpy).not.toHaveBeenCalled();

			// Check if the schema is correct
			expect(schema).toBeDefined();
		});

		it('should reuse existing tenant tables', async () => {
			// Import the mocked modules
			const pgSchemaSpy = spyOn(d, 'pgSchema');

			// Call the function with a tenant
			Tenancy.wrapTenantSchema('cache-tenant', MockModel.tableName, MockModel.columns);

			// Reset the mock to check if it's called again
			pgSchemaSpy.mockClear();

			// Call the function with the same tenant and model
			Tenancy.wrapTenantSchema('cache-tenant', MockModel.tableName, MockModel.columns);

			// Check if pgSchema was not called again
			expect(pgSchemaSpy).not.toHaveBeenCalled();
		});

		it('should run the callback with the correct tenant', async () => {
			// Import the mocked modules
			const getStoreSpy = spyOn(Application.context, 'getStore');
			const runSpy = spyOn(Application.context, 'run');
			const mockCallback = mock(() => {
				// Check if getStore was called
				expect(getStoreSpy).toHaveBeenCalled();

				// Check if run was called with the correct tenant
				expect(runSpy).toHaveBeenCalledWith(expect.any(Map), expect.any(Function));
				expect(runSpy.mock.calls[0][0].get('tenant')).toBe('new-tenant');

				return 'test-result';
			});

			// Call the function
			const result = Tenancy.withTenant('new-tenant', mockCallback);

			// Check if run was called with the correct callback
			expect(runSpy).toHaveBeenCalledWith(expect.any(Map), mockCallback);

			// Check if the result is correct
			expect(result).toBe('test-result');
		});
	});
});
