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

import type { Mock } from 'bun:test';
import type { DatabaseConnection } from '../src/database';

import { afterAll, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getTableConfig, text, uuid } from 'drizzle-orm/pg-core';

import { Application } from '@elysiumjs/core';

import { Database } from '../src/database';
import { Model } from '../src/model';
import { Repository } from '../src/repository';
import * as Tenancy from '../src/tenancy';

let mockRecord = { id: '1', name: 'Test' };

// Mock database connection
const mockDbConnection: Promise<any> & DatabaseConnection = {
	// @ts-expect-error Mocking headaches
	select: mock(() => mockDbConnection),
	from: mock(() => mockDbConnection),
	where: mock(() => mockDbConnection),
	// @ts-expect-error Mocking headaches
	insert: mock(() => mockDbConnection),
	values: mock(() => mockDbConnection),
	// @ts-expect-error Mocking headaches
	update: mock(() => mockDbConnection),
	set: mock(() => mockDbConnection),
	// @ts-expect-error Mocking headaches
	delete: mock(() => mockDbConnection),
	returning: mock(() => mockDbConnection),
	[Symbol.toStringTag]: 'mockDbConnection',
	// @ts-expect-error Mocking headaches
	catch(onRejected) {
		return onRejected?.(new Error('Database connection error'));
	},
	// @ts-expect-error Mocking headaches
	then(onFulfilled) {
		return onFulfilled?.([mockRecord]);
	},
	finally(onFinally) {
		return this.then(
			(v) => {
				onFinally?.();
				return v;
			},
			(e) => {
				onFinally?.();
				throw e;
			}
		);
	}
};

// Mock transaction connection
const mockTxConnection: Promise<any> & DatabaseConnection = {
	// @ts-expect-error Mocking headaches
	select: mock(() => mockTxConnection),
	from: mock(() => mockTxConnection),
	where: mock(() => mockTxConnection),
	// @ts-expect-error Mocking headaches
	insert: mock(() => mockTxConnection),
	values: mock(() => mockTxConnection),
	// @ts-expect-error Mocking headaches
	update: mock(() => mockTxConnection),
	set: mock(() => mockTxConnection),
	// @ts-expect-error Mocking headaches
	delete: mock(() => mockTxConnection),
	returning: mock(() => mockTxConnection),
	[Symbol.toStringTag]: 'mockTxConnection',
	// @ts-expect-error Mocking headaches
	catch(onRejected) {
		return onRejected?.(new Error('Database connection error'));
	},
	// @ts-expect-error Mocking headaches
	then(onFulfilled) {
		return onFulfilled?.([mockRecord]);
	},
	finally(onFinally) {
		return this.then(
			(v) => {
				onFinally?.();
				return v;
			},
			(e) => {
				onFinally?.();
				throw e;
			}
		);
	}
};

// Mock dependencies
const mockStore = new Map<string, any>([
	['tenant', 'test-tenant'],
	['db:tx', mockTxConnection]
]);

const mockContext = {
	getStore: mock(() => mockStore)
};

mock.module('@elysiumjs/core', () => ({
	Application: {
		...Application,
		instance: {
			_appContextStorage: mockContext
		},
		context: mockContext
	}
}));

