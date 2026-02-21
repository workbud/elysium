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

// @ts-nocheck

import type { PgColumnBuilderBase } from 'drizzle-orm/pg-core';
import type { Class } from 'type-fest';
import type { DatabaseConnection } from './database';
import type { ModelClass } from './model';

import { Application } from '@elysiumjs/core';
import { eq } from 'drizzle-orm';

import { Database } from './database';

/**
 * Database's primary column type.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type IdType = number | string;

/**
 * Interface of a repository.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TModel The type of the model class wrapped by the repository.
 * @template TId The primary column type.
 * @template TColumnsMap The table columns config.
 */
export interface RepositoryInterface<
	TModel extends ModelClass<TTableName, TColumnsMap>,
	TId extends IdType = string,
	TTableName extends string = TModel extends ModelClass<infer TTableName, infer _>
		? TTableName
		: string,
	TColumnsMap extends Record<string, PgColumnBuilderBase> = TModel extends ModelClass<
		TTableName,
		infer TColumnsMap
	>
		? TColumnsMap
		: Record<string, PgColumnBuilderBase>
> {
	/**
	 * Retrieves all the records in the database.
	 * @returns All the records in the database.
	 */
	all(): Promise<TModel['$inferSelect'][]>;

	/**
	 * Retrieves a record by its id.
	 * @param id The id of the record to retrieve.
	 * @returns The record with the given id.
	 */
	find(id: TId): Promise<TModel['$inferSelect'] | null>;

	/**
	 * Inserts a new record in the database.
	 * @param data The data to insert.
	 * @returns The inserted record.
	 */
	insert(data: TModel['$inferInsert']): Promise<TModel['$inferSelect']>;

	/**
	 * Updates a record in the database.
	 * @param id The id of the record to update.
	 * @param data The data to update.
	 * @returns The updated record.
	 */
	update(id: TId, data: TModel['$inferUpdate']): Promise<TModel['$inferSelect']>;

	/**
	 * Updates all the records in the database.
	 * @param data The data to update.
	 * @returns The updated records.
	 */
	updateAll(data: TModel['$inferUpdate']): Promise<TModel['$inferSelect'][]>;

	/**
	 * Deletes a record from the database.
	 * @param id The ID of the record to delete.
	 * @returns The deleted record.
	 */
	delete(id: TId): Promise<TModel['$inferSelect']>;

	/**
	 * Deletes all the records from the database.
	 * @returns All the records in the database.
	 */
	deleteAll(): Promise<TModel['$inferSelect'][]>;

	/**
	 * Checks if a record exists in the database.
	 * @param id The ID of the record to check.
	 * @returns True if the record exists, false otherwise.
	 */
	exists(id: TId): Promise<boolean>;
}

/**
 * Type of a repository class.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TModel The type of the model class wrapped by the repository.
 * @template TId The primary column type.
 * @template TColumnsMap The table columns config.
 */
export type RepositoryClass<
	TModel extends ModelClass<TTableName, TColumnsMap>,
	TId extends IdType = string,
	TTableName extends string = TModel extends ModelClass<infer TTableName, infer _>
		? TTableName
		: string,
	TColumnsMap extends Record<string, PgColumnBuilderBase> = TModel extends ModelClass<
		TTableName,
		infer TColumnsMap
	>
		? TColumnsMap
		: Record<string, PgColumnBuilderBase>
> = Class<RepositoryInterface<TModel, TId, TTableName, TColumnsMap>> & {
	/**
	 * The drizzle's table schema wrapped by the repository.
	 */
	readonly Model: TModel;

	/**
	 * The database connection name to use in the repository.
	 *
	 * Update this value to change the database connection used by this repository.
	 */
	readonly connection: string;
};

/**
 * Mixin used to create a new repository class over a model.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TModel The type of the model class wrapped by the repository.
 * @template TId The primary column type.
 * @template TColumnsMap The table columns config.
 * @template model The model class wrapped by the repository.
 */
export const Repository = <
	TModel extends ModelClass<TTableName, TColumnsMap>,
	TId extends IdType = string,
	TTableName extends string = TModel extends ModelClass<infer TTableName, infer _>
		? TTableName
		: string,
	TColumnsMap extends Record<string, PgColumnBuilderBase> = TModel extends ModelClass<
		TTableName,
		infer TColumnsMap
	>
		? TColumnsMap
		: Record<string, PgColumnBuilderBase>
