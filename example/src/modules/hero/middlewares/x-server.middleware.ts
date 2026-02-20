import type { Context } from '@elysiumjs/core';

import { Middleware } from '@elysiumjs/core';

export class XServerMiddleware extends Middleware {
	public onBeforeHandle(ctx: Context) {
		ctx.set.headers['X-Server'] = 'Elysium';
	}
}