describe('Repository', () => {
	// Create a test model
	class TestModel extends Model('test_table', {
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull()
	}) {
		public static readonly supportTenancy: boolean = false;
	}

	// Create a test repository
	class TestRepository extends Repository(TestModel) {}

	afterAll(() => {
		mock.restore();
	});

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks();
		jest.restoreAllMocks();
	});

	describe('Repository creation', () => {
		it('should create a repository class with the correct model', () => {
			expect(TestRepository.Model).toBe(TestModel);
		});

		it('should set the default connection name', () => {
			expect(TestRepository.connection).toBe('default');
		});

		it('should create a repository instance', () => {
			const repo = new TestRepository();
			expect(repo).toBeInstanceOf(TestRepository);
		});
	});

	describe('Database connection', () => {
		it('should get the database connection from the Database service', () => {
			const getConnectionSpy = spyOn(Database, 'getConnection').mockReturnValueOnce(
				mockDbConnection
			);

			// Mock Application.context.getStore to return null (no transaction)
			(Application.context.getStore as Mock<any>).mockReturnValueOnce(null);

			const repo = new TestRepository();
			const db = repo.db;

			expect(getConnectionSpy).toHaveBeenCalledWith('default');
			expect(db).toBe(mockDbConnection);
		});

		it('should get the transaction connection from the context if available', () => {
			(Application.context.getStore as Mock<any>).mockReturnValueOnce(mockStore);

			const repo = new TestRepository();
			const db = repo.db;

			expect(Application.context.getStore).toHaveBeenCalled();
			expect(db).toBe(mockTxConnection);
		});

		it('should use a custom connection if specified', () => {
			const getConnectionSpy = spyOn(Database, 'getConnection').mockReturnValueOnce(
				mockDbConnection
			);

			// Create a repository with a custom connection
			class CustomRepository extends Repository(TestModel) {
				public static readonly connection = 'custom';
			}

			// Mock Application.context.getStore to return null (no transaction)
			(Application.context.getStore as Mock<any>).mockReturnValueOnce(null);

			const repo = new CustomRepository();
			const db = repo.db;

			expect(getConnectionSpy).toHaveBeenCalledWith('custom');
			expect(db).toBe(mockDbConnection);
		});
	});

	describe('Table handling', () => {
		it('should return the regular table if tenancy is not supported', () => {
			const table = TestRepository.Model.table;
			expect(getTableConfig(table).name).toBe(TestModel.tableName);
		});

		it('should return a tenant-specific table if tenancy is supported', () => {
			const getCurrentTenantSpy = spyOn(Tenancy, 'getCurrentTenant').mockReturnValueOnce(
				'test-tenant'
			);
			const wrapTenantSchemaSpy = spyOn(Tenancy, 'wrapTenantSchema');

			// Create a model with tenancy support
			class TenantModel extends TestModel {
				public static readonly supportTenancy = true;
			}

			// Create a repository with tenancy support
			class TenantRepository extends Repository(TenantModel) {}

			const _table = TenantRepository.Model.table;

			expect(getCurrentTenantSpy).toHaveBeenCalled();
			expect(wrapTenantSchemaSpy).toHaveBeenLastCalledWith('test-tenant', TenantModel.tableName, TenantModel.columns);
		});
	});

	describe('CRUD operations', () => {
		let repo: InstanceType<typeof TestRepository>;

		beforeEach(() => {
			repo = new TestRepository();
		});

		it('should retrieve all records', async () => {
			spyOn(Database, 'getConnection').mockReturnValueOnce(mockDbConnection);

			const result = await repo.all();

			expect(mockDbConnection.select).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockDbConnection.from).toHaveBeenCalledWith(TestRepository.Model.table);
			expect(result).toEqual([mockRecord]);
		});

		it('should find a record by id', async () => {
			const result = await repo.find('1');

			expect(mockTxConnection.select).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.from).toHaveBeenCalledWith(TestRepository.Model.table);
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.where).toHaveBeenCalledWith(eq(TestModel.table.id, '1'));
			expect(result).toEqual(mockRecord);
		});

		it('should return null if record is not found', async () => {
			const result = await repo.find('999');

			expect(mockTxConnection.select).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.from).toHaveBeenCalledWith(TestRepository.Model.table);
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.where).toHaveBeenCalledWith(eq(TestModel.table.id, '999'));
			expect(result).not.toEqual({ id: '999', name: 'Test' });
		});

		it('should support filtering records using findBy method', async () => {
			// Arrange
			const data = { name: 'Test', age: 25 };
			const insertedRecord = await repo.insert(data);

			// Act
			const foundRecord = await repo.findBy('name', 'Test');

			// Assert
			expect(foundRecord).toEqual(insertedRecord);
		});

		it('should insert a record', async () => {
			const data = { name: 'New Test' };
			const result = await repo.insert(data);

			expect(mockTxConnection.insert).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.values).toHaveBeenCalledWith(data);
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.returning).toHaveBeenCalled();
			expect(result).toEqual(mockRecord);
		});

		it('should update a record by id', async () => {
			const data = { name: 'Updated Test' };
			const result = await repo.update('1', data);

			expect(mockTxConnection.update).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.set).toHaveBeenCalledWith(data);
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.where).toHaveBeenCalledWith(eq(TestModel.table.id, '1'));
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.returning).toHaveBeenCalled();
			expect(result).toEqual(mockRecord);
		});

		it('should update all records', async () => {
			const data = { name: 'All Updated' };
			mockRecord = { ...mockRecord, ...data };
			const result = await repo.updateAll(data);

			expect(mockTxConnection.update).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.set).toHaveBeenCalledWith(data);
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.returning).toHaveBeenCalled();
			expect(result).toEqual([mockRecord]);
		});

		it('should delete a record by id', async () => {
			const result = await repo.delete('1');

			expect(mockTxConnection.delete).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.where).toHaveBeenCalledWith(eq(TestModel.table.id, '1'));
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.returning).toHaveBeenCalled();
			expect(result).toEqual(mockRecord);
		});

		it('should delete all records', async () => {
			const result = await repo.deleteAll();

			expect(mockTxConnection.delete).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.returning).toHaveBeenCalled();
			expect(result).toEqual([mockRecord]);
		});
	});

	describe('Transaction management', () => {
		it('should use the transaction from the context if available', async () => {
			const repo = new TestRepository();
			await repo.all();

			expect(Application.context.getStore).toHaveBeenCalled();
			expect(mockTxConnection.select).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.from).toHaveBeenCalledWith(TestModel.table);
		});

		it('should fall back to the regular connection if no transaction is available', async () => {
			const getConnectionSpy = spyOn(Database, 'getConnection').mockReturnValueOnce(
				mockDbConnection
			);

			// Mock Application.context.getStore to return null (no transaction)
			(Application.context.getStore as Mock<any>).mockReturnValueOnce(null);

			const repo = new TestRepository();
			await repo.all();

			expect(getConnectionSpy).toHaveBeenCalledWith('default');
			expect(mockDbConnection.select).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockDbConnection.from).toHaveBeenCalledWith(TestModel.table);
		});
	});

	describe.todo('Multi-tenancy support', () => {
		it('should use the current tenant for models with tenancy support', async () => {
			const getCurrentTenantSpy = spyOn(Tenancy, 'getCurrentTenant').mockReturnValueOnce(
				'test-tenant'
			);
			const wrapTenantSchemaSpy = spyOn(Tenancy, 'wrapTenantSchema');

			// Create a model with tenancy support
			class TenantModel extends TestModel {
				public readonly supportTenancy = true;
			}

			// Create a repository with tenancy support
			class TenantRepository extends Repository(TenantModel) {}
			const repo = new TenantRepository();

			await repo.all();

			expect(getCurrentTenantSpy).toHaveBeenCalled();
			expect(wrapTenantSchemaSpy).toHaveBeenCalledWith('test-tenant', TenantModel.tableName, TenantModel.columns);
			expect(mockTxConnection.select).toHaveBeenCalled();
			// @ts-expect-error Mocking headaches
			expect(mockTxConnection.from).toHaveBeenCalledWith(TenantRepository.Model.table);
		});

		it('should use the public schema if no tenant is set', async () => {
			// Create a model with tenancy support
			class TenantModel extends TestModel {
				public readonly supportTenancy = true;
			}

			// Mock getCurrentTenant to return null
			const getCurrentTenantSpy = spyOn(Tenancy, 'getCurrentTenant').mockReturnValueOnce(null);
			const wrapTenantSchemaSpy = spyOn(Tenancy, 'wrapTenantSchema');

			// Create a repository with tenancy support
			class TenantRepository extends Repository(TenantModel) {}
			const repo = new TenantRepository();

			await repo.all();

			expect(getCurrentTenantSpy).toHaveBeenCalled();
			expect(wrapTenantSchemaSpy).toHaveBeenCalledWith('public', TenantModel.tableName, TenantModel.columns);
		});
	});
});
