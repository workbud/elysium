// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

import type { Class } from 'type-fest';
import type { Job } from './job';

import { uid } from 'radash';

import { InteractsWithConsole } from './console';
import { JobStatus } from './job';
import { Service } from './service';
import { Symbols } from './utils';

const BunWorker = globalThis.Worker;
type BunWorker = InstanceType<typeof BunWorker>;

/**
 * Configuration options for a job queue.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export interface QueueOptions {
	/**
	 * The name of the queue.
	 */
	name: string;

	/**
	 * The maximum number of concurrent jobs to process in this queue.
	 * @default 1
	 */
	concurrency?: number;

	/**
	 * The maximum number of retries for failed jobs.
	 * @default 0
	 */
	maxRetries?: number;

	/**
	 * The delay in milliseconds between retries.
	 * @default 1000
	 */
	retryDelay?: number;

	/**
	 * Whether to pause processing when an error occurs.
	 * @default false
	 */
	pauseOnError?: boolean;
}

/**
 * Represents a job in the queue with its metadata.
 * @author Axel Nana <axel.nana@workbud.com>
 */
interface QueuedJob {
	/**
	 * The job instance.
	 */
	job: Job;

	/**
	 * The number of times this job has been retried.
	 */
	retries: number;

	/**
	 * The queue this job belongs to.
	 */
	queueName: string;
}

/**
 * Represents the state of a queue.
 * @author Axel Nana <axel.nana@workbud.com>
 */
interface QueueState {
	/**
	 * The queue configuration options.
	 */
	options: QueueOptions;

	/**
	 * The jobs waiting to be processed.
	 */
	jobs: QueuedJob[];

	/**
	 * The number of jobs currently being processed.
	 */
	processing: number;

	/**
	 * Whether the queue is currently paused.
	 */
	paused: boolean;

	/**
	 * Whether the queue is currently being drained (completing existing jobs but not accepting new ones).
	 */
	draining: boolean;
}

