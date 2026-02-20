import type { Route } from '@elysiumjs/core';
import type { Elysia, ErrorContext } from 'elysia';

import '#hero/commands/progress-demo.command';
import '#hero/commands/spinner-demo.command';
import '#hero/commands/test.command';

import { Application, Middleware, Service, WorkerPool } from '@elysiumjs/core';
import { HermesLogger } from '@elysiumjs/hermes';

import { MainModule } from '#hero/hero.module';
import { XServerMiddleware } from '#hero/middlewares/x-server.middleware';

@Middleware.register(XServerMiddleware)
@Application.register({
	modules: [MainModule],
	server: {
		name: App.name,
		port: parseInt(process.env.PORT!, 10) || 3000
	},
	debug: false,
	database: {
		default: 'main',
		connections: {
			main: { connection: process.env.DATABASE_URL! }
		}
	},
	redis: {
		default: 'cache',
		connections: {
			cache: { url: process.env.REDIS_URL! }
		}
	},
	wamp: {
		default: 'main',
		connections: {
			main: { url: process.env.WAMP_URL!, realm: 'realm1' }
		}
	},
	swagger: {
		path: '/docs',
		documentation: {
			info: {
				title: 'Elysium',
				description: 'Elysium API Documentation',
				version: '1.0.0'
			}
		}
	},
	'elysium:hermes': {
		level: 'debug',
		format: 'pretty'
	}
})
export class App extends Application {
	protected override async onStart(e: Elysia<Route>) {
		await super.onStart(e);
		await WorkerPool.instance.init();
		WorkerPool.instance.addWorker(['email']);
		WorkerPool.instance.addWorker(['email', 'sync']);
	}

	protected onError(e: ErrorContext): Promise<boolean> {
		Service.get(HermesLogger)?.error(e.error.message, e.error);
		return super.onError(e);
	}
}
