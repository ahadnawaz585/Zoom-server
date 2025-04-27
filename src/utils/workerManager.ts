import { Worker } from 'worker_threads';
import { cpus, setPriority } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { SystemMonitor } from './SystemMoniter';
import { Task, WorkerResult } from '../types';
import { workerScript } from '../utils/workerScript';

export interface ActiveWorkerInfo {
  worker: Worker;
  terminationTimeout: NodeJS.Timeout;
  startTime: number;
  duration: number; // in minutes
  botCount: number;
}

export class WorkerManager {
  private activeWorkers: Map<string, ActiveWorkerInfo> = new Map();
  private systemMonitor: SystemMonitor;
  private config = {
    maxConcurrentWorkers: parseInt(process.env.MAX_CONCURRENT_WORKERS || '50'),
    workerTimeout: parseInt(process.env.WORKER_TIMEOUT || '60000'),
    gracePeriod: parseInt(process.env.GRACE_PERIOD || '5000'),
  };

  constructor(systemMonitor: SystemMonitor) {
    this.systemMonitor = systemMonitor;
  }

  async executeTasks(tasks: Task[], duration: number, globalActiveWorkers: Map<string, ActiveWorkerInfo>): Promise<WorkerResult[]> {
    const cpuCount = cpus().length;
    const systemLoad = this.systemMonitor.getMetrics().cpuLoad;
    const maxConcurrentWorkers = Math.min(
      this.config.maxConcurrentWorkers,
      Math.max(1, Math.floor(cpuCount * 2 * (1 - systemLoad) * 0.9)),
      tasks.length
    );

    class Semaphore {
      private permits: number;
      private queue: (() => void)[] = [];

      constructor(permits: number) {
        this.permits = permits;
      }

      async acquire(): Promise<void> {
        if (this.permits > 0) {
          this.permits--;
          return;
        }
        return new Promise(resolve => this.queue.push(resolve));
      }

      release(): void {
        if (this.queue.length > 0) {
          this.queue.shift()!();
        } else {
          this.permits++;
        }
      }
    }

    const semaphore = new Semaphore(maxConcurrentWorkers);
    const results: WorkerResult[] = [];

    for (const task of tasks) {
      await semaphore.acquire();
      const taskId = uuidv4();
      const worker = new Worker(workerScript, {
        eval: true,
        workerData: { ...task, systemInfo: { cpuCount, highPriority: true } },
        resourceLimits: {
          maxOldGenerationSizeMb: 150 + (task.botPair.length * 25),
          maxYoungGenerationSizeMb: 75 + (task.botPair.length * 10),
        }
      });

      const terminationTimeout = setTimeout(() => {
        worker.postMessage({ type: 'TERMINATE' });
        setTimeout(() => {
          if (this.activeWorkers.has(taskId)) {
            worker.terminate();
            this.activeWorkers.delete(taskId);
            globalActiveWorkers.delete(taskId);
            this.systemMonitor.updateMetrics(globalActiveWorkers);
          }
        }, this.config.gracePeriod);
      }, duration * 60 * 1000);

      this.activeWorkers.set(taskId, {
        worker,
        terminationTimeout,
        startTime: Date.now(),
        duration,
        botCount: task.botPair.length
      });
      globalActiveWorkers.set(taskId, this.activeWorkers.get(taskId)!);
      this.systemMonitor.updateMetrics(globalActiveWorkers);

      const workerResults = await new Promise<WorkerResult[]>(resolve => {
        let timeoutId: NodeJS.Timeout;
        worker.on('message', (result: WorkerResult[]) => {
          clearTimeout(timeoutId);
          semaphore.release();
          resolve(result);
        });
        worker.on('error', (error) => {
          clearTimeout(timeoutId);
          this.cleanupWorker(taskId, globalActiveWorkers);
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
            this.cleanupWorker(taskId, globalActiveWorkers);
            semaphore.release();
            resolve(task.botPair.map(bot => ({
              success: false,
              botId: bot.id,
              error: `Worker exited with code ${code}`,
              browser: task.browserType
            })));
          }
        });
        timeoutId = setTimeout(() => {
          semaphore.release();
          resolve(task.botPair.map(bot => ({
            success: true,
            botId: bot.id,
            error: 'Worker timeout but tabs kept open',
            browser: task.browserType,
            keepOpenOnTimeout: true,
            scheduledTermination: new Date(Date.now() + duration * 60 * 1000).toISOString()
          })));
        }, this.config.workerTimeout);
      });

      results.push(...workerResults);
    }

    return results;
  }

  private cleanupWorker(taskId: string, globalActiveWorkers: Map<string, ActiveWorkerInfo>): void {
    const workerInfo = this.activeWorkers.get(taskId);
    if (workerInfo) {
      clearTimeout(workerInfo.terminationTimeout);
      this.activeWorkers.delete(taskId);
      globalActiveWorkers.delete(taskId);
      this.systemMonitor.updateMetrics(globalActiveWorkers);
    }
  }

  async gracefulShutdown(globalActiveWorkers: Map<string, ActiveWorkerInfo>): Promise<void> {
    const terminationPromises: Promise<void>[] = [];
    this.activeWorkers.forEach((info, taskId) => {
      terminationPromises.push(new Promise(resolve => {
        clearTimeout(info.terminationTimeout);
        info.worker.postMessage({ type: 'TERMINATE' });
        setTimeout(() => {
          if (this.activeWorkers.has(taskId)) {
            info.worker.terminate();
            this.activeWorkers.delete(taskId);
            globalActiveWorkers.delete(taskId);
          }
          resolve();
        }, this.config.gracePeriod);
        info.worker.on('exit', () => {
          this.activeWorkers.delete(taskId);
          globalActiveWorkers.delete(taskId);
          resolve();
        });
      }));
    });
    await Promise.race([
      Promise.all(terminationPromises),
      new Promise(resolve => setTimeout(resolve, 10000))
    ]);
  }

  getActiveWorkers(): { taskId: string; botCount: number; startTime: string; duration: number; elapsedMinutes: number; remainingMinutes: number; scheduledTerminationTime: string }[] {
    this.systemMonitor.updateMetrics(this.activeWorkers);
    return Array.from(this.activeWorkers.entries()).map(([taskId, info]) => {
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
  }
}