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

import type { DrizzleConfig } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { CacheConfig } from 'drizzle-orm/cache/core/types';
import type { CacheInterface } from './cache';

import { getTableName, is, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { Cache as DrizzleCache } from 'drizzle-orm/cache/core';

import { Service } from '@elysiumjs/core';

import { Cache } from './cache';

/**
 * Properties used to create a new database connection.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DatabaseConnectionProps<
	TSchema extends Record<string, unknown> = Record<string, never>
> = Omit<DrizzleConfig<TSchema>, 'cache'> &
	(
		| {
				connection:
					| string
					| ({
							url?: string;
					  } & Bun.SQLOptions);
		  }
		| {
				client: Bun.SQL;
		  }
	) & {
		/**
		 * Configures caching behavior for the database connection.
		 * Set it to `true` to enable caching with default configurations.
		 */
		cache?:
			| true
			| {
					/**
					 * Whether to enable caching.
					 */
					enabled?: boolean;

					/**
					 * The default TTL for cached data, in seconds.
					 * @default 1
					 */
					ttl?: number;

					/**
					 * The caching strategy.
					 * Set it to `all` to cache all queries automatically.
					 * Set it to `explicit` to cache queries manually.
					 * @default 'explicit'
					 */
					strategy?: 'explicit' | 'all';

					/**
					 * The storage engine to use.
					 * @default 'redis'
					 */
					storage?: 'redis' | 'memory';
			  };
	};

/**
 * A database connection.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type DatabaseConnection = BunSQLDatabase<Record<string, never>> & {
	$client: Bun.SQL;
};

/**
 * Database cache implementation for Drizzle.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class DatabaseCache extends DrizzleCache {
	#cache: Omit<CacheInterface, 'tags'>;

	private usedTablesPerKey: Record<string, string[]> = {};

	constructor(
		private readonly cacheStrategy: 'explicit' | 'all' = 'explicit',
		private readonly globalTtl: number = 1,
		storageEngine: 'redis' | 'memory' = 'redis'
	) {
		super();
		this.#cache = Cache[storageEngine].tags('database');
	}

	public override strategy(): 'explicit' | 'all' {
		return this.cacheStrategy;
	}

	public override async get(key: string): Promise<any[] | undefined> {
		const res = (await this.#cache.get<any[]>(key)) ?? undefined;
		return res;
	}

	public override async put(
		key: string,
		response: any,
		tables: string[],
		_isTag: boolean,
		config?: CacheConfig
	): Promise<void> {
		await this.#cache.set(key, response, (config?.ex ?? this.globalTtl) * 1000);
		for (const table of tables) {
			const keys = this.usedTablesPerKey[table];
			if (keys === undefined) {
				this.usedTablesPerKey[table] = [key];
			} else {
				keys.push(key);
			}
		}
	}

	public override async onMutate(params: {
		tags: string | string[];
		tables: string | string[] | Table<any> | Table<any>[];
	}): Promise<void> {
		const tagsArray = params.tags ? (Array.isArray(params.tags) ? params.tags : [params.tags]) : [];
		const tablesArray = params.tables
			? Array.isArray(params.tables)
				? params.tables
				: [params.tables]
			: [];

		const keysToDelete = new Set<string>();

		for (const table of tablesArray) {
			const tableName = is(table, Table) ? getTableName(table) : (table as string);
			const keys = this.usedTablesPerKey[tableName] ?? [];
			for (const key of keys) keysToDelete.add(key);
		}

		if (keysToDelete.size > 0 || tagsArray.length > 0) {
			await this.#cache.mdel(tagsArray);
			await this.#cache.mdel([...keysToDelete]);

			for (const table of tablesArray) {
				const tableName = is(table, Table) ? getTableName(table) : (table as string);
				this.usedTablesPerKey[tableName] = [];
			}
		}
	}
}

export namespace Database {
	/**
	 * Creates a service name for a database connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns A service name for the connection.
	 */
	const getConnectionName = (name: string) => {
		return `db.connection.${name}`;
	};

	/**
	 * Retrieves the connection with the given name.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The connection name.
	 * @returns The connection with the given name.
	 */
	export const getConnection = (name: string) => {
		if (!Service.exists(getConnectionName(name))) {
			// TODO: Use logger service here
			console.error(
				`No connection with name ${name} found. Please make sure to register the connection before using it.`
			);
			process.exit(1);
		}

		return Service.get<DatabaseConnection>(getConnectionName(name))!;
	};

	/**
	 * Creates and registers a new connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 *
	 * This will make the registered connection available for dependency injection with
	 * the key `db.connection.{name}`, where `{name}` is replaced with the given name.
	 *
	 * @param name The connection name.
	 * @param config The connection properties.
	 * @returns The newly created and registered connection.
	 */
	export const registerConnection = (name: string, config: DatabaseConnectionProps) => {
		if (Service.exists(getConnectionName(name))) {
			// TODO: Use logger service here
			console.error(`A connection with the name ${name} has already been registered.`);
			process.exit(1);
		}

		return Service.instance(
			getConnectionName(name),
			drizzle({
				...config,
				cache:
					config.cache === undefined
						? undefined
						: config.cache === true
							? new DatabaseCache()
							: config.cache.enabled
								? new DatabaseCache(config.cache.strategy, config.cache.ttl, config.cache.storage)
								: undefined
			})
		);
	};

	/**
	 * Checks if a connection with the given name exists.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to check.
	 * @returns `true` if the connection exists, `false` otherwise.
	 */
	export const connectionExists = (name: string) => {
		return Service.exists(getConnectionName(name));
	};

	/**
	 * Retrieves the default connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @returns The default connection.
	 */
	export const getDefaultConnection = () => {
		return getConnection('default');
	};

	/**
	 * Sets the default connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to set as default.
	 * @returns The default connection.
	 */
	export const setDefaultConnection = (name: string) => {
		const serviceName = getConnectionName('default');
		Service.remove(serviceName);
		return Service.instance(serviceName, getConnection(name));
	};
}
