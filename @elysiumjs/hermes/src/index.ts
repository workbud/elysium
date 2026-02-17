// Copyright (c) 2026-present Workbud Technologies Inc. All rights reserved.
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

import type { HermesConfig } from './types';

import { Application, Service } from '@elysiumjs/core';

import { HermesLogger } from './services/logger.service';

// Lazy singleton resolver: reads config from Application on first access.
let hermesInstance: HermesLogger | null = null;
const hermesResolver = () => {
	if (!hermesInstance) {
		const app = Service.get<Application>('elysium.app');
		const config = app?.getConfig<Partial<HermesConfig>>('elysium:hermes');
		hermesInstance = new HermesLogger(config ?? {});
	}
	return hermesInstance;
};

Service.registerLazy(HermesLogger.name, hermesResolver);
Service.registerLazy('logger', hermesResolver);

export { HermesLogger } from './services/logger.service';
export { HttpTransport } from './transports/http.transport';
export type { HttpTransportOptions } from './transports/http.transport';
export { Logged } from './decorators/logged';
export type { LoggedOptions } from './decorators/logged';
export type { HermesConfig, LogLevel, LogFormat, TransportConfig } from './types';