/**
 * Worker class that manages multiple job queues and processes them in parallel.
 * Each queue processes its jobs sequentially by default, but can be configured for concurrency.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class Worker extends InteractsWithConsole {
	readonly #id: string;

	/**
	 * The queues managed by this worker.
	 */
	private queues: Map<string, QueueState> = new Map();

	/**
	 * The default queue name.
	 */
	private defaultQueueName: string = 'default';

	public static spawn(
		thread: BunWorker,
		queues: string[] = ['default'],
		options?: Omit<QueueOptions, 'name'>
	): Worker {
		const worker = new this();

		worker.debug(`Worker ${worker.id} starting with queues: ${queues.join(', ')}`);

		// Create each queue
		for (const queue of queues) {
			worker.createQueue({
				name: queue,
				concurrency: options?.concurrency ?? 1,
				maxRetries: options?.maxRetries ?? 5,
				retryDelay: options?.retryDelay ?? 5000,
				pauseOnError: options?.pauseOnError ?? false
			});
		}

		// Listen for messages from the main thread
		thread.addEventListener('message', async (event) => {
			const { type = 'job:process', jobId, job: jobName, args, queue = 'default' } = event.data;

			// Handle different message types
			switch (type) {
				case 'job:cancel':
					// Cancel a specific job
					const canceled = worker.cancelJob(jobId, queue);
					thread.postMessage({
						type: 'job:canceled',
						jobId,
						queue,
						success: canceled,
						count: canceled ? 1 : 0
					});
					break;

				case 'job:cancelAll':
					// Cancel all jobs in a queue
					const canceledCount = worker.cancelAllJobs(queue);
					thread.postMessage({
						type: 'jobs:canceled',
						queue,
						count: canceledCount
					});
					break;

				case 'job:process':
					worker.debug(`Worker ${worker.id} received job ${jobName} for queue ${queue}`);

					// Handle regular job submission
					try {
						// Get the job class from the service container
						const JobClass = Service.get(jobName) as Class<Job>;

						if (!JobClass) {
							worker.error(`Job class ${jobName} not found`);
							throw new Error(`Job class ${jobName} not found`);
						}

						// Create a new job instance with the provided arguments
						const job = new JobClass(...(args || []));

						// Add the job to the specified queue
						worker.addJob(job, queue);

						// Acknowledge receipt of the job
						thread.postMessage({
							type: 'job:received',
							jobId: job.id,
							queue
						});
					} catch (error: any) {
						worker.trace(
							{ ...error, ...(options ?? {}) },
							`Error while adding job '${jobName}' to queue '${queue}' with worker ${worker.id}`
						);

						// Report the error back to the main thread
						thread.postMessage({
							type: 'job:error',
							jobName,
							error: error.message
						});
					}
					break;
			}
		});

		// Handle errors
		thread.addEventListener('error', (e) => {
			worker.trace({ ...e.error, filename: e.filename }, `Worker ${worker.id} error:`);
		});

		// Handle unhandled promise rejections
		thread.addEventListener('unhandledrejection', (e: any) => {
			worker.trace(e, `Worker ${worker.id} unhandled rejection:`);
		});

		// Report that the worker is ready
		thread.postMessage({
			type: 'worker:ready',
			id: worker.id,
			queues
		});

		return worker;
	}

	/**
	 * Creates a new Worker instance.
	 */
	constructor() {
		super();

		this.#id = uid(24);

		// Initialize the default queue
		this.createQueue({ name: this.defaultQueueName });
	}

	/**
	 * Gets the worker ID.
	 * @returns The worker ID.
	 */
	public get id(): string {
		return this.#id;
	}

	/**
	 * Creates a new queue with the specified options.
	 *
	 * @param options The queue configuration options.
	 * @returns The Worker instance for method chaining.
	 */
	public createQueue(options: QueueOptions): Worker {
		if (this.queues.has(options.name)) {
			this.debug(`Queue with name '${options.name}' already exists`);
			return this;
		}

		const queueState: QueueState = {
			options: {
				...options,
				concurrency: options.concurrency || 1,
				maxRetries: options.maxRetries || 0,
				retryDelay: options.retryDelay || 1000,
				pauseOnError: options.pauseOnError || false
			},
			jobs: [],
			processing: 0,
			paused: false,
			draining: false
		};

		this.queues.set(options.name, queueState);
		this.debug(`Created queue '${options.name}'`);

		return this;
	}

	/**
	 * Adds a job to the specified queue or the default queue if not specified.
	 *
	 * @param job The job to add to the queue.
	 * @param queueName Optional name of the queue to add the job to. Defaults to the default queue.
	 * @returns The Worker instance for method chaining.
	 * @throws Error if the specified queue does not exist.
	 */
	public addJob(job: Job, queueName: string = this.defaultQueueName): Worker {
		const queue = this.queues.get(queueName);

		if (!queue) {
			this.error(`Queue '${queueName}' does not exist`);
			return this;
		}

		if (queue.draining) {
			this.warning(`Queue '${queueName}' is draining, job ${job.id} will not be added`);
			return this;
		}

		const queuedJob: QueuedJob = {
			job,
			retries: 0,
			queueName
		};

		queue.jobs.push(queuedJob);
		this.debug(`Added job ${job.id} to queue '${queueName}'`);

		// Start processing if the queue is not paused and not already at max concurrency
		if (!queue.paused && queue.processing < queue.options.concurrency!) {
			this.processNextJob(queueName);
		}

		return this;
	}

	/**
	 * Pauses a queue, preventing it from processing new jobs.
	 *
	 * @param queueName The name of the queue to pause. If not specified, pauses all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public pause(queueName?: string): Worker {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				queue.paused = true;
				this.info(`Paused queue '${queueName}'`);
			}
		} else {
			// Pause all queues
			for (const [name] of this.queues.entries()) {
				this.pause(name);
			}
		}

		return this;
	}

	/**
	 * Resumes a paused queue.
	 *
	 * @param queueName The name of the queue to resume. If not specified, resumes all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public resume(queueName?: string): Worker {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				queue.paused = false;
				this.info(`Resumed queue '${queueName}'`);
				// Start processing jobs if there are any waiting
				this.processQueueJobs(queueName);
			}
		} else {
			// Resume all queues
			for (const [name] of this.queues.entries()) {
				this.resume(name);
			}
		}

		return this;
	}

	/**
	 * Drains a queue, completing all current jobs but not accepting new ones.
	 *
	 * @param queueName The name of the queue to drain. If not specified, drains all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public drain(queueName?: string): Worker {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				queue.draining = true;
				this.info(`Draining queue '${queueName}'`);
			}
		} else {
			// Drain all queues
			for (const [name] of this.queues.entries()) {
				this.drain(name);
			}
		}

		return this;
	}

	/**
	 * Clears all jobs from a queue.
	 *
	 * @param queueName The name of the queue to clear. If not specified, clears all queues.
	 * @returns The Worker instance for method chaining.
	 */
	public clear(queueName?: string): Worker {
		if (queueName) {
			const queue = this.queues.get(queueName);
			if (queue) {
				const jobCount = queue.jobs.length;
				queue.jobs = [];
				this.info(`Cleared ${jobCount} jobs from queue '${queueName}'`);
			}
		} else {
			// Clear all queues
			for (const [name, queue] of this.queues.entries()) {
				const jobCount = queue.jobs.length;
				queue.jobs = [];
				this.info(`Cleared ${jobCount} jobs from queue '${name}'`);
			}
		}
		return this;
	}

	/**
	 * Gets the number of jobs in a queue.
	 *
	 * @param queueName The name of the queue to get the size of.
	 * @returns The number of jobs in the queue.
	 * @throws Error if the specified queue does not exist.
	 */
	public size(queueName: string = this.defaultQueueName): number {
		const queue = this.queues.get(queueName);
		if (!queue) {
			throw new Error(`Queue '${queueName}' does not exist`);
		}
		return queue.jobs.length;
	}

	/**
	 * Gets the total number of jobs across all queues.
	 *
	 * @returns The total number of jobs.
	 */
	public totalSize(): number {
		let total = 0;
		for (const queue of this.queues.values()) {
			total += queue.jobs.length;
		}
		return total;
	}

	/**
	 * Processes the next job in the specified queue.
	 *
	 * @param queueName The name of the queue to process.
	 */
	private async processNextJob(queueName: string): Promise<void> {
		const queue = this.queues.get(queueName);
		if (!queue || queue.paused || queue.processing >= queue.options.concurrency!) {
			return;
		}

		const queuedJob = queue.jobs.shift();
		if (!queuedJob) {
			return;
		}

		// Skip cancelled jobs
		if (queuedJob.job.status === JobStatus.CANCELLED) {
			this.info(`Skipping cancelled job ${queuedJob.job.id}`);
			queue.processing--;
			this.processQueueJobs(queueName);
			return;
		}

		queue.processing++;

		try {
			this.debug(`Processing job ${queuedJob.job.id} from queue '${queueName}'`);
			await queuedJob.job.run();

			if (queuedJob.job.status === JobStatus.FAILED) {
				// Handle job failure
				if (queuedJob.retries < queue.options.maxRetries!) {
					// Retry the job
					queuedJob.retries++;
					this.warning(
						`Job ${queuedJob.job.id} failed, retrying (${queuedJob.retries}/${queue.options.maxRetries})`
					);

					// Add the job back to the queue after the retry delay
					setTimeout(() => {
						// Check if job was cancelled during the delay
						if (queuedJob.job.status !== JobStatus.CANCELLED) {
							queue.jobs.push(queuedJob);
							this.processQueueJobs(queueName);
						} else {
							this.info(`Skipping cancelled job ${queuedJob.job.id} during retry delay`);
						}
					}, queue.options.retryDelay!);
				} else {
					this.error(`Job ${queuedJob.job.id} failed after ${queuedJob.retries} retries`);

					// Pause the queue if configured to do so
					if (queue.options.pauseOnError) {
						this.pause(queueName);
						this.warning(`Queue '${queueName}' paused due to job failure`);
					}
				}
			} else if (queuedJob.job.status === JobStatus.COMPLETED) {
				this.success(`Job ${queuedJob.job.id} completed successfully`);
			} else {
				this.info(`Job ${queuedJob.job.id} cancelled while running`);
			}
		} catch (error) {
			this.error(`Unexpected error processing job ${queuedJob.job.id}: ${error}`);

			// Pause the queue if configured to do so
			if (queue.options.pauseOnError) {
				this.pause(queueName);
				this.warning(`Queue '${queueName}' paused due to unexpected error`);
			}
		} finally {
			queue.processing--;

			// Process the next job if there are any waiting
			this.processQueueJobs(queueName);
		}
	}

	/**
	 * Processes jobs in a queue up to the concurrency limit.
	 *
	 * @param queueName The name of the queue to process.
	 */
	private processQueueJobs(queueName: string): void {
		const queue = this.queues.get(queueName);
		if (!queue || queue.paused) {
			return;
		}

		// Start processing jobs up to the concurrency limit
		while (queue.jobs.length > 0 && queue.processing < queue.options.concurrency!) {
			this.processNextJob(queueName);
		}
	}

	/**
	 * Gets statistics about all queues.
	 *
	 * @returns An object containing statistics about each queue.
	 */
	public getStats(): Record<
		string,
		{ waiting: number; processing: number; paused: boolean; draining: boolean }
	> {
		const stats: Record<
			string,
			{ waiting: number; processing: number; paused: boolean; draining: boolean }
		> = {};

		for (const [name, queue] of this.queues.entries()) {
			stats[name] = {
				waiting: queue.jobs.length,
				processing: queue.processing,
				paused: queue.paused,
				draining: queue.draining
			};
		}

		return stats;
	}

	/**
	 * Cancels a job by its ID.
	 *
	 * @param jobId The ID of the job to cancel.
	 * @param queueName Optional queue name to search in. If not provided, searches all queues.
	 * @returns `true` if the job was found and canceled, false otherwise.
	 */
	public cancelJob(jobId: string, queueName?: string): boolean {
		if (queueName) {
			// Search in specific queue
			return this.cancelJobInQueue(jobId, queueName);
		} else {
			// Search in all queues
			let canceled = false;
			for (const [name] of this.queues.entries()) {
				if (this.cancelJobInQueue(jobId, name)) {
					canceled = true;
					break;
				}
			}
			return canceled;
		}
	}

	/**
	 * Cancels a job in a specific queue.
	 *
	 * @param jobId The ID of the job to cancel.
	 * @param queueName The name of the queue to search in.
	 * @returns `true` if the job was found and canceled, false otherwise.
	 */
	private cancelJobInQueue(jobId: string, queueName: string): boolean {
		const queue = this.queues.get(queueName);
		if (!queue) {
			return false;
		}

		// Find the job in the queue
		const jobIndex = queue.jobs.findIndex((queuedJob) => queuedJob.job.id === jobId);
		if (jobIndex >= 0) {
			// Mark the job as canceled
			queue.jobs[jobIndex].job.cancel();
			this.info(`Canceled job ${jobId} in queue '${queueName}'`);
			return true;
		}

		return false;
	}

	/**
	 * Cancels all jobs in a queue.
	 *
	 * @param queueName The name of the queue to cancel jobs from. If not provided, cancels jobs in all queues.
	 * @returns The number of jobs canceled.
	 */
	public cancelAllJobs(queueName?: string): number {
		let canceledCount = 0;

		if (queueName) {
			// Cancel jobs in specific queue
			const queue = this.queues.get(queueName);
			if (queue) {
				canceledCount = queue.jobs.length;
				queue.jobs.forEach((queuedJob) => {
					queuedJob.job.cancel();
				});
				this.info(`Canceled ${canceledCount} jobs in queue '${queueName}'`);
			}
		} else {
			// Cancel jobs in all queues
			for (const [name, queue] of this.queues.entries()) {
				const queueCanceledCount = queue.jobs.length;
				queue.jobs.forEach((queuedJob) => {
					queuedJob.job.cancel();
				});
				canceledCount += queueCanceledCount;
				this.info(`Canceled ${queueCanceledCount} jobs in queue '${name}'`);
			}
		}

		return canceledCount;
	}
}

