import { 
  BollingerBands, 
  RSI, 
  MACD, 
  EMA, 
  Stochastic, 
  ATR 
} from 'technicalindicators';
import prisma from '../database/prisma.client';

export class IndicatorsService {
  
  async calculateIndicators(
    symbol: string, 
    timeframe: string, 
    limit: number = 100
  ) {
    console.log(`📊 Calculando indicadores para ${symbol} ${timeframe}...`);

    const candles = await prisma.candle.findMany({
      where: { symbol, timeframe },
      orderBy: { epoch: 'asc' },
      take: limit,
    });

    if (candles.length < 50) {
      console.warn('⚠️ No hay suficientes velas para calcular indicadores (mínimo 50)');
      return;
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const bbResults = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const rsiResults = RSI.calculate({ period: 14, values: closes });
    const macdResults = MACD.calculate({ 
      fastPeriod: 12, 
      slowPeriod: 26, 
      signalPeriod: 9, 
      values: closes,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const ema9Results = EMA.calculate({ period: 9, values: closes });
    const ema21Results = EMA.calculate({ period: 21, values: closes });
    const ema50Results = EMA.calculate({ period: 50, values: closes });
    const stochResults = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
    const atrResults = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

    const maxOffset = Math.max(
      closes.length - bbResults.length,
      closes.length - rsiResults.length,
      closes.length - macdResults.length,
      closes.length - ema50Results.length,
      closes.length - stochResults.length,
      closes.length - atrResults.length
    );

    console.log(`✅ Indicadores calculados. Guardando en DB...`);

    let savedCount = 0;
    for (let i = maxOffset; i < candles.length; i++) {
      const candle = candles[i];
      const bbIndex = i - (closes.length - bbResults.length);
      const rsiIndex = i - (closes.length - rsiResults.length);
      const macdIndex = i - (closes.length - macdResults.length);
      const ema9Index = i - (closes.length - ema9Results.length);
      const ema21Index = i - (closes.length - ema21Results.length);
      const ema50Index = i - (closes.length - ema50Results.length);
      const stochIndex = i - (closes.length - stochResults.length);
      const atrIndex = i - (closes.length - atrResults.length);

      const bb = bbIndex >= 0 ? bbResults[bbIndex] : null;
      const rsi = rsiIndex >= 0 ? rsiResults[rsiIndex] : null;
      const macd = macdIndex >= 0 ? macdResults[macdIndex] : null;
      const ema9 = ema9Index >= 0 ? ema9Results[ema9Index] : null;
      const ema21 = ema21Index >= 0 ? ema21Results[ema21Index] : null;
      const ema50 = ema50Index >= 0 ? ema50Results[ema50Index] : null;
      const stoch = stochIndex >= 0 ? stochResults[stochIndex] : null;
      const atr = atrIndex >= 0 ? atrResults[atrIndex] : null;

      let bbPercentB = null;
      if (bb && bb.upper && bb.lower) {
        bbPercentB = (candle.close - bb.lower) / (bb.upper - bb.lower);
      }

      let bbWidth = null;
      if (bb && bb.upper && bb.lower) {
        bbWidth = bb.upper - bb.lower;
      }

      await prisma.indicator.upsert({
        where: { candleId: candle.id },
        create: {
          candleId: candle.id,
          bbUpper: bb?.upper || null,
          bbMiddle: bb?.middle || null,
          bbLower: bb?.lower || null,
          bbWidth: bbWidth,
          bbPercentB: bbPercentB,
          rsi: rsi || null,
          macd: macd?.MACD || null,
          macdSignal: macd?.signal || null,
          macdHistogram: macd?.histogram || null,
          ema9: ema9 || null,
          ema21: ema21 || null,
          ema50: ema50 || null,
          stochK: stoch?.k || null,
          stochD: stoch?.d || null,
          atr: atr || null,
        },
        update: {
          bbUpper: bb?.upper || null,
          bbMiddle: bb?.middle || null,
          bbLower: bb?.lower || null,
          bbWidth: bbWidth,
          bbPercentB: bbPercentB,
          rsi: rsi || null,
          macd: macd?.MACD || null,
          macdSignal: macd?.signal || null,
          macdHistogram: macd?.histogram || null,
          ema9: ema9 || null,
          ema21: ema21 || null,
          ema50: ema50 || null,
          stochK: stoch?.k || null,
          stochD: stoch?.d || null,
          atr: atr || null,
        },
      });

      savedCount++;
    }

    console.log(`✅ ${savedCount} indicadores guardados`);
  }
}
