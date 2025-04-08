export const workerScript = `
  const { parentPort, workerData } = require('worker_threads');
  const { chromium, firefox, webkit } = require('playwright');
  const { setPriority } = require('os');

  const browserEngines = { chromium, firefox, webkit };

  const joinMeetingPair = async ({ botPair, meetingId, password, origin, signature, browserType }) => {
    setPriority(19); // High priority (19 on Unix-like, use -20 for Windows)
    console.log(\`[${new Date().toISOString()}] Worker starting for bots \${botPair.map(b => b.name).join(', ')} with \${browserType}\`);
    const browserEngine = browserEngines[browserType];
    let browser;

    try {
      const context = await browserEngine.launchPersistentContext('', { 
        headless: true, 
        args: browserType === 'chromium' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
        timeout: 15000 // Increased timeout
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
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (!response || response.status() >= 400) throw new Error('Navigation failed: Status ' + response?.status());

          await Promise.race([
            page.waitForSelector("#meeting-joined-indicator", { timeout: 20000 }),
            page.waitForSelector(".join-error", { timeout: 20000 }).then(() => {
              throw new Error('Meeting join error detected');
            })
          ]);

          console.log(\`[${new Date().toISOString()}] \${browserType} bot \${bot.name} joined successfully\`);
          results.push({ success: true, botId: bot.id, browser: browserType });
        } catch (error) {
          console.error(\`[${new Date().toISOString()}] \${browserType} bot \${bot.name} failed: \${error.message}\`);
          results.push({ success: false, botId: bot.id, error: error.message, browser: browserType });
        } finally {
          await page.close();
        }
      }));

      await context.close();
      console.log(\`[${new Date().toISOString()}] \${browserType} closed for bots \${botPair.map(b => b.name).join(', ')}\`);
      return results;
    } catch (error) {
      console.error(\`[${new Date().toISOString()}] \${browserType} launch failed: \${error.message}\`);
      if (browser) await browser.close();
      return botPair.map(bot => ({ success: false, botId: bot.id, error: 'Browser launch failed: ' + error.message, browser: browserType }));
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
