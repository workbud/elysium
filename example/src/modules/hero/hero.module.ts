import { Module } from '@elysiumjs/core';

import { UserController } from '#hero/controllers/http/user.controller';
import { TestController } from '#hero/controllers/wamp/test.controller';
import { ChatServerController } from '#hero/controllers/websocket/chat-server.controller';

@Module.register({
	controllers: [UserController, ChatServerController]
})
export class MainModule extends Module {
	public constructor() {
		super();
	}

	public override async afterRegister(): Promise<void> {
		console.log('Module registered successfully');
	}
}
