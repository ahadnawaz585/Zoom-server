import { freemem, totalmem, cpus } from 'os';
import { ActiveWorkerInfo } from './workerManager';

interface SystemMetrics {
  totalWorkers: number;
  totalActiveBots: number;
  lastChecked: number;
  memoryUsage: number;
  cpuLoad: number;
}

export class SystemMonitor {
  private metrics: SystemMetrics = {
    totalWorkers: 0,
    totalActiveBots: 0,
    lastChecked: Date.now(),
    memoryUsage: 0,
    cpuLoad: 0
  };

  updateMetrics(activeWorkers: Map<string, ActiveWorkerInfo>): void {
    this.metrics.totalWorkers = activeWorkers.size;
    this.metrics.totalActiveBots = Array.from(activeWorkers.values()).reduce((sum, info) => sum + info.botCount, 0);
    this.metrics.lastChecked = Date.now();
    this.metrics.memoryUsage = 1 - (freemem() / totalmem());
    const cpuCount = cpus().length;
    this.metrics.cpuLoad = Math.min(1, this.metrics.totalWorkers / (cpuCount * 2));
  }

  canHandleMoreWorkers(requestedBotCount: number, globalActiveWorkers: Map<string, ActiveWorkerInfo>): boolean {
    this.updateMetrics(globalActiveWorkers);
    if (this.metrics.memoryUsage > 0.85) {
      console.warn(`[${new Date().toISOString()}] High memory usage (${(this.metrics.memoryUsage * 100).toFixed(1)}%)`);
      return false;
    }
    if (this.metrics.cpuLoad > 0.9) {
      console.warn(`[${new Date().toISOString()}] High CPU load (${(this.metrics.cpuLoad * 100).toFixed(1)}%)`);
      return false;
    }
    const totalBotsAfterRequest = this.metrics.totalActiveBots + requestedBotCount;
    const maxSystemBots = parseInt(process.env.MAX_SYSTEM_BOTS || '1000');
    if (totalBotsAfterRequest > maxSystemBots) {
      console.warn(`[${new Date().toISOString()}] Exceeds max bot limit (${totalBotsAfterRequest}/${maxSystemBots})`);
      return false;
    }
    return true;
  }

  getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }
}