interface Indicators {
  rsi: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPercentB: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  stochK: number | null;
  stochD: number | null;
  atr: number | null;
}

interface Signal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasons: string[];
  stopLoss: number;
  takeProfit: number;
}

export class SignalGenerator {
  
  generateSignal(currentPrice: number, indicators: Indicators): Signal {
    const reasons: string[] = [];
    let bullishScore = 0;
    let bearishScore = 0;

    if (indicators.rsi !== null) {
      if (indicators.rsi < 30) {
        bullishScore += 2;
        reasons.push(`RSI sobreventa (${indicators.rsi.toFixed(1)})`);
      } else if (indicators.rsi > 70) {
        bearishScore += 2;
        reasons.push(`RSI sobrecompra (${indicators.rsi.toFixed(1)})`);
      }
    }

    if (indicators.bbPercentB !== null) {
      if (indicators.bbPercentB < 0.2) {
        bullishScore += 2;
        reasons.push(`Precio cerca de BB inferior (%B=${(indicators.bbPercentB*100).toFixed(1)}%)`);
      } else if (indicators.bbPercentB > 0.8) {
        bearishScore += 2;
        reasons.push(`Precio cerca de BB superior (%B=${(indicators.bbPercentB*100).toFixed(1)}%)`);
      }
    }

    if (indicators.macd !== null && indicators.macdSignal !== null) {
      if (indicators.macd > indicators.macdSignal && indicators.macdHistogram! > 0) {
        bullishScore += 1.5;
        reasons.push('MACD cruzó hacia arriba');
      } else if (indicators.macd < indicators.macdSignal && indicators.macdHistogram! < 0) {
        bearishScore += 1.5;
        reasons.push('MACD cruzó hacia abajo');
      }
    }

    if (indicators.ema9 && indicators.ema21 && indicators.ema50) {
      if (indicators.ema9 > indicators.ema21 && 
          indicators.ema21 > indicators.ema50 &&
          currentPrice > indicators.ema9) {
        bullishScore += 2;
        reasons.push('Tendencia alcista confirmada');
      }
      else if (indicators.ema9 < indicators.ema21 && 
               indicators.ema21 < indicators.ema50 &&
               currentPrice < indicators.ema9) {
        bearishScore += 2;
        reasons.push('Tendencia bajista confirmada');
      }
    }

    if (indicators.stochK !== null && indicators.stochD !== null) {
      if (indicators.stochK < 20 && indicators.stochD < 20) {
        bullishScore += 1;
        reasons.push(`Stochastic sobreventa (K=${indicators.stochK.toFixed(1)})`);
      } else if (indicators.stochK > 80 && indicators.stochD > 80) {
        bearishScore += 1;
        reasons.push(`Stochastic sobrecompra (K=${indicators.stochK.toFixed(1)})`);
      }
    }

    const confidence = Math.min(95, (Math.max(bullishScore, bearishScore) / 10) * 100);
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let stopLoss = 0;
    let takeProfit = 0;

    const atrMultiplier = 3.0;
    const atrValue = indicators.atr || (currentPrice * 0.004);

    // 🔧 UMBRAL REDUCIDO: 3 → 2
    if (bullishScore > bearishScore && bullishScore >= 2) {
      action = 'BUY';
      stopLoss = currentPrice - (atrValue * atrMultiplier);
      takeProfit = currentPrice + (atrValue * atrMultiplier * 2.5);
      reasons.unshift(`🟢 SEÑAL ALCISTA (Score: ${bullishScore.toFixed(1)})`);
    } 
    else if (bearishScore > bullishScore && bearishScore >= 2) {
      action = 'SELL';
      stopLoss = currentPrice + (atrValue * atrMultiplier);
      takeProfit = currentPrice - (atrValue * atrMultiplier * 2);
      reasons.unshift(`🔴 SEÑAL BAJISTA (Score: ${bearishScore.toFixed(1)})`);
    }
    else {
      reasons.unshift(`⚪ SIN SEÑAL (Bull: ${bullishScore.toFixed(1)}, Bear: ${bearishScore.toFixed(1)})`);
    }

    // 🔍 DEBUG: Log cada ~30 velas para ver qué está pasando
    if (Math.random() < 0.001) {
      console.log('🔍 DEBUG SIGNAL:', {
        rsi: indicators.rsi,
        macd: indicators.macd,
        macdSignal: indicators.macdSignal,
        bullishScore,
        bearishScore,
        confidence,
        action
      });
    }

    return { action, confidence: Math.round(confidence), reasons, stopLoss, takeProfit };
  }

  formatSignal(signal: Signal, currentPrice: number): string {
    const lines = [
      '\n' + '='.repeat(60),
      `🎯 SEÑAL DE TRADING`,
      '='.repeat(60),
      '',
      `Acción:      ${signal.action}`,
      `Confianza:   ${signal.confidence}%`,
      `Precio:      ${currentPrice.toFixed(2)}`,
      '',
    ];

    if (signal.action !== 'HOLD') {
      const slDistance = Math.abs(currentPrice - signal.stopLoss);
      const tpDistance = Math.abs(signal.takeProfit - currentPrice);
      const riskReward = (tpDistance / slDistance).toFixed(2);

      lines.push(`Stop Loss:   ${signal.stopLoss.toFixed(2)} (${((slDistance/currentPrice)*100).toFixed(2)}%)`);
      lines.push(`Take Profit: ${signal.takeProfit.toFixed(2)} (${((tpDistance/currentPrice)*100).toFixed(2)}%)`);
      lines.push(`Risk/Reward: 1:${riskReward}`);
      lines.push('');
    }

    lines.push('📋 Razones:');
    signal.reasons.forEach(reason => {
      lines.push(`  • ${reason}`);
    });
    
    lines.push('='.repeat(60) + '\n');
    return lines.join('\n');
  }
}
