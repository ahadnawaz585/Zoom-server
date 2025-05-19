import { Browser, BrowserContext, Page, chromium } from "playwright";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";

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
  private detailsFilePath: string = `./browser_details_${uuidv4()}.json`;

  constructor() {
    this.details = {
      browserId: uuidv4(),
      launchTime: new Date(),
      isOpen: false,
      tabCount: 0,
      tabs: [],
    };
  }

  async launchBrowser(): Promise<void> {
    if (this.browser && this.context && this.details.isOpen) {
      console.log(
        `[${new Date().toISOString()}] Reusing browser instance (ID: ${
          this.details.browserId
        })`
      );
      return;
    }

    const launchOptions: any = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--process-per-site",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--use-fake-ui-for-media-stream", // Keep this for fake audio input
        "--disable-sync",
        "--disable-translate",
        "--hide-scrollbars",
        "--metrics-recording-only",
        "--no-default-browser-check",
        "--disable-hang-monitor",
        "--disable-prompt-on-repost",
        "--disable-client-side-phishing-detection",
        "--disable-component-update",
        "--disable-breakpad",
        "--disable-ipc-flooding-protection",
        "--disable-renderer-backgrounding",
        "--force-color-profile=srgb",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-timer-throttling",
        "--force-device-scale-factor=0.25",
        "--js-flags=--max-old-space-size=200",
        "--memory-pressure-off",
        "--disable-webgl",
        "--disable-webrtc",
        "--disable-canvas-aa",
        "--disable-2d-canvas-clip-aa",
        "--disable-accelerated-2d-canvas",
        "--num-raster-threads=1",
        "--renderer-process-limit=20",
        "--disable-site-isolation-trials",
        "--disable-features=IsolateOrigins,SitePerProcess",
      ],
    };

    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext({
      viewport: { width: 640, height: 480 }, // Minimal viewport
      reducedMotion: "reduce",
      javaScriptEnabled: true,
      bypassCSP: true,
    });
    this.details.isOpen = true;
    this.details.launchTime = new Date();
    this.details.browserId = uuidv4();
    await this.saveDetails();
  }

  async openTabForDuration(url: string, durationMs: number): Promise<string> {
    if (!this.browser || !this.context) {
      throw new Error("Browser not initialized");
    }

    const page = await this.context.newPage();
    const tabId = uuidv4();

    // No permissions granted to minimize resource usage
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });

    // Wait for the audio button and click it
    try {
      await page.waitForSelector('button[aria-label="Headphone Meeting6"]', {
        timeout: 5000,
      });
      await page.click('button[aria-label="Headphone Meeting6"]');
      console.log(
        `[${new Date().toISOString()}] Audio button clicked for tab ${tabId}`
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Failed to click audio button for tab ${tabId}:`,
        error
      );
    }

    const title = await page.title().catch(() => "Untitled"); // Fallback for title

    const tabInfo: TabInfo = {
      id: tabId,
      url,
      title,
      openedAt: new Date(),
      isActive: true,
    };

    this.pages.set(tabId, page);
    this.details.tabs.push(tabInfo);
    this.details.tabCount = this.pages.size;

    await this.saveDetails();

    // Schedule tab closure with promise
    setTimeout(() => {
      this.closeTab(tabId).catch((error) => {
        console.error(
          `[${new Date().toISOString()}] Failed to auto-close tab ${tabId}:`,
          error
        );
      });
    }, durationMs);

    return tabId;
  }

  async closeTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error("Tab not found");
    }

    await page.close();
    this.pages.delete(tabId);
    this.details.tabs = this.details.tabs.filter((tab) => tab.id !== tabId);
    this.details.tabCount = this.pages.size;

    await this.saveDetails();
  }

  async closeBrowser(): Promise<void> {
    if (!this.browser) return;

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

  getTabCount(): number {
    return this.pages.size;
  }

  private async saveDetails(): Promise<void> {
    await fs.writeFile(
      this.detailsFilePath,
      JSON.stringify(this.details, null, 2)
    );
  }
}
