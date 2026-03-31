import { spawn } from 'child_process';
import path from 'path';

export interface PredictionInput {
  open: number;
  high: number;
  low: number;
  close: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  ema9: number;
  ema21: number;
  ema50: number;
  stochK: number;
  stochD: number;
  atr: number;
  close_lag1: number;
  close_lag2: number;
  close_lag3: number;
  rsi_lag1: number;
  rsi_lag2: number;
  volume_change: number;
  price_change_1: number;
  price_change_3: number;
  price_change_5: number;
  close_sma_5: number;
  close_sma_10: number;
  close_sma_20: number;
  close_std_5: number;
  close_std_10: number;
  high_low_ratio: number;
  close_to_ema9_ratio: number;
  close_to_ema21_ratio: number;
  rsi_momentum: number;
  macd_momentum: number;
  bb_position: number;
  stoch_momentum: number;
}

export interface PredictionResult {
  prediction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number;
  probabilities: {
    down: number;
    neutral: number;
    up: number;
  };
}

export class PredictionService {
  async predict(features: PredictionInput): Promise<PredictionResult> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(process.cwd(), 'predict.py');
      const featuresJson = JSON.stringify(features);

      const python = spawn('python', [pythonScript, featuresJson]);

      let result = '';
      let error = '';

      python.stdout.on('data', (data) => {
        result += data.toString();
      });

      python.stderr.on('data', (data) => {
        error += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python error: ${error}`));
          return;
        }

        try {
          const parsed = JSON.parse(result);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Parse error: ${result}`));
        }
      });
    });
  }
}