>(
	model: TModel
) => {
	type TSelect = TModel['$inferSelect'];
	type TInsert = TModel['$inferInsert'];
	type TUpdate = TModel['$inferUpdate'];

	class R implements RepositoryInterface<TModel, TId, TTableName, TColumnsMap> {
		/**
		 * The drizzle's table schema wrapped by this repository.
		 */
		public static readonly Model: TModel = model;

		/**
		 * The database connection name to use.
		 *
		 * Update this value to change the database connection used by this repository.
		 */
		public static readonly connection: string = 'default';

		/**
		 * The database connection used by this repository.
		 */
		public get db(): DatabaseConnection {
			const connection = (this.constructor as RepositoryClass<TModel, TId, TTableName, TColumnsMap>)
				.connection;
			let db: DatabaseConnection | null = null;

			if (connection === 'default') {
				db = (Application.context.getStore()?.get('db:tx') as DatabaseConnection) ?? null;
			}

			return db ?? Database.getConnection(connection);
		}

		/**
		 * Retrieves all the records in the database.
		 * @returns All the records in the database.
		 */
		public async all(): Promise<TSelect[]> {
			return await this.db.select().from(model.table);
		}

		/**
		 * Get a paginated subset of the records in the database.
		 * @param page The page number to retrieve.
		 * @param count The number of records to retrieve per page.
		 * @returns A paginated response containing the records and the total number of records.
		 */
		public async paginate(
			count: number,
			page: number = 1
		): Promise<{ page: number; data: TSelect[]; total: number }> {
			const total = await this.db.$count(model.table);
			const offset = Math.max(page - 1, 0) * count;
			return {
				page,
				total,
				data: await this.db.select().from(model.table).offset(offset).limit(count)
			};
		}

		/**
		 * Retrieves a record by its id.
		 * @param id The id of the record to retrieve.
		 * @returns The record with the given id.
		 */
		public async find(id: TId): Promise<TSelect | null> {
			const [row] = await this.db.select().from(model.table).where(eq(model.table.id, id));
			return (row ?? null) as TSelect | null;
		}

		/**
		 * Finds the first record with a column matching the given value.
		 * @param column The column to filter by.
		 * @param value The value the column should match.
		 * @returns The first record with a column matching the given value.
		 */
		public async findBy<TKey extends keyof TSelect>(
			column: TKey,
			value: TSelect[TKey]
		): Promise<TSelect | null> {
			const [row] = await this.db.select().from(model.table).where(eq(model.table[column], value));
			return (row ?? null) as TSelect | null;
		}

		/**
		 * Inserts a new record in the database.
		 * @param data The data to insert.
		 * @returns The inserted record.
		 */
		public async insert(data: TInsert): Promise<TSelect> {
			const [row] = await this.db.insert(model.table).values(data).returning();
			return row as TSelect;
		}

		/**
		 * Updates a record in the database.
		 * @param id The id of the record to update.
		 * @param data The data to update.
		 * @returns The updated record.
		 */
		public async update(id: TId, data: TUpdate): Promise<TSelect> {
			const [row] = await this.db
				.update(model.table)
				.set(data)
				.where(eq(model.table.id, id))
				.returning();
			return row as TSelect;
		}

		/**
		 * Updates all the records in the database.
		 * @param data The data to update.
		 * @returns The updated records.
		 */
		public async updateAll(data: TUpdate): Promise<TSelect[]> {
			return await this.db.update(model.table).set(data).returning();
		}

		/**
		 * Deletes a record from the database.
		 * @param id The ID of the record to delete.
		 * @returns The deleted record.
		 */
		public async delete(id: TId): Promise<TSelect> {
			const [row] = await this.db.delete(model.table).where(eq(model.table.id, id)).returning();
			return row as TSelect;
		}

		/**
		 * Deletes all the records from the database.
		 * @returns All the records in the database.
		 */
		public async deleteAll(): Promise<TSelect[]> {
			return await this.db.delete(model.table).returning();
		}

		/**
		 * Checks if a record exists in the database.
		 * @param id The ID of the record to check.
		 * @returns True if the record exists, false otherwise.
		 */
		public async exists(id: TId): Promise<boolean> {
			const count = await this.db.$count(model.table, eq(model.table.id, id));
			return count > 0;
		}
	}

	return R;
};
