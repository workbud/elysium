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

import { omit } from 'radash';

import { Service } from './service';

/**
 * Properties used to create a new redis connection.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type RedisConnectionProps = Bun.RedisOptions & { url: string };

export namespace Redis {
	/**
	 * Creates a service name for a redis connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns A service name for the connection.
	 */
	const getConnectionName = (name: string) => {
		return `redis.connection.${name}`;
	};

	/**
	 * Retrieves the client for a redis connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection.
	 * @returns The Bun.RedisClient for the connection with the given name.
	 */
	export const getConnection = (name: string) => {
		if (!Service.exists(getConnectionName(name))) {
			// TODO: Use logger service here
			console.error(
				`No Redis connection with name ${name} found. Please make sure to register the connection before using it.`
			);
			process.exit(1);
		}

		return Service.get<Bun.RedisClient>(getConnectionName(name))!;
	};

	/**
	 * Creates and registers a new redis connection.
	 *
	 * This will make the registered connection available for dependency injection with
	 * the key `redis.connection.{name}`, where `{name}` is replaced with the given name.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 *
	 * @param name The name of the connection.
	 * @param config The configuration for the redis connection.
	 * @returns The newly created and registered redis connection.
	 */
	export const registerConnection = (name: string, config: RedisConnectionProps) => {
		if (Service.exists(getConnectionName(name))) {
			// TODO: Use logger service here
			console.error(`A Redis connection with the name ${name} has already been registered.`);
			process.exit(1);
		}

		return Service.instance(
			getConnectionName(name),
			new Bun.RedisClient(config.url, omit(config, ['url']))
		);
	};

	/**
	 * Checks if a redis connection with the given name exists.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to check.
	 * @returns `true` if the connection exists, `false` otherwise.
	 */
	export const connectionExists = (name: string) => {
		return Service.exists(getConnectionName(name));
	};

	/**
	 * Retrieves the default redis connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @returns The default redis connection.
	 */
	export const getDefaultConnection = () => {
		return getConnection('default');
	};

	/**
	 * Sets the default redis connection.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the connection to set as default.
	 * @returns The default redis connection.
	 */
	export const setDefaultConnection = (name: string) => {
		const serviceName = getConnectionName('default');
		Service.remove(serviceName);
		return Service.instance(serviceName, getConnection(name));
	};
}
