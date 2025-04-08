import { Request, Response } from 'express';
import { Worker } from 'worker_threads';
import { setPriority } from 'os';
import { Bot, JoinRequest, Task, WorkerResult } from '../types';
import { generateSignature } from '../utils/signature';
import { generateBots } from '../utils/botUtils';
import { workerScript } from '../utils/workerScript';

export const joinMeeting = async (req: Request, res: Response): Promise<void> => {
  console.log(`[${new Date().toISOString()}] Received join meeting request`);
  const body = req.body as JoinRequest;
  let { bots, meetingId, password, botCount = 0, duration = 60 } = body;
  
  console.log("Request received:", bots, meetingId, password, botCount, duration);

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

  const browserTypes: ('chromium' | 'firefox' | 'webkit')[] = ['chromium', 'firefox', 'webkit'];
  const MIN_BOTS_PER_BROWSER = 2; // Reduced for testing
  const totalBots = bots.length;
  const botsPerBrowser = Math.max(MIN_BOTS_PER_BROWSER, Math.floor(totalBots / browserTypes.length));
  const botPairsByBrowser: { [key: string]: Bot[][] } = { chromium: [], firefox: [], webkit: [] };

  const shuffledBots = [...bots].sort(() => Math.random() - 0.5);
  let botIndex = 0;
  for (const browser of browserTypes) {
    const botsForThisBrowser = shuffledBots.slice(botIndex, botIndex + botsPerBrowser);
    botIndex += botsPerBrowser;
    for (let i = 0; i < botsForThisBrowser.length; i += 2) {
      botPairsByBrowser[browser].push(botsForThisBrowser.slice(i, i + 2));
    }
  }

  const tasks: Task[] = [];
  for (const browser of browserTypes) {
    botPairsByBrowser[browser].forEach(botPair => {
      tasks.push({
        botPair,
        meetingId,
        password,
        origin,
        signature,
        browserType: browser,
      });
    });
  }

  console.log(`[${new Date().toISOString()}] Created ${tasks.length} bot pairs: ` +
    `Chromium: ${botPairsByBrowser.chromium.length} (${botPairsByBrowser.chromium.flat().length} bots), ` +
    `Firefox: ${botPairsByBrowser.firefox.length} (${botPairsByBrowser.firefox.flat().length} bots), ` +
    `Webkit: ${botPairsByBrowser.webkit.length} (${botPairsByBrowser.webkit.flat().length} bots)`);

  console.log(`[${new Date().toISOString()}] Starting execution of ${tasks.length} tasks`);

  const MAX_CONCURRENT_WORKERS = 3; // Reduced for testing
  const activeWorkers = new Map<string, Worker>();

  const executeTask = async (task: Task): Promise<WorkerResult[]> => {
    const taskId = `${task.browserType}-${task.botPair.map(b => b.id).join('-')}`;
    console.log(`[${new Date().toISOString()}] Queuing task ${taskId} with ${task.browserType}`);
    return new Promise((resolve) => {
      const worker = new Worker(workerScript, { 
        eval: true,
        workerData: task,
        resourceLimits: {
          maxOldGenerationSizeMb: 300,
          maxYoungGenerationSizeMb: 150,
        }
      });

      activeWorkers.set(taskId, worker);
      console.log(`[${new Date().toISOString()}] Active workers: ${activeWorkers.size}`);
      let timeoutId: NodeJS.Timeout;

      worker.on('message', (result: WorkerResult[]) => {
        clearTimeout(timeoutId);
        activeWorkers.delete(taskId);
        console.log(`[${new Date().toISOString()}] Worker completed for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')}`);
        resolve(result);
      });

      worker.on('error', (error) => {
        clearTimeout(timeoutId);
        activeWorkers.delete(taskId);
        console.error(`[${new Date().toISOString()}] Worker error for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')}: ${error.stack}`);
        resolve(task.botPair.map(bot => ({
          success: false,
          botId: bot.id,
          error: error.message,
          browser: task.browserType
        })));
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timeoutId);
          activeWorkers.delete(taskId);
          console.error(`[${new Date().toISOString()}] Worker exited with code ${code} for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')}`);
          resolve(task.botPair.map(bot => ({
            success: false,
            botId: bot.id,
            error: `Worker exited with code ${code}`,
            browser: task.browserType
          })));
        }
      });

      timeoutId = setTimeout(() => {
        worker.terminate().then(() => {
          activeWorkers.delete(taskId);
          console.warn(`[${new Date().toISOString()}] Worker timeout for ${task.browserType} bots ${task.botPair.map(b => b.name).join(', ')}`);
          resolve(task.botPair.map(bot => ({
            success: false,
            botId: bot.id,
            error: "Timeout",
            browser: task.browserType
          })));
        });
      }, 60000); // Increased timeout
    });
  };

  const runTasksWithHighConcurrency = async () => {
    const results: WorkerResult[] = [];
    const queue = [...tasks];

    try {
      setPriority(19); // High priority (19 on Unix-like, use -20 for Windows)
      console.log(`[${new Date().toISOString()}] Set main process to high priority`);
    } catch (error) {
      console.warn(`[${new Date().toISOString()}] Failed to set process priority: ${error}`);
    }

    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_CONCURRENT_WORKERS);
      console.log(`[${new Date().toISOString()}] Processing batch of ${batch.length} tasks`);
      const batchResults = await Promise.all(batch.map(task => executeTask(task)));
      results.push(...batchResults.flat());
    }

    return results;
  };

  try {
    const results = await runTasksWithHighConcurrency();
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success);

    const response = {
      success: successes === bots.length,
      message: `${successes}/${bots.length} bots joined`,
      failures,
      browserStats: {
        chromium: {
          total: results.filter(r => r.browser === 'chromium').length,
          successes: results.filter(r => r.browser === 'chromium' && r.success).length
        },
        firefox: {
          total: results.filter(r => r.browser === 'firefox').length,
          successes: results.filter(r => r.browser === 'firefox' && r.success).length
        },
        webkit: {
          total: results.filter(r => r.browser === 'webkit').length,
          successes: results.filter(r => r.browser === 'webkit' && r.success).length
        }
      }
    };

    console.log(`[${new Date().toISOString()}] Request completed: ${response.message}`, JSON.stringify(response.browserStats));
    res.status(failures.length > 0 ? 207 : 200).json(response);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Processing error: ${error instanceof Error ? error.stack : String(error)}`);
    res.status(500).json({ 
      error: "Failed to process bots",
      details: error instanceof Error ? error.message : String(error)
    });
  }
};