/**
 * A pool of worker threads.
 * @author Axel Nana <axel.nana@workbud.com>
 */
export class WorkerPool extends InteractsWithConsole {
	private workers: BunWorker[] = [];
	private currentWorkerIndex = 0;
	private queueWorkerMap: Map<string, BunWorker[]> = new Map();

	public static readonly instance = new WorkerPool();

	private constructor() {
		super();
	}

	/**
	 * Initialize the worker pool.
	 */
	public async init() {
		// noop for now
	}

	/**
	 * Add a new worker to the pool.
	 * @param queues The queues to listen from the worker.
	 */
	public async addWorker(queues: string[] = []): Promise<void> {
		let worker: BunWorker;

		const isBuild = Bun.main.endsWith('.js');

		if (isBuild) {
			worker = new BunWorker('./index.js', {
				argv: ['work', ...queues.map((queue) => `--queue=${queue}`)]
			});
		} else {
			// Preload all job files to make them available in worker thread.
			const jobFiles = await Array.fromAsync(new Bun.Glob('./src/**/*.job.ts').scan());

			worker = new BunWorker('./index.ts', {
				preload: jobFiles,
				argv: ['work', ...queues.map((queue) => `--queue=${queue}`)]
			});
		}

		worker.addEventListener('error', (e) => {
			this.trace({
				message: 'An error occurred inside a worker process',
				stack: e.message,
				name: 'WorkerError'
			});

			this.removeWorker(worker);
			this.addWorker(queues);
		});

		worker.addEventListener('messageerror', (e) => {
			this.error(`Worker message error: ${e}`);
		});

		worker.addEventListener('message', (e) => {
			if (e.data.type === 'worker:ready') {
				this.debug(`Worker ${e.data.id} ready with queues: ${e.data.queues.join(', ')}`);
			} else if (e.data.type === 'job:received') {
				this.debug(`Job ${e.data.jobId} received by worker for queue ${e.data.queue}`);
			} else if (e.data.type === 'job:error') {
				this.error(`Error processing job ${e.data.jobName}: ${e.data.error}`);
			} else {
				this.debug(`Worker message: ${JSON.stringify(e.data)}`);
			}
		});

		this.workers.push(worker);

		// Map queues to workers for efficient job distribution
		for (const queue of queues) {
			if (!this.queueWorkerMap.has(queue)) {
				this.queueWorkerMap.set(queue, []);
			}
			this.queueWorkerMap.get(queue)!.push(worker);
		}
	}

