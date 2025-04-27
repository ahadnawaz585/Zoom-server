import BrowserManager from '../utils/browserManager';
import { Bot } from '../types';

export class BotManager {
  private browserManager: BrowserManager;

  constructor(browserManager: BrowserManager) {
    this.browserManager = browserManager;
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
    const maxBotsPerTab = 3; // Use single page for up to 3 bots to save resources

    for (let i = 0; i < bots.length; i += maxBotsPerTab) {
      const batch = bots.slice(i, i + maxBotsPerTab);
      const botIds = batch.map(bot => bot.id.toString());
      const usernames = batch.map(bot => encodeURIComponent(bot.name)).join(',');
      let url = `${origin}/meetings?usernames=${usernames}&meetingId=${encodeURIComponent(meetingId)}&password=${encodeURIComponent(password)}&signature=${encodeURIComponent(signature)}`;
      url += '&optimized=true&noVideo=true&noAudio=true&lowRes=true';

      const tabId = await this.browserManager.openTabForDuration(url, duration * 60 * 1000);
      results.push({ tabId, botIds });

      // Throttle to prevent overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  }
}