import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

interface TabInfo {
  id: string;
  url: string;
  title?: string;
  openedAt: Date;
  isActive: boolean;
}

interface BrowserDetails {
  browserId: string;
  launchTime: Date;
  isOpen: boolean;
  tabCount: number;
  tabs: TabInfo[];
}

export default class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private details: BrowserDetails;
  private detailsFilePath: string = './browser_details.json';

  constructor() {
    this.details = {
      browserId: uuidv4(),
      launchTime: new Date(),
      isOpen: false,
      tabCount: 0,
      tabs: []
    };
  }

  async launchBrowser(resourceLimits: { maxMemoryMB: number } = { maxMemoryMB: 512 }): Promise<void> {
    if (this.browser && this.context && this.details.isOpen) {
      console.log(`[${new Date().toISOString()}] Reusing existing browser instance (ID: ${this.details.browserId})`);
      return;
    }

    const launchOptions: any = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--process-per-site',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        // '--use-fake-device-for-media-stream',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio', // Remove if audio output is needed
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
        '--force-device-scale-factor=0.5',
        `--js-flags=--max-old-space-size=${resourceLimits.maxMemoryMB}`,
        '--memory-pressure-off'
      ]
    };

    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext();
    this.details.isOpen = true;
    this.details.launchTime = new Date();
    this.details.browserId = uuidv4();
    await this.saveDetails();
  }

  async openNewTab(url: string): Promise<string> {
    if (!this.browser || !this.context) {
      throw new Error('Browser not initialized');
    }

    const page = await this.context.newPage();
    const tabId = uuidv4();

    // Grant microphone permissions for voice input
    await this.context.grantPermissions(['microphone'], { origin: url });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const title = await page.title();

    const tabInfo: TabInfo = {
      id: tabId,
      url,
      title,
      openedAt: new Date(),
      isActive: true
    };

    this.pages.set(tabId, page);
    this.details.tabs.push(tabInfo);
    this.details.tabCount = this.pages.size;

    await this.saveDetails();
    return tabId;
  }

  async openTabForDuration(url: string, durationMs: number): Promise<string> {
    if (!this.browser || !this.context) {
      throw new Error('Browser not initialized');
    }

    const page = await this.context.newPage();
    const tabId = uuidv4();

    // Grant microphone permissions for voice input
    await this.context.grantPermissions(['microphone'], { origin: url });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const title = await page.title();

    const tabInfo: TabInfo = {
      id: tabId,
      url,
      title,
      openedAt: new Date(),
      isActive: true
    };

    this.pages.set(tabId, page);
    this.details.tabs.push(tabInfo);
    this.details.tabCount = this.pages.size;

    await this.saveDetails();

    setTimeout(async () => {
      try {
        await this.closeTab(tabId);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Failed to auto-close tab ${tabId}:`, error);
      }
    }, durationMs);

    return tabId;
  }

  async closeTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error('Tab not found');
    }

    await page.close();
    this.pages.delete(tabId);
    this.details.tabs = this.details.tabs.filter(tab => tab.id !== tabId);
    this.details.tabCount = this.pages.size;

    await this.saveDetails();
  }

  async closeBrowser(): Promise<void> {
    if (!this.browser) {
      throw new Error('No browser instance');
    }

    for (const page of this.pages.values()) {
      await page.close();
    }
    await this.context?.close();
    await this.browser.close();

    this.browser = null;
    this.context = null;
    this.pages.clear();
    this.details.isOpen = false;
    this.details.tabCount = 0;
    this.details.tabs = [];

    await this.saveDetails();
  }

  getBrowserStatus(): BrowserDetails {
    return { ...this.details };
  }

  getTabCount(): number {
    return this.pages.size;
  }

  async switchToTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error('Tab not found');
    }

    this.details.tabs = this.details.tabs.map(tab => ({
      ...tab,
      isActive: tab.id === tabId
    }));

    await page.bringToFront();
    await this.saveDetails();
  }

  async reloadTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error('Tab not found');
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  async getTabInfo(tabId: string): Promise<TabInfo | undefined> {
    return this.details.tabs.find(tab => tab.id === tabId);
  }

  async navigateTab(tabId: string, url: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error('Tab not found');
    }

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const title = await page.title();

    const tabIndex = this.details.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex !== -1) {
      this.details.tabs[tabIndex] = {
        ...this.details.tabs[tabIndex],
        url,
        title
      };
    }

    await this.saveDetails();
  }

  private async saveDetails(): Promise<void> {
    await fs.writeFile(this.detailsFilePath, JSON.stringify(this.details, null, 2));
  }

  async loadDetails(): Promise<void> {
    try {
      const data = await fs.readFile(this.detailsFilePath, 'utf-8');
      this.details = JSON.parse(data);
    } catch (error) {
      // If file doesn't exist, keep default details
    }
  }

  async takeScreenshot(tabId: string, path: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error('Tab not found');
    }
    await page.screenshot({ path, fullPage: true });
  }

  async setViewport(tabId: string, width: number, height: number): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error('Tab not found');
    }
    await page.setViewportSize({ width, height });
  }
}