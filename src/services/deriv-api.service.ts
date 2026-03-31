import DerivAPI from '@deriv-com/api-client';
import { logger } from '../utils/logger';

export class DerivAPIService {
  private api: DerivAPI;
  private connection: any;

  constructor() {
    this.api = new DerivAPI({ 
      app_id: parseInt(process.env.DERIV_APP_ID!) 
    });
  }

  async connect() {
    try {
      this.connection = await this.api.basic.ping();
      logger.info('✅ Connected to Deriv API');
      return this.connection;
    } catch (error) {
      logger.error('❌ Failed to connect to Deriv API:', error);
      throw error;
    }
  }

  async getTickHistory(symbol: string, count: number = 1000) {
    try {
      const response = await this.api.basic.ticksHistory({
        ticks_history: symbol,
        count: count,
        end: 'latest',
        style: 'ticks'
      });
      
      logger.info(`📊 Fetched ${response.history.times.length} ticks for ${symbol}`);
      return response;
    } catch (error) {
      logger.error(`Failed to fetch tick history for ${symbol}:`, error);
      throw error;
    }
  }

  async subscribeTicks(symbol: string, callback: (tick: any) => void) {
    try {
      const subscription = await this.api.subscribe({
        ticks: symbol
      });

      subscription.subscribe((response: any) => {
        if (response.tick) {
          callback(response.tick);
        }
      });

      logger.info(`🔔 Subscribed to ${symbol} ticks`);
      return subscription;
    } catch (error) {
      logger.error(`Failed to subscribe to ${symbol}:`, error);
      throw error;
    }
  }
}
