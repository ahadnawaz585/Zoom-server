// workerScript.ts
export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { chromium } = require('playwright');
  const { setPriority } = require('os');
  const os = require('os');
  const { performance } = require('perf_hooks');

  // Extract system info if provided
  const { systemInfo = { cpuCount: os.cpus().length, highPriority: true, memoryGB: 8 } } = workerData;

  // Set higher thread priority for better performance
  if (systemInfo.highPriority) {
    try {
      setPriority(19); // High priority (19 on Unix-like, use -20 for Windows)
      console.log(\`[${new Date().toISOString()}] Worker thread set to high priority\`);
    } catch (error) {
      console.warn(\`[${new Date().toISOString()}] Failed to set thread priority: \${error}\`);
    }
  }

  // Apply memory and resource optimizations based on system memory
  const lowMemoryMode = systemInfo.memoryGB < 8 || workerData.lowMemoryMode;
  
  // Performance metrics
  const metrics = {
    startTime: performance.now(),
    browserLaunchTime: 0,
    pageCreationTime: 0,
    navigationTime: [],
    totalBots: workerData.botPair.length
  };

  const joinMeetingBatch = async ({ 
    botPair, 
    meetingId, 
    password, 
    origin, 
    signature, 
    browserType,
    skipJoinIndicator = true, 
    keepOpenOnTimeout = true, 
    selectorTimeout = 86400000,
    optimizedJoin = true,
    disableVideo = true,
    disableAudio = true,
    lowResolution = true,
    workerProcess
  }) => {
    console.log(\`[${new Date().toISOString()}] Worker in process \${workerProcess} starting for \${botPair.length} bots\`);
    let browser;
    let context;
    const results = [];

    // Enhanced browser arguments for better performance and stability
    const launchOptions = {
      headless: true,
      timeout: 30000,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process', 
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-breakpad',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--force-color-profile=srgb',
        '--disable-backgrounding-occluded-windows',
        '--disable-background-timer-throttling',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--disable-webrtc-hw-encoding',
        '--disable-webrtc-hw-decoding',
        '--force-device-scale-factor=0.5',
        '--js-flags=--max-old-space-size=128' // Limit JS heap size per page
      ]
    };
    
    // Additional optimizations for low memory systems
    if (lowMemoryMode) {
      launchOptions.args.push(
        '--disable-notifications',
        '--disable-speech-api',
        '--disable-web-security',
        '--disk-cache-size=1',
        '--media-cache-size=1',
        '--disable-application-cache',
        '--aggressive-cache-discard'
      );
    }

    try {
      console.log(\`[${new Date().toISOString()}] Launching browser with\${lowMemoryMode ? ' low-memory' : ''} optimized settings\`);
      const browserLaunchStart = performance.now();
      
      context = await chromium.launchPersistentContext('', launchOptions);
      browser = context.browser();
      
      metrics.browserLaunchTime = performance.now() - browserLaunchStart;
      console.log(\`[${new Date().toISOString()}] Browser launched in \${metrics.browserLaunchTime.toFixed(2)}ms\`);
      
      // Set up reusable URL creation function
      const createMeetingUrl = (username) => {
        let url = \`\${origin}/meeting?username=\${encodeURIComponent(username)}&meetingId=\${encodeURIComponent(meetingId)}&password=\${encodeURIComponent(password)}&signature=\${encodeURIComponent(signature)}\`;
        
        if (optimizedJoin) {
          url += \`&optimized=true\`;
          if (disableVideo) url += \`&noVideo=true\`;
          if (disableAudio) url += \`&noAudio=true\`;
          if (lowResolution) url += \`&lowRes=true\`;
        }
        return url;
      };
      
      // Create pages in batches to avoid overwhelming the system
      const pageCreationStart = performance.now();
      const pages = [];
      const batchSize = lowMemoryMode ? 2 : 4;
      
      for (let i = 0; i < botPair.length; i += batchSize) {
        const batch = botPair.slice(i, Math.min(i + batchSize, botPair.length));
        const batchPages = await Promise.all(batch.map(() => context.newPage()));
        pages.push(...batchPages);
        
        // Small delay between batches to prevent resource spikes
        if (i + batchSize < botPair.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      metrics.pageCreationTime = performance.now() - pageCreationStart;
      console.log(\`[${new Date().toISOString()}] Created \${pages.length} pages in \${metrics.pageCreationTime.toFixed(2)}ms\`);
      
      // Configure pages for optimal performance
      await Promise.all(pages.map(async (page) => {
        // Disable cache for memory optimization
        await page.route('**/*', (route) => {
          const request = route.request();
          // Block images, fonts, styles and other non-essential resources
          if (
            request.resourceType() === 'image' || 
            request.resourceType() === 'font' ||
            request.resourceType() === 'stylesheet' ||
            request.url().includes('analytics') ||
            request.url().includes('tracking')
          ) {
            return route.abort();
          }
          route.continue();
        });
        
        // Set minimal viewport
        const viewportWidth = lowResolution ? 480 : 640;
        const viewportHeight = lowResolution ? 360 : 480;
        await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
        
        // Optimize memory with JavaScript flags
        await page.addInitScript(() => {
          // Delete some unused browser APIs to reduce memory footprint
          delete window.WebGL2RenderingContext;
          delete window.WebGLRenderingContext;
        });
      }));

      // Process all bots in batches for better resource management
      console.log(\`[${new Date().toISOString()}] Processing \${botPair.length} bots in batches\`);
      
      // Split navigation into batches to prevent network congestion
      const botBatchSize = lowMemoryMode ? 2 : 4;
      
      for (let i = 0; i < botPair.length; i += botBatchSize) {
        const startIdx = i;
        const endIdx = Math.min(i + botBatchSize, botPair.length);
        const botBatch = botPair.slice(startIdx, endIdx);
        
        console.log(\`[${new Date().toISOString()}] Processing batch \${Math.floor(i/botBatchSize) + 1}: Bots \${startIdx+1} to \${endIdx}\`);
        
        await Promise.all(botBatch.map(async (bot, batchIndex) => {
          const pageIndex = startIdx + batchIndex;
          const page = pages[pageIndex];
          const navStartTime = performance.now();
          
          try {
            const url = createMeetingUrl(bot.name);
            console.log(\`[${new Date().toISOString()}] Navigating bot \${bot.name} to meeting\`);
            
            // Navigate with optimized settings
            const navigationResponse = await page.goto(url, { 
              waitUntil: 'domcontentloaded',
              timeout: 30000 
            }).catch(error => {
              console.log(\`[${new Date().toISOString()}] Navigation initial timeout for \${bot.name}, continuing: \${error.message}\`);
              return null;
            });
            
            metrics.navigationTime.push(performance.now() - navStartTime);
            
            if (navigationResponse && navigationResponse.status() >= 400) {
              console.warn(\`[${new Date().toISOString()}] Navigation returned error status \${navigationResponse.status()} for \${bot.name}, continuing\`);
            }

            // Handle potential meeting joining UI elements
            try {
              // Just wait a moment to let the page initialize
              await page.waitForTimeout(1000);
              
              // Click common join buttons (with retry)
              const possibleButtons = [
                'button:has-text("Join")', 
                'button:has-text("Join Audio")', 
                'button:has-text("Join with Computer Audio")',
                '[data-testid="join-btn"]'
              ];
              
              // Try common UI interactions to join the meeting
              for (const selector of possibleButtons) {
                await page.locator(selector).click({ timeout: 1000 }).catch(() => {});
              }
              
              // Handle media settings
              if (disableVideo) {
                const videoButtons = [
                  'button[aria-label*="video"]',
                  'button[title*="video"]',
                  '[data-testid="video-btn"]'
                ];
                
                for (const selector of videoButtons) {
                  await page.locator(selector).click({ timeout: 1000 }).catch(() => {});
                }
              }
              
              if (disableAudio) {
                const audioButtons = [
                  'button[aria-label*="mute"]',
                  'button[title*="mute"]',
                  '[data-testid="audio-btn"]'
                ];
                
                for (const selector of audioButtons) {
                  await page.locator(selector).click({ timeout: 1000 }).catch(() => {});
                }
              }
            } catch (interactionError) {
              console.log(\`[${new Date().toISOString()}] Interaction handling for \${bot.name}: \${interactionError.message}\`);
            }
            
            results.push({ 
              success: true, 
              botId: bot.id, 
              browser: browserType,
              keepOpenOnTimeout: true
            });
          } catch (error) {
            console.log(\`[${new Date().toISOString()}] Error for bot \${bot.name}: \${error.message}\`);
            
            results.push({ 
              success: true, // Still mark as success if keeping tabs open
              botId: bot.id, 
              browser: browserType,
              error: 'Tab kept open despite error: ' + error.message,
              keepOpenOnTimeout: true
            });
          }
        }));
        
        // Add a small delay between batches to reduce resource contention
        if (endIdx < botPair.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Calculate and log performance metrics
      const totalTime = performance.now() - metrics.startTime;
      const avgNavigationTime = metrics.navigationTime.length > 0 ? 
        metrics.navigationTime.reduce((a, b) => a + b, 0) / metrics.navigationTime.length : 0;
      
      console.log(\`[${new Date().toISOString()}] Performance metrics:
        Total time: \${totalTime.toFixed(2)}ms
        Browser launch: \${metrics.browserLaunchTime.toFixed(2)}ms
        Page creation: \${metrics.pageCreationTime.toFixed(2)}ms
        Avg navigation: \${avgNavigationTime.toFixed(2)}ms
        Bots processed: \${botPair.length}
      \`);

      // Set up keep-alive interval that doesn't block the event loop
      if (keepOpenOnTimeout) {
        const interval = setInterval(() => {
          console.log(\`[${new Date().toISOString()}] Keeping browsers alive for \${botPair.length} bots\`);
        }, 300000); // Every 5 minutes
        
        interval.unref();
      }

      return results;
    } catch (error) {
      console.error(\`[${new Date().toISOString()}] Browser launch failed: \${error.message}\`);
      if (browser) await browser.close().catch(() => {});
      return botPair.map(bot => ({ 
        success: false, 
        botId: bot.id, 
        error: 'Browser launch failed: ' + error.message, 
        browser: browserType 
      }));
    }
  };

  // Execute with optimized error handling
  Promise.resolve()
    .then(() => joinMeetingBatch(workerData))
    .then(result => {
      parentPort.postMessage(result);
    })
    .catch(error => {
      console.error(\`[${new Date().toISOString()}] Worker fatal error: \${error.message}\`);
      parentPort.postMessage(workerData.botPair.map(bot => ({
        success: false,
        botId: bot.id,
        error: 'Worker fatal error: ' + error.message,
        browser: workerData.browserType
      })));
    });
` as const; // Optional: `as const` to make it a readonly string literal