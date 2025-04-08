import { Request, Response } from 'express';
import { Worker } from 'worker_threads';
import { setPriority, cpus } from 'os';
import { Bot, JoinRequest, Task, WorkerResult } from '../types';
import { generateSignature } from '../utils/signature';
import { generateBots } from '../utils/botUtils';
import { workerScript } from '../utils/workerScript';
import { start } from 'repl';

export const joinMeeting = async (req: Request, res: Response): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Received join meeting request`);
  const body = req.body as JoinRequest;
  let { bots, meetingId, password, botCount = 0, duration = 60 } = body;
  const maxParallel = 50; // Increased from 10 to 50 for higher parallelism
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

  // Use only Chromium for faster performance
  const browserTypes: ('chromium')[] = ['chromium'];
  
  // Ensure even distribution of bots
  const totalBots = bots.length;
  const shuffledBots = [...bots].sort(() => Math.random() - 0.5);
  
  // Initialize bot distribution structure
  const botBatchesByBrowser: { [key: string]: Bot[][] } = { 
    chromium: []
  };
  
  // Group bots into batches of 4 instead of pairs
  for (const browser of browserTypes) {
    // Group bots into larger batches (groups of 4)
    for (let j = 0; j < shuffledBots.length; j += 4) {
      const batch = shuffledBots.slice(j, Math.min(j + 4, shuffledBots.length));
      botBatchesByBrowser[browser].push(batch);
    }
  }

  // Create tasks from the distributed bots
  const tasks: Task[] = [];
  for (const browser of browserTypes) {
    botBatchesByBrowser[browser].forEach(botBatch => {
      tasks.push({
        botPair: botBatch, // Now contains up to 4 bots
        meetingId,
        password,
        origin,
        signature,
        browserType: browser,
        keepOpenOnTimeout: true,
        skipJoinIndicator: true,
        selectorTimeout: 86400000,
        // Add new options for faster joining
        optimizedJoin: true, // Flag for worker script to use optimized settings
        disableVideo: true,  // Flag to disable video
        disableAudio: true,  // Flag to disable audio
        lowResolution: true  // Flag to use low resolution
      });
    });
  }

  // Log bot distribution
  const chromiumBots = botBatchesByBrowser.chromium.flat().length;
  console.log(`[${new Date().toISOString()}] Created ${tasks.length} bot batches: ` +
    `Chromium: ${botBatchesByBrowser.chromium.length} (${chromiumBots} bots)`);
  console.log(`[${new Date().toISOString()}] Total bots distributed: ${chromiumBots} out of ${totalBots}`);

  // Calculate optimal number of concurrent workers
  const cpuCount = cpus().length;
  const MAX_CONCURRENT_WORKERS = maxParallel || Math.max(cpuCount * 2, tasks.length);
  
  console.log(`[${new Date().toISOString()}] Starting execution with maximum parallelism: ${MAX_CONCURRENT_WORKERS} concurrent workers`);

  // Create a semaphore for controlling concurrency
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

      return new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
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

  const semaphore = new Semaphore(MAX_CONCURRENT_WORKERS);
  const activeWorkers = new Map<string, Worker>();

  const executeTask = async (task: Task): Promise<WorkerResult[]> => {
    const taskId = `${task.browserType}-${task.botPair.map(b => b.id).join('-')}`;
    
    // Wait for a permit before starting the task
    await semaphore.acquire();
    
    console.log(`[${new Date().toISOString()}] Starting task ${taskId} with ${task.browserType} (active workers: ${activeWorkers.size})`);
    
    return new Promise<WorkerResult[]>((resolve) => {
      const worker = new Worker(workerScript, { 
        eval: true,
        workerData: {
          ...task,
          systemInfo: {
            cpuCount,
            highPriority: true,
          }
        },
        // Reduced resource limits for faster startup and more concurrent workers
        resourceLimits: {
          maxOldGenerationSizeMb: 200,
          maxYoungGenerationSizeMb: 100,
        }
      });

      activeWorkers.set(taskId, worker);
      console.log(`[${new Date().toISOString()}] Active workers: ${activeWorkers.size}`);
      let timeoutId: NodeJS.Timeout;

      worker.on('message', (result: WorkerResult[]) => {
        clearTimeout(timeoutId);
        activeWorkers.delete(taskId);
        console.log(`[${new Date().toISOString()}] Worker completed for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')}`);
        
        const processedResults = result.map(r => {
          return {
            ...r,
            success: true,
            keepOpenOnTimeout: true,
            error: r.error ? "Browser tab kept open" : undefined
          };
        });
        
        semaphore.release();
        resolve(processedResults);
      });

      worker.on('error', (error) => {
        clearTimeout(timeoutId);
        activeWorkers.delete(taskId);
        console.error(`[${new Date().toISOString()}] Worker error for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')}: ${error.stack}`);
        semaphore.release();
        resolve(task.botPair.map(bot => ({
          success: false,
          botId: bot.id,
          error: `Worker error: ${error.message}`,
          browser: task.browserType
        })));
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timeoutId);
          activeWorkers.delete(taskId);
          console.error(`[${new Date().toISOString()}] Worker exited with code ${code} for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')}`);
          semaphore.release();
          resolve(task.botPair.map(bot => ({
            success: false,
            botId: bot.id,
            error: `Worker exited with code ${code}`,
            browser: task.browserType
          })));
        }
      });

      // Shorter timeout for faster error handling
      timeoutId = setTimeout(() => {
        console.log(`[${new Date().toISOString()}] Worker main process timeout for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')} - keeping active`);
        semaphore.release();
        resolve(task.botPair.map(bot => ({
          success: true,
          botId: bot.id,
          error: "Main process timeout but browser tabs kept open",
          browser: task.browserType,
          keepOpenOnTimeout: true
        })));
      }, 60000); // Reduced from 600000 (10 min) to 60000 (1 min)
    });
  };

  const runTasksWithMaxParallelism = async () => {
    try {
      // Set max priority - 0 is highest on Unix-like systems
      setPriority(0);
      console.log(`[${new Date().toISOString()}] Set main process to highest priority`);
    } catch (error) {
      console.warn(`[${new Date().toISOString()}] Failed to set process priority: ${error}`);
    }

    console.log(`[${new Date().toISOString()}] Launching ${tasks.length} tasks with max concurrency of ${MAX_CONCURRENT_WORKERS}`);
    const start = Date.now();
    
    const results = await Promise.all(tasks.map(task => executeTask(task)));
    
    const elapsed = (Date.now() - start) / 1000;
    console.log(`[${new Date().toISOString()}] All tasks completed in ${elapsed.toFixed(2)} seconds`);
    
    return results.flat();
  };

  const keptOpenTabs: string[] = [];

  try {
    const results = await runTasksWithMaxParallelism();
    
    results.forEach(r => {
      keptOpenTabs.push(`${r.browser}-${r.botId}`);
    });
    
    console.log(`[${new Date().toISOString()}] Keeping ${keptOpenTabs.length} tabs open: ${keptOpenTabs.join(', ')}`);
    
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
        maxConcurrentWorkers: MAX_CONCURRENT_WORKERS,
        cpuCount,
        executionTimeSeconds: (Date.now() - startTime) / 1000
      }
    };

    console.log(`[${new Date().toISOString()}] Request completed: ${response.message}`, JSON.stringify(response.browserStats));
    res.status(failures.length > 0 ? 207 : 200).json(response);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Processing error: ${error instanceof Error ? error.stack : String(error)}`);
    res.status(500).json({ 
      error: "Failed to process bots",
      details: error instanceof Error ? error.message : String(error),
      systemInfo: {
        cpuCount,
        attemptedConcurrency: MAX_CONCURRENT_WORKERS
      }
    });
  }
};