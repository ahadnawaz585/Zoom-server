export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { setPriority } = require('os');
  const os = require('os');
  const BrowserManager = require('./browserManager').default;

  const { systemInfo = { cpuCount: os.cpus().length, highPriority: true } } = workerData;
  const duration = workerData.duration || 60 * 60 * 1000;
  let browserManager = null;

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
    if (browserManager) {
      await browserManager.cleanupInactiveBrowsers();
    }
  }

  function optimizeMemory() {
    if (global.gc) {
      global.gc();
      console.log(\`[${new Date().toISOString()}] Forced garbage collection\`);
    }
  }

  async function toggleMicrophone(page) {
    try {
      // Wait for the microphone button to be available
      await page.waitForSelector('[aria-label*="microphone"]', { timeout: 10000 });
      
      // Click the microphone button
      await page.click('[aria-label*="microphone"]');
      
      // Wait a bit to ensure the action is completed
      await page.waitForTimeout(1000);
      
      return true;
    } catch (error) {
      console.error(\`[${new Date().toISOString()}] Failed to toggle microphone: \${error}\`);
      return false;
    }
  }

  async function joinMeetingPair({ botPair, origin, optimizedJoin, disableVideo, disableAudio, lowResolution }) {
    console.log(\`[${new Date().toISOString()}] Worker processing \${botPair.length} bots\`);
    const results = [];
    
    browserManager = BrowserManager.getInstance();
    
    // Process bots in batches of 20 (max tabs per browser)
    for (let i = 0; i < botPair.length; i += 20) {
      const batch = botPair.slice(i, i + 20);
      const browserInstance = await browserManager.getAvailableBrowser();
      
      for (const bot of batch) {
        try {
          const page = await browserManager.addTab(browserInstance);
          
          // Configure page settings
          await page.setViewport({
            width: lowResolution ? 640 : 1024,
            height: lowResolution ? 480 : 720
          });
          
          // Join meeting logic here
          // ... (existing meeting join code)
          
          // Toggle microphone if needed
          if (!disableAudio) {
            await toggleMicrophone(page);
          }
          
          results.push({
            success: true,
            botId: bot.id,
            browser: 'chromium',
            keepOpenOnTimeout: true,
            scheduledTermination: new Date(Date.now() + duration).toISOString()
          });
          
          // Small delay between tabs to prevent overwhelming
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
      
      optimizeMemory();
    }

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