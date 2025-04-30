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
    const maxBotsPerTab = 10; // Use single page for up to 10 bots to save resources

    for (let i = 0; i < bots.length; i += maxBotsPerTab) {
      const batch = bots.slice(i, i + maxBotsPerTab);
      const botIds = batch.map(bot => bot.id.toString());
      const usernames = batch.map(bot => encodeURIComponent(bot.name)).join(',');
      
      // Add explicit parameters for audio control
      let url = `${origin}/meetings?usernames=${usernames}&meetingId=${encodeURIComponent(meetingId)}&password=${encodeURIComponent(password)}&signature=${encodeURIComponent(signature)}`;
      
      // Add optimization parameters
      url += '&optimized=true&noVideo=true&noAudio=false&forceMute=true&lowRes=true';

      console.log(`Opening tab for ${batch.length} bots with URL: ${url}`);
      
      try {
        const tabId = await this.browserManager.openTabForDuration(url, duration * 60 * 1000);
        results.push({ tabId, botIds });
        console.log(`Successfully opened tab ${tabId} for bots: ${botIds.join(', ')}`);
        
        // Optional: Take screenshot of the tab for debugging
        // await this.browserManager.takeScreenshot(tabId, `meeting-join-${new Date().getTime()}.png`);
      } catch (error) {
        console.error(`Error opening tab for bots: ${botIds.join(', ')}`, error);
      }

      // Throttle to prevent overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
  }
  
  async checkBotsMuteStatus(tabIds: string[]): Promise<boolean[]> {
    // This could be implemented with browser automation to check if bots are properly muted
    // For now, returning a placeholder implementation
    return tabIds.map(() => true);
  }
}