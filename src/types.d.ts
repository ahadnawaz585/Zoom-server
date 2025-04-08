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
  password: string;
  origin: string;
  signature: string;
  browserType: 'chromium' | 'firefox' | 'webkit';
}

export interface WorkerResult {
  success: boolean;
  botId: number;
  error?: string;
  browser: 'chromium' | 'firefox' | 'webkit';
}
