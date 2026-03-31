import prisma from '../database/prisma.client';
import { Candle, Indicator } from '@prisma/client';

interface CandleWithIndicators extends Candle {
  indicators: Indicator | null;
}

class FeaturesService {
  
  async generateFeatures(symbol: string, timeframe: string) {
    console.log(`🧠 Generando features de ML para ${symbol} ${timeframe}...`);

    const candles = await prisma.candle.findMany({
      where: { 
        symbol, 
        timeframe
      },
      include: { indicators: true },
      orderBy: { epoch: 'asc' },
    }) as CandleWithIndicators[];

    // Filtrar solo las que tienen indicadores
    const candlesWithIndicators = candles.filter(c => c.indicators !== null);

    if (candlesWithIndicators.length < 10) {
      console.warn('⚠️ No hay suficientes velas con indicadores (mínimo 10)');
      return;
    }

    console.log(`📊 Procesando ${candlesWithIndicators.length} velas...`);

    let featuresCreated = 0;

    for (let i = 5; i < candlesWithIndicators.length - 5; i++) {
      const candle = candlesWithIndicators[i];
      const prevCandle = candlesWithIndicators[i - 1];
      const indicators = candle.indicators;

      if (!indicators) continue;

      // ============================================
      // PRICE FEATURES
      // ============================================
      
      const priceChangePct = ((candle.close - prevCandle.close) / prevCandle.close) * 100;
      const highLowRange = candle.high - candle.low;
      const closeOpenRatio = candle.close / candle.open;
      
      const candleBody = Math.abs(candle.close - candle.open);
      const candleBodySize = (candleBody / highLowRange) * 100;
      
      const upperShadow = candle.high - Math.max(candle.open, candle.close);
      const lowerShadow = Math.min(candle.open, candle.close) - candle.low;
      const upperShadowRatio = (upperShadow / highLowRange) * 100;
      const lowerShadowRatio = (lowerShadow / highLowRange) * 100;

      // ============================================
      // NORMALIZED INDICATORS
      // ============================================
      
      const rsiNormalized = indicators.rsi ? indicators.rsi / 100 : null;
      
      let bbPosition = null;
      if (indicators.bbUpper && indicators.bbLower) {
        bbPosition = (candle.close - indicators.bbLower) / 
                     (indicators.bbUpper - indicators.bbLower);
      }
      
      let macdStrength = null;
      if (indicators.macd && indicators.macdSignal) {
        macdStrength = indicators.macdHistogram || 0;
      }
      
      let trendDirection = 0;
      if (indicators.ema9 && indicators.ema21 && indicators.ema50) {
        if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) {
          trendDirection = 1;
        } else if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) {
          trendDirection = -1;
        }
      }

      // ============================================
      // PATTERN RECOGNITION
      // ============================================
      
      const isBullishEngulfing = 
        prevCandle.close < prevCandle.open &&
        candle.close > candle.open &&
        candle.open < prevCandle.close &&
        candle.close > prevCandle.open;
      
      const isBearishEngulfing = 
        prevCandle.close > prevCandle.open &&
        candle.close < candle.open &&
        candle.open > prevCandle.close &&
        candle.close < prevCandle.open;

      // ============================================
      // VOLATILITY FEATURES
      // ============================================
      
      const atrNormalized = indicators.atr ? (indicators.atr / candle.close) * 100 : null;
      
      let volatilityRegime = 'medium';
      if (atrNormalized) {
        if (atrNormalized < 0.5) volatilityRegime = 'low';
        else if (atrNormalized > 1.5) volatilityRegime = 'high';
      }

      // ============================================
      // TARGET VARIABLES
      // ============================================
      
      // ============================================
// TARGET VARIABLES (para entrenamiento)
// ============================================

        // Inicializar todas las variables
        let priceDirectionNext1m: number | null = null;
        let priceDirectionNext5m: number | null = null;
        let profitPotential: number | null = null;

        // Dirección del precio en próximo minuto (1m)
        if (i + 1 < candlesWithIndicators.length) {
        const nextCandle = candlesWithIndicators[i + 1];
        const priceChange = ((nextCandle.close - candle.close) / candle.close) * 100;

        if (priceChange > 0.01) priceDirectionNext1m = 1;      // UP
        else if (priceChange < -0.01) priceDirectionNext1m = -1; // DOWN
        else priceDirectionNext1m = 0;                          // NEUTRAL
        }

        // Dirección del precio en próximos 5 minutos
        if (i + 5 < candlesWithIndicators.length) {
        const futureCandle = candlesWithIndicators[i + 5];
        const priceChange = ((futureCandle.close - candle.close) / candle.close) * 100;

        if (priceChange > 0.03) priceDirectionNext5m = 1;      // UP
        else if (priceChange < -0.03) priceDirectionNext5m = -1; // DOWN
        else priceDirectionNext5m = 0;                          // NEUTRAL

        // Potencial de ganancia (max high alcanzado en próximas 5 velas)
        const nextFiveCandles = candlesWithIndicators.slice(i + 1, i + 6);
        const maxHigh = Math.max(...nextFiveCandles.map(c => c.high));
        profitPotential = ((maxHigh - candle.close) / candle.close) * 100;
        }


      // ============================================
      // GUARDAR EN BASE DE DATOS
      // ============================================
      
