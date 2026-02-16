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

import type { Class } from 'type-fest';

import { isString } from 'radash';

import { Symbols } from './utils';

/**
 * The scope of a service.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export enum ServiceScope {
	/**
	 * A single instance of the service is created and shared everywhere it is injected or retrieved.
	 */
	SINGLETON,

	/**
	 * A new instance of the service is created every time it is injected or retrieved.
	 */
	FACTORY
}

/**
 * A generic service class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type ServiceClass = Class<any>;

/**
 * A typed service class.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type TypedServiceClass<T> = Class<T>;

/**
 * Describes metadata for each registered service.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type ServiceRegistration = {
	/**
	 * The service's scope.
	 */
	scope: ServiceScope;

	/**
	 * A factory function that create the service.
	 *
	 * When `scope` is set to `Scope.SINGLETON`, this function always return the
	 * same instance.
	 *
	 * @returns An instance to the service.
	 */
	factory: () => any;
};

/**
 * Describes the metadata stored for each injected services.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type InjectedService = {
	/**
	 * The name of the injected service. It should match the one used when
	 * registering the service.
	 */
	name: string;

	/**
	 * The index in the constructor where the service is injected.
	 */
	index: number;
};

/**
 * Type for a factory function.
 * @author Axel Nana <axel.nana@workbud.com>
 */
type FactoryFn<T> = () => T extends void ? never : T;

/**
 * Utility function to check if a value is a class.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param value The value to check.
 * @returns `true` if the value is a class, `false` otherwise.
 */
const isClass = <T, V>(value: Class<T> | V): value is Class<T> => {
	return typeof value === 'function' && value.prototype && value.prototype.constructor === value;
};

/**
 * Sentinel value to distinguish "lazy, not yet resolved" from a resolved entry.
 * @author Axel Nana <axel.nana@workbud.com>
 */
const LAZY_SENTINEL = Symbol('lazy');

/**
 * Describes a lazy service entry in the registry.
 * @author Axel Nana <axel.nana@workbud.com>
 */
interface LazyEntry {
	[LAZY_SENTINEL]: true;
	resolver: () => any;
}

/**
 * Type guard to check if a registry entry is a lazy (unresolved) entry.
 * @author Axel Nana <axel.nana@workbud.com>
 */
const isLazy = (value: unknown): value is LazyEntry => {
	return typeof value === 'object' && value !== null && LAZY_SENTINEL in value;
};

/**
 * Storage for registered services.
 * @author Axel Nana <axel.nana@workbud.com>
 */
const servicesRegistry = new Map<string, ServiceRegistration | LazyEntry>();

/**
 * Properties required when declaring a service using the `@service()` decorator.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export type ServiceProps = Partial<{
	/**
	 * The name of the service. If not set, it will default to the service class name.
	 */
	name: string;

	/**
	 * The service's scope.
	 *
	 * Set it to `Scope.SINGLETON` to ensure that only one instance of this service is
	 * used everywhere it is injected or retrieved.
	 *
	 * Set it to `Scope.FACTORY` to ensure that every time you inject or retrieve this
	 * service, you have a new instance created.
	 *
	 * @see ServiceScope
	 */
	scope: ServiceScope;
}>;

export namespace Service {
	/**
	 * Marks a class as a service
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param options The decorator options.
	 */
	export const register = (options?: ServiceProps) => {
		return function (target: ServiceClass) {
			const name = options?.name ?? target.name;
			const scope = options?.scope ?? ServiceScope.SINGLETON;

			if (Service.exists(name)) {
				// TODO: Use the logger service here
				console.error(`A service with the name ${name} has already been registered.`);
				process.exit(1);
			}

			const factory = () => Service.make(target);

			if (scope === ServiceScope.SINGLETON) {
				const service = factory();
				servicesRegistry.set(name, {
					scope,
					factory() {
						return service;
					}
				});
			} else {
				servicesRegistry.set(name, {
					scope,
					factory
				});
			}
		};
	};

	/**
	 * Resolves a registered service and set it as a parameter value.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service An optional name for the service. If not set, the name of the parameter's type is used instead.
	 */
	export const inject = (service?: string | ServiceClass): ParameterDecorator => {
		return function (target, propertyKey, parameterIndex) {
			const services = Reflect.getMetadata(Symbols.services, target, propertyKey!) ?? [];
			const types: Function[] =
				Reflect.getMetadata('design:paramtypes', target, propertyKey!) ?? [];
			const name = isString(service) ? service : (service?.name ?? types[parameterIndex].name);

			services.push({
				name,
				index: parameterIndex
			});

			Reflect.defineMetadata(Symbols.services, services, target, propertyKey!);
		};
	};

	/**
	 * Retrieves a registered service's instance from the container.
	 * Resolves lazy services on first access and caches the result.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The name of the service, or its class.
	 * @returns An instance of the registered service, or `null` if no service with that name/type was registered.
	 */
	export const get = <T>(service: string | TypedServiceClass<T>): T | null => {
		const name = isString(service) ? service : service.name;

		if (exists(name)) {
			const entry = servicesRegistry.get(name)!;

			// Resolve lazy service on first access
			if (isLazy(entry)) {
				const instance = entry.resolver();
				servicesRegistry.set(name, {
					scope: ServiceScope.SINGLETON,
					factory: () => instance
				});
				return instance as T;
			}

			return entry.factory() as T;
		}

		return null;
	};

