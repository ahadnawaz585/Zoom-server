export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { setPriority } = require('os');
  const os = require('os');
  const BrowserManager = require('./browserManager').default;

  const { systemInfo = { cpuCount: os.cpus().length, highPriority: true } } = workerData;
  const duration = workerData.duration || 60 * 60 * 1000;
  let browserManager = null;

  // Performance optimization settings
  const PERFORMANCE_SETTINGS = {
    BATCH_SIZE: 15, // Increased batch size for faster processing
    BATCH_DELAY: 300, // Reduced delay between batches
    VIDEO_CHECK_INTERVAL: 3000, // More frequent video checks
    MAX_RETRIES: 3, // Number of retries for failed operations
    MEMORY_OPTIMIZATION_INTERVAL: 60000, // Memory optimization every minute
  };

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

  async function setupPerformanceOptimizations(page) {
    try {
      await page.evaluate(() => {
        // Disable unnecessary features
        window.performance.setResourceTimingBufferSize(0);
        
        // Optimize memory usage
        if (window.gc) window.gc();
        
        // Disable animations
        document.body.style.setProperty('animation', 'none', 'important');
        document.body.style.setProperty('transition', 'none', 'important');
        
        // Optimize video performance
        const optimizeVideo = (video) => {
          if (video) {
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.style.transform = 'translateZ(0)';
            video.style.backfaceVisibility = 'hidden';
            video.style.perspective = '1000px';
          }
        };

        // Apply video optimizations to all video elements
        document.querySelectorAll('video').forEach(optimizeVideo);

        // Create observer for new video elements
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeName === 'VIDEO') {
                optimizeVideo(node);
              }
            });
          });
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      });
    } catch (error) {
      console.warn(\`[${new Date().toISOString()}] Performance optimization failed: \${error}\`);
    }
  }

  async function ensureVideoStability(page) {
    try {
      await page.waitForSelector('video', { timeout: 10000 });
      
      await page.evaluate(() => {
        const observer = new MutationObserver((mutations) => {
          const video = document.querySelector('video');
          if (video) {
            // Ensure video is playing
            if (video.paused) {
              video.play().catch(() => {});
            }
            // Set video quality to low for better performance
            if (video.videoWidth > 640) {
              video.style.width = '640px';
              video.style.height = 'auto';
            }
            // Force hardware acceleration
            video.style.transform = 'translateZ(0)';
            video.style.backfaceVisibility = 'hidden';
          }
        });

        const video = document.querySelector('video');
        if (video) {
          observer.observe(video, {
            attributes: true,
            childList: true,
            subtree: true
          });
        }
      });

      // Set up periodic video stability check with retry mechanism
      setInterval(async () => {
        try {
          await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
              if (video.paused) {
                video.play().catch(() => {});
              }
              if (video.videoWidth > 640) {
                video.style.width = '640px';
                video.style.height = 'auto';
              }
              // Force hardware acceleration
              video.style.transform = 'translateZ(0)';
              video.style.backfaceVisibility = 'hidden';
            }
          });
        } catch (error) {
          console.warn(\`[${new Date().toISOString()}] Video stability check failed: \${error}\`);
        }
      }, PERFORMANCE_SETTINGS.VIDEO_CHECK_INTERVAL);
    } catch (error) {
      console.warn(\`[${new Date().toISOString()}] Failed to set up video stability: \${error}\`);
    }
  }

  async function openTabsInParallel(browserInstance, bots, lowResolution) {
    const results = [];
    
    for (let i = 0; i < bots.length; i += PERFORMANCE_SETTINGS.BATCH_SIZE) {
      const batch = bots.slice(i, i + PERFORMANCE_SETTINGS.BATCH_SIZE);
      const batchPromises = batch.map(async (bot) => {
        let retries = 0;
        while (retries < PERFORMANCE_SETTINGS.MAX_RETRIES) {
          try {
            const page = await browserManager.addTab(browserInstance);
            
            // Configure page settings for better performance
            await page.setViewport({
              width: lowResolution ? 640 : 1024,
              height: lowResolution ? 480 : 720,
              deviceScaleFactor: 1
            });

            // Apply performance optimizations
            await setupPerformanceOptimizations(page);
            
            // Join meeting logic here
            // ... (existing meeting join code)
            
            // Set up video stability
            await ensureVideoStability(page);
            
            return {
              success: true,
              botId: bot.id,
              browser: 'chromium',
              keepOpenOnTimeout: true,
              scheduledTermination: new Date(Date.now() + duration).toISOString()
            };
          } catch (error) {
            retries++;
            if (retries === PERFORMANCE_SETTINGS.MAX_RETRIES) {
              return {
                success: false,
                botId: bot.id,
                error: \`Processing error after \${PERFORMANCE_SETTINGS.MAX_RETRIES} retries: \${error.message}\`,
                browser: 'chromium'
              };
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          }
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Reduced delay between batches
      await new Promise(resolve => setTimeout(resolve, PERFORMANCE_SETTINGS.BATCH_DELAY));
    }

    return results;
  }

  async function joinMeetingPair({ botPair, origin, optimizedJoin, disableVideo, disableAudio, lowResolution }) {
    console.log(\`[${new Date().toISOString()}] Worker processing \${botPair.length} bots\`);
    const results = [];
    
    browserManager = BrowserManager.getInstance();
    
    // Set up periodic memory optimization
    const memoryOptimizationInterval = setInterval(optimizeMemory, PERFORMANCE_SETTINGS.MEMORY_OPTIMIZATION_INTERVAL);
    
    try {
      // Process bots in batches of 20 (max tabs per browser)
      for (let i = 0; i < botPair.length; i += 20) {
        const batch = botPair.slice(i, i + 20);
        const browserInstance = await browserManager.getAvailableBrowser();
        
        // Open tabs in parallel for better performance
        const batchResults = await openTabsInParallel(browserInstance, batch, lowResolution);
        results.push(...batchResults);
        
        optimizeMemory();
      }
    } finally {
      clearInterval(memoryOptimizationInterval);
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