      await prisma.mLFeature.upsert({
        where: { candleId: candle.id },
        create: {
          candleId: candle.id,
          symbol: candle.symbol,
          epoch: candle.epoch,
          
          closePrice: candle.close,
          priceChangePct,
          highLowRange,
          closeOpenRatio,
          
          rsiNormalized,
          bbPosition,
          macdStrength,
          trendDirection,
          
          isBullishEngulfing,
          isBearishEngulfing,
          candleBodySize,
          upperShadowRatio,
          lowerShadowRatio,
          
          atrNormalized,
          volatilityRegime,
          
          priceDirectionNext1m,
          priceDirectionNext5m,
          profitPotential,
        },
        update: {
          closePrice: candle.close,
          priceChangePct,
          highLowRange,
          closeOpenRatio,
          
          rsiNormalized,
          bbPosition,
          macdStrength,
          trendDirection,
          
          isBullishEngulfing,
          isBearishEngulfing,
          candleBodySize,
          upperShadowRatio,
          lowerShadowRatio,
          
          atrNormalized,
          volatilityRegime,
          
          priceDirectionNext1m,
          priceDirectionNext5m,
          profitPotential,
        },
      });

      featuresCreated++;
    }

    console.log(`✅ ${featuresCreated} features generadas y guardadas\n`);
    
    await this.showStatistics(symbol, timeframe);
  }

  async showStatistics(symbol: string, timeframe: string) {
    const features = await prisma.mLFeature.findMany({
      where: { symbol, NOT: { priceDirectionNext1m: null } },
    });

    if (features.length === 0) {
      console.log('⚠️ No hay features con targets válidos');
      return;
    }

    const upCount = features.filter(f => f.priceDirectionNext1m === 1).length;
    const downCount = features.filter(f => f.priceDirectionNext1m === -1).length;
    const neutralCount = features.filter(f => f.priceDirectionNext1m === 0).length;

    console.log('📊 Estadísticas del Dataset:\n');
    console.log(`Total de samples: ${features.length}`);
    console.log(`  UP (1):      ${upCount} (${((upCount/features.length)*100).toFixed(1)}%)`);
    console.log(`  DOWN (-1):   ${downCount} (${((downCount/features.length)*100).toFixed(1)}%)`);
    console.log(`  NEUTRAL (0): ${neutralCount} (${((neutralCount/features.length)*100).toFixed(1)}%)`);
    
    const avgProfit = features.reduce((sum, f) => sum + (f.profitPotential || 0), 0) / features.length;
    console.log(`\nPromedio de profit potential: ${avgProfit.toFixed(4)}%`);
    
    const bullishPatterns = features.filter(f => f.isBullishEngulfing).length;
    const bearishPatterns = features.filter(f => f.isBearishEngulfing).length;
    console.log(`\nPatrones detectados:`);
    console.log(`  Bullish Engulfing: ${bullishPatterns}`);
    console.log(`  Bearish Engulfing: ${bearishPatterns}`);
    
    const lowVol = features.filter(f => f.volatilityRegime === 'low').length;
    const medVol = features.filter(f => f.volatilityRegime === 'medium').length;
    const highVol = features.filter(f => f.volatilityRegime === 'high').length;
    console.log(`\nRégimen de volatilidad:`);
    console.log(`  Low:    ${lowVol} (${((lowVol/features.length)*100).toFixed(1)}%)`);
    console.log(`  Medium: ${medVol} (${((medVol/features.length)*100).toFixed(1)}%)`);
    console.log(`  High:   ${highVol} (${((highVol/features.length)*100).toFixed(1)}%)`);
  }

  async exportToCSV(symbol: string, timeframe: string, filename: string = 'training_data.csv') {
    const features = await prisma.mLFeature.findMany({
      where: { 
        symbol, 
        NOT: { priceDirectionNext1m: null }
      },
      orderBy: { epoch: 'asc' },
    });

    if (features.length === 0) {
      console.log('⚠️ No hay features para exportar');
      return;
    }

    const headers = [
      'epoch','closePrice','priceChangePct','highLowRange','closeOpenRatio',
      'rsiNormalized','bbPosition','macdStrength','trendDirection',
      'isBullishEngulfing','isBearishEngulfing','candleBodySize',
      'upperShadowRatio','lowerShadowRatio','atrNormalized','volatilityRegime',
      'priceDirectionNext1m','priceDirectionNext5m','profitPotential',
    ];

    const csvLines = [headers.join(',')];
    
    for (const feature of features) {
      const row = [
        feature.epoch.toString(),
        feature.closePrice,
        feature.priceChangePct || '',
        feature.highLowRange || '',
        feature.closeOpenRatio || '',
        feature.rsiNormalized || '',
        feature.bbPosition || '',
        feature.macdStrength || '',
        feature.trendDirection || '',
        feature.isBullishEngulfing ? 1 : 0,
        feature.isBearishEngulfing ? 1 : 0,
        feature.candleBodySize || '',
        feature.upperShadowRatio || '',
        feature.lowerShadowRatio || '',
        feature.atrNormalized || '',
        feature.volatilityRegime || '',
        feature.priceDirectionNext1m,
        feature.priceDirectionNext5m || '',
        feature.profitPotential || '',
      ];
      csvLines.push(row.join(','));
    }

    const fs = require('fs');
    fs.writeFileSync(filename, csvLines.join('\n'));
    console.log(`\n✅ Dataset exportado a: ${filename}`);
    console.log(`📊 Total de registros: ${features.length}`);
  }
}

export default FeaturesService;
