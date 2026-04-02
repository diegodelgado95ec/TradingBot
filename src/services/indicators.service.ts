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
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const bbResults    = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const rsiResults   = RSI.calculate({ period: 14, values: closes });
    const macdResults  = MACD.calculate({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      values: closes,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const ema9Results  = EMA.calculate({ period: 9,  values: closes });
    const ema21Results = EMA.calculate({ period: 21, values: closes });
    const ema50Results = EMA.calculate({ period: 50, values: closes });
    const stochResults = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
    const atrResults   = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

    const maxOffset = Math.max(
      closes.length - bbResults.length,
      closes.length - rsiResults.length,
      closes.length - macdResults.length,
      closes.length - ema50Results.length,
      closes.length - stochResults.length,
      closes.length - atrResults.length,
    );

    console.log(`✅ Indicadores calculados. Guardando en DB...`);

    let savedCount = 0;
    for (let i = maxOffset; i < candles.length; i++) {
      const candle = candles[i];

      const bbIdx    = i - (closes.length - bbResults.length);
      const rsiIdx   = i - (closes.length - rsiResults.length);
      const macdIdx  = i - (closes.length - macdResults.length);
      const ema9Idx  = i - (closes.length - ema9Results.length);
      const ema21Idx = i - (closes.length - ema21Results.length);
      const ema50Idx = i - (closes.length - ema50Results.length);
      const stochIdx = i - (closes.length - stochResults.length);
      const atrIdx   = i - (closes.length - atrResults.length);

      const bb    = bbIdx    >= 0 ? bbResults[bbIdx]       : null;
      const rsi   = rsiIdx   >= 0 ? rsiResults[rsiIdx]     : null;
      const macd  = macdIdx  >= 0 ? macdResults[macdIdx]   : null;
      const ema9  = ema9Idx  >= 0 ? ema9Results[ema9Idx]   : null;
      const ema21 = ema21Idx >= 0 ? ema21Results[ema21Idx] : null;
      const ema50 = ema50Idx >= 0 ? ema50Results[ema50Idx] : null;
      const stoch = stochIdx >= 0 ? stochResults[stochIdx] : null;
      const atr   = atrIdx   >= 0 ? atrResults[atrIdx]     : null;

      const data = {
        bbUpper:       bb?.upper        ?? null,
        bbMiddle:      bb?.middle       ?? null,
        bbLower:       bb?.lower        ?? null,
        rsi:           rsi              ?? null,
        macd:          macd?.MACD       ?? null,
        macdSignal:    macd?.signal     ?? null,
        macdHistogram: macd?.histogram  ?? null,
        ema9:          ema9             ?? null,
        ema21:         ema21            ?? null,
        ema50:         ema50            ?? null,
        stochK:        stoch?.k         ?? null,
        stochD:        stoch?.d         ?? null,
        atr:           atr              ?? null,
      };

      await prisma.indicator.upsert({
        where:  { candleId: candle.id },
        create: { candleId: candle.id, ...data },
        update: data,
      });

      savedCount++;
    }

    console.log(`✅ ${savedCount} indicadores guardados`);
  }
}