	/**
	 * Removes a worker from the pool.
	 * @param w The worker to be removed. If not provided, the last worker will be removed.
	 */
	public removeWorker(w?: BunWorker): void {
		const worker = w ?? this.workers.pop();

		if (!worker) return;

		worker.terminate();

		// Remove worker from queue mappings
		for (const [queue, workers] of this.queueWorkerMap.entries()) {
			this.queueWorkerMap.set(
				queue,
				workers.filter((w) => w !== worker)
			);
		}

		if (w) {
			this.workers = this.workers.filter((workerItem) => workerItem !== worker);
		}
	}

	/**
	 * Terminates all workers in the pool.
	 */
	public terminate() {
		while (this.workers.length > 0) {
			this.removeWorker();
		}

		this.queueWorkerMap.clear();
	}

	/**
	 * Runs a job in a worker.
	 * @param job The job class to run.
	 * @param args The class constructor arguments to pass to the job.
	 */
	public runJob<T extends Job, TClass extends Class<T>>(
		job: TClass,
		...args: ConstructorParameters<TClass>
	): void {
		if (!Reflect.hasMetadata(Symbols.job, job)) {
			throw new Error(`Job ${job.name} is not marked with @job() decorator`);
		}

		const { name: jobName, queue = 'default' } = Reflect.getMetadata(Symbols.job, job);

		// Get workers for this queue
		const queueWorkers = this.queueWorkerMap.get(queue) || this.workers;

		if (queueWorkers.length === 0) {
			throw new Error(`No workers available for queue '${queue}'`);
		}

		// Use round-robin to distribute jobs among workers for this queue
		const workerIndex = this.currentWorkerIndex % queueWorkers.length;
		const worker = queueWorkers[workerIndex];

		worker.postMessage({ job: jobName, args, queue });

		// Update the index for next job
		this.currentWorkerIndex = (this.currentWorkerIndex + 1) % this.workers.length;
	}

	/**
	 * Cancels a job in the worker pool.
	 *
	 * @param jobId The ID of the job to cancel.
	 * @param queue Optional queue name to search in.
	 * @returns `true` if a cancellation message was sent to workers.
	 */
	public cancelJob(jobId: string, queue?: string): boolean {
		// We need to send a cancellation message to all workers
		// since we don't know which worker has the job
		for (const worker of this.workers) {
			worker.postMessage({
				type: 'job:cancel',
				jobId,
				queue
			});
		}

		return this.workers.length > 0;
	}

	/**
	 * Cancels all jobs in a queue.
	 *
	 * @param queue Optional queue name to cancel jobs from. If not provided, cancels jobs in all queues.
	 * @returns `true` if a cancellation message was sent to workers.
	 */
	public cancelAllJobs(queue?: string): boolean {
		// Send cancellation message to all workers
		for (const worker of this.workers) {
			worker.postMessage({
				type: 'job:cancelAll',
				queue
			});
		}

		return this.workers.length > 0;
	}
}
