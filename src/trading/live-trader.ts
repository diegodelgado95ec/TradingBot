import DerivAPI from '@deriv/deriv-api';
import prisma from '../database/prisma.client';
import { IndicatorsService } from '../services/indicators.service';
import { SignalGenerator } from './signal-generator';

interface TickData {
  epoch: number;
  quote: number;
}

class LiveTrader {
  private api: DerivAPI;
  private signalGenerator: SignalGenerator;
  private indicatorsService: IndicatorsService;
  private lastSignalTime: number = 0;
  private signalCooldown: number = 60000; // 1 minuto entre señales

  constructor(connection: WebSocket) {
    this.api = new DerivAPI({ connection });
    this.signalGenerator = new SignalGenerator();
    this.indicatorsService = new IndicatorsService();
  }

  /**
   * Inicia el trading en vivo
   */
  async start(symbol: string) {
    console.log(`\n🚀 Iniciando trading en vivo: ${symbol}`);
    console.log('⏰ Monitoreando mercado cada minuto...\n');

    // Suscribirse a ticks
    let tickCount = 0;
    let lastMinuteEpoch = 0;

    setInterval(async () => {
      try {
        // Obtener última vela con indicadores
        const latestCandle = await prisma.candle.findFirst({
          where: { symbol, timeframe: '1m' },
          include: { indicators: true },
          orderBy: { epoch: 'desc' },
        });

        if (!latestCandle || !latestCandle.indicators) {
          console.log('⏳ Esperando datos suficientes...');
          return;
        }

        const currentTime = Date.now();
        if (currentTime - this.lastSignalTime < this.signalCooldown) {
          return; // Cooldown activo
        }

        // Generar señal
        const signal = this.signalGenerator.generateSignal(
          latestCandle.close,
          latestCandle.indicators
        );

        // Mostrar señal si no es HOLD o tiene alta confianza
        if (signal.action !== 'HOLD' || signal.confidence > 60) {
          const output = this.signalGenerator.formatSignal(signal, latestCandle.close);
          console.log(output);
          
          if (signal.action !== 'HOLD') {
            this.lastSignalTime = currentTime;
            
            // Aquí ejecutarías la operación real
            await this.executeTrade(symbol, signal, latestCandle.close);
          }
        } else {
          const date = new Date();
          console.log(`[${date.toLocaleTimeString()}] 💤 Sin señales - Esperando...`);
        }

      } catch (error: any) {
        console.error('❌ Error en análisis:', error.message);
      }
    }, 15000); // Cada 15 segundos
  }

  /**
   * Ejecuta una operación (DEMO por ahora)
   */
  async executeTrade(symbol: string, signal: any, price: number) {
    console.log('\n📝 Guardando operación en base de datos...');

    const trade = await prisma.trade.create({
      data: {
        symbol,
        direction: signal.action === 'BUY' ? 'LONG' : 'SHORT',
        entryEpoch: BigInt(Math.floor(Date.now() / 1000)),
        entryPrice: price,
        quantity: 1,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        mlConfidence: signal.confidence,
      },
    });

    console.log(`✅ Trade ID: ${trade.id}`);
    console.log(`💰 Entry: ${price.toFixed(2)}`);
    console.log(`🛡️ Stop Loss: ${signal.stopLoss.toFixed(2)}`);
    console.log(`🎯 Take Profit: ${signal.takeProfit.toFixed(2)}\n`);

    // TODO: Integrar con Deriv API para ejecutar trade real
    // const proposal = await this.api.proposal({...});
  }
}

export default LiveTrader;
