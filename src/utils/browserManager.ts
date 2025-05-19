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
      headless: true, // Run in headless mode
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
        "--use-fake-ui-for-media-stream",
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
      viewport: { width: 1024, height: 768 },
      reducedMotion: "reduce",
      javaScriptEnabled: true,
      bypassCSP: true,
      permissions: ['microphone', 'camera'],
    });
    
    this.context.setDefaultTimeout(30000);
    
    this.details.isOpen = true;
    this.details.launchTime = new Date();
    this.details.browserId = uuidv4();
    await this.saveDetails();
  }

  async clickAudioButton(
    page: Page,
    tabId: string,
    retries = 3
  ): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[${new Date().toISOString()}] Attempt ${attempt} for tab ${tabId}: Looking for audio button`);
        
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
          console.log(`[${new Date().toISOString()}] Network didn't become idle, continuing anyway`);
        });
        
        const selectors = [
          'button[title="Audio"]',
          'button[aria-label="Headphone Meeting6"]',
          'button[aria-label="join audio"]',
          'button[aria-label="Join Audio"]',
          '.join-audio-container button',
          '[data-test-id="join-audio-button"]',
          'button:has-text("Join Audio")',
          'button.join-audio-btn'
        ];
        
        let audioButton = null;
        
        for (const selector of selectors) {
          console.log(`[${new Date().toISOString()}] Trying selector: ${selector}`);
          audioButton = await page.$(selector).catch(() => null);
          if (audioButton) {
            console.log(`[${new Date().toISOString()}] Found button with selector: ${selector}`);
            break;
          }
        }
        
        if (!audioButton) {
          console.log(`[${new Date().toISOString()}] No button found with predefined selectors, checking all buttons`);
          const allButtons = await page.$$eval('button', buttons => {
            return buttons.map(button => ({
              id: button.id,
              title: button.getAttribute('title'),
              ariaLabel: button.getAttribute('aria-label'),
              text: button.textContent?.trim(),
              classes: button.className,
              isVisible: button.offsetWidth > 0 && button.offsetHeight > 0,
              position: {
                x: button.getBoundingClientRect().x,
                y: button.getBoundingClientRect().y
              }
            }));
          });
          
          console.log(`[${new Date().toISOString()}] Found ${allButtons.length} buttons:`, JSON.stringify(allButtons));
          
          const audioKeywords = ['audio', 'sound', 'headphone', 'speaker', 'join audio', 'microphone'];
          const likelyButtons = allButtons.filter(btn => {
            const allText = [btn.title, btn.ariaLabel, btn.text, btn.classes, btn.id].join(' ').toLowerCase();
            return btn.isVisible && audioKeywords.some(keyword => allText.includes(keyword.toLowerCase()));
          });
          
          if (likelyButtons.length > 0) {
            console.log(`[${new Date().toISOString()}] Found likely audio buttons:`, JSON.stringify(likelyButtons));
            
            const targetButton = likelyButtons[0];
            const selector = targetButton.id ?
              `#${targetButton.id}` :
              `button[title="${targetButton.title}"], button[aria-label="${targetButton.ariaLabel}"]`;
            
            console.log(`[${new Date().toISOString()}] Attempting to click button with selector: ${selector}`);
            audioButton = await page.$(selector);
          }
        }
        
        if (!audioButton) {
          throw new Error("Audio button not found");
        }
        
        const isAlreadyActive = await audioButton.evaluate(button => {
          return button.classList.contains('active') ||
                 button.getAttribute('aria-pressed') === 'true' ||
                 button.getAttribute('data-active') === 'true';
        }).catch(() => false);
        
        if (isAlreadyActive) {
          console.log(`[${new Date().toISOString()}] Audio already active for tab ${tabId}`);
          return;
        }
        
        console.log(`[${new Date().toISOString()}] Clicking audio button for tab ${tabId}`);
        await audioButton.click({ force: true });
        
        await page.waitForTimeout(2000);
        
        const secondaryButtons = [
          'button:has-text("Join with Computer Audio")',
          'button[aria-label="Join with Computer Audio"]',
          'button.join-audio',
          'button.join-btn',
          'button.join-computer-audio'
        ];
        
        for (const selector of secondaryButtons) {
          const joinButton = await page.$(selector).catch(() => null);
          if (joinButton) {
            console.log(`[${new Date().toISOString()}] Found secondary join audio button: ${selector}`);
            await joinButton.click().catch(e => {
              console.log(`[${new Date().toISOString()}] Failed to click secondary button: ${e.message}`);
            });
            break;
          }
        }
        
        console.log(`[${new Date().toISOString()}] Audio button clicked for tab ${tabId}`);
        return;
        
      } catch (error) {
        console.warn(
          `[${new Date().toISOString()}] Attempt ${attempt} failed for tab ${tabId}:`,
          error
        );
        
        if (attempt === retries) {
          throw new Error(
            `Failed to click audio button for tab ${tabId} after ${retries} attempts`
          );
        }
        await page.waitForTimeout(2000);
      }
    }
  }
  
  async openTabForDuration(url: string, durationMs: number): Promise<string> {
    if (!this.browser || !this.context) {
      throw new Error("Browser not initialized");
    }

    const page = await this.context.newPage();
    const tabId = uuidv4();

    console.log(`[${new Date().toISOString()}] Navigating to URL: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    try {
      await page.waitForTimeout(15000);
      await this.handleInitialDialogs(page, tabId);
      await this.clickAudioButton(page, tabId, 5);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during Zoom setup:`, error);
    }

    const title = await page.title().catch(() => "Untitled");

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

    console.log(`[${new Date().toISOString()}] Tab ${tabId} opened successfully, will close after ${durationMs}ms`);
    
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
  
  private async handleInitialDialogs(page: Page, tabId: string): Promise<void> {
    const dialogSelectors = [
      'button:has-text("Join")',
      'button:has-text("Join Meeting")',
      'button:has-text("Join Without Audio")',
      'button:has-text("Join Without Video")',
      'button:has-text("Allow")',
      'button:has-text("Accept")',
      'button:has-text("Continue")',
      'button:has-text("Close")',
      'button:has-text("Cancel")',
      'button.close-btn',
      'button[aria-label="Close"]'
    ];
    
    for (const selector of dialogSelectors) {
      const button = await page.$(selector).catch(() => null);
      if (button) {
        console.log(`[${new Date().toISOString()}] Found dialog button "${selector}" for tab ${tabId}, clicking it`);
        await button.click().catch(e => {
          console.log(`[${new Date().toISOString()}] Failed to click dialog button: ${e.message}`);
        });
        await page.waitForTimeout(1000);
      }
    }
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