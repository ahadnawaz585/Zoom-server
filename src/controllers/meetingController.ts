import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import BrowserManager from '../utils/browserManager';
import { Bot, JoinRequest, Task } from '../types';
import { generateSignature } from '../utils/signature';
import { generateBots } from '../utils/botUtils';
import { SystemMonitor } from '../utils/SystemMoniter';
import { BotManager } from '../utils/botManager';
import { WorkerManager, ActiveWorkerInfo } from '../utils/workerManager';

const globalActiveWorkers = new Map<string, ActiveWorkerInfo>();
const browserManager = BrowserManager.getInstance(); // Use singleton instance
const systemMonitor = new SystemMonitor();
const workerManager = new WorkerManager(systemMonitor);

export const joinMeeting = async (req: Request, res: Response): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Received join meeting request`);
  const { bots, meetingId, password, botCount = 0, duration = 60 } = req.body as JoinRequest;

  if (!meetingId || !password) {
    console.error(`[${new Date().toISOString()}] Missing required fields`);
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const finalDuration = Math.max(1, Math.floor(duration));
  const finalBots = bots && bots.length > 0 ? [...bots] : [];
  if (botCount > 0) {
    finalBots.push(...generateBots(botCount, finalBots));
  }

  if (finalBots.length === 0) {
    console.error(`[${new Date().toISOString()}] No bots provided`);
    res.status(400).json({ error: 'No bots provided' });
    return;
  }

  if (!systemMonitor.canHandleMoreWorkers(finalBots.length, globalActiveWorkers)) {
    console.error(`[${new Date().toISOString()}] System capacity exceeded`);
    res.status(503).json({
      error: 'System at capacity',
      message: 'Too many bots. Try again later or with fewer bots.',
      currentLoad: systemMonitor.getMetrics()
    });
    return;
  }

  const origin = process.env.NEXT_PUBLIC_CLIENT_URL || 'https://zoom-bots.vercel.app';
  const signature = await generateSignature(meetingId, 0, finalDuration);

  try {
    // Initialize the browser first
    await browserManager.launchBrowser();
    
    // Create and initialize BotManager
    const botManager = new BotManager();
    await botManager.launchBrowsers(); // Initialize browsers
    
    const tabResults = await botManager.joinMeetingForBots(finalBots, meetingId, password, finalDuration, origin, signature);

    const tasks: Task[] = tabResults.map(result => ({
      botPair: finalBots.filter(bot => result.botIds.includes(bot.id.toString())),
      meetingId,
      password,
      origin,
      signature,
      browserType: 'chromium',
      keepOpenOnTimeout: true,
      skipJoinIndicator: true,
      selectorTimeout: 86400000,
      optimizedJoin: true,
      disableVideo: true,
      disableAudio: true,
      lowResolution: true,
      duration: finalDuration * 60 * 1000
    }));

    const results = await workerManager.executeTasks(tasks, finalDuration, globalActiveWorkers);
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success);

    res.status(failures.length > 0 ? 207 : 200).json({
      success: successes > 0,
      message: `${successes}/${finalBots.length} bots processed successfully`,
      keptOpenTabs: tabResults.length,
      tabsWillCloseAt: new Date(Date.now() + finalDuration * 60 * 1000).toISOString(),
      durationMinutes: finalDuration,
      failures,
      systemLoad: systemMonitor.getMetrics()
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Processing error: ${error}`);
    res.status(500).json({
      error: 'Failed to process bots',
      details: error instanceof Error ? error.message : String(error),
      systemLoad: systemMonitor.getMetrics()
    });
  }
};

export const getActiveWorkers = (req: Request, res: Response): void => {
  const activeWorkers = workerManager.getActiveWorkers();
  res.status(200).json({
    activeWorkers: activeWorkers.length,
    totalActiveBots: systemMonitor.getMetrics().totalActiveBots,
    systemMetrics: systemMonitor.getMetrics(),
    workers: activeWorkers
  });
};

export const terminateAllWorkers = async (req: Request, res: Response): Promise<void> => {
  const count = globalActiveWorkers.size;
  const totalBots = Array.from(globalActiveWorkers.values()).reduce((sum, info) => sum + info.botCount, 0);
  await workerManager.gracefulShutdown(globalActiveWorkers);
  await browserManager.closeBrowser();
  res.status(200).json({
    success: true,
    message: `Terminated ${count} worker(s) controlling ${totalBots} bots`,
    terminatedAt: new Date().toISOString()
  });
};

export const gracefulShutdown = async (): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Server shutting down`);
  await workerManager.gracefulShutdown(globalActiveWorkers);
  await browserManager.closeBrowser();
  console.log(`[${new Date().toISOString()}] Shutdown complete`);
};