# Elysium.js

A super-charged web framework for Bun, built on top of ElysiaJS.

Elysium.js is a full-stack, batteries-included framework that brings structure, scalability, and developer ergonomics to [ElysiaJS](https://elysiajs.com/). It provides an opinionated architecture with dependency injection, modular organization, background jobs, CLI tooling, observability, and more -- all running on the [Bun](https://bun.sh/) runtime.

## Features

- **Modular architecture** -- Organize your application into self-contained modules with controllers, services, and repositories.
- **Dependency injection** -- Scoped, singleton, and transient service lifetimes with a built-in DI container.
- **Multiple transport protocols** -- HTTP, WebSocket, and WAMP controllers out of the box.
- **Background job processing** -- Redis-backed job queues with scheduling, retries, concurrency, and priority support.
- **CLI code generators** -- Scaffold controllers, services, models, jobs, middlewares, and entire modules from the command line.
- **Built-in ORM integration** -- First-class Drizzle ORM support with models, repositories, and migrations.
- **Structured logging** -- Multi-transport logger with decorators for automatic method-level logging.
- **Observability** -- OpenTelemetry tracing with decorator-based instrumentation and correlation IDs.
- **Authorization** -- Ability-based roles and permissions middleware.
- **Build and deploy** -- Compilation, bundling, Docker generation, and cross-platform binary building.
- **Multi-tenant support** -- Built-in tenancy module for multi-tenant applications.
- **Caching and Redis** -- Integrated caching layer and Redis client utilities.

## Quick Start

Scaffold a new project with `create-elysium`:

```bash
bun create elysium my-app
cd my-app
bun install
bun run dev
```

The scaffolding CLI offers two project templates:

- **Single-module** -- A minimal starting point with one application module.
- **Multi-module** -- A structured layout with separate modules for different domains.

## Packages

| Package                                                | Version | Description                                                                                                                                                                                         |
| ------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [@elysiumjs/core](./@elysiumjs/core)                   | `0.6.0` | Core framework. Application, controllers, services with DI, modules, models, repositories, commands, middleware, events, caching, Redis, worker pools, multi-tenant support, and console utilities. |
| [@elysiumjs/hermes](./@elysiumjs/hermes)               | `0.3.0` | Structured logging with multiple transports, log levels, `@Logged` decorator, and logger factory.                                                                                                   |
| [@elysiumjs/heracles](./@elysiumjs/heracles)           | `0.6.0` | Redis-based background job processing with scheduling, retries, concurrency, priorities, and CLI queue management.                                                                                  |
| [@elysiumjs/styx](./@elysiumjs/styx)                   | `0.7.0` | CLI code generators for controllers, services, commands, jobs, middlewares, models, repositories, validators, and modules.                                                                          |
| [@elysiumjs/cerberus](./@elysiumjs/cerberus)           | `0.2.1` | Ability-based authorization with roles and permissions middleware.                                                                                                                                  |
| [@elysiumjs/hephaestus](./@elysiumjs/hephaestus)       | `0.2.0` | Build system with compilation, bundling, asset embedding, Docker generation, and cross-platform binary building.                                                                                    |
| [@elysiumjs/argus](./@elysiumjs/argus)                 | `0.1.0` | Observability with OpenTelemetry tracing, `@Traced` decorator, correlation IDs, and SDK integration.                                                                                                |
| [@elysiumjs/plugin-sentry](./@elysiumjs/plugin-sentry) | `0.1.1` | Sentry error reporting integration.                                                                                                                                                                 |
| [create-elysium](./create-elysium)                     | `0.1.9` | Project scaffolding CLI (`bun create elysium`).                                                                                                                                                     |

## Project Structure

```
elysium/
  @elysiumjs/
    core/           # Core framework
    hermes/         # Logging
    heracles/       # Background jobs
    styx/           # CLI / code generators
    cerberus/       # Authorization
    hephaestus/     # Build system
    argus/          # Observability / tracing
    plugin-sentry/  # Sentry integration
  create-elysium/   # Project scaffolding CLI
  example/          # Example application
```

## Development

### Prerequisites

- [Bun](https://bun.sh/) v1.3.9 or later
- [Node.js](https://nodejs.org/) (for Turborepo)
- Redis (required by `@elysiumjs/heracles` and caching features)

### Install dependencies

```bash
bun install
```

### Build all packages

```bash
bun run build
```

### Run tests

```bash
bun run test
```

### Run tests with coverage

```bash
bun run test:coverage
```

### Type checking

```bash
bun run typecheck
```

### Linting

```bash
bun run lint
```

### Versioning and releases

This monorepo uses [Changesets](https://github.com/changesets/changesets) for versioning and [Turborepo](https://turbo.build/) for build orchestration.

```bash
# Add a changeset
bun run changeset

# Apply version bumps
bun run version

# Build and publish
bun run release
```

## License

[Apache 2.0](./LICENSE) -- Workbud Technologies Inc.
