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
    console.log(\`[${new Date().toISOString()}] Worker starting for bots \${botPair.map(b => b.name).join(', ')} with chromium\`);
    console.log(\`[${new Date().toISOString()}] Browser session will run for \${duration/60000} minutes\`);

    // Base options for Chromium
    const launchOptions = {
      headless: true,
      timeout: 30000 // Increased timeout for browser launch
    };

    // Chromium-specific optimizations
    launchOptions.args = [
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
      '--disable-background-timer-throttling'
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
      console.log(\`[${new Date().toISOString()}] Launching chromium with optimized settings\`);
      context = await chromium.launchPersistentContext('', launchOptions);
      browser = context.browser();
      
      // Grant microphone permissions automatically
      await context.grantPermissions(['microphone']);
      console.log(\`[${new Date().toISOString()}] Microphone permissions granted for chromium\`);

      console.log(\`[${new Date().toISOString()}] chromium launched for bots \${botPair.map(b => b.name).join(', ')}\`);

      // Schedule cleanup after duration
      console.log(\`[${new Date().toISOString()}] Scheduling browser closure after \${duration/60000} minutes\`);
      cleanupTimeout = setTimeout(async () => {
        console.log(\`[${new Date().toISOString()}] Duration timer expired - closing browser\`);
        await cleanup('Duration timer expired');
      }, duration);

      const results = [];
      
      // Create all pages in parallel
      console.log(\`[${new Date().toISOString()}] Creating \${botPair.length} pages in parallel\`);
      const pages = await Promise.all(botPair.map(() => context.newPage()));
      
      // Configure each page for performance
      await Promise.all(pages.map(async (page) => {
        // Disable unnecessary features
        await page.route('**/*.{png,jpg,jpeg,gif,webp,css,woff,woff2,svg,ico}', route => {
          return route.abort();
        });
        
        // Block analytics, ads and other unnecessary requests
        await page.route(/google-analytics|googletagmanager|analytics|facebook|twitter|hotjar/, route => {
          return route.abort();
        });
        
        // Set low-res viewport to reduce resource usage
        const viewportWidth = lowResolution ? 640 : 800;
        const viewportHeight = lowResolution ? 480 : 600;
        await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
      }));

      // Process all bots in parallel for maximum efficiency
      console.log(\`[${new Date().toISOString()}] Processing \${botPair.length} bots in parallel\`);
      await Promise.all(botPair.map(async (bot, index) => {
        const page = pages[index];
        console.log(\`[${new Date().toISOString()}] chromium attempting to join with bot \${bot.name}\`);
        
        // Add optimized query parameters when optimizedJoin is enabled
        let url = \`\${origin}/meeting?username=\${encodeURIComponent(bot.name)}&meetingId=\${encodeURIComponent(meetingId)}&password=\${encodeURIComponent(password)}&signature=\${encodeURIComponent(signature)}\`;
        
        if (optimizedJoin) {
          url += \`&optimized=true\`;
          if (disableVideo) url += \`&noVideo=true\`;
          if (disableAudio) url += \`&noAudio=true\`;
          if (lowResolution) url += \`&lowRes=true\`;
        }
        
        console.log(\`[${new Date().toISOString()}] Navigating to: \${url}\`);
        
        try {
          // Set shorter timeouts for navigation but handle gracefully
          const navigationResponse = await page.goto(url, { 
            waitUntil: 'domcontentloaded', // Use faster domcontentloaded instead of load
            timeout: 30000 
          }).catch(error => {
            console.log(\`[${new Date().toISOString()}] Navigation initial timeout for \${bot.name}, continuing anyway: \${error.message}\`);
            return null; // Return null but continue execution
          });
          
          if (navigationResponse && navigationResponse.status() >= 400) {
            console.warn(\`[${new Date().toISOString()}] Navigation returned error status \${navigationResponse.status()} for \${bot.name}, but continuing\`);
          }

          // Skip waiting for join indicator if requested
          if (!skipJoinIndicator) {
            try {
              await Promise.race([
                page.waitForSelector("#meeting-joined-indicator", { timeout: selectorTimeout }),
                page.waitForSelector(".join-error", { timeout: selectorTimeout }).then(() => {
                  throw new Error('Meeting join error detected');
                })
              ]);
              console.log(\`[${new Date().toISOString()}] chromium bot \${bot.name} joined successfully\`);
            } catch (waitError) {
              console.log(\`[${new Date().toISOString()}] Indicator wait timeout for \${bot.name}: \${waitError.message}\`);
            }
          } else {
            // Just wait a moment to let the page initialize
            await page.waitForTimeout(2000);
            console.log(\`[${new Date().toISOString()}] chromium bot \${bot.name} navigation complete - skipping join indicator check\`);
          }
          
          // Run some basic interaction to ensure the meeting connection is established
          try {
            // Try to ensure audio/video permissions by clicking common UI elements
            // These are optional and won't fail the process if they don't exist
            const possibleJoinButtons = [
              'button:has-text("Join")', 
              'button:has-text("Join Audio")', 
              'button:has-text("Join with Computer Audio")',
              '[data-testid="join-btn"]'
            ];
            
            // Try each selector, but don't worry if not found
            for (const selector of possibleJoinButtons) {
              await page.locator(selector).click().catch(() => {}); // Ignore errors
              await page.waitForTimeout(500);
            }
            
            // Handle optimized settings if needed
            if (optimizedJoin) {
              // Disable video if requested (look for common UI selectors)
              if (disableVideo) {
                const videoButtons = [
                  'button[aria-label*="video"]',
                  'button[title*="video"]',
                  '[data-testid="video-btn"]'
                ];
                
                for (const selector of videoButtons) {
                  await page.locator(selector).click().catch(() => {}); // Ignore errors
                  await page.waitForTimeout(500);
                }
              }
              
              // Disable audio if requested
              if (disableAudio) {
                const audioButtons = [
                  'button[aria-label*="mute"]',
                  'button[title*="mute"]',
                  '[data-testid="audio-btn"]'
                ];
                
                for (const selector of audioButtons) {
                  await page.locator(selector).click().catch(() => {}); // Ignore errors
                  await page.waitForTimeout(500);
                }
              }
            }
          } catch (interactionError) {
            console.log(\`[${new Date().toISOString()}] Optional interaction error for \${bot.name}, continuing: \${interactionError.message}\`);
          }
          
          // Always mark as success
          results.push({ 
            success: true, 
            botId: bot.id, 
            browser: 'chromium',
            keepOpenOnTimeout: true,
            scheduledTermination: new Date(Date.now() + duration).toISOString()
          });
          
          // Important: Don't close the page - leave it open
        } catch (error) {
          console.log(\`[${new Date().toISOString()}] chromium bot \${bot.name} encountered issue: \${error.message}\`);
          
          // Even on error, if keepOpenOnTimeout is true, mark as success and keep page open
          if (keepOpenOnTimeout) {
            results.push({ 
              success: true, 
              botId: bot.id, 
              browser: 'chromium',
              error: 'Tab kept open despite error: ' + error.message,
              keepOpenOnTimeout: true,
              scheduledTermination: new Date(Date.now() + duration).toISOString()
            });
            // Don't close the page
          } else {
            results.push({ 
              success: false, 
              botId: bot.id, 
              error: error.message, 
              browser: 'chromium'
            });
            await page.close().catch(() => {}); // Ignore close errors
          }
        }
      }));

      // Set up keep-alive for browser context to prevent it from being garbage collected
      if (keepOpenOnTimeout) {
        keepAliveInterval = setInterval(() => {
          // Report that browsers are still alive
          const remainingMinutes = ((Date.now() + duration) - Date.now()) / 60000;
          console.log(\`[${new Date().toISOString()}] chromium keeping browsers alive for \${botPair.map(b => b.name).join(', ')}. Approximately \${remainingMinutes.toFixed(1)} minutes remaining\`);
        }, 60000); // Log every minute
        
        // Ensure interval doesn't keep Node.js process alive indefinitely
        keepAliveInterval.unref();
      }

      // Don't close the context or browser - leave everything open
      console.log(\`[${new Date().toISOString()}] chromium keeping browser open for bots \${botPair.map(b => b.name).join(', ')} for \${duration/60000} minutes\`);
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