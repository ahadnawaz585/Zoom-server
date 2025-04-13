export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { chromium } = require('playwright');
  const { setPriority } = require('os');
  const os = require('os');

  // Extract system info if provided
  const { systemInfo = { cpuCount: os.cpus().length, highPriority: true } } = workerData;
  
  // Extract duration from workerData (defaults to 60 minutes if not specified)
  const duration = workerData.duration || 60 * 60 * 1000; // in milliseconds
  
  // Track browser resources for cleanup
  let browser;
  let context;
  let cleanupTimeout;
  let keepAliveInterval;
  let pages = [];
  
  // Setup termination handler for parent messages
  parentPort.on('message', (message) => {
    if (message.type === 'TERMINATE') {
      console.log(\`[${new Date().toISOString()}] Received termination message from parent\`);
      cleanup('Parent requested termination')
        .then(() => {
          console.log(\`[${new Date().toISOString()}] Cleanup completed after termination request\`);
        })
        .catch(err => {
          console.error(\`[${new Date().toISOString()}] Error during cleanup after termination: \${err}\`);
        });
    }
  });

  // Set higher thread priority for better performance
  if (systemInfo.highPriority) {
    try {
      setPriority(19); // High priority (19 on Unix-like, use -20 for Windows)
      console.log(\`[${new Date().toISOString()}] Worker thread set to high priority\`);
    } catch (error) {
      console.warn(\`[${new Date().toISOString()}] Failed to set thread priority: \${error}\`);
    }
  }
  
  // Function to clean up resources
  async function cleanup(reason) {
    console.log(\`[${new Date().toISOString()}] Cleaning up resources: \${reason}\`);
    
    // Clear any pending timeouts/intervals
    if (cleanupTimeout) clearTimeout(cleanupTimeout);
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    
    // Close browser resources
    try {
      // Close all pages first
      for (const page of pages) {
        try {
          if (page && !page.isClosed()) {
            await page.close().catch(e => console.error(\`Page close error: \${e}\`));
          }
        } catch (e) {
          console.error(\`[${new Date().toISOString()}] Error closing page: \${e}\`);
        }
      }
      
      if (context) {
        console.log(\`[${new Date().toISOString()}] Closing browser context\`);
        await context.close().catch(e => console.error(\`Context close error: \${e}\`));
      }
      
      if (browser) {
        console.log(\`[${new Date().toISOString()}] Closing browser\`);
        await browser.close().catch(e => console.error(\`Browser close error: \${e}\`));
      }
      
      console.log(\`[${new Date().toISOString()}] Cleanup completed\`);
    } catch (error) {
      console.error(\`[${new Date().toISOString()}] Error during cleanup: \${error}\`);
    }
  }

  // Memory optimization function - force garbage collection if available
  function optimizeMemory() {
    try {
      if (global.gc) {
        global.gc();
        console.log(\`[${new Date().toISOString()}] Forced garbage collection\`);
      }
    } catch (e) {
      // Ignore if gc is not available
    }
  }

  // Calculate resource limits based on bot count
  function calculateResourceLimits(botCount) {
    // Memory parameters based on bot count
    return {
      // Limit the memory usage based on the number of bots
      maxMemoryMB: 512 + (botCount * 50),
      // Limit concurrent connections per domain
      maxConcurrentConnections: Math.max(3, Math.min(10, botCount)),
      // Response size limit
      downloadLimit: 1024 * 1024 * 3, // 3MB
    };
  }

  const joinMeetingPair = async ({ 
    botPair, 
    meetingId, 
    password, 
    origin, 
    signature, 
    browserType,
    skipJoinIndicator = true, 
    keepOpenOnTimeout = true, 
    selectorTimeout = 86400000,
    // Support for new options from controller
    optimizedJoin = true,
    disableVideo = true,
    disableAudio = true,
    lowResolution = true
  }) => {
    console.log(\`[${new Date().toISOString()}] Worker starting for \${botPair.length} bots with chromium\`);
    console.log(\`[${new Date().toISOString()}] Browser session will run for \${duration/60000} minutes\`);

    // Safety check - ensure we don't exceed 10 bots per worker
    const maxBotsPerWorker = 10;
    if (botPair.length > maxBotsPerWorker) {
      console.warn(\`[${new Date().toISOString()}] Worker received \${botPair.length} bots, which exceeds the maximum of \${maxBotsPerWorker}\`);
      // Truncate the list to maximum allowed
      botPair = botPair.slice(0, maxBotsPerWorker);
      console.log(\`[${new Date().toISOString()}] Proceeding with first \${maxBotsPerWorker} bots only\`);
    }

    // Calculate resource limits based on bot count
    const resourceLimits = calculateResourceLimits(botPair.length);

    // Base options for Chromium
    const launchOptions = {
      headless: true,
      timeout: 30000, // Increased timeout for browser launch
      // Use a shared context to save memory
      userDataDir: '', // Use empty string for in-memory data dir
    };

    // Add memory limits based on bot count
    launchOptions.args = [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      // Use process per site instead of process per tab to save memory
      '--process-per-site',
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
      // Memory-specific flags
      \`--js-flags=--max-old-space-size=\${resourceLimits.maxMemoryMB}\`,
      \`--memory-pressure-off\`,
    ];
    
    // Add additional optimizations for video/audio when requested
    if (disableVideo) {
      launchOptions.args.push('--use-fake-device-for-media-stream');
      launchOptions.args.push('--use-fake-ui-for-media-stream');
      launchOptions.args.push('--disable-webrtc-hw-encoding');
      launchOptions.args.push('--disable-webrtc-hw-decoding');
    }
    
    if (lowResolution) {
      launchOptions.args.push('--force-device-scale-factor=0.5');
    }

    try {
      console.log(\`[${new Date().toISOString()}] Launching chromium with optimized settings for \${botPair.length} bots\`);
      context = await chromium.launchPersistentContext('', launchOptions);
      browser = context.browser();

      // Optimize memory usage right after browser launch
      optimizeMemory();
      
      // Grant microphone permissions automatically
      await context.grantPermissions(['microphone']);
      console.log(\`[${new Date().toISOString()}] Microphone permissions granted for chromium\`);

      console.log(\`[${new Date().toISOString()}] chromium launched for \${botPair.length} bots\`);

      // Schedule cleanup after duration
      console.log(\`[${new Date().toISOString()}] Scheduling browser closure after \${duration/60000} minutes\`);
      cleanupTimeout = setTimeout(async () => {
        console.log(\`[${new Date().toISOString()}] Duration timer expired - closing browser\`);
        await cleanup('Duration timer expired');
      }, duration);

      const results = [];
      
      // For better resource management, decide whether to use a single page or multiple pages
      // based on bot count - for small numbers of bots (<=3), use separate pages
      // for larger numbers, use a single page with multiple bots
      const useSinglePage = botPair.length > 3;
      
      if (useSinglePage) {
        console.log(\`[${new Date().toISOString()}] Using single page approach for \${botPair.length} bots\`);
        const page = await context.newPage();
        pages.push(page);
        
        // Configure page for performance
        // Disable unnecessary features
        await page.route('**/*.{png,jpg,jpeg,gif,webp,css,woff,woff2,svg,ico}', route => {
          return route.abort();
        });
        
        // Block analytics, ads and other unnecessary requests
        await page.route(/google-analytics|googletagmanager|analytics|facebook|twitter|hotjar/, route => {
          return route.abort();
        });
        
        // Set low-res viewport to reduce resource usage
        const viewportWidth = lowResolution ? 800 : 1280;
        const viewportHeight = lowResolution ? 600 : 720;
        await page.setViewportSize({ width: viewportWidth, height: viewportHeight });

        try {
          console.log(\`[${new Date().toISOString()}] chromium attempting to join with \${botPair.length} bots in a single page\`);
          
          // Create usernames parameter by joining all bot names
          const usernamesParam = botPair.map(bot => encodeURIComponent(bot.name)).join(',');
          
          // Add optimized query parameters when optimizedJoin is enabled
          let url = \`\${origin}/meetings?usernames=\${usernamesParam}&meetingId=\${encodeURIComponent(meetingId)}&password=\${encodeURIComponent(password)}&signature=\${encodeURIComponent(signature)}\`;
          
          if (optimizedJoin) {
            url += \`&optimized=true\`;
            if (disableVideo) url += \`&noVideo=true\`;
            if (disableAudio) url += \`&noAudio=true\`;
            if (lowResolution) url += \`&lowRes=true\`;
          }
          
          console.log(\`[${new Date().toISOString()}] Navigating to: \${url}\`);
          
          // Set shorter timeouts for navigation but handle gracefully
          const navigationResponse = await page.goto(url, { 
            waitUntil: 'domcontentloaded', // Use faster domcontentloaded instead of load
            timeout: 30000 
          }).catch(error => {
            console.log(\`[${new Date().toISOString()}] Navigation initial timeout for multiple bots, continuing anyway: \${error.message}\`);
            return null; // Return null but continue execution
          });
          
          if (navigationResponse && navigationResponse.status() >= 400) {
            console.warn(\`[${new Date().toISOString()}] Navigation returned error status \${navigationResponse.status()} for multiple bots, but continuing\`);
          }

          // Wait for the grid of iframes to load
          try {
            await page.waitForSelector('iframe', { timeout: selectorTimeout });
            console.log(\`[${new Date().toISOString()}] Zoom meeting grid loaded\`);
          } catch (waitError) {
            console.log(\`[${new Date().toISOString()}] Timeout waiting for Zoom meeting grid to load: \${waitError.message}\`);
          }

          // Mark all bots as successful
          botPair.forEach(bot => {
            results.push({ 
              success: true, 
              botId: bot.id, 
              browser: 'chromium',
              keepOpenOnTimeout: true,
              scheduledTermination: new Date(Date.now() + duration).toISOString()
            });
          });
          
        } catch (error) {
          console.log(\`[${new Date().toISOString()}] chromium bots encountered issue: \${error.message}\`);
          
          // Even on error, if keepOpenOnTimeout is true, mark as success and keep page open
          if (keepOpenOnTimeout) {
            botPair.forEach(bot => {
              results.push({ 
                success: true, 
                botId: bot.id, 
                browser: 'chromium',
                error: 'Tab kept open despite error: ' + error.message,
                keepOpenOnTimeout: true,
                scheduledTermination: new Date(Date.now() + duration).toISOString()
              });
            });
            // Don't close the page
          } else {
            botPair.forEach(bot => {
              results.push({ 
                success: false, 
                botId: bot.id, 
                error: error.message, 
                browser: 'chromium'
              });
            });
            await page.close().catch(() => {}); // Ignore close errors
          }
        }
      } else {
        // Use separate pages for each bot when count is small (<=3)
        console.log(\`[${new Date().toISOString()}] Using multi-page approach for \${botPair.length} bots\`);
        
        // Process bots in sequence to avoid overwhelming the browser
        for (const bot of botPair) {
          console.log(\`[${new Date().toISOString()}] Processing bot: \${bot.name}\`);
          
          try {
            const page = await context.newPage();
            pages.push(page);
            
            // Configure page for performance
            await page.route('**/*.{png,jpg,jpeg,gif,webp,css,woff,woff2,svg,ico}', route => {
              return route.abort();
            });
            
            await page.route(/google-analytics|googletagmanager|analytics|facebook|twitter|hotjar/, route => {
              return route.abort();
            });
            
            // Set low-res viewport
            const viewportWidth = lowResolution ? 640 : 1024;
            const viewportHeight = lowResolution ? 480 : 720;
            await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
            
            // Add optimized query parameters
            let url = \`\${origin}/meeting?username=\${encodeURIComponent(bot.name)}&meetingId=\${encodeURIComponent(meetingId)}&password=\${encodeURIComponent(password)}&signature=\${encodeURIComponent(signature)}\`;
            
            if (optimizedJoin) {
              url += \`&optimized=true\`;
              if (disableVideo) url += \`&noVideo=true\`;
              if (disableAudio) url += \`&noAudio=true\`;
              if (lowResolution) url += \`&lowRes=true\`;
            }
            
            console.log(\`[${new Date().toISOString()}] Navigating to: \${url} for bot \${bot.name}\`);
            
            const navigationResponse = await page.goto(url, { 
              waitUntil: 'domcontentloaded',
              timeout: 30000 
            }).catch(error => {
              console.log(\`[${new Date().toISOString()}] Navigation timeout for bot \${bot.name}, continuing: \${error.message}\`);
              return null;
            });
            
            try {
              await page.waitForSelector('iframe', { timeout: 30000 });
              console.log(\`[${new Date().toISOString()}] Zoom meeting loaded for bot \${bot.name}\`);
              
              results.push({ 
                success: true, 
                botId: bot.id, 
                browser: 'chromium',
                keepOpenOnTimeout: true,
                scheduledTermination: new Date(Date.now() + duration).toISOString()
              });
            } catch (waitError) {
              console.log(\`[${new Date().toISOString()}] Timeout waiting for Zoom meeting for bot \${bot.name}: \${waitError.message}\`);
              
              // Mark as success anyway if we're keeping the page open
              if (keepOpenOnTimeout) {
                results.push({ 
                  success: true, 
                  botId: bot.id, 
                  browser: 'chromium',
                  error: 'Tab kept open despite selector timeout',
                  keepOpenOnTimeout: true,
                  scheduledTermination: new Date(Date.now() + duration).toISOString()
                });
              } else {
                results.push({ 
                  success: false, 
                  botId: bot.id, 
                  error: 'Selector timeout: ' + waitError.message, 
                  browser: 'chromium'
                });
                await page.close().catch(() => {});
              }
            }
            
            // Small delay between bot page creations to prevent overwhelming the browser
            await new Promise(resolve => setTimeout(resolve, 1000));
            
          } catch (botError) {
            console.error(\`[${new Date().toISOString()}] Error processing bot \${bot.name}: \${botError.message}\`);
            results.push({ 
              success: false, 
              botId: bot.id, 
              error: 'Processing error: ' + botError.message, 
              browser: 'chromium'
            });
          }
        }
      }

      // Run garbage collection to free up memory
      optimizeMemory();

      // Set up keep-alive for browser context to prevent it from being garbage collected
      if (keepOpenOnTimeout) {
        keepAliveInterval = setInterval(() => {
          // Report that browsers are still alive
          const remainingMinutes = ((Date.now() + duration) - Date.now()) / 60000;
          console.log(\`[${new Date().toISOString()}] chromium keeping browser alive for \${botPair.length} bots. Approximately \${remainingMinutes.toFixed(1)} minutes remaining\`);
          
          // Run periodic memory optimization
          optimizeMemory();
        }, 60000); // Log every minute
        
        // Ensure interval doesn't keep Node.js process alive indefinitely
        keepAliveInterval.unref();
      }

      // Don't close the context or browser - leave everything open
      console.log(\`[${new Date().toISOString()}] chromium keeping browser open for \${botPair.length} bots for \${duration/60000} minutes\`);
      return results;
    } catch (error) {
      console.error(\`[${new Date().toISOString()}] chromium launch failed: \${error.message}\`);
      // Clean up any resources that might have been created
      await cleanup('Launch error').catch(() => {});
      
      return botPair.map(bot => ({ 
        success: false, 
        botId: bot.id, 
        error: 'Browser launch failed: ' + error.message, 
        browser: 'chromium'
      }));
    }
  };

  // Execute with optimized error handling
  Promise.resolve()
    .then(() => joinMeetingPair(workerData))
    .then(result => {
      // Send results back to parent but keep browser open
      parentPort.postMessage(result);
    })
    .catch(error => {
      console.error(\`[${new Date().toISOString()}] Worker fatal error: \${error.message}\`);
      cleanup('Fatal error').catch(() => {});
      
      parentPort.postMessage(workerData.botPair.map(bot => ({
        success: false,
        botId: bot.id,
        error: 'Worker fatal error: ' + error.message,
        browser: 'chromium'
      })));
    });
`;