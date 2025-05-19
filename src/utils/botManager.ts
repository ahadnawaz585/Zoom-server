import BrowserManager from '../utils/browserManager';
import { Bot } from '../types';

export class BotManager {
  private browserManagers: BrowserManager[] = [];
  private maxBrowsers: number = 4; // Max browser instances
  private maxTabsPerBrowser: number = 25; // Max tabs per browser to prevent crashes

  constructor() {
    // Initialize multiple browser managers
    for (let i = 0; i < this.maxBrowsers; i++) {
      this.browserManagers.push(new BrowserManager());
    }
  }

  async launchBrowsers(): Promise<void> {
    console.log(`[${new Date().toISOString()}] Launching ${this.maxBrowsers} browser instances`);
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
    const results: { tabId: string; botIds: string[] }[] = [];
    const maxBotsPerTab = 2; // Only 2 bots per tab

    // Distribute bots across browser instances
    let browserIndex = 0;
    for (let i = 0; i < bots.length; i += maxBotsPerTab) {
      const batch = bots.slice(i, i + maxBotsPerTab);
      if (batch.length === 0) break;

      const botIds = batch.map(bot => bot.id.toString());
      const usernames = batch.map(bot => encodeURIComponent(bot.name)).join(',');

      // Construct optimized URL
      let url = `${origin}/meeting?usernames=${usernames}&meetingId=${encodeURIComponent(meetingId)}&password=${encodeURIComponent(password)}&signature=${encodeURIComponent(signature)}`;
      url += '&optimized=true&noVideo=true&noAudio=true&forceMute=true&lowRes=true&minimalUI=true';

      console.log(`[${new Date().toISOString()}] Opening tab for ${batch.length} bots with URL: ${url}`);

      try {
        const browserManager = this.browserManagers[browserIndex];
        if (browserManager.getTabCount() >= this.maxTabsPerBrowser) {
          browserIndex = (browserIndex + 1) % this.maxBrowsers;
          console.log(`[${new Date().toISOString()}] Switching to browser instance ${browserIndex}`);
        }

        const tabId = await browserManager.openTabForDuration(url, duration * 60 * 1000);
        results.push({ tabId, botIds });
        console.log(`[${new Date().toISOString()}] Successfully opened tab ${tabId} for bots: ${botIds.join(', ')}`);

        // Throttle to prevent browser overload
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error opening tab for bots: ${botIds.join(', ')}`, error);
      }
    }

    return results;
  }

  async closeAll(): Promise<void> {
    console.log(`[${new Date().toISOString()}] Closing all browser instances`);
    await Promise.all(this.browserManagers.map(bm => bm.closeBrowser()));
  }
}
