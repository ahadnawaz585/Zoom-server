export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { chromium, firefox, webkit } = require('playwright');
  const { setPriority } = require('os');

  const browserEngines = { chromium, firefox, webkit };

  const joinMeetingPair = async ({ botPair, meetingId, password, origin, signature, browserType, skipJoinIndicator = true, keepOpenOnTimeout = true, selectorTimeout = 86400000 }) => {
    setPriority(19); // High priority (19 on Unix-like, use -20 for Windows)
    console.log(\`[${new Date().toISOString()}] Worker starting for bots \${botPair.map(b => b.name).join(', ')} with \${browserType}\`);
    const browserEngine = browserEngines[browserType];
    let browser;
    let context;

    try {
      context = await browserEngine.launchPersistentContext('', { 
        headless: true, 
        args: browserType === 'chromium' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
        timeout: 30000 // Increased timeout for browser launch
      });
      browser = context.browser();
      console.log(\`[${new Date().toISOString()}] \${browserType} launched for bots \${botPair.map(b => b.name).join(', ')}\`);

      const results = [];
      const pages = await Promise.all(botPair.map(() => context.newPage()));

      await Promise.all(botPair.map(async (bot, index) => {
        const page = pages[index];
        console.log(\`[${new Date().toISOString()}] \${browserType} attempting to join with bot \${bot.name}\`);
        
        const url = \`\${origin}/meeting?username=\${encodeURIComponent(bot.name)}&meetingId=\${encodeURIComponent(meetingId)}&password=\${encodeURIComponent(password)}&signature=\${encodeURIComponent(signature)}\`;
        console.log(url);
        try {
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          if (!response || response.status() >= 400) throw new Error('Navigation failed: Status ' + response?.status());

          // Skip waiting for join indicator if requested
          if (!skipJoinIndicator) {
            await Promise.race([
              page.waitForSelector("#meeting-joined-indicator", { timeout: selectorTimeout }),
              page.waitForSelector(".join-error", { timeout: selectorTimeout }).then(() => {
                throw new Error('Meeting join error detected');
              })
            ]);
            console.log(\`[${new Date().toISOString()}] \${browserType} bot \${bot.name} joined successfully\`);
          } else {
            // Just wait a moment to let the page initialize
            await page.waitForTimeout(5000);
            console.log(\`[${new Date().toISOString()}] \${browserType} bot \${bot.name} navigation complete - skipping join indicator check\`);
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
            await page.close();
          }
        }
      }));

      // Don't close the context or browser - leave everything open
      console.log(\`[${new Date().toISOString()}] \${browserType} keeping browser open for bots \${botPair.map(b => b.name).join(', ')}\`);
      return results;
    } catch (error) {
      console.error(\`[${new Date().toISOString()}] \${browserType} launch failed: \${error.message}\`);
      // Only close the browser if it failed to launch properly
      if (browser) await browser.close();
      return botPair.map(bot => ({ 
        success: false, 
        botId: bot.id, 
        error: 'Browser launch failed: ' + error.message, 
        browser: browserType 
      }));
    }
  };

  joinMeetingPair(workerData)
    .then(result => parentPort.postMessage(result))
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