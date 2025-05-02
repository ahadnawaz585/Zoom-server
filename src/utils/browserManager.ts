import { Browser, BrowserContext, Page, chromium, Frame } from 'playwright';
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

    // Start clicking the SVG path element
    this.clickSvgPath(page).catch(error => {
      console.error(`[${new Date().toISOString()}] Failed to click SVG path in tab ${tabId}:`, error);
    });

    return tabId;
  }

  async openTabForDuration(url: string, durationMs: number): Promise<string> {
    if (!this.browser || !this.context) {
      throw new Error('Browser not initialized');
    }

    const page = await this.context.newPage();
    const tabId = uuidv4();

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

    // Start clicking the SVG path element
    this.clickSvgPath(page).catch(error => {
      console.error(`[${new Date().toISOString()}] Failed to click SVG path in tab ${tabId}:`, error);
    });

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

  private async clickSvgPath(page: Page): Promise<void> {
    const xpath = `(//*[local-name()='svg' and @xmlns='http://www.w3.org/2000/svg']/*[local-name()='path'][1])[5]`;
    let attempts = 0;
    const maxAttempts = 30; // Limit retries to prevent infinite loops
    const retryInterval = 1000; // Wait 1 second between retries

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`[${new Date().toISOString()}] Attempt ${attempts} to click SVG path`);

        // Check the main page first
        try {
          await page.waitForSelector(`xpath=${xpath}`, { state: 'visible', timeout: 5000 });
          await page.locator(`xpath=${xpath}`).click({ timeout: 5000 });
          console.log(`[${new Date().toISOString()}] Successfully clicked SVG path in main page`);
          return;
        } catch (mainPageError) {
          console.log(`[${new Date().toISOString()}] SVG path not found in main page, checking iframes`);
        }

        // Get all iframes on the page
        const iframeElements = await page.locator('iframe').elementHandles();
        console.log(`[${new Date().toISOString()}] Found ${iframeElements.length} iframes`);

        // Iterate through each iframe
        for (let i = 0; i < iframeElements.length; i++) {
          const iframe = iframeElements[i];
          const frame = await iframe.contentFrame();
          if (!frame) {
            console.warn(`[${new Date().toISOString()}] Could not access content frame for iframe ${i}`);
            continue;
          }

          try {
            // Wait for the SVG path in the iframe
            await frame.waitForSelector(`xpath=${xpath}`, { state: 'visible', timeout: 5000 });
            await frame.locator(`xpath=${xpath}`).click({ timeout: 5000 });
            console.log(`[${new Date().toISOString()}] Successfully clicked SVG path in iframe ${i}`);
            return; // Exit if click is successful
          } catch (iframeError) {
            console.log(`[${new Date().toISOString()}] SVG path not found in iframe ${i}`);
          }
        }

        // If no SVG path was found in the main page or any iframe, retry
        console.warn(`[${new Date().toISOString()}] SVG path not found in attempt ${attempts}, retrying...`);
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to click SVG path after ${maxAttempts} attempts`);
        }
        await page.waitForTimeout(retryInterval); // Wait before retrying
      } catch (error:any) {
        console.warn(`[${new Date().toISOString()}] Attempt ${attempts} failed:`, error.message);
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to click SVG path after ${maxAttempts} attempts: ${error.message}`);
        }
        await page.waitForTimeout(retryInterval); // Wait before retrying
      }
    }
  }
}