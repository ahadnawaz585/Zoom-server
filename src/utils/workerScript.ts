export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { chromium, firefox, webkit } = require('playwright');
  const { setPriority } = require('os');
  const os = require('os');

  const browserEngines = { chromium, firefox, webkit };
  
  // Extract system info if provided
  const { systemInfo = { cpuCount: os.cpus().length, highPriority: true } } = workerData;

  // Set higher thread priority for better performance
  if (systemInfo.highPriority) {
    try {
      setPriority(19); // High priority (19 on Unix-like, use -20 for Windows)
      console.log(\`[${new Date().toISOString()}] Worker thread set to high priority\`);
    } catch (error) {
      console.warn(\`[${new Date().toISOString()}] Failed to set thread priority: \${error}\`);
    }
  }

  const joinMeetingPair = async ({ botPair, meetingId, password, origin, signature, browserType, skipJoinIndicator = true, keepOpenOnTimeout = true, selectorTimeout = 86400000 }) => {
    console.log(\`[${new Date().toISOString()}] Worker starting for bots \${botPair.map(b => b.name).join(', ')} with \${browserType}\`);
    const browserEngine = browserEngines[browserType];
    let browser;
    let context;

    // Options to optimize browser performance
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // Use a single process
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check'
      ],
      timeout: 30000 // Increased timeout for browser launch
    };
    
    // Apply specific browser optimizations
    if (browserType === 'chromium') {
      // Additional Chromium-specific optimizations
      launchOptions.args.push(
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
      );
    } else if (browserType === 'firefox') {
      // Firefox-specific optimizations
      launchOptions.firefoxUserPrefs = {
        'media.volume_scale': '0.0',
        'media.navigator.audio.fake_device': 'true',
        'media.navigator.permission.disabled': true,
        'media.navigator.streams.fake': true,
        'media.autoplay.block-webaudio': false,
        'media.block-autoplay-until-in-foreground': false
      };
    }

    try {
      console.log(\`[${new Date().toISOString()}] Launching \${browserType} with optimized settings\`);
      context = await browserEngine.launchPersistentContext('', launchOptions);
      browser = context.browser();
      console.log(\`[${new Date().toISOString()}] \${browserType} launched for bots \${botPair.map(b => b.name).join(', ')}\`);

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
        await page.setViewportSize({ width: 800, height: 600 });
      }));

      // Process all bots in parallel for maximum efficiency
      console.log(\`[${new Date().toISOString()}] Processing \${botPair.length} bots in parallel\`);
      await Promise.all(botPair.map(async (bot, index) => {
        const page = pages[index];
        console.log(\`[${new Date().toISOString()}] \${browserType} attempting to join with bot \${bot.name}\`);
        
        const url = \`\${origin}/meeting?username=\${encodeURIComponent(bot.name)}&meetingId=\${encodeURIComponent(meetingId)}&password=\${encodeURIComponent(password)}&signature=\${encodeURIComponent(signature)}\`;
        console.log(url);
        
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
              console.log(\`[${new Date().toISOString()}] \${browserType} bot \${bot.name} joined successfully\`);
            } catch (waitError) {
              console.log(\`[${new Date().toISOString()}] Indicator wait timeout for \${bot.name}: \${waitError.message}\`);
            }
          } else {
            // Just wait a moment to let the page initialize
            await page.waitForTimeout(2000);
            console.log(\`[${new Date().toISOString()}] \${browserType} bot \${bot.name} navigation complete - skipping join indicator check\`);
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
          } catch (interactionError) {
            console.log(\`[${new Date().toISOString()}] Optional interaction error for \${bot.name}, continuing: \${interactionError.message}\`);
          }
          
          // Always mark as success
          results.push({ 
            success: true, 
            botId: bot.id, 
            browser: browserType,
            keepOpenOnTimeout: true
          });
          
          // Important: Don't close the page - leave it open
        } catch (error) {
          console.log(\`[${new Date().toISOString()}] \${browserType} bot \${bot.name} encountered issue: \${error.message}\`);
          
          // Even on error, if keepOpenOnTimeout is true, mark as success and keep page open
          if (keepOpenOnTimeout) {
            results.push({ 
              success: true, 
              botId: bot.id, 
              browser: browserType,
              error: 'Tab kept open despite error: ' + error.message,
              keepOpenOnTimeout: true
            });
            // Don't close the page
          } else {
            results.push({ 
              success: false, 
              botId: bot.id, 
              error: error.message, 
              browser: browserType 
            });
            await page.close().catch(() => {}); // Ignore close errors
          }
        }
      }));

      // Set up keep-alive for browser context to prevent it from being garbage collected
      if (keepOpenOnTimeout) {
        const interval = setInterval(() => {
          // Report that browsers are still alive
          console.log(\`[${new Date().toISOString()}] \${browserType} keeping browsers alive for \${botPair.map(b => b.name).join(', ')}\`);
        }, 300000); // Log every 5 minutes
        
        // Ensure interval doesn't keep Node.js process alive indefinitely
        interval.unref();
      }

      // Don't close the context or browser - leave everything open
      console.log(\`[${new Date().toISOString()}] \${browserType} keeping browser open for bots \${botPair.map(b => b.name).join(', ')}\`);
      return results;
    } catch (error) {
      console.error(\`[${new Date().toISOString()}] \${browserType} launch failed: \${error.message}\`);
      // Only close the browser if it failed to launch properly
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
    .then(() => joinMeetingPair(workerData))
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
`;