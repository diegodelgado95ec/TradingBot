import prisma from '../src/database/prisma.client';
import { writeFileSync } from 'fs';

interface FeatureRow {
  // Timestamp
  epoch: number;
  timestamp: string;
  hour: number;
  minute: number;
  day_of_week: number;
  
  // Price data
  open: number;
  high: number;
  low: number;
  close: number;
  
  // Technical indicators
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbPercentB: number;
  bbWidth: number;
  ema9: number;
  ema21: number;
  ema50: number;
  stochK: number;
  stochD: number;
  atr: number;
  
  // Derived features
  price_change: number;
  price_change_pct: number;
  high_low_spread: number;
  close_open_ratio: number;
  
  // Target (label)
  target: 'UP' | 'DOWN' | 'NEUTRAL';
  future_return: number;
}

async function exportFeaturesAdvanced() {
  console.log('🔍 Exportando features avanzadas para ML...\n');

  const candles = await prisma.candle.findMany({
    where: {
      symbol: 'R_10',
      timeframe: '1m',
      indicators: { some: {} }
    },
    include: { indicators: true },
    orderBy: { epoch: 'asc' }
  });

  console.log(`📊 Total velas: ${candles.length}`);

  const features: FeatureRow[] = [];
  
  for (let i = 0; i < candles.length - 5; i++) { // -5 para calcular future return
    const candle = candles[i];
    const ind = candle.indicators[0];
    
    if (!ind || !ind.rsi || !ind.macd) continue;

    const date = new Date(Number(candle.epoch) * 1000);
    
    // Calcular retorno futuro (5 velas adelante)
    const futureCandle = candles[i + 5];
    const futureReturn = ((futureCandle.close - candle.close) / candle.close) * 100;
    
    // Clasificar target
    let target: 'UP' | 'DOWN' | 'NEUTRAL';
    if (futureReturn > 0.15) target = 'UP';
    else if (futureReturn < -0.15) target = 'DOWN';
    else target = 'NEUTRAL';

    features.push({
      // Timestamp
      epoch: Number(candle.epoch),
      timestamp: date.toISOString(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      day_of_week: date.getDay(),
      
      // Price data
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      
      // Technical indicators
      rsi: ind.rsi,
      macd: ind.macd,
      macdSignal: ind.macdSignal,
      macdHistogram: ind.macdHistogram,
      bbUpper: ind.bbUpper!,
      bbMiddle: ind.bbMiddle!,
      bbLower: ind.bbLower!,
      bbPercentB: ind.bbPercentB!,
      bbWidth: ind.bbWidth!,
      ema9: ind.ema9!,
      ema21: ind.ema21!,
      ema50: ind.ema50!,
      stochK: ind.stochK,
      stochD: ind.stochD,
      atr: ind.atr!,
      
      // Derived features
      price_change: candle.close - candle.open,
      price_change_pct: ((candle.close - candle.open) / candle.open) * 100,
      high_low_spread: candle.high - candle.low,
      close_open_ratio: candle.close / candle.open,
      
      // Target
      target,
      future_return: futureReturn
    });
  }

  console.log(`✅ Features generadas: ${features.length}`);
  console.log(`📊 Distribución de targets:`);
  
  const upCount = features.filter(f => f.target === 'UP').length;
  const downCount = features.filter(f => f.target === 'DOWN').length;
  const neutralCount = features.filter(f => f.target === 'NEUTRAL').length;
  
  console.log(`   UP:      ${upCount} (${(upCount/features.length*100).toFixed(1)}%)`);
  console.log(`   DOWN:    ${downCount} (${(downCount/features.length*100).toFixed(1)}%)`);
  console.log(`   NEUTRAL: ${neutralCount} (${(neutralCount/features.length*100).toFixed(1)}%)`);

  // Convertir a CSV
  const headers = Object.keys(features[0]).join(',');
  const rows = features.map(f => Object.values(f).join(','));
  const csv = [headers, ...rows].join('\n');

  writeFileSync('ml/features_advanced.csv', csv);
  console.log('\n💾 Guardado en: ml/features_advanced.csv');
}

exportFeaturesAdvanced()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
