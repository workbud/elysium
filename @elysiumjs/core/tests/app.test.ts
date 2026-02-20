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

import type { ValueError } from '@sinclair/typebox/value';
import type { AppContext } from '../src/app';

import { AsyncLocalStorage } from 'node:async_hooks';

import { Value } from '@sinclair/typebox/value';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Elysia, t } from 'elysia';

import { Application } from '../src/app';
import * as Env from '../src/env';
import { Event } from '../src/event';
import { Middleware } from '../src/middleware';
import { Module } from '../src/module';
import { Redis } from '../src/redis';
import { Service } from '../src/service';
import { nextTick, Symbols } from '../src/utils';

// Test decorator
describe('@Application.register decorator', () => {
	it('should set metadata on the target class', () => {
		// Create a test class
		@Application.register({
			debug: true,
			modules: [],
			commands: []
		})
		class TestApp extends Application {}

		// Check if metadata was set correctly
		const metadata = Reflect.getMetadata(Symbols.app, TestApp);
		expect(metadata).toBeDefined();
		expect(metadata.debug).toBe(true);
		expect(metadata.modules).toBeArrayOfSize(0);
		expect(metadata.commands).toBeArrayOfSize(0);
	});
});

// Test Application class
describe('Application class', () => {
	// Mock process.exit to prevent tests from exiting
	const originalExit = process.exit;
	const originalStdoutWrite = process.stdout.write;

	let output = '';

	// Reset mocks before each test
	beforeEach(() => {
		process.exit = mock() as any;
		mock.restore();

		process.stdout.write = mock((message) => {
			output += message;
			return true;
		});
	});

	afterEach(() => {
		process.exit = originalExit;
		process.stdout.write = originalStdoutWrite;

		Service.clear();
		output = '';
	});

	describe('constructor', () => {
		it('should register the application instance in the service container', () => {
			const instanceSpy = spyOn(Service, 'instance');

			// Create a test class
			@Application.register({
				debug: true
			})
			class TestApp extends Application {}

			// Create an instance
			new TestApp();

			// Check if the instance was registered
			expect(instanceSpy).toHaveBeenCalledWith('elysium.app', expect.any(TestApp));
		});

		it('should set debug mode from app props', () => {
			// Create a test class with debug mode enabled
			@Application.register({
				debug: true
			})
			class TestApp extends Application {}

			// Create an instance
			const instance = new TestApp();

			// Check if debug mode is set
			expect(instance.isDebug).toBe(true);
		});

		it('should handle the case when no environment configuration is provided', () => {
			const initEnvSpy = spyOn(Env, 'initEnv');

			// Create a test class with no env configuration
			@Application.register()
			class TestApp extends Application {
				// Override run to avoid actual execution
				protected async run(): Promise<void> {
					return Promise.resolve();
				}
			}

			// Create an instance
			new TestApp();

			// Check if initEnv was called with Bun.env
			expect(initEnvSpy).toHaveBeenCalledWith(Bun.env);
		});

		it('should validate and handle invalid environment configuration when debug is enabled', () => {
			// Mock dependencies
			const traceSpy = spyOn(Application.prototype, 'trace');
			const errorFirstMock: ValueError = {
				type: 43,
				path: '/TEST_VAR',
				message: 'Expected string',
				errors: [],
				value: {},
				schema: t.Object({ TEST_VAR: t.String() })
			};
			const valueCheckSpy = spyOn(Value, 'Check').mockReturnValueOnce(false);
			// @ts-expect-error The type is incorrect
			const valueErrorsSpy = spyOn(Value, 'Errors').mockReturnValueOnce({
				First: () => errorFirstMock
			});
			const valueConvertSpy = spyOn(Value, 'Convert').mockReturnValueOnce({});
			const valueCleanSpy = spyOn(Value, 'Clean').mockReturnValueOnce({});
			const initEnvSpy = spyOn(Env, 'initEnv');

			// Create test environment schema
			const envSchema = errorFirstMock.schema;

			// Create a test class with debug mode enabled and environment schema
			@Application.register({
				debug: true,
				env: envSchema
			})
			class TestApp extends Application {
				protected async run(): Promise<void> {
					return Promise.resolve();
				}
			}

			// Create an instance
			new TestApp();

			// Verify that validation was performed and error was traced
			expect(valueCheckSpy).toHaveBeenCalled();
			expect(valueErrorsSpy).toHaveBeenCalled();
			expect(traceSpy).toHaveBeenCalledWith(errorFirstMock, 'Invalid environment configuration');
			expect(valueCleanSpy).toHaveBeenCalled();
			expect(initEnvSpy).toHaveBeenCalledWith({});
		});

		it('should properly initialize environment with Value.Clean result when env is provided', () => {
			// Mock dependencies
			const valueCloneSpy = spyOn(Value, 'Clone').mockReturnValueOnce({ TEST_VAR: 'test_value' });
			const valueConvertSpy = spyOn(Value, 'Convert').mockReturnValueOnce({
				TEST_VAR: 'test_value'
			});
			const valueCheckSpy = spyOn(Value, 'Check').mockReturnValueOnce(true);
			const valueCleanSpy = spyOn(Value, 'Clean').mockReturnValueOnce({
				TEST_VAR: 'cleaned_value'
			});
			const initEnvSpy = spyOn(Env, 'initEnv');

			// Create test environment schema
			const envSchema = t.Object({ TEST_VAR: t.String() });

			// Create a test class with environment schema
			@Application.register({
				env: envSchema
			})
			class TestApp extends Application {
				protected async run(): Promise<void> {
					return Promise.resolve();
				}
			}

			// Create an instance
			new TestApp();

			// Verify that the environment was properly initialized with the cleaned value
			expect(valueCloneSpy).toHaveBeenCalledWith(Bun.env);
			expect(valueConvertSpy).toHaveBeenCalledWith(envSchema, { TEST_VAR: 'test_value' });
			expect(valueCleanSpy).toHaveBeenCalled();
			expect(initEnvSpy).toHaveBeenCalledWith({ TEST_VAR: 'cleaned_value' });
		});

		it('should register Redis connections if provided', () => {
			const registerConnectionSpy = spyOn(Redis, 'registerConnection');
			const connectionExistsSpy = spyOn(Redis, 'connectionExists');
			const setDefaultConnectionSpy = spyOn(Redis, 'setDefaultConnection');

			// Create a test class with Redis configuration
			@Application.register({
				redis: {
					default: 'main',
					connections: {
						main: { url: 'redis://localhost:6379' }
					}
				}
			})
			class TestApp extends Application {}

			// Create an instance
			new TestApp();

			// Check if Redis connections were registered
			expect(registerConnectionSpy).toHaveBeenCalledWith('main', {
				url: 'redis://localhost:6379'
			});
			expect(connectionExistsSpy).toHaveBeenCalledWith('main');
			expect(setDefaultConnectionSpy).toHaveBeenCalledWith('main');
		});

		it('should set default Redis connection only when the specified connection exists', () => {
			// Mock Redis methods
			const registerConnectionSpy = spyOn(Redis, 'registerConnection');
			const connectionExistsSpy = spyOn(Redis, 'connectionExists');
			const setDefaultConnectionSpy = spyOn(Redis, 'setDefaultConnection');

			// First test: connection exists, should set default
			connectionExistsSpy.mockReturnValueOnce(true);

			// Create a test class with Redis configuration where connection exists
			@Application.register({
				redis: {
					default: 'main',
					connections: {
						main: { url: 'redis://localhost:6379' }
					}
				}
			})
			class TestAppWithExistingConnection extends Application {}

			// Create an instance
			new TestAppWithExistingConnection();

			// Check if default Redis connection was set
			expect(registerConnectionSpy).toHaveBeenCalledWith('main', {
				url: 'redis://localhost:6379'
			});
			expect(connectionExistsSpy).toHaveBeenCalledWith('main');
			expect(setDefaultConnectionSpy).toHaveBeenCalledWith('main');

			// Clear calls for next test
			registerConnectionSpy.mockClear();
			connectionExistsSpy.mockClear();
			setDefaultConnectionSpy.mockClear();

			// Second test: connection doesn't exist, should not set default
			connectionExistsSpy.mockReturnValueOnce(false);

			// Create a test class with Redis configuration where connection doesn't exist
			@Application.register({
				redis: {
					default: 'missing',
					connections: {
						other: { url: 'redis://localhost:6380' }
					}
				}
			})
			class TestAppWithMissingConnection extends Application {}

			// Create an instance
			new TestAppWithMissingConnection();

			// Check if registration was called but default connection was not set
			expect(registerConnectionSpy).toHaveBeenCalledWith('other', {
				url: 'redis://localhost:6380'
			});
			expect(connectionExistsSpy).toHaveBeenCalledWith('missing');
			expect(setDefaultConnectionSpy).not.toHaveBeenCalled();
		});

		it('should handle exceptions thrown by the run method', async () => {
			// Mock process.exit to prevent tests from exiting
			const originalExit = process.exit;
			process.exit = mock() as any;

			// Mock Event.emit to verify it's not called when run throws
			const emitSpy = spyOn(Event, 'emit');

			// Create a test class that throws in run()
			@Application.register()
			class ErrorApp extends Application {
				protected async run(): Promise<void> {
					throw new Error('Test error in run method');
				}
			}

			// Create an instance, which should call run() and handle the error
			try {
				new ErrorApp();

				await nextTick(); // run() is called
				await nextTick(); // then/catch is called

				// Verify that the app:launched event was not emitted
				expect(emitSpy).not.toHaveBeenCalledWith(
					'elysium:app:launched',
					expect.any(ErrorApp),
					expect.any(ErrorApp)
				);

				expect(emitSpy).toHaveBeenCalledWith(
					'elysium:error',
					expect.objectContaining({
						message: 'Test error in run method',
						name: 'Error',
						stack: expect.any(String)
					})
				);

				expect(process.exit).toHaveBeenCalledWith(1);
			} finally {
				// Restore original exit function
				process.exit = originalExit;
			}
		});

		it('should emit an event when the application is launched', async () => {
			const emitSpy = spyOn(Event, 'emit');

			// Create a test class
			@Application.register()
			class TestApp extends Application {
				// Override run to avoid actual execution
				protected async run(): Promise<void> {
					return Promise.resolve();
				}
			}

			// Create an instance
			const instance = new TestApp();

			// Wait for the next tick to allow the event to be emitted
			await nextTick(); // run() is called
			await nextTick(); // then/catch is called

			// Check if the event was emitted
			expect(emitSpy).toHaveBeenCalledWith('elysium:app:launched', instance, instance);
		});
	});

	describe('static methods', () => {
		it('should return the application instance', () => {
			// Mock the Service.get method to return a test instance
			const testInstance = {};
			const getSpy = spyOn(Service, 'get').mockReturnValueOnce(testInstance);

			// Call the static method
			const instance = Application.instance;

			// Check if the correct service was requested
			expect(getSpy).toHaveBeenCalledWith('elysium.app');
			expect(instance).toBe(testInstance as Application);
		});

		it('should return the application context', () => {
			// Create a mock context
			const mockContext: AppContext = new AsyncLocalStorage();

			// Mock the Application.instance getter
			const mockInstance = {
				_appContextStorage: mockContext
			};

			// Use Object.defineProperty to mock the getter
			const originalDescriptor = Object.getOwnPropertyDescriptor(Application, 'instance');
			Object.defineProperty(Application, 'instance', {
				get: () => mockInstance
			});

			expect(Application.instance).toBe(mockInstance as unknown as Application);

			// Call the static method
			const context = Application.context;

			// Check if the correct context was returned
			expect(context).toBe(mockContext);

			// Restore the original descriptor
			if (originalDescriptor) {
				Object.defineProperty(Application, 'instance', originalDescriptor);
			}
		});
	});

	describe('getters and setters', () => {
		it('should get and set debug mode', () => {
			// Create a test class
			@Application.register({
				debug: false
			})
			class TestApp extends Application {
				// Override run to avoid actual execution
				protected async run(): Promise<void> {
					return Promise.resolve();
				}
			}

			// Create an instance
			const instance = new TestApp();

			// Check initial debug mode
			expect(instance.isDebug).toBe(false);

			// Set debug mode
			instance.isDebug = true;

			// Check if debug mode was set
			expect(instance.isDebug).toBe(true);
		});

		it('should get the Elysia instance', () => {
			// Create a test class
			@Application.register()
			class TestApp extends Application {
				// Override run to directly call commandServe to initialize Elysia
				protected async run(): Promise<void> {
					// @ts-expect-error The commandServe method is private
					return this.commandServe();
				}
			}

			// Create an instance
			const instance = new TestApp();

			// Check if the Elysia instance is accessible
			expect(instance.elysia).toBeDefined();
		});
	});

	describe('lifecycle hooks', () => {
		it('should call onStart when the server starts', async () => {
			// Create a test class with an overridden onStart method
			@Application.register()
			class TestApp extends Application {
				protected async onStart(): Promise<void> {}

				// Override run to avoid actual execution
				protected async run(): Promise<void> {
					// @ts-expect-error The commandServe method is private
					return this.commandServe();
				}
			}

			// Create a spy on the onStart method
			// @ts-expect-error The onStart method is protected
			const onStartSpy = spyOn(TestApp.prototype, 'onStart');
			const emitSpy = spyOn(Event, 'emit');

			// Create an instance
			const instance = new TestApp();

			await nextTick();

			// Check if onStart was called
			expect(onStartSpy).toHaveBeenCalledWith(instance.elysia);
			expect(emitSpy).toHaveBeenLastCalledWith('elysium:server:start', instance.elysia, instance);
		});

		it('should call onStop when the server stops', async () => {
			// Create a test class with an overridden onStop method
			@Application.register()
			class TestApp extends Application {
				protected async onStop(): Promise<void> {
					// Do nothing
				}

				// Override run to avoid actual execution
				protected async run(): Promise<void> {
					// @ts-expect-error The commandServe method is private
					return this.commandServe();
				}
			}

			// Create a spy on the onStop method
			// @ts-expect-error The onStop method is protected
			const onStopSpy = spyOn(TestApp.prototype, 'onStop');
			const emitSpy = spyOn(Event, 'emit');

			// Create an instance
			const instance = new TestApp();

			await nextTick();
			process.emit('SIGINT');
			await nextTick();

			// Check if onStop was called
			expect(onStopSpy).toHaveBeenCalledWith(instance.elysia);
			expect(emitSpy).toHaveBeenCalledWith('elysium:server:stop', instance.elysia, instance);
		});

		it('should call onError when an error occurs', async () => {
			// Create a test class with an overridden onError method
			@Application.register()
			class TestApp extends Application {
				protected async onError(): Promise<boolean> {
					return true;
				}

				// Override run to avoid actual execution
				protected async run(): Promise<void> {
					// @ts-expect-error The commandServe method is private
					return this.commandServe();
				}
			}

			// Create a spy on the onError method
			// @ts-expect-error The onError method is protected
			const onErrorSpy = spyOn(TestApp.prototype, 'onError');
			const emitSpy = spyOn(Event, 'emit');

			// Create an instance
			const instance = new TestApp();
			await nextTick();

			instance.elysia.get('/', ({ error }) => {
				throw error(500, 'Test error');
			});
			instance.elysia.listen(3131);

			const response = await instance.elysia.handle(new Request('http://localhost:3131/'));
			await nextTick();

			// Check error is parsed correctly
			expect(response.status).toBe(500);
			expect(response.json()).toEqual(
				expect.resolvesTo.objectContaining({
					type: 'INTERNAL_SERVER_ERROR',
					data: {
						message: 'Test error'
					}
				})
			);

			// Check if onError was called
			expect(onErrorSpy).toHaveBeenCalledWith(expect.anything());
			expect(emitSpy).toHaveBeenCalledWith('elysium:error', expect.anything());
		});
	});

	describe('module registration', () => {
		it('should register modules correctly', async () => {
			const bindSpy = spyOn(Service, 'bind');

			@Module.register()
			class TestModule1 extends Module {}

			@Module.register()
			class TestModule2 extends Module {}

			// Create a test class with modules
			@Application.register({
				modules: [TestModule1, TestModule2]
			})
			class TestApp extends Application {
				// Override run to directly call commandServe
				protected async run(): Promise<void> {
					// @ts-expect-error The commandServe method is private
					return this.commandServe();
				}
			}

			// Spies the use function
			const useSpy = spyOn(Elysia.prototype, 'use');

			// Create an instance
			new TestApp();

			// Check if modules were registered correctly
			await nextTick();
			expect(bindSpy).toHaveBeenCalledWith(TestModule1);

			await nextTick();
			expect(bindSpy).toHaveBeenCalledWith(TestModule2);

			await nextTick();
			expect(useSpy).toHaveBeenCalledTimes(2);
		});
	});

	describe('middleware application', () => {
		it('should apply middlewares correctly', async () => {
			// Mock the applyMiddlewares function
			const mi = await import('../src/middleware');
			const applyMiddlewaresSpy = spyOn(mi, 'applyMiddlewares');

			try {
				class Middleware1 extends Middleware {}
				class Middleware2 extends Middleware {}

				// Create mock middlewares
				const mockMiddlewares = [Middleware1, Middleware2];

				// Set middlewares metadata
				@Application.register()
				class TestApp extends Application {
					// Override run to directly call commandServe
					protected async run(): Promise<void> {
						// @ts-expect-error The commandServe method is private
						return this.commandServe();
					}
				}

				// Apply app decorator

				// Set middlewares metadata
				Reflect.defineMetadata(Symbols.middlewares, mockMiddlewares, TestApp);

				// Create an instance
				const instance = new TestApp();
				await nextTick();

				// Check if middlewares were applied correctly
				expect(applyMiddlewaresSpy).toHaveBeenCalledWith(mockMiddlewares, instance.elysia);
			} finally {
				// Restore the original function
				applyMiddlewaresSpy.mockRestore();
			}
		});
	});

	describe('command methods', () => {
		it('should handle the serve command', async () => {
			// Create a test class
			@Application.register({
				server: { port: 3131 },
				modules: [],
				swagger: false
			})
			class TestApp extends Application {
				// Override run to directly call commandServe
				protected async run(): Promise<void> {
					// @ts-expect-error The commandServe method is private
					return this.commandServe();
				}
			}

			Event.on('elysium:server:after-init', async (e) => {
				spyOn(e.source.elysia, 'listen');
			});

			// Create an instance
			const instance = new TestApp();

			await nextTick();

			// Check if Elysia was initialized correctly
			expect(instance.elysia.listen).toHaveBeenCalledWith(3131);
		});

		it('should handle the exec command', async () => {
			// Create a mock command class
			const mockCommand = {
				command: 'test',
				description: 'Test command'
			};

			// Create a mock command instance
			const mockCommandInstance = {
				init: mock().mockResolvedValue(true),
				run: mock().mockResolvedValue(undefined)
			};

			// Mock Service.make to return the mock command instance
			const makeSpy = spyOn(Service, 'make').mockReturnValueOnce(mockCommandInstance);

			// Create a test class
			@Application.register({
				commands: [mockCommand as any]
			})
			class TestApp extends Application {
				// Override run to directly call commandExec
				protected async run(): Promise<void> {
					// @ts-expect-error The commandExec method is private
					return this.commandExec('test', ['arg1', 'arg2']);
				}
			}

			// Create an instance
			new TestApp();
			await nextTick();

			// Check if the command was executed correctly
			expect(makeSpy).toHaveBeenCalledWith(mockCommand);
			expect(mockCommandInstance.init).toHaveBeenCalledWith('arg1', 'arg2');
			expect(mockCommandInstance.run).toHaveBeenCalled();

			await nextTick();
			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('should handle the work command', async () => {
			// Mock the Worker module
			mock.module('../src/worker', () => ({
				Worker: {
					spawn: mock().mockReturnThis()
				}
			}));

			// Create a test class with a public commandWork method
			@Application.register()
			class TestApp extends Application {
				// Make commandWork public for testing
				protected async run(): Promise<void> {
					// @ts-expect-error The commandWork method is private
					return super.commandWork(['--queue=test', '--concurrency=2']);
				}
			}

			// Create an instance
			new TestApp();
			await nextTick();

			// Check if Worker.spawn was called
			const workerModule = await import('../src/worker');
			expect(workerModule.Worker.spawn).toHaveBeenCalled();
		});

		it('should handle the list command', async () => {
			// Create mock command classes
			const mockCommands = [
				{ command: 'test:one', description: 'Test command one' },
				{ command: 'test:two', description: 'Test command two' }
			];

			let output = '';
			process.stdout.write = mock((message: string) => {
				output += message;
				return true;
			});

			// Create a test class
			@Application.register({
				commands: mockCommands as any
			})
			class TestApp extends Application {
				protected async run(): Promise<void> {
					// @ts-expect-error The commandList method is private
					return super.commandList();
				}
			}

			// Create an instance
			new TestApp();
			await nextTick();

			// Check if the commands were listed correctly
			expect(process.stdout.write).toHaveBeenCalled();
			expect(output).toContain('test:one');
			expect(output).toContain('test:two');
			expect(output).toContain('Test command one');
			expect(output).toContain('Test command two');
			expect(process.exit).not.toHaveBeenCalled(); // commandList doesn't exit
		});

		it('should handle the help command', async () => {
			const makeSpy = spyOn(Service, 'make');

			// Create a mock command class
			const mockCommand = {
				command: 'test',
				description: 'Test command'
			};

			// Create a mock command instance
			const mockCommandInstance = {
				help: mock().mockResolvedValue('Test command help text')
			};

			let output = '';
			process.stdout.write = mock((message: string) => {
				output += message;
				return true;
			});

			// Mock Service.make to return the mock command instance
			makeSpy.mockImplementationOnce((service) =>
				service === (mockCommand as any) ? (mockCommandInstance as any) : undefined
			);

			// Save original argv
			const originalArgv = process.argv;

			try {
				// Mock argv for help command
				process.argv = ['bun', 'styx', 'help', 'test'];

				// Create a test class with a modified run method
				@Application.register({
					commands: [mockCommand as any]
				})
				class TestApp extends Application {}

				// Create an instance
				new TestApp();

				await nextTick();

				// Check if the help was displayed correctly
				expect(makeSpy).toHaveBeenCalledWith(mockCommand);
				expect(mockCommandInstance.help).toHaveBeenCalled();
				expect(output).toContain('Test command help text');
			} finally {
				// Restore original argv
				process.argv = originalArgv;
			}
		});

		it('should handle the describe command', async () => {
			// Create a mock command class
			const mockCommand = {
				command: 'test',
				description: 'Test command'
			};

			let output = '';
			process.stdout.write = mock((message: string) => {
				output += message;
				return true;
			});

			// Create a test class
			@Application.register({
				commands: [mockCommand as any]
			})
			class TestApp extends Application {
				public async run(): Promise<void> {
					// @ts-expect-error The commandDescribe method is private
					return super.commandDescribe();
				}
			}

			// Create an instance
			new TestApp();

			await nextTick();

			// Check if the description was displayed correctly
			expect(output).toContain('Usage:');
			expect(output).toContain('Commands:');
		});
	});
});
