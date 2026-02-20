import '@elysiumjs/core';

type ErrorResponse<TError extends string, TData> = {
	type: TError;
	data: TData;
};

declare module '@elysiumjs/core' {
	type AppEnv = typeof import('./src/app').env.static;
}
