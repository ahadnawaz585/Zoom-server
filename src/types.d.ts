export interface Bot {
  id: number;
  name: string;
  status: string;
  country?: string;
  countryCode?: string;
  flag?: string;
}

export interface JoinRequest {
  bots: Bot[];
  meetingId: string;
  password: string;
  botCount?: number;
  duration?: number;
}

export interface Task {
  botPair: Bot[];
  meetingId: string;
  keepOpenOnTimeout?:any;
  selectorTimeout?:any;
  skipJoinIndicator?:any;
  optimizedJoin?:any;
  disableVideo?:any;
  disableAudio?:any;
  lowResolution?:any;
  lowMemoryMode?:any;
  duration?:any;
  password: string;
  origin: string;
  signature: string;
  browserType: 'chromium' | 'firefox' | 'webkit';
}

export interface WorkerResult {
  success: boolean;
  botId: number;
  error?: string;
  keepOpenOnTimeout?:any;
  browser: 'chromium' | 'firefox' | 'webkit';
}


export interface TabInfo {
  id: string;
  url: string;
  title?: string;
  openedAt: Date;
  isActive: boolean;
}

export interface BrowserDetails {
  browserId: string;
  launchTime: Date;
  isOpen: boolean;
  tabCount: number;
  tabs: TabInfo[];
}

export interface SystemMetrics {
  totalWorkers: number;
  totalActiveBots: number;
  lastChecked: number;
  memoryUsage: number;
  cpuLoad: number;
}

export interface ActiveWorkerInfo {
  worker: Worker;
  terminationTimeout: NodeJS.Timeout;
  startTime: number;
  duration: number; // in minutes
  botCount: number;
}
