export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { setPriority } = require('os');
  const os = require('os');
  const BrowserManager = require('./browserManager').default;

  const { systemInfo = { cpuCount: os.cpus().length, highPriority: true } } = workerData;
  const duration = workerData.duration || 60 * 60 * 1000;
  let browserManager = null;

  // Enhanced performance optimization settings
  const PERFORMANCE_SETTINGS = {
    BATCH_SIZE: 10,
    BATCH_DELAY: 200, // Reduced delay for faster processing
    VIDEO_CHECK_INTERVAL: 2000, // More frequent video checks
    MEMORY_OPTIMIZATION_INTERVAL: 30000, // More frequent memory optimization
    PAGE_LOAD_TIMEOUT: 30000,
    MAX_CONCURRENT_TABS: 20,
    RESOURCE_BLOCK_LIST: [
      'image',
      'media',
      'font',
      'stylesheet',
      'script',
      'texttrack',
      'xhr',
      'fetch',
      'eventsource',
      'websocket',
      'manifest',
      'other'
    ],
    VIEWPORT: {
      width: 640,
      height: 480,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: false
    }
  };

  // Generate usernames for bots
  function generateUsernames(count) {
    return Array.from({ length: count }, (_, i) => \`name\${i + 1}\`);
  }

  parentPort.on('message', async (message) => {
    if (message.type === 'TERMINATE') {
      console.log(\`[${new Date().toISOString()}] Terminating\`);
      await cleanup('Parent requested termination');
    }
  });

  if (systemInfo.highPriority) {
    try {
      setPriority(19);
      console.log(\`[${new Date().toISOString()}] Set to high priority\`);
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
      // Block unnecessary resources
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (PERFORMANCE_SETTINGS.RESOURCE_BLOCK_LIST.includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      // Set up performance monitoring
      await page.evaluate(() => {
        // Disable unnecessary features
        window.performance.setResourceTimingBufferSize(0);
        
        // Optimize memory usage
        if (window.gc) window.gc();
        
        // Disable animations and transitions
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
            video.style.willChange = 'transform';
            video.style.contain = 'layout style paint';
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

        // Optimize rendering performance
        document.body.style.setProperty('will-change', 'transform', 'important');
        document.body.style.setProperty('contain', 'layout style paint', 'important');
      });

      // Set up performance monitoring
      await page.evaluateOnNewDocument(() => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
          const start = performance.now();
          const response = await originalFetch(...args);
          const duration = performance.now() - start;
          if (duration > 1000) {
            console.warn(\`Slow fetch request: \${duration}ms\`, args[0]);
          }
          return response;
        };
      });
    } catch (error) {
      console.warn(\`[${new Date().toISOString()}] Performance optimization failed: \${error}\`);
    }
  }

  async function ensureVideoStability(page) {
    try {
      await page.waitForSelector('video', { timeout: PERFORMANCE_SETTINGS.PAGE_LOAD_TIMEOUT });
      
      await page.evaluate(() => {
        const observer = new MutationObserver((mutations) => {
          const video = document.querySelector('video');
          if (video) {
            if (video.paused) {
              video.play().catch(() => {});
            }
            if (video.videoWidth > 640) {
              video.style.width = '640px';
              video.style.height = 'auto';
            }
            video.style.transform = 'translateZ(0)';
            video.style.backfaceVisibility = 'hidden';
            video.style.willChange = 'transform';
            video.style.contain = 'layout style paint';
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
              video.style.transform = 'translateZ(0)';
              video.style.backfaceVisibility = 'hidden';
              video.style.willChange = 'transform';
              video.style.contain = 'layout style paint';
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

  async function openMeetingTabs(meetings) {
    console.log(\`[${new Date().toISOString()}] Opening tabs for \${meetings.length} meetings\`);
    const results = [];
    
    browserManager = BrowserManager.getInstance();
    
    // Set up periodic memory optimization
    const memoryOptimizationInterval = setInterval(optimizeMemory, 
      PERFORMANCE_SETTINGS.MEMORY_OPTIMIZATION_INTERVAL);
    
    try {
      for (const meeting of meetings) {
        const usernames = generateUsernames(10);
        const browserInstance = await browserManager.getAvailableBrowser();
        
        // Open all tabs for this meeting simultaneously
        const tabPromises = usernames.map(async (username) => {
          try {
            const page = await browserManager.addTab(browserInstance);
            
            // Apply viewport settings
            await page.setViewport(PERFORMANCE_SETTINGS.VIEWPORT);

            // Apply performance optimizations
            await setupPerformanceOptimizations(page);
            await ensureVideoStability(page);

            // Set username in the page
            await page.evaluate((name) => {
              const nameInput = document.querySelector('input[type="text"]');
              if (nameInput) {
                nameInput.value = name;
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, username);
            
            return {
              success: true,
              meetingId: meeting.id,
              username,
              browser: 'chromium',
              keepOpenOnTimeout: true,
              scheduledTermination: new Date(Date.now() + duration).toISOString()
            };
          } catch (error) {
            return {
              success: false,
              meetingId: meeting.id,
              username,
              error: \`Processing error: \${error.message}\`,
              browser: 'chromium'
            };
          }
        });

        const meetingResults = await Promise.all(tabPromises);
        results.push(...meetingResults);
        
        optimizeMemory();
      }
    } finally {
      clearInterval(memoryOptimizationInterval);
    }

    return results;
  }

  // Handle process termination
  process.on('SIGTERM', () => cleanup('SIGTERM received'));
  process.on('SIGINT', () => cleanup('SIGINT received'));
  process.on('uncaughtException', (error) => {
    console.error(\`[${new Date().toISOString()}] Uncaught exception: \${error}\`);
    cleanup('Uncaught exception');
  });

  // Start processing meetings
  Promise.resolve()
    .then(() => openMeetingTabs(workerData.meetings))
    .then(result => parentPort.postMessage(result))
    .catch(error => {
      console.error(\`[${new Date().toISOString()}] Error: \${error}\`);
      cleanup('Fatal error');
      parentPort.postMessage(workerData.meetings.flatMap(meeting => 
        generateUsernames(10).map(username => ({
          success: false,
          meetingId: meeting.id,
          username,
          error: \`Worker error: \${error.message}\`,
          browser: 'chromium'
        }))
      ));
    });
`;