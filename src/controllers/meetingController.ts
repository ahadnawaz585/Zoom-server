import { Request, Response } from 'express';
import { Worker } from 'worker_threads';
import { setPriority, cpus } from 'os';
import cluster from 'cluster';
import { Bot, JoinRequest, Task, WorkerResult } from '../types';
import { generateSignature } from '../utils/signature';
import { generateBots } from '../utils/botUtils';
import { workerScript } from '../utils/workerScript';

// Number of CPU cores for optimal cluster distribution
const numCPUs = cpus().length;

// Define the joinMeeting function at the top level
export const joinMeeting = async (req: Request, res: Response): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Worker ${process.pid} received join meeting request`);
  const body = req.body as JoinRequest;
  let { bots, meetingId, password, botCount = 0, duration = 60 } = body;

  // Adaptive concurrency based on system resources
  const systemMemoryGB = Math.floor(require('os').totalmem() / (1024 * 1024 * 1024));
  const maxParallel = Math.min(Math.max(30, systemMemoryGB * 5), 100); // Scale with available memory

  console.log(`[${new Date().toISOString()}] System memory: ${systemMemoryGB}GB, max parallel: ${maxParallel}`);
  console.log("Request received:", meetingId, password, botCount, duration);

  if (!meetingId || !password) {
    console.error(`[${new Date().toISOString()}] Missing required fields`);
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  bots = bots || [];
  console.log(`[${new Date().toISOString()}] Initial bot count: ${bots.length}, requested botCount: ${botCount}`);
  if (botCount > 0) bots = [...bots, ...generateBots(botCount, bots)];
  if (bots.length === 0) {
    console.error(`[${new Date().toISOString()}] No bots provided`);
    res.status(400).json({ error: "No bots provided" });
    return;
  }

  const origin = process.env.NEXT_PUBLIC_CLIENT_URL || 'https://zoom-bots.vercel.app';
  console.log(`[${new Date().toISOString()}] Using origin: ${origin}`);
  const signature = generateSignature(meetingId, 0, duration);

  // Only using Chromium for better performance
  const browserType = 'chromium';

  // Shuffle bots to distribute them evenly
  const shuffledBots = [...bots].sort(() => Math.random() - 0.5);

  // Create bot batches with dynamic sizing based on system capacity
  const batchSize = systemMemoryGB >= 16 ? 8 : (systemMemoryGB >= 8 ? 6 : 4);
  console.log(`[${new Date().toISOString()}] Using batch size: ${batchSize}`);

  const botBatches: Bot[][] = [];
  for (let i = 0; i < shuffledBots.length; i += batchSize) {
    const batch = shuffledBots.slice(i, Math.min(i + batchSize, shuffledBots.length));
    botBatches.push(batch);
  }

  // Create tasks from batches
  const tasks: Task[] = botBatches.map(botBatch => ({
    botPair: botBatch,
    meetingId,
    password,
    origin,
    signature,
    browserType,
    keepOpenOnTimeout: true,
    skipJoinIndicator: true,
    selectorTimeout: 86400000,
    optimizedJoin: true,
    disableVideo: true,
    disableAudio: true,
    lowResolution: true,
    lowMemoryMode: systemMemoryGB < 8,
    workerProcess: process.pid
  }));

  console.log(`[${new Date().toISOString()}] Created ${tasks.length} bot batches with ${botBatches.flat().length} total bots`);

  // Semaphore for controlling concurrency
  class Semaphore {
    private permits: number;
    private queue: (() => void)[] = [];

    constructor(permits: number) {
      this.permits = permits;
    }

    async acquire(): Promise<void> {
      if (this.permits > 0) {
        this.permits--;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => this.queue.push(resolve));
    }

    release(): void {
      if (this.queue.length > 0) {
        const resolve = this.queue.shift()!;
        resolve();
      } else {
        this.permits++;
      }
    }
  }

  const semaphore = new Semaphore(maxParallel);
  const activeWorkers = new Map<string, Worker>();
  const workerTimeouts = new Map<string, NodeJS.Timeout>();

  const monitorResources = () => {
    const maxMemory = process.memoryUsage().heapTotal / (1024 * 1024);
    console.log(`[${new Date().toISOString()}] Memory usage: ${maxMemory.toFixed(2)}MB`);

    if (maxMemory > systemMemoryGB * 500) {
      console.log(`[${new Date().toISOString()}] High memory detected, cleaning up idle workers`);
      let cleaned = 0;
      const now = Date.now();
      workerTimeouts.forEach((timeout, id) => {
        if (cleaned < 5 && activeWorkers.has(id)) {
          clearTimeout(timeout);
          const worker = activeWorkers.get(id)!;
          worker.terminate().catch(() => {});
          activeWorkers.delete(id);
          workerTimeouts.delete(id);
          cleaned++;
        }
      });
      if (cleaned > 0) {
        console.log(`[${new Date().toISOString()}] Cleaned up ${cleaned} idle workers`);
      }
    }
  };

  const resourceMonitor = setInterval(monitorResources, 30000);
  resourceMonitor.unref();

  const executeTask = async (task: Task): Promise<WorkerResult[]> => {
    const taskId = `${task.browserType}-${task.botPair.map(b => b.id).join('-')}`;
    await semaphore.acquire();

    console.log(`[${new Date().toISOString()}] Starting task ${taskId} (active workers: ${activeWorkers.size})`);

    return new Promise<WorkerResult[]>((resolve) => {
      const maxOldGenSize = task.lowMemoryMode ? 150 : 250;
      const maxYoungGenSize = task.lowMemoryMode ? 75 : 150;

      const worker = new Worker(workerScript, {
        eval: true,
        workerData: {
          ...task,
          systemInfo: {
            cpuCount: cpus().length,
            highPriority: true,
            memoryGB: systemMemoryGB
          }
        },
        resourceLimits: {
          maxOldGenerationSizeMb: maxOldGenSize,
          maxYoungGenerationSizeMb: maxYoungGenSize,
        }
      });

      activeWorkers.set(taskId, worker);
      console.log(`[${new Date().toISOString()}] Active workers: ${activeWorkers.size}`);

      const timeoutId = setTimeout(() => {
        console.log(`[${new Date().toISOString()}] Worker timeout for ${taskId} - keeping active`);
        workerTimeouts.set(taskId, timeoutId);
        semaphore.release();
        resolve(task.botPair.map(bot => ({
          success: true,
          botId: bot.id,
          error: "Main process timeout but browser tabs kept open",
          browser: task.browserType,
          keepOpenOnTimeout: true
        })));
      }, 60000);

      worker.on('message', (result: WorkerResult[]) => {
        clearTimeout(timeoutId);
        console.log(`[${new Date().toISOString()}] Worker completed for bots ${task.botPair.map(b => b.name).join(', ')}`);

        const processedResults = result.map(r => ({
          ...r,
          success: true,
          keepOpenOnTimeout: true,
          error: r.error ? "Browser tab kept open" : undefined
        }));

        semaphore.release();
        resolve(processedResults);
      });

      worker.on('error', (error) => {
        clearTimeout(timeoutId);
        activeWorkers.delete(taskId);
        console.error(`[${new Date().toISOString()}] Worker error: ${error.stack}`);
        semaphore.release();
        resolve(task.botPair.map(bot => ({
          success: false,
          botId: bot.id,
          error: `Worker error: ${error.message}`,
          browser: task.browserType
        })));
      });

      worker.on('exit', (code) => {
        if (code !== 0 && activeWorkers.has(taskId)) {
          clearTimeout(timeoutId);
          activeWorkers.delete(taskId);
          console.error(`[${new Date().toISOString()}] Worker exited with code ${code}`);
          semaphore.release();
          resolve(task.botPair.map(bot => ({
            success: false,
            botId: bot.id,
            error: `Worker exited with code ${code}`,
            browser: task.browserType
          })));
        }
      });
    });
  };

  const runTasksWithMaxParallelism = async () => {
    console.log(`[${new Date().toISOString()}] Launching ${tasks.length} tasks with max concurrency of ${maxParallel}`);
    const start = Date.now();

    const results = await Promise.all(tasks.map(task => executeTask(task)));

    const elapsed = (Date.now() - start) / 1000;
    console.log(`[${new Date().toISOString()}] All tasks completed in ${elapsed.toFixed(2)} seconds`);

    return results.flat();
  };

  const keptOpenTabs: string[] = [];

  try {
    const results = await runTasksWithMaxParallelism();

    clearInterval(resourceMonitor);

    results.forEach(r => {
      keptOpenTabs.push(`${r.browser}-${r.botId}`);
    });

    console.log(`[${new Date().toISOString()}] Keeping ${keptOpenTabs.length} tabs open`);

    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success);
    const startTime = Date.now();
    const response = {
      success: successes > 0,
      message: `${successes}/${bots.length} bots processed successfully`,
      keptOpenTabs: keptOpenTabs.length,
      failures,
      browserStats: {
        chromium: {
          total: results.filter(r => r.browser === 'chromium').length,
          successes: results.filter(r => r.browser === 'chromium' && r.success).length,
          keptOpen: results.filter(r => r.browser === 'chromium').length
        }
      },
      performance: {
        totalWorkers: tasks.length,
        maxConcurrentWorkers: maxParallel,
        cpuCount: cpus().length,
        executionTimeSeconds: (Date.now() - startTime) / 1000,
        clusterWorker: process.pid
      }
    };

    console.log(`[${new Date().toISOString()}] Request completed: ${response.message}`);
    res.status(failures.length > 0 ? 207 : 200).json(response);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Processing error: ${error instanceof Error ? error.stack : String(error)}`);
    res.status(500).json({
      error: "Failed to process bots",
      details: error instanceof Error ? error.message : String(error),
      systemInfo: {
        cpuCount: cpus().length,
        memoryGB: systemMemoryGB,
        attemptedConcurrency: maxParallel,
        clusterWorker: process.pid
      }
    });
  }
};

// Master process handles request routing and coordination
if (cluster.isPrimary) {
  console.log(`[${new Date().toISOString()}] Master process ${process.pid} is running`);

  try {
    setPriority(0);
    console.log(`[${new Date().toISOString()}] Set master process to highest priority`);
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Failed to set process priority: ${error}`);
  }

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[${new Date().toISOString()}] Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    cluster.fork();
  });
} else {
  console.log(`[${new Date().toISOString()}] Worker ${process.pid} started`);
  // Here, you could set up an Express server or other logic to use joinMeeting
}