export interface TimeRange {
  startEpoch: number;
  endEpoch: number;
}

export interface DataGap {
  symbol: string;
  timeframe: string;
  gaps: TimeRange[];
  totalMissing: number;
  existingCount: number;
}

export interface DerivCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DownloadConfig {
  symbol: string;
  timeframe: string;
  totalDays: number;
  batchSize: number;
}

export interface DownloadStats {
  symbol: string;
  timeframe: string;
  downloaded: number;
  total: number;
  startTime: number;
  currentRate: number; // velas/segundo
}
