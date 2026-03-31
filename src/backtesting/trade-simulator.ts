import Decimal from 'decimal.js';

export interface Trade {
  id: string;
  symbol: string;
  direction: 'UP' | 'DOWN';
  entryTime: Date;
  entryPrice: Decimal;
  exitTime?: Date;
  exitPrice?: Decimal;
  stake: Decimal;
  stopLoss: Decimal;
  takeProfit: Decimal;
  stopLossPips: number;
  takeProfitPips: number;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnl: Decimal;
  pnlPercent: number;
  commission: Decimal;
  slippage: Decimal;
  confidence: number;
  lotSize: number;
}

interface SimulationConfig {
  slippagePips: number;
  fixedCommission: number; // Por micro lote por lado
}

// Valor de 1 pip por micro lote (0.01 lote)
const PIP_VALUE_MICRO: Record<string, number> = {
  'frxEURUSD': 0.10,
  'frxGBPUSD': 0.10,
  'frxAUDUSD': 0.10,
  'frxUSDJPY': 0.093, // Aproximado
  'frxGBPJPY': 0.093
};

// Tamaño de pip por par
const PIP_SIZE: Record<string, number> = {
  'frxEURUSD': 0.0001,
  'frxGBPUSD': 0.0001,
  'frxAUDUSD': 0.0001,
  'frxUSDJPY': 0.01,
  'frxGBPJPY': 0.01
};

export class TradeSimulator {
  private config: SimulationConfig;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = {
      slippagePips:    config.slippagePips    ?? 0.3,
      fixedCommission: config.fixedCommission ?? 0.07 // $0.07 por micro lote por lado
    };
  }

  private getPipSize(symbol: string): number {
    return PIP_SIZE[symbol] ?? 0.0001;
  }

  private getPipValue(symbol: string, lotSize: number): number {
    const microPipValue = PIP_VALUE_MICRO[symbol] ?? 0.10;
    // lotSize en micro lotes (0.01 = 1 micro lote)
    return microPipValue * (lotSize / 0.01);
  }

  /**
   * Calcula lot size basado en stake y riesgo máximo
   * stake = capital a arriesgar en USD
   * stopLossPips = distancia del SL en pips
   */
 private calcLotSize(symbol: string, stake: number): number {
  // Fijo: 1 micro lote (0.01) por cada $100 de stake
  // Es el modelo más simple y predecible
  const microLots = stake / 100;
  return Math.max(0.01, Math.min(0.10, Math.round(microLots * 100) / 100));
}

  openTrade(
    symbol: string,
    direction: 'UP' | 'DOWN',
    entryTime: Date,
    entryPrice: number,
    stake: Decimal,
    stopLossDistance: Decimal,
    takeProfitDistance: Decimal,
    confidence: number
  ): Trade {
    const pipSize       = this.getPipSize(symbol);
    const slippagePrice = this.config.slippagePips * pipSize;

    // Convertir distancias a pips
    const stopLossPips   = stopLossDistance.toNumber() / pipSize;
    const takeProfitPips = takeProfitDistance.toNumber() / pipSize;

    // Calcular lot size basado en stake y SL
    const lotSize = this.calcLotSize(symbol, stake.toNumber());

    // Aplicar slippage al entry
    const adjustedEntry = direction === 'UP'
      ? entryPrice + slippagePrice
      : entryPrice - slippagePrice;

    // Comisión = $0.07 por micro lote por lado
    const commission = new Decimal(this.config.fixedCommission * lotSize);

    return {
      id:             `${symbol}_${entryTime.getTime()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      direction,
      entryTime,
      entryPrice:     new Decimal(adjustedEntry),
      stake,
      stopLoss:       stopLossDistance,
      takeProfit:     takeProfitDistance,
      stopLossPips,
      takeProfitPips,
      status:         'OPEN',
      pnl:            new Decimal(0),
      pnlPercent:     0,
      commission,
      slippage:       new Decimal(slippagePrice),
      confidence,
      lotSize
    };
  }

  updateTrade(
    trade: Trade,
    currentTime: Date,
    high: number,
    low: number,
    close: number
  ): Trade {
    if (trade.status !== 'OPEN') return trade;

    const pipSize   = this.getPipSize(trade.symbol);
    const entry     = trade.entryPrice.toNumber();
    const slipPrice = this.config.slippagePips * pipSize;

    let exitPrice: number | null = null;
    let status: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN' = 'OPEN';

    const tpDistance = trade.takeProfit.toNumber();
    const slDistance = trade.stopLoss.toNumber();

    if (trade.direction === 'UP') {
      if (high >= entry + tpDistance) { exitPrice = entry + tpDistance; status = 'WIN';  }
      else if (low <= entry - slDistance) { exitPrice = entry - slDistance; status = 'LOSS'; }
    } else {
      if (low <= entry - tpDistance) { exitPrice = entry - tpDistance; status = 'WIN';  }
      else if (high >= entry + slDistance) { exitPrice = entry + slDistance; status = 'LOSS'; }
    }

    if (exitPrice !== null) {
      // Slippage en exit (desfavorable)
      exitPrice = status === 'WIN'
        ? exitPrice - slipPrice
        : exitPrice + slipPrice;

      // PnL en pips
      const priceDiff = trade.direction === 'UP'
        ? exitPrice - entry
        : entry - exitPrice;

      const pipsGained   = priceDiff / pipSize;
      const pipValue     = this.getPipValue(trade.symbol, trade.lotSize);
      const grossPnl     = new Decimal(pipsGained * pipValue);

      // Comisión de salida
    const exitCommission = new Decimal(this.config.fixedCommission * trade.lotSize);
      const totalCommission = trade.commission.add(exitCommission);
      const finalPnl        = grossPnl.sub(totalCommission);
      const pnlPercent      = finalPnl.div(trade.stake).mul(100).toNumber();

      if (Math.abs(pnlPercent) < 0.05) status = 'BREAKEVEN';

      return {
        ...trade,
        exitTime:   currentTime,
        exitPrice:  new Decimal(exitPrice),
        status,
        pnl:        finalPnl,
        pnlPercent,
        commission: totalCommission
      };
    }

    return trade;
  }

  closeTrade(trade: Trade, currentTime: Date, currentPrice: number): Trade {
    if (trade.status !== 'OPEN') return trade;

    const pipSize    = this.getPipSize(trade.symbol);
    const entry      = trade.entryPrice.toNumber();
    const priceDiff  = trade.direction === 'UP'
      ? currentPrice - entry
      : entry - currentPrice;

    const pipsGained     = priceDiff / pipSize;
    const pipValue       = this.getPipValue(trade.symbol, trade.lotSize);
    const grossPnl       = new Decimal(pipsGained * pipValue);
    const exitCommission = new Decimal(this.config.fixedCommission * trade.lotSize);
    const totalCommission = trade.commission.add(exitCommission);
    const finalPnl        = grossPnl.sub(totalCommission);
    const pnlPercent      = finalPnl.div(trade.stake).mul(100).toNumber();

    let status: 'WIN' | 'LOSS' | 'BREAKEVEN' = 'BREAKEVEN';
    if (pnlPercent >  0.05) status = 'WIN';
    if (pnlPercent < -0.05) status = 'LOSS';

    return {
      ...trade,
      exitTime:   currentTime,
      exitPrice:  new Decimal(currentPrice),
      status,
      pnl:        finalPnl,
      pnlPercent,
      commission: totalCommission
    };
  }
}
