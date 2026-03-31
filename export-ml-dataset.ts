import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function exportDataset(symbol: string, startEpoch?: number, endEpoch?: number) {
  console.log(`\n📥 Exportando ${symbol}...`);

  const where: any = { symbol, timeframe: '60' };
  if (startEpoch) where.epoch = { gte: startEpoch };
  if (endEpoch)   where.epoch = { ...where.epoch, lte: endEpoch };

  const total = await prisma.candle.count({ where });
  console.log(`   📊 Total registros: ${total.toLocaleString()}`);

  const filename = `ml_data/${symbol.toLowerCase()}_features.csv`;
  fs.mkdirSync('ml_data', { recursive: true });

  // Stream para escritura directa — sin acumular en memoria
  const stream = fs.createWriteStream(filename);

  // Header
  stream.write([
    'epoch',
    'open', 'high', 'low', 'close',
    'rsi', 'macd', 'macdSignal', 'macdHistogram',
    'bbUpper', 'bbMiddle', 'bbLower',
    'ema9', 'ema21', 'ema50',
    'stochK', 'stochD', 'atr',
    'close_lag1', 'close_lag2', 'close_lag3',
    'rsi_lag1', 'rsi_lag2',
    'volume_change',
    'price_change_1', 'price_change_3', 'price_change_5',
    'close_sma_5', 'close_sma_10', 'close_sma_20',
    'close_std_5', 'close_std_10',
    'high_low_ratio',
    'close_to_ema9_ratio', 'close_to_ema21_ratio',
    'rsi_momentum', 'macd_momentum',
    'bb_position', 'stoch_momentum',
    'target'
  ].join(',') + '\n');

  const CHUNK_SIZE = 50000;
  // Buffer de velas previas para calcular lags entre chunks
  let prevBuffer: any[] = [];
  let validRows  = 0;
  let totalLoaded = 0;

  // Contadores para distribución
  let upCount = 0, downCount = 0, neutralCount = 0;

  for (let skip = 0; skip < total; skip += CHUNK_SIZE) {
    const chunk = await prisma.candle.findMany({
      where,
      include: { indicators: true },
      orderBy: { epoch: 'asc' },
      skip,
      take: CHUNK_SIZE
    });

    totalLoaded += chunk.length;
    process.stdout.write(`\r   ⏳ Procesando: ${totalLoaded.toLocaleString()}/${total.toLocaleString()}`);

    // Combinar buffer previo con chunk actual para calcular lags en el borde
    const data = [...prevBuffer, ...chunk];

    // Procesar desde el índice 20 (para tener historia suficiente)
    // pero solo escribir velas del chunk actual (no del buffer)
    const startIdx = Math.max(20, prevBuffer.length);
    const endIdx   = data.length - 1; // -1 porque necesitamos 'next'

    for (let i = startIdx; i < endIdx; i++) {
      const current = data[i];
      const next    = data[i + 1];
      const ind     = current.indicators[0];

      if (!ind) continue;

      const lag1    = data[i - 1];
      const lag2    = data[i - 2];
      const lag3    = data[i - 3];
      const indLag1 = lag1?.indicators[0];
      const indLag2 = lag2?.indicators[0];

      if (!indLag1 || !indLag2) continue;
      if (!data[i - 5]) continue;

      const last5  = data.slice(i - 5,  i).map((d: any) => d.close);
      const last10 = data.slice(i - 10, i).map((d: any) => d.close);
      const last20 = data.slice(i - 20, i).map((d: any) => d.close);

      const sma5  = last5.reduce( (a: number, b: number) => a + b, 0) / 5;
      const sma10 = last10.reduce((a: number, b: number) => a + b, 0) / 10;
      const sma20 = last20.reduce((a: number, b: number) => a + b, 0) / 20;

      const std5  = Math.sqrt(last5.reduce( (s: number, v: number) => s + Math.pow(v - sma5,  2), 0) / 5);
      const std10 = Math.sqrt(last10.reduce((s: number, v: number) => s + Math.pow(v - sma10, 2), 0) / 10);

      const priceChange = ((next.close - current.close) / current.close) * 100;
      const atrPercent  = ind.atr ? (ind.atr / current.close) * 100 : 0.02;
      const threshold   = Math.max(atrPercent * 0.5, 0.015);

      let target: number;
      if      (priceChange >  threshold) { target =  1; upCount++;      }
      else if (priceChange < -threshold) { target = -1; downCount++;    }
      else                               { target =  0; neutralCount++; }

      const volumeChange      = ((current.high - current.low) / current.close) * 100;
      const priceChange1      = ((current.close - lag1.close) / lag1.close) * 100;
      const priceChange3      = ((current.close - lag3.close) / lag3.close) * 100;
      const priceChange5      = ((current.close - data[i - 5].close) / data[i - 5].close) * 100;
      const highLowRatio      = current.high / current.low;
      const closeToEma9Ratio  = ind.ema9  ? current.close / ind.ema9  : 1;
      const closeToEma21Ratio = ind.ema21 ? current.close / ind.ema21 : 1;
      const rsiMomentum       = ind.rsi  && indLag1.rsi  ? ind.rsi  - indLag1.rsi  : 0;
      const macdMomentum      = ind.macd && indLag1.macd ? ind.macd - indLag1.macd : 0;
      const bbPosition        = ind.bbUpper && ind.bbLower
        ? (current.close - ind.bbLower) / (ind.bbUpper - ind.bbLower)
        : 0.5;
      const stochMomentum     = ind.stochK && indLag1.stochK ? ind.stochK - indLag1.stochK : 0;

      const row = [
        current.epoch,
        current.open, current.high, current.low, current.close,
        ind.rsi, ind.macd, ind.macdSignal, ind.macdHistogram,
        ind.bbUpper, ind.bbMiddle, ind.bbLower,
        ind.ema9, ind.ema21, ind.ema50,
        ind.stochK, ind.stochD, ind.atr,
        lag1.close, lag2.close, lag3.close,
        indLag1.rsi, indLag2.rsi,
        volumeChange,
        priceChange1, priceChange3, priceChange5,
        sma5, sma10, sma20,
        std5, std10,
        highLowRatio,
        closeToEma9Ratio, closeToEma21Ratio,
        rsiMomentum, macdMomentum,
        bbPosition, stochMomentum,
        target
      ].join(',');

      stream.write(row + '\n');
      validRows++;
    }

    // Guardar últimas 25 velas del chunk como buffer para el siguiente
    prevBuffer = data.slice(-25);
  }

  // Cerrar stream
  await new Promise<void>(resolve => stream.end(resolve));

  console.log(`\n   ✅ ${validRows.toLocaleString()} filas exportadas → ${filename}`);
  console.log(`   📊 Target distribution:`);
  console.log(`      UP:      ${upCount.toLocaleString()}      (${((upCount      / validRows) * 100).toFixed(1)}%)`);
  console.log(`      DOWN:    ${downCount.toLocaleString()}    (${((downCount    / validRows) * 100).toFixed(1)}%)`);
  console.log(`      NEUTRAL: ${neutralCount.toLocaleString()} (${((neutralCount / validRows) * 100).toFixed(1)}%)`);
}

async function main() {
  console.log('🚀 EXPORTANDO DATASET PARA ML\n');

  const symbols = ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxGBPJPY', 'frxAUDUSD'];
  const START   = Math.floor(new Date('2020-01-01').getTime() / 1000);
  const END     = Math.floor(new Date('2025-12-31').getTime() / 1000);

  for (const symbol of symbols) {
    await exportDataset(symbol, START, END);
  }

  console.log('\n🎉 DATASETS EXPORTADOS\n');
  await prisma.$disconnect();
}

main();