import Decimal from 'decimal.js';

interface PairCharacteristics {
  symbol: string;
  avgSpread: number;        // Spread promedio en pips
  avgVolatility: number;    // ATR promedio
  baseStakePercent: number; // % del capital base
  minStake: number;
  maxStake: number;
}

interface AdaptiveParams {
  stake: Decimal;
  stopLoss: Decimal;
  takeProfit: Decimal;
  riskReward: number;
  viable: boolean; // ← NUEVO
}

// Características por par Forex
const PAIR_CHARACTERISTICS: Record<string, PairCharacteristics> = {
  'frxEURUSD': {
    symbol: 'frxEURUSD',
    avgSpread: 0.8,
    avgVolatility: 0.0012,
    baseStakePercent: 0.01,
    minStake: 5,
    maxStake: 50
  },
  'frxGBPUSD': {
    symbol: 'frxGBPUSD',
    avgSpread: 1.2,
    avgVolatility: 0.0015,
    baseStakePercent: 0.008,
    minStake: 5,
    maxStake: 40
  },
  'frxUSDJPY': {
    symbol: 'frxUSDJPY',
    avgSpread: 0.9,
    avgVolatility: 0.0011,
    baseStakePercent: 0.01,
    minStake: 5,
    maxStake: 50
  },
  'frxGBPJPY': {
    symbol: 'frxGBPJPY',
    avgSpread: 2.0,
    avgVolatility: 0.0020,
    baseStakePercent: 0.005,
    minStake: 5,
    maxStake: 30
  },
  'frxAUDUSD': {
    symbol: 'frxAUDUSD',
    avgSpread: 1.0,
    avgVolatility: 0.0013,
    baseStakePercent: 0.008,
    minStake: 5,
    maxStake: 40
  }
};


export class AdaptiveParamsCalculator {
  /**
   * Calcula parámetros adaptativos basados en ATR y volatilidad actual
   */
  static calculate(
  symbol: string,
  currentPrice: number,
  atr: number,
  accountBalance: number,
  recentVolatility: number
): AdaptiveParams {
  const pairConfig = PAIR_CHARACTERISTICS[symbol];
  if (!pairConfig) throw new Error(`Pair ${symbol} not configured`);

  // ATR mínimo para evitar trades con ganancia < comisión
  const MIN_ATR_PIPS = 2; // mínimo 5 pips de ATR
  const pipValue = symbol.includes('JPY') ? 0.01 : 0.0001;
  const atrInPips = atr / pipValue;
  
  if (atrInPips < MIN_ATR_PIPS) {
    // ATR demasiado pequeño - no tradear
    return {
      stake: new Decimal(0), // stake 0 = señal para no abrir trade
      stopLoss: new Decimal(atr * 1.5),
      takeProfit: new Decimal(atr * 2.5),
      riskReward: 1.67,
      viable: false  // ← NUEVO FLAG
    };
  }

  const volatilityRatio = recentVolatility / pairConfig.avgVolatility;
  const volatilityAdjustment = Math.max(0.5, Math.min(1.5, 1 / volatilityRatio));

  let stakeAmount = accountBalance * pairConfig.baseStakePercent * volatilityAdjustment;
  stakeAmount = Math.max(pairConfig.minStake, Math.min(pairConfig.maxStake, stakeAmount));

  return {
    stake: new Decimal(stakeAmount.toFixed(2)),
    stopLoss: new Decimal(atr * 1.5),
    takeProfit: new Decimal(atr * 2.5),
    riskReward: 2.5 / 1.5,
    viable: true
  };
}


  /**
   * Calcula volatilidad reciente (últimas 24 velas en timeframe 1h)
   */
  static calculateRecentVolatility(recentCandles: Array<{ high: number; low: number }>): number {
    if (recentCandles.length === 0) return 0;

    const ranges = recentCandles.map(c => c.high - c.low);
    const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
    
    return avgRange;
  }
}

export { PAIR_CHARACTERISTICS };
