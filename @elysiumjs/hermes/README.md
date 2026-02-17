# @elysiumjs/hermes

Logging utilities for Elysium.

## Installation

```bash
bun add @elysiumjs/hermes
```

## Usage

```ts
import { HermesLogger } from '@elysiumjs/hermes';

const logger = HermesLogger.make('my-logger');

logger.info('Hello world!');
logger.error('Something went wrong!');
```

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](../../LICENSE) file for more info.
