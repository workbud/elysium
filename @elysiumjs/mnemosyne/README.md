# @elysiumjs/mnemosyne

Database and caching for Elysium.js applications.

## Installation

```bash
bun add @elysiumjs/mnemosyne
```

## Usage

```ts
import { Database, Model, Repository } from '@elysiumjs/mnemosyne';
import { Service, ServiceScope } from '@elysiumjs/core';
import { uuid, varchar } from 'drizzle-orm/pg-core';

// Define a model
class UserModel extends Model('users', {
	id: uuid().primaryKey().defaultRandom(),
	name: varchar({ length: 255 }).notNull(),
}) {
	public static readonly supportTenancy = true;
}

// Create a repository
@Service.register({ name: 'UserRepository', scope: ServiceScope.SINGLETON })
class UserRepository extends Repository(UserModel) {}
```

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
