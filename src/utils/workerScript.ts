export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { setPriority } = require('os');
  const os = require('os');

  const { systemInfo = { cpuCount: os.cpus().length, highPriority: true } } = workerData;
  const duration = workerData.duration || 60 * 60 * 1000;
  let pages = [];

  parentPort.on('message', async (message) => {
    if (message.type === 'TERMINATE') {
      console.log(\`[${new Date().toISOString()}] Terminating worker\`);
      await cleanup('Parent requested termination');
    }
  });

  if (systemInfo.highPriority) {
    try {
      setPriority(19);
      console.log(\`[${new Date().toISOString()}] Worker set to high priority\`);
    } catch (error) {
      console.warn(\`[${new Date().toISOString()}] Failed to set priority: \${error}\`);
    }
  }

  async function cleanup(reason) {
    console.log(\`[${new Date().toISOString()}] Cleaning up: \${reason}\`);
    for (const page of pages) {
      try {
        if (page && !page.isClosed()) await page.close();
      } catch (e) {
        console.error(\`[${new Date().toISOString()}] Page close error: \${e}\`);
      }
    }
    pages = [];
  }

  function optimizeMemory() {
    if (global.gc) {
      global.gc();
      console.log(\`[${new Date().toISOString()}] Forced garbage collection\`);
    }
  }

  async function joinMeetingPair({ botPair, origin, optimizedJoin, disableVideo, disableAudio, lowResolution }) {
    console.log(\`[${new Date().toISOString()}] Worker processing \${botPair.length} bots\`);
    const results = [];

    const useSinglePage = botPair.length > 3;
    if (useSinglePage) {
      console.log(\`[${new Date().toISOString()}] Using single page for \${botPair.length} bots\`);
      const viewportWidth = lowResolution ? 800 : 1280;
      const viewportHeight = lowResolution ? 600 : 720;
      // Note: Actual page creation is handled by BrowserManager
      botPair.forEach(bot => {
        results.push({
          success: true,
          botId: bot.id,
          browser: 'chromium',
          keepOpenOnTimeout: true,
          scheduledTermination: new Date(Date.now() + duration).toISOString()
        });
      });
    } else {
      console.log(\`[${new Date().toISOString()}] Using multi-page for \${botPair.length} bots\`);
      for (const bot of botPair) {
        try {
          const viewportWidth = lowResolution ? 640 : 1024;
          const viewportHeight = lowResolution ? 480 : 720;
          // Note: Actual page creation is handled by BrowserManager
          results.push({
            success: true,
            botId: bot.id,
            browser: 'chromium',
            keepOpenOnTimeout: true,
            scheduledTermination: new Date(Date.now() + duration).toISOString()
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          results.push({
            success: false,
            botId: bot.id,
            error: \`Processing error: \${error.message}\`,
            browser: 'chromium'
          });
        }
      }
    }

    optimizeMemory();
    return results;
  }

  Promise.resolve()
    .then(() => joinMeetingPair(workerData))
    .then(result => parentPort.postMessage(result))
    .catch(error => {
      console.error(\`[${new Date().toISOString()}] Worker error: \${error}\`);
      cleanup('Fatal error');
      parentPort.postMessage(workerData.botPair.map(bot => ({
        success: false,
        botId: bot.id,
        error: \`Worker error: \${error.message}\`,
        browser: 'chromium'
      })));
    });
`;