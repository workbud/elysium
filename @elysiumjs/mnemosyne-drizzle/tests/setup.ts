import 'reflect-metadata';

import { mock } from 'bun:test';

mock.module('node:async_hooks', () => ({
	AsyncLocalStorage: class {
		public run = mock((_map, callback) => callback());
		public disable = mock();
	}
}));