	/**
	 * Registers a lazy service that is only instantiated on first access.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name The name of the service.
	 * @param resolver A factory function called on first access.
	 */
	export const registerLazy = <T>(name: string, resolver: () => T): void => {
		if (servicesRegistry.has(name) && !isLazy(servicesRegistry.get(name))) {
			throw new Error(`Service ${name} already registered`);
		}
		servicesRegistry.set(name, { [LAZY_SENTINEL]: true, resolver } as LazyEntry);
	};

	/**
	 * Instantiates a service with its dependencies.
	 *
	 * This function always create a new instance of the service, even if the service's scope is `ServiceScope.SINGLETON`
	 * and it has already been registered in the container.
	 *
	 * @author Axel Nana <axel.nana@workbud.com>
	 *
	 * @param service The service class to instantiate.
	 */
	export const make = <T>(service: TypedServiceClass<T>): T => {
		const dependencies: Array<InjectedService> =
			Reflect.getMetadata(Symbols.services, service) ?? [];

		const params: any[] = [];
		dependencies.forEach((dependency) => {
			const s = get(dependency.name);

			if (s === null) {
				// TODO: Use the logger service here
				console.error(
					`Cannot inject service ${dependency.name}. No service was registered with the name: ${dependency.name}`
				);
				process.exit(1);
			}

			params[dependency.index] = s;
		});

		return new service(...params);
	};

	/**
	 * Binds a service to the container and sets it as a singleton.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class to bind.
	 * @param name An optional name for the service. If not set, the name of the service class is used instead.
	 */
	export const bind = <T>(service: TypedServiceClass<T>, name?: string): T => {
		const s = make(service);
		return instance(name ?? service.name, s);
	};

	/**
	 * Binds a service to the container and sets it as a factory.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param name A name for the service.
	 * @param factory The factory function used to instantiate the service.
	 */
	export function factory<T>(name: string, factory: FactoryFn<T>): T;

	/**
	 * Binds a service to the container and sets it as a factory.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class to bind.
	 * @param name An optional name for the service. If not set, the name of the service class is used instead.
	 */
	export function factory<T>(service: TypedServiceClass<T>, name?: string): T;

	/**
	 * Binds a service to the container and sets it as a factory.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param serviceOrName The service class to bind or its name.
	 * @param nameOrFactory The service name or a factory function.
	 */
	export function factory<T>(
		serviceOrName: TypedServiceClass<T> | string,
		nameOrFactory?: FactoryFn<T> | string
	): T {
		const serviceName = isString(serviceOrName)
			? serviceOrName
			: ((nameOrFactory as string | undefined) ?? serviceOrName.name);

		if (exists(serviceName)) {
			// TODO: Use the logger service here
			console.error(`A service with the name ${serviceName} has already been registered.`);
			process.exit(1);
		}

		const factory = () => {
			return isClass(serviceOrName) ? make(serviceOrName) : (nameOrFactory as FactoryFn<T>)();
		};

		servicesRegistry.set(serviceName, {
			scope: ServiceScope.FACTORY,
			factory
		});

		return factory();
	}

	/**
	 * Binds a service's instance to the container.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to bind.
	 * @param instance The instance to bind.
	 */
	export const instance = <T>(service: string | TypedServiceClass<T>, instance: T): T => {
		const serviceName = isString(service) ? service : service.name;

		if (exists(serviceName)) {
			// TODO: Use the logger service here
			console.error(`A service with the name ${serviceName} has already been registered.`);
			process.exit(1);
		}

		servicesRegistry.set(serviceName, {
			scope: ServiceScope.SINGLETON,
			factory() {
				return instance;
			}
		});

		return instance;
	};

	/**
	 * Removes a service from the container.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to remove.
	 */
	export const remove = (service: string | TypedServiceClass<any>): void => {
		const serviceName = isString(service) ? service : service.name;
		servicesRegistry.delete(serviceName);
	};

	/**
	 * Checks if a service exists in the container.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param service The service class or name to check.
	 * @returns `true` if the service exists, `false` otherwise.
	 */
	export const exists = (service: string | TypedServiceClass<any>): boolean => {
		const serviceName = isString(service) ? service : service.name;
		return servicesRegistry.has(serviceName);
	};

	/**
	 * Clears the container.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	export const clear = () => {
		servicesRegistry.clear();
	};

	/**
	 * Returns an array of registered service names matching the given pattern.
	 * Pattern supports '*' (any sequence) and '?' (any single character), similarly to Redis KEYS.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param pattern The glob-like pattern to match service names.
	 * @returns Array of matching service names.
	 */
	export const keys = (pattern: string): string[] => {
		// Escape regex special chars except * and ?
		const regexPattern =
			'^' +
			pattern
				.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&')
				.replace(/\*/g, '.*')
				.replace(/\?/g, '.') +
			'$';
		const regex = new RegExp(regexPattern);
		return Array.from(servicesRegistry.keys()).filter((key) => regex.test(key));
	};
}
