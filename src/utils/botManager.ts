import BrowserManager from '../utils/browserManager';
import { Bot } from '../types';

export class BotManager {
  private browserManagers: BrowserManager[] = [];
  private maxTabsPerBrowser: number = 25; // Max tabs per browser to prevent crashes

  constructor() {
    // No browser instances initialized here; they'll be created dynamically
  }

  async launchBrowsers(): Promise<void> {
    console.log(`[${new Date().toISOString()}] Launching ${this.browserManagers.length} browser instances`);
    await Promise.all(this.browserManagers.map(bm => bm.launchBrowser()));
  }

  async joinMeetingForBots(
    bots: Bot[],
    meetingId: string,
    password: string,
    duration: number,
    origin: string,
    signature: string
  ): Promise<{ tabId: string; botIds: string[] }[]> {
    console.log(`[${new Date().toISOString()}] Processing ${bots.length} bots for meeting ${meetingId}`);
    const results: { tabId: string; botIds: string[] }[] = [];
    const maxBotsPerTab = 1; // Only 1 bot per tab for simplicity

    // Calculate required browser instances
    const requiredBrowsers = Math.ceil(bots.length / this.maxTabsPerBrowser);
    console.log(`[${new Date().toISOString()}] Requiring ${requiredBrowsers} browser instances for ${bots.length} bots`);

    // Initialize browser instances if needed
    while (this.browserManagers.length < requiredBrowsers) {
      this.browserManagers.push(new BrowserManager());
    }

    // Launch only the required browser instances
    await Promise.all(
      this.browserManagers.slice(0, requiredBrowsers).map(bm => bm.launchBrowser())
    );

    // Distribute bots across browser instances
    let currentBrowserIndex = 0;
    let tabsInCurrentBrowser = this.browserManagers[currentBrowserIndex].getTabCount();

    for (let i = 0; i < bots.length; i += maxBotsPerTab) {
      const batch = bots.slice(i, i + maxBotsPerTab);
      if (batch.length === 0) break;

      const botIds = batch.map(bot => bot.id.toString());
      const usernames = batch.map(bot => encodeURIComponent(bot.name)).join(',');

      // Construct optimized URL
      let url = `${origin}/meeting?username=${usernames}&meetingId=${encodeURIComponent(meetingId)}&password=${encodeURIComponent(password)}&signature=${encodeURIComponent(signature)}`;
      url += '&optimized=true&noVideo=true&noAudio=true&forceMute=true&lowRes=true&minimalUI=true';

      console.log(`[${new Date().toISOString()}] Opening tab for ${batch.length} bots with URL: ${url}`);

      try {
        // Check if current browser has reached max tabs
        if (tabsInCurrentBrowser >= this.maxTabsPerBrowser) {
          currentBrowserIndex++;
          tabsInCurrentBrowser = 0; // Reset tab count for new browser
          if (currentBrowserIndex >= this.browserManagers.length) {
            console.warn(`[${new Date().toISOString()}] No more browser instances available`);
            break; // No more browser instances available
          }
          console.log(`[${new Date().toISOString()}] Switching to browser instance ${currentBrowserIndex}`);
        }

        const browserManager = this.browserManagers[currentBrowserIndex];
        const tabId = await browserManager.openTabForDuration(url, duration * 60 * 1000);
        results.push({ tabId, botIds });
        tabsInCurrentBrowser++; // Increment tab count for current browser
        console.log(`[${new Date().toISOString()}] Successfully opened tab ${tabId} for bots: ${botIds.join(', ')}`);

        // Throttle to prevent browser overload
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error opening tab for bots: ${botIds.join(', ')}`, error);
      }
    }

    // Log the distribution of tabs across browsers
    this.browserManagers.forEach((bm, index) => {
      console.log(`[${new Date().toISOString()}] Browser ${index} has ${bm.getTabCount()} tabs`);
    });

    return results;
  }

  async closeAll(): Promise<void> {
    console.log(`[${new Date().toISOString()}] Closing all browser instances`);
    await Promise.all(this.browserManagers.map(bm => bm.closeBrowser()));
    this.browserManagers = []; // Clear browser instances after closing
  }
}