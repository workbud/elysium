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

import type { AnyElysia } from 'elysia';
import type { Class } from 'type-fest';
import type { Context } from './http';
import type { LoggerInterface } from './logger';

import { Application } from './app';
import { Service } from './service';
import { Symbols } from './utils';

/**
 * Execute a chain of middlewares, stopping on the first return or throw.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param middlewares The list of middleware instances to execute.
 * @param context The context to pass to each middleware.
 * @param method The method to call on each middleware.
 */
export const executeMiddlewareChain = (
	middlewares: Middleware[],
	context: any,
	method: Exclude<keyof Middleware, 'guards'>
): Promise<any> => {
	return Application.context.run(
		new Map([
			['tenant', context.tenant],
			['http:context', context]
		]),
		async () => {
			for (const middleware of middlewares) {
				try {
					const result = await middleware[method](context);
					if (result !== undefined) {
						return result; // Stop the chain if middleware returns a value
					}
				} catch (error) {
					throw error; // Stop the chain and propagate the error
				}
			}
		}
	);
};

/**
 * Apply a list of middlewares to an Elysia plugin.
 * @author Axel Nana <axel.nana@workbud.com>
 * @param middlewares The list of middlewares to apply.
 * @param plugin The Elysia plugin instance.
 */
export const applyMiddlewares = (middlewares: Class<Middleware>[], plugin: AnyElysia) => {
	const mi = middlewares.map((middleware) => Service.make<Middleware>(middleware));

	plugin.onRequest((c) => {
		return executeMiddlewareChain(mi, c, 'onRequest');
	});

	plugin.onTransform((c) => {
		return executeMiddlewareChain(mi, c, 'onTransform');
	});

	plugin.onBeforeHandle((c) => {
		return executeMiddlewareChain(mi, c, 'onBeforeHandle');
	});

	plugin.onAfterHandle((c) => {
		return executeMiddlewareChain(mi, c, 'onAfterHandle');
	});

	plugin.onAfterResponse((c) => {
		return executeMiddlewareChain(mi, c, 'onAfterResponse');
	});
};

/**
 * Base class for middleware.
 * @author Axel Nana <axel.nana@workbud.com>
 * @template TGuards The list of guards for the middleware.
 */
export abstract class Middleware<TGuards extends string[] = []> {
	/**
	 * Registers a list of middlewares to be applied on a controller or endpoint.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param middlewares The list of middlewares to apply.
	 */
	public static register(...middlewares: Class<Middleware>[]): ClassDecorator & MethodDecorator {
		return function (
			target: Object,
			propertyKey?: string | symbol,
			descriptor?: PropertyDescriptor
		) {
			if (propertyKey === undefined && descriptor === undefined) {
				const m = Reflect.getMetadata(Symbols.middlewares, target) ?? [];
				m.push(...middlewares);
				Reflect.defineMetadata(Symbols.middlewares, m, target);
			} else {
				const m = Reflect.getMetadata(Symbols.middlewares, target, propertyKey!) ?? [];
				m.push(...middlewares);
				Reflect.defineMetadata(Symbols.middlewares, m, target, propertyKey!);
			}
		};
	}

	/**
	 * Creates a guarded version of the middleware.
	 * @author Axel Nana <axel.nana@workbud.com>
	 * @param guards The list of guards for the middleware.
	 * @returns A middleware class decorated with guards.
	 */
	public static guards(guards: string[]): Class<Middleware> {
		class GuardedMiddleware extends this {}
		Reflect.defineMetadata(Symbols.middlewareGuards, guards, GuardedMiddleware);
		return GuardedMiddleware;
	}

	/**
	 * Structured application logger resolved from the service container.
	 * Returns a child logger with the middleware class name in context.
	 * @author Axel Nana <axel.nana@workbud.com>
	 */
	protected get logger(): LoggerInterface {
		const base = Service.get<LoggerInterface>('logger')!;
		return base.child({ middleware: this.constructor.name });
	}

	/**
	 * Gets the list of guards for the middleware.
	 */
	public get guards(): TGuards {
		return Reflect.getMetadata(Symbols.middlewareGuards, this.constructor) ?? [];
	}

	/**
	 * Called first before everything else. This middleware hook works only when used on
	 * a controller, a module, or the application.
	 * @param _ctx The request context.
	 */
	public onRequest(_ctx: Context): any {}

	/**
	 * Called before validation, but after the request has been parsed.
	 * Use this method to modify the request inputs before validation.
	 * @param _ctx The request context.
	 */
	public onTransform(_ctx: Context): any {}

	/**
	 * Called after the request has been handled, but before the response is sent.
	 * @param _ctx The request context.
	 */
	public onAfterHandle(_ctx: Context): any {}

	/**
	 * Called before the request is handled.
	 * @param _ctx The request context.
	 */
	public onBeforeHandle(_ctx: Context): any {}

	/**
	 * Called after the response has been sent.
	 * @param _ctx The request context.
	 */
	public onAfterResponse(_ctx: Context): any {}
}
