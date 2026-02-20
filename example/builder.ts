try {
	const result = await Bun.build({
		entrypoints: ['./index.ts'],
		outdir: './dist',
		target: 'bun'
	});

	if (result.logs.length > 0) {
		console.warn('Build succeeded with warnings:');
		for (const message of result.logs) {
			// Bun will pretty print the message object
			console.warn(message);
		}
	}
} catch (e) {
	// TypeScript does not allow annotations on the catch clause
	const error = e as AggregateError;
	console.error('Build Failed');

	// Example: Using the built-in formatter
	console.error(error);

	// Example: Serializing the failure as a JSON string.
	console.error(JSON.stringify(error, null, 2));
}
