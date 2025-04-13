import { Request, Response } from 'express';
import { Worker } from 'worker_threads';
import { setPriority, cpus } from 'os';
import { Bot, JoinRequest, Task, WorkerResult } from '../types';
import { generateSignature } from '../utils/signature';
import { generateBots } from '../utils/botUtils';
import { workerScript } from '../utils/workerScript';

// Store active workers with their scheduled termination times
interface ActiveWorkerInfo {
  worker: Worker;
  terminationTimeout: NodeJS.Timeout;
  startTime: number;
  duration: number; // in minutes
  botCount: number; // number of bots managed by this worker
}

// Global map to track all active workers across requests
const globalActiveWorkers = new Map<string, ActiveWorkerInfo>();

export const joinMeeting = async (req: Request, res: Response): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Received join meeting request`);
  const body = req.body as JoinRequest;
  let { bots, meetingId, password, botCount = 0, duration = 60 } = body;
  
  // Configuration options with sensible defaults
  const config = {
    maxBotsPerWorker: parseInt(process.env.MAX_BOTS_PER_WORKER || '6'), // Configurable batch size
    maxConcurrentWorkers: parseInt(process.env.MAX_CONCURRENT_WORKERS || '50'),
    minBotsPerWorker: parseInt(process.env.MIN_BOTS_PER_WORKER || '1'), // For smaller batches
    workerTimeout: parseInt(process.env.WORKER_TIMEOUT || '60000'), // 1 minute timeout for worker to report back
    gracePeriod: parseInt(process.env.GRACE_PERIOD || '5000'), // 5 seconds for cleanup
  };
  
  console.log(`[${new Date().toISOString()}] Request received: meetingId=${meetingId}, botCount=${botCount}, duration=${duration}`);

  if (!meetingId || !password) {
    console.error(`[${new Date().toISOString()}] Missing required fields`);
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // Convert duration to minutes if it's not already
  duration = Math.max(1, Math.floor(duration)); // Ensure minimum 1 minute and integer value
  console.log(`[${new Date().toISOString()}] Using duration: ${duration} minutes`);

  bots = bots || [];
  console.log(`[${new Date().toISOString()}] Initial bot count: ${bots.length}, requested additional botCount: ${botCount}`);
  
  // Generate additional bots if needed
  if (botCount > 0) {
    bots = [...bots, ...generateBots(botCount, bots)];
  }
  
  if (bots.length === 0) {
    console.error(`[${new Date().toISOString()}] No bots provided`);
    res.status(400).json({ error: "No bots provided" });
    return;
  }

  const origin = process.env.NEXT_PUBLIC_CLIENT_URL || 'https://zoom-bots.vercel.app';
  console.log(`[${new Date().toISOString()}] Using origin: ${origin}`);
  const signature = await generateSignature(meetingId, 0, duration);

  // Use only Chromium for faster performance
  const browserType = 'chromium';
  
  // Shuffle bots for random distribution
  const shuffledBots = [...bots].sort(() => Math.random() - 0.5);
  
  // Calculate optimal batch size based on total bots
  const totalBots = shuffledBots.length;
  const cpuCount = cpus().length;
  
  // Adaptive batch sizing algorithm:
  // - For smaller sets (< 4 bots), just use one bot per worker
  // - For medium sets (4-20 bots), use 2-4 bots per worker
  // - For larger sets (>20 bots), aim for maxBotsPerWorker (6 by default)
  let optimalBotsPerWorker = config.maxBotsPerWorker;
  
  if (totalBots < 4) {
    optimalBotsPerWorker = config.minBotsPerWorker; // Use 1 bot per worker for very small groups
  } else if (totalBots <= 20) {
    // For medium groups, find a divisor that makes sense
    optimalBotsPerWorker = Math.min(4, Math.ceil(totalBots / Math.ceil(totalBots / 4)));
  }
  
  // Create batches based on calculated optimal size
  const botBatches: Bot[][] = [];
  for (let i = 0; i < shuffledBots.length; i += optimalBotsPerWorker) {
    const batch = shuffledBots.slice(i, Math.min(i + optimalBotsPerWorker, shuffledBots.length));
    botBatches.push(batch);
  }
  
  // Create tasks from the batches
  const tasks: Task[] = botBatches.map(batch => ({
    botPair: batch, // Now contains optimal number of bots
    meetingId,
    password,
    origin,
    signature,
    browserType,
    keepOpenOnTimeout: true,
    skipJoinIndicator: true,
    selectorTimeout: 86400000,
    // Add new options for faster joining
    optimizedJoin: true, // Flag for worker script to use optimized settings
    disableVideo: true,  // Flag to disable video
    disableAudio: true,  // Flag to disable audio
    lowResolution: true, // Flag to use low resolution
    duration: duration * 60 * 1000, // Convert minutes to milliseconds for worker
  }));

  // Log bot distribution
  console.log(`[${new Date().toISOString()}] Created ${tasks.length} bot batches with ${optimalBotsPerWorker} bots per batch (optimal)`);
  console.log(`[${new Date().toISOString()}] Total bots: ${totalBots}, Batches: ${botBatches.length}`);

  // Calculate optimal number of concurrent workers
  const MAX_CONCURRENT_WORKERS = Math.min(
    config.maxConcurrentWorkers, 
    Math.max(cpuCount * 2, tasks.length)
  );
  
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

  // Function to schedule worker termination after duration
  const scheduleWorkerTermination = (taskId: string, worker: Worker, durationMinutes: number, botCount: number): NodeJS.Timeout => {
    const durationMs = durationMinutes * 60 * 1000;
    
    console.log(`[${new Date().toISOString()}] Scheduling termination for task ${taskId} with ${botCount} bots after ${durationMinutes} minutes`);
    
    return setTimeout(() => {
      try {
        console.log(`[${new Date().toISOString()}] Duration expired for task ${taskId} - terminating worker`);
        
        // Send termination message to worker to allow graceful cleanup
        worker.postMessage({ type: 'TERMINATE' });
        
        // After a short grace period, forcefully terminate if still running
        setTimeout(() => {
          if (globalActiveWorkers.has(taskId)) {
            console.log(`[${new Date().toISOString()}] Force terminating worker for task ${taskId}`);
            worker.terminate();
            activeWorkers.delete(taskId);
            globalActiveWorkers.delete(taskId);
          }
        }, config.gracePeriod);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error terminating worker for task ${taskId}: ${error}`);
      }
    }, durationMs);
  };

  const executeTask = async (task: Task): Promise<WorkerResult[]> => {
    const taskId = `${task.browserType}-${task.botPair.map(b => b.id).join('-')}`;
    
    // Wait for a permit before starting the task
    await semaphore.acquire();
    
    console.log(`[${new Date().toISOString()}] Starting task ${taskId} with ${task.browserType} for ${task.botPair.length} bots (active workers: ${activeWorkers.size})`);
    
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
        // Dynamic resource limits based on batch size
        resourceLimits: {
          maxOldGenerationSizeMb: 150 + (task.botPair.length * 25), // Scale with bot count
          maxYoungGenerationSizeMb: 75 + (task.botPair.length * 10),
        }
      });

      activeWorkers.set(taskId, worker);
      
      // Schedule termination after duration minutes
      const terminationTimeout = scheduleWorkerTermination(taskId, worker, duration, task.botPair.length);
      
      // Store in global map with termination info
      globalActiveWorkers.set(taskId, {
        worker,
        terminationTimeout,
        startTime: Date.now(),
        duration,
        botCount: task.botPair.length
      });
      
      console.log(`[${new Date().toISOString()}] Active workers: ${activeWorkers.size}, will terminate in ${duration} minutes`);
      let timeoutId: NodeJS.Timeout;

      worker.on('message', (result: WorkerResult[]) => {
        clearTimeout(timeoutId);
        
        // Don't remove from global active workers map yet - we'll let the duration timer handle that
        console.log(`[${new Date().toISOString()}] Worker completed initial join for ${task.botPair.length} ${task.browserType} bots`);
        console.log(`[${new Date().toISOString()}] Bots will remain in meeting for ${duration} minutes`);
        
        const processedResults = result.map(r => {
          return {
            ...r,
            success: true,
            keepOpenOnTimeout: true,
            scheduledTermination: new Date(Date.now() + duration * 60 * 1000).toISOString(),
            error: r.error ? "Browser tab kept open" : undefined
          };
        });
        
        semaphore.release();
        resolve(processedResults);
      });

      worker.on('error', (error) => {
        clearTimeout(timeoutId);
        activeWorkers.delete(taskId);
        
        // Clear the termination timeout and remove from global map
        const workerInfo = globalActiveWorkers.get(taskId);
        if (workerInfo) {
          clearTimeout(workerInfo.terminationTimeout);
          globalActiveWorkers.delete(taskId);
        }
        
        console.error(`[${new Date().toISOString()}] Worker error for ${task.botPair.length} ${task.browserType} bots: ${error.stack}`);
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
          
          // Clear the termination timeout and remove from global map
          const workerInfo = globalActiveWorkers.get(taskId);
          if (workerInfo) {
            clearTimeout(workerInfo.terminationTimeout);
            globalActiveWorkers.delete(taskId);
          }
          
          console.error(`[${new Date().toISOString()}] Worker exited with code ${code} for ${task.botPair.length} ${task.browserType} bots`);
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
        console.log(`[${new Date().toISOString()}] Worker main process timeout for ${task.botPair.length} ${task.browserType} bots - keeping active for ${duration} minutes`);
        semaphore.release();
        resolve(task.botPair.map(bot => ({
          success: true,
          botId: bot.id,
          error: "Main process timeout but browser tabs kept open",
          browser: task.browserType,
          keepOpenOnTimeout: true,
          scheduledTermination: new Date(Date.now() + duration * 60 * 1000).toISOString()
        })));
      }, config.workerTimeout);
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
    
    console.log(`[${new Date().toISOString()}] Keeping ${keptOpenTabs.length} tabs open for ${duration} minutes: ${keptOpenTabs.join(', ')}`);
    
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success);
    const startTime = Date.now();
    const response = {
      success: successes > 0,
      message: `${successes}/${bots.length} bots processed successfully`,
      keptOpenTabs: keptOpenTabs.length,
      tabsWillCloseAt: new Date(Date.now() + duration * 60 * 1000).toISOString(),
      durationMinutes: duration,
      failures,
      workerStats: {
        totalWorkers: tasks.length,
        botsPerWorker: optimalBotsPerWorker,
        batchDistribution: tasks.map(t => t.botPair.length).join(',')
      },
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
    console.log(`[${new Date().toISOString()}] Tabs will automatically close at: ${response.tabsWillCloseAt}`);
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

// Add an endpoint to get status of active workers
export const getActiveWorkers = (req: Request, res: Response): void => {
  const activeWorkerData = Array.from(globalActiveWorkers.entries()).map(([taskId, info]) => {
    const elapsedMinutes = (Date.now() - info.startTime) / (60 * 1000);
    const remainingMinutes = Math.max(0, info.duration - elapsedMinutes);
    
    return {
      taskId,
      botCount: info.botCount,
      startTime: new Date(info.startTime).toISOString(),
      duration: info.duration,
      elapsedMinutes: parseFloat(elapsedMinutes.toFixed(2)),
      remainingMinutes: parseFloat(remainingMinutes.toFixed(2)),
      scheduledTerminationTime: new Date(info.startTime + info.duration * 60 * 1000).toISOString()
    };
  });
  
  // Calculate total bots in active sessions
  const totalActiveBots = activeWorkerData.reduce((sum, worker) => sum + worker.botCount, 0);
  
  res.status(200).json({
    activeWorkers: activeWorkerData.length,
    totalActiveBots,
    workers: activeWorkerData
  });
};

// Add an endpoint to manually terminate all workers
export const terminateAllWorkers = (req: Request, res: Response): void => {
  const count = globalActiveWorkers.size;
  const totalBots = Array.from(globalActiveWorkers.values()).reduce((sum, info) => sum + info.botCount, 0);
  
  globalActiveWorkers.forEach((info, taskId) => {
    try {
      console.log(`[${new Date().toISOString()}] Manually terminating worker for task ${taskId} with ${info.botCount} bots`);
      clearTimeout(info.terminationTimeout);
      info.worker.postMessage({ type: 'TERMINATE' });
      
      // After a short grace period, forcefully terminate if still running
      setTimeout(() => {
        if (globalActiveWorkers.has(taskId)) {
          info.worker.terminate();
          globalActiveWorkers.delete(taskId);
        }
      }, 3000);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error terminating worker for task ${taskId}: ${error}`);
    }
  });
  
  res.status(200).json({
    success: true,
    message: `Initiated termination of ${count} worker(s) controlling ${totalBots} bots`,
    terminatedAt: new Date().toISOString()
  });
};

// Add functions to help with cleanup during server shutdown
export const gracefulShutdown = async (): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Server shutting down, terminating ${globalActiveWorkers.size} workers`);
  
  const terminationPromises: Promise<void>[] = [];
  
  globalActiveWorkers.forEach((info, taskId) => {
    const terminationPromise = new Promise<void>((resolve) => {
      try {
        clearTimeout(info.terminationTimeout);
        info.worker.postMessage({ type: 'TERMINATE' });
        
        // Set a timeout to force terminate if graceful shutdown doesn't work
        setTimeout(() => {
          try {
            if (globalActiveWorkers.has(taskId)) {
              info.worker.terminate();
              globalActiveWorkers.delete(taskId);
            }
          } catch (e) {
            console.error(`[${new Date().toISOString()}] Error in force termination: ${e}`);
          }
          resolve();
        }, 3000);
        
        info.worker.on('exit', () => {
          globalActiveWorkers.delete(taskId);
          resolve();
        });
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error during shutdown for task ${taskId}: ${error}`);
        resolve();
      }
    });
    
    terminationPromises.push(terminationPromise);
  });
  
  // Wait for all workers to terminate (with a timeout)
  await Promise.race([
    Promise.all(terminationPromises),
    new Promise<void>(resolve => setTimeout(resolve, 10000)) // 10 second max wait
  ]);
  
  console.log(`[${new Date().toISOString()}] Server shutdown complete, terminated workers`);
};