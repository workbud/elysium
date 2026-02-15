#!/usr/bin/env bun
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

import type { PlatformTarget } from './types';

import { PlatformTargetSchema } from './types';
import { BinaryBuilder } from './builder';
import { AssetEmbedder } from './assets';
import { DockerGenerator } from './commands/docker.command';
import { loadConfig } from './config';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
	const config = await loadConfig();

	switch (command) {
		case 'build': {
			const platformFlag = args.indexOf('--platform');
			const allPlatforms = args.includes('--all-platforms');
			const builder = new BinaryBuilder(config);

			if (allPlatforms) {
				const results = await builder.buildAll();
				for (const result of results) {
					console.log(
						`Built ${result.platform}: ${result.outputPath} (${formatSize(result.size)}, ${result.duration}ms)`
					);
				}
			} else if (platformFlag !== -1 && args[platformFlag + 1]) {
				const platform = PlatformTargetSchema.parse(args[platformFlag + 1]);
				const result = await builder.build(platform as PlatformTarget);
				console.log(
					`Built ${result.platform}: ${result.outputPath} (${formatSize(result.size)}, ${result.duration}ms)`
				);
			} else {
				const result = await builder.build();
				console.log(
					`Built ${result.platform}: ${result.outputPath} (${formatSize(result.size)}, ${result.duration}ms)`
				);
			}
			break;
		}

		case 'embed': {
			const embedder = new AssetEmbedder(config);
			const loader = await embedder.embed();
			const outputPath = `${config.output.dir}/__assets__.ts`;
			await Bun.write(outputPath, loader);
			console.log(`Asset loader generated: ${outputPath}`);
			break;
		}

		case 'docker': {
			const outputDir = args[1] ?? '.';
			const generator = new DockerGenerator(config);
			generator.generate(outputDir);
			console.log(`Dockerfile generated in ${outputDir}`);
			break;
		}

		default:
			console.log(`Usage: hephaestus <command>

Commands:
  build                         Build for current platform
  build --platform <target>     Build for specific platform
  build --all-platforms         Build for all configured platforms
  embed                         Generate asset loader
  docker [outputDir]            Generate Dockerfile`);
			break;
	}
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
