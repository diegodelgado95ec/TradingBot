// src/index.ts
import dotenv from 'dotenv';
import DerivAPI from '@deriv/deriv-api';
import prisma from './database/prisma.client';
import { LiveTrader } from './trading/live-trader';

dotenv.config();

const APP_ID    = parseInt(process.env.DERIV_APP_ID    || '0');
const API_TOKEN = process.env.DERIV_API_TOKEN || '';
const SYMBOL    = 'frxGBPJPY';

async function main() {
  console.log('🚀 Trading Bot ML — GBPJPY\n');

  // 1. Iniciar servidor Python
  const trader = new LiveTrader();
  await trader.startPythonServer();

  // 2. Conectar a Deriv
  const connection = new WebSocket(
    `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`
  );
  const api = new DerivAPI({ connection });

  connection.onopen = () => {
    console.log('🔌 Conectado a Deriv');
    connection.send(JSON.stringify({ authorize: API_TOKEN }));
  };

  let lastEpoch = 0;

  connection.onmessage = async (msg) => {
    const data = JSON.parse(msg.data.toString());

    // Autorización exitosa → suscribir a velas de 1M
    if (data.authorize) {
      console.log(`✅ Autorizado: ${data.authorize.email}`);
      console.log(`💰 Balance: ${data.authorize.balance} ${data.authorize.currency}\n`);

      // Suscripción a velas en tiempo real (1 minuto)
      connection.send(JSON.stringify({
        ticks_history: SYMBOL,
        style:         'candles',
        granularity:   60,
        count:         100,       // warm-up para indicadores
        end:           'latest',
        subscribe:     1,
      }));
    }

    // Velas históricas de warm-up
    if (data.candles && !data.subscription) {
      console.log(`📊 Warm-up: ${data.candles.length} velas cargadas`);
      // Guardar en DB para calcular indicadores
    for (const c of data.candles) {
  await prisma.candle.upsert({
    where: {
      symbol_timeframe_epoch: {        // ✅ nombre correcto
        symbol:    SYMBOL,
        epoch:     Number(c.epoch),    // ✅ Int no BigInt
        timeframe: '60'
      }
    },
    create: {
      symbol:    SYMBOL,
      epoch:     Number(c.epoch),
      open:      Number(c.open),
      high:      Number(c.high),
      low:       Number(c.low),
      close:     Number(c.close),
      timeframe: '60'
    },
    update: {
      open:  Number(c.open),
      high:  Number(c.high),
      low:   Number(c.low),
      close: Number(c.close)
    }
  });
}
      console.log('✅ Warm-up completo — monitoreando mercado...\n');
    }

    // Nueva vela en tiempo real
    if (data.ohlc) {
      const candle = {
        epoch: parseInt(data.ohlc.open_time),
        open:  parseFloat(data.ohlc.open),
        high:  parseFloat(data.ohlc.high),
        low:   parseFloat(data.ohlc.low),
        close: parseFloat(data.ohlc.close),
      };

      // Solo procesar velas cerradas (epoch cambia cada minuto)
      if (candle.epoch !== lastEpoch) {
        lastEpoch = candle.epoch;

      await prisma.candle.upsert({
  where: {
    symbol_timeframe_epoch: {          // ✅
      symbol:    SYMBOL,
      epoch:     Number(candle.epoch), // ✅
      timeframe: '60'
    }
  },
  create: {
    symbol:    SYMBOL,
    epoch:     Number(candle.epoch),
    open:      candle.open,
    high:      candle.high,
    low:       candle.low,
    close:     candle.close,
    timeframe: '60'
  },
  update: {
    open:  candle.open,
    high:  candle.high,
    low:   candle.low,
    close: candle.close
  }
});

        await trader.onNewCandle(candle, api);
      }
    }

    if (data.error) {
      console.error('❌ Error Deriv:', data.error.message);
    }
  };

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Deteniendo bot...');
    trader.stop();
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch(console.error);