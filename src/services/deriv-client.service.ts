import WebSocket from 'ws';
import { DerivCandle, TimeRange } from '../types/downloader.types';

/**
 * 🌐 Cliente WebSocket reutilizable para Deriv API
 * Rate Limits: ~5000 velas/request, sin límite explícito de requests/segundo
 */
export class DerivClientService {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private readonly WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 3;

  /**
   * Conecta al WebSocket de Deriv con retry automático
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.WS_URL);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        console.log('✅ Deriv WebSocket conectado');
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 WebSocket cerrado');
        this.handleDisconnect();
      });
    });
  }

  /**
   * Auto-reconnect en caso de desconexión
   */
  private async handleDisconnect(): Promise<void> {
    if (this.reconnectAttempts < this.MAX_RECONNECT) {
      this.reconnectAttempts++;
      console.log(`🔄 Reintentando conexión (${this.reconnectAttempts}/${this.MAX_RECONNECT})...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.connect();
    }
  }

  /**
   * Descarga velas históricas para un rango específico
   */
  async fetchCandlesInRange(
    symbol: string,
    granularity: number,
    range: TimeRange,
    count: number = 5000
  ): Promise<DerivCandle[]> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket no conectado. Llama a connect() primero.');
    }

    return new Promise((resolve, reject) => {
      const reqId = ++this.requestId;

      const request = {
        ticks_history: symbol,
        style: 'candles',
        granularity,
        start: range.startEpoch,
        end: range.endEpoch,
        count: Math.min(count, 5000),
        req_id: reqId
      };

      const timeout = setTimeout(() => {
        this.ws?.off('message', messageHandler);
        reject(new Error(`Timeout: No response for req_id ${reqId} after 30s`));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());

          if (response.req_id !== reqId) return;

          clearTimeout(timeout);
          this.ws?.off('message', messageHandler);

          if (response.error) {
            reject(new Error(`Deriv API Error: ${response.error.message} (${response.error.code})`));
            return;
          }

          const candles: DerivCandle[] = [];
          const history = response.candles || [];

          for (const candle of history) {
            candles.push({
              epoch: candle.epoch,
              open: parseFloat(candle.open),
              high: parseFloat(candle.high),
              low: parseFloat(candle.low),
              close: parseFloat(candle.close),
            });
          }

          resolve(candles);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      this.ws?.on('message', messageHandler);
      this.ws.send(JSON.stringify(request));
    });
  }

  /**
   * Descarga todas las velas para un gap específico
   * 🔥 VERSIÓN FINAL: Sin debug logs, producción ready
   */
  async fetchGap(
    symbol: string,
    granularity: number,
    gap: TimeRange
  ): Promise<DerivCandle[]> {
    const allCandles: DerivCandle[] = [];
    const MAX_PER_REQUEST = 5000;

    const expectedCandles = Math.floor((gap.endEpoch - gap.startEpoch) / granularity) + 1;
    console.log(`      🎯 Objetivo: ~${expectedCandles.toLocaleString()} velas | Rango: ${this.formatDate(gap.startEpoch)} → ${this.formatDate(gap.endEpoch)}`);

    let currentStart = gap.startEpoch;
    let requestCount = 0;
    let consecutiveEmpty = 0;
    const MAX_EMPTY = 5;
    const MAX_REQUESTS = Math.ceil(expectedCandles / MAX_PER_REQUEST) + 10;

    while (allCandles.length < expectedCandles && requestCount < MAX_REQUESTS) {
      requestCount++;

      if (currentStart >= gap.endEpoch) {
        break;
      }

      try {
        const candles = await this.fetchCandlesInRange(
          symbol,
          granularity,
          { startEpoch: currentStart, endEpoch: gap.endEpoch },
          MAX_PER_REQUEST
        );

        if (candles.length === 0) {
          consecutiveEmpty++;
          
          if (consecutiveEmpty >= MAX_EMPTY) {
            break;
          }
          
          currentStart = Math.min(currentStart + (24 * 60 * 60), gap.endEpoch);
          await this.sleep(500);
          continue;
        }

        consecutiveEmpty = 0;

        const filteredCandles = candles.filter(c => 
          c.epoch >= gap.startEpoch && c.epoch <= gap.endEpoch
        );

        const existingEpochs = new Set(allCandles.map(c => c.epoch));
        const newCandles = filteredCandles.filter(c => !existingEpochs.has(c.epoch));

        allCandles.push(...newCandles);

        const progress = ((allCandles.length / expectedCandles) * 100).toFixed(1);
        
        // Log cada 10 requests o cuando hay nuevas velas
        if (requestCount % 10 === 0 || newCandles.length > 0) {
          console.log(`      📦 Request ${requestCount}: +${newCandles.length} velas | Total: ${allCandles.length.toLocaleString()} (${progress}%)`);
        }

        if (allCandles.length >= expectedCandles * 0.98) {
          break;
        }

        if (candles.length > 0) {
          const lastEpoch = candles[candles.length - 1].epoch;
          const nextStart = lastEpoch + granularity;
          
          if (nextStart >= gap.endEpoch) {
            break;
          }
          
          currentStart = nextStart;
        } else {
          currentStart = Math.min(currentStart + (24 * 60 * 60), gap.endEpoch);
        }

        await this.sleep(250);

        if (requestCount % 20 === 0) {
          console.log(`      ⏸️  Pause (${requestCount} requests)...`);
          await this.sleep(2000);
        }

      } catch (error: any) {
        if (error.message.includes('InvalidStartEnd') || error.message.includes('Start time')) {
          break;
        }
        
        consecutiveEmpty++;
        const backoff = Math.min(1000 * Math.pow(1.5, consecutiveEmpty), 10000);
        await this.sleep(backoff);
        
        if (consecutiveEmpty >= MAX_EMPTY) {
          break;
        }
      }
    }

    const downloadedPercent = expectedCandles > 0 
      ? ((allCandles.length / expectedCandles) * 100).toFixed(1)
      : '100.0';
    
    console.log(`      ✅ Gap finalizado: ${allCandles.length.toLocaleString()}/${expectedCandles.toLocaleString()} velas (${downloadedPercent}%) en ${requestCount} requests`);
    
    return allCandles;
  }

  /**
   * Helper: Formatear epoch a fecha legible
   */
  private formatDate(epoch: number): string {
    return new Date(epoch * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }

  /**
   * Verifica si el WebSocket está conectado
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Cierra la conexión WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      console.log('🔌 Desconectado de Deriv WebSocket');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
