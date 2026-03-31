import { PrismaClient } from '@prisma/client';
import { RSI, MACD, BollingerBands, EMA, Stochastic, ATR } from 'technicalindicators';

const prisma = new PrismaClient();

const SYMBOL_MAP = ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxGBPJPY', 'frxAUDUSD'];

async function calculateIndicatorsForSymbol(symbol: string) {
  console.log(`\n🔵 ${symbol}`);

  // Obtener todas las velas ordenadas
  const candles = await prisma.candle.findMany({
    where: { symbol, timeframe: '60' },
    orderBy: { epoch: 'asc' }
  });

  console.log(`   📊 ${candles.length.toLocaleString()} velas cargadas`);

  if (candles.length < 200) {
    console.log(`   ⚠️  Insuficientes datos (mínimo 200)`);
    return;
  }

  // Preparar arrays de precios
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  console.log(`   🔢 Calculando indicadores...`);

  // Calcular indicadores
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const bbValues = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2
  });
  const ema9Values = EMA.calculate({ values: closes, period: 9 });
  const ema21Values = EMA.calculate({ values: closes, period: 21 });
  const ema50Values = EMA.calculate({ values: closes, period: 50 });
  const stochValues = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3
  });
  const atrValues = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14
  });

  console.log(`   💾 Guardando en base de datos...`);

  const BATCH_SIZE = 5000;
  let saved = 0;

  // El offset para alinear los indicadores (empiezan después de los períodos de calentamiento)
  const maxOffset = Math.max(
    closes.length - rsiValues.length,
    closes.length - macdValues.length,
    closes.length - bbValues.length,
    closes.length - ema9Values.length,
    closes.length - ema21Values.length,
    closes.length - ema50Values.length,
    closes.length - stochValues.length,
    closes.length - atrValues.length
  );

  for (let i = maxOffset; i < candles.length; i += BATCH_SIZE) {
    const batch = [];

    for (let j = i; j < Math.min(i + BATCH_SIZE, candles.length); j++) {
      const candle = candles[j];
      
      const rsiIdx = j - (closes.length - rsiValues.length);
      const macdIdx = j - (closes.length - macdValues.length);
      const bbIdx = j - (closes.length - bbValues.length);
      const ema9Idx = j - (closes.length - ema9Values.length);
      const ema21Idx = j - (closes.length - ema21Values.length);
      const ema50Idx = j - (closes.length - ema50Values.length);
      const stochIdx = j - (closes.length - stochValues.length);
      const atrIdx = j - (closes.length - atrValues.length);

      batch.push(
        prisma.indicator.upsert({
          where: { candleId: candle.id },
          create: {
            candleId: candle.id,
            rsi: rsiIdx >= 0 ? rsiValues[rsiIdx] : null,
            macd: macdIdx >= 0 ? macdValues[macdIdx]?.MACD : null,
            macdSignal: macdIdx >= 0 ? macdValues[macdIdx]?.signal : null,
            macdHistogram: macdIdx >= 0 ? macdValues[macdIdx]?.histogram : null,
            bbUpper: bbIdx >= 0 ? bbValues[bbIdx]?.upper : null,
            bbMiddle: bbIdx >= 0 ? bbValues[bbIdx]?.middle : null,
            bbLower: bbIdx >= 0 ? bbValues[bbIdx]?.lower : null,
            ema9: ema9Idx >= 0 ? ema9Values[ema9Idx] : null,
            ema21: ema21Idx >= 0 ? ema21Values[ema21Idx] : null,
            ema50: ema50Idx >= 0 ? ema50Values[ema50Idx] : null,
            stochK: stochIdx >= 0 ? stochValues[stochIdx]?.k : null,
            stochD: stochIdx >= 0 ? stochValues[stochIdx]?.d : null,
            atr: atrIdx >= 0 ? atrValues[atrIdx] : null,
            createdAt: new Date()
          },
          update: {}
        })
      );
    }

    await prisma.$transaction(batch);
    saved += batch.length;

    const progress = ((saved / (candles.length - maxOffset)) * 100).toFixed(1);
    console.log(`   ${progress}% | ${saved.toLocaleString()} indicadores guardados`);
  }

  console.log(`   ✅ ${saved.toLocaleString()} indicadores completados`);
}

async function main() {
  console.log('🚀 CÁLCULO DE INDICADORES TÉCNICOS\n');

  for (const symbol of SYMBOL_MAP) {
    await calculateIndicatorsForSymbol(symbol);
  }

  console.log('\n\n📊 RESUMEN FINAL:\n');

  for (const symbol of SYMBOL_MAP) {
    const count = await prisma.indicator.count({
      where: {
        candle: { symbol, timeframe: '60' }
      }
    });
    console.log(`   ✅ ${symbol}: ${count.toLocaleString()} indicadores`);
  }

  console.log('\n🎉 INDICADORES COMPLETOS\n');
  await prisma.$disconnect();
}

main();
