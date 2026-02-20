import type { Context } from '@elysiumjs/core';

import { Http } from '@elysiumjs/core';

/**
 * Extracts the controller instance from the context.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const co = Http.decorate((c: Context) => {
	return c.controller;
});

/**
 * Extracts the module instance from the context.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export const mo = Http.decorate((c: Context) => {
	return c.module;
});
