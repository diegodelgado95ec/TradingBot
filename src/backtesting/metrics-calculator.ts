import Decimal from 'decimal.js';
import { Trade } from './trade-simulator';

export interface BacktestMetrics {
  // Métricas generales
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  
  // Performance
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  
  // PnL
  totalPnl: Decimal;
  totalPnlPercent: number;
  avgWin: Decimal;
  avgLoss: Decimal;
  avgWinPercent: number;
  avgLossPercent: number;
  largestWin: Decimal;
  largestLoss: Decimal;
  
  // Drawdown
  maxDrawdown: Decimal;
  maxDrawdownPercent: number;
  avgDrawdown: Decimal;
  
  // Costos
  totalCommissions: Decimal;
  totalSlippage: Decimal;
  
  // Por símbolo
  bySymbol: Record<string, SymbolMetrics>;
  
  // Por mes
  byMonth: Record<string, MonthlyMetrics>;
  
  // Equity curve
  equityCurve: Array<{ date: Date; balance: Decimal; drawdown: Decimal }>;
}

export interface SymbolMetrics {
  symbol: string;
  trades: number;
  winRate: number;
  totalPnl: Decimal;
  profitFactor: number;
  avgConfidence: number;
}

export interface MonthlyMetrics {
  month: string;
  trades: number;
  winRate: number;
  pnl: Decimal;
}

export class MetricsCalculator {
  /**
   * Calcula todas las métricas del backtest
   */
  static calculate(trades: Trade[], initialBalance: number): BacktestMetrics {
    const closedTrades = trades.filter(t => t.status !== 'OPEN');
    const winningTrades = closedTrades.filter(t => t.status === 'WIN');
    const losingTrades = closedTrades.filter(t => t.status === 'LOSS');
    const breakevenTrades = closedTrades.filter(t => t.status === 'BREAKEVEN');

    // PnL
    const totalPnl = closedTrades.reduce((sum, t) => sum.add(t.pnl), new Decimal(0));
    const totalWins = winningTrades.reduce((sum, t) => sum.add(t.pnl), new Decimal(0));
    const totalLosses = losingTrades.reduce((sum, t) => sum.add(t.pnl.abs()), new Decimal(0));
    
    const avgWin = winningTrades.length > 0 
      ? totalWins.div(winningTrades.length) 
      : new Decimal(0);
    const avgLoss = losingTrades.length > 0 
      ? totalLosses.div(losingTrades.length) 
      : new Decimal(0);

    // Métricas básicas
    const winRate = closedTrades.length > 0 
      ? (winningTrades.length / closedTrades.length) * 100 
      : 0;
    
    const profitFactor = totalLosses.toNumber() > 0 
      ? totalWins.div(totalLosses).toNumber() 
      : totalWins.toNumber() > 0 ? 999 : 0;

    // Equity curve y drawdown
    const { equityCurve, maxDrawdown, maxDrawdownPercent, avgDrawdown } = 
      this.calculateEquityCurve(closedTrades, initialBalance);

    // Sharpe y Sortino Ratio
    const returns = closedTrades.map(t => t.pnlPercent);
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns);

    // Costos
    const totalCommissions = closedTrades.reduce((sum, t) => sum.add(t.commission), new Decimal(0));
    const totalSlippage = closedTrades.reduce((sum, t) => sum.add(t.slippage), new Decimal(0));

    // Métricas por símbolo
    const bySymbol = this.calculateBySymbol(closedTrades);

    // Métricas por mes
    const byMonth = this.calculateByMonth(closedTrades);

    // Promedios de win/loss en %
    const avgWinPercent = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / winningTrades.length
      : 0;
    
    const avgLossPercent = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnlPercent), 0) / losingTrades.length
      : 0;

    // Largest win/loss
    const largestWin = winningTrades.length > 0
      ? winningTrades.reduce((max, t) => t.pnl.gt(max) ? t.pnl : max, new Decimal(0))
      : new Decimal(0);
    
    const largestLoss = losingTrades.length > 0
      ? losingTrades.reduce((min, t) => t.pnl.lt(min) ? t.pnl : min, new Decimal(0))
      : new Decimal(0);

    return {
      totalTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      breakevenTrades: breakevenTrades.length,
      winRate,
      profitFactor,
      sharpeRatio,
      sortinoRatio,
      totalPnl,
      totalPnlPercent: (totalPnl.toNumber() / initialBalance) * 100,
      avgWin,
      avgLoss,
      avgWinPercent,
      avgLossPercent,
      largestWin,
      largestLoss,
      maxDrawdown,
      maxDrawdownPercent,
      avgDrawdown,
      totalCommissions,
      totalSlippage,
      bySymbol,
      byMonth,
      equityCurve
    };
  }

  private static calculateEquityCurve(trades: Trade[], initialBalance: number) {
    const equityCurve: Array<{ date: Date; balance: Decimal; drawdown: Decimal }> = [];
    let balance = new Decimal(initialBalance);
    let peak = balance;
    let maxDrawdown = new Decimal(0);
    let drawdownSum = new Decimal(0);
    let drawdownCount = 0;

    for (const trade of trades) {
      if (!trade.exitTime) continue;

      balance = balance.add(trade.pnl);
      
      // Actualizar peak
      if (balance.gt(peak)) {
        peak = balance;
      }

      // Calcular drawdown
      const drawdown = peak.sub(balance);
      const drawdownPercent = peak.toNumber() > 0 ? drawdown.div(peak).mul(100) : new Decimal(0);

      if (drawdown.gt(0)) {
        drawdownSum = drawdownSum.add(drawdown);
        drawdownCount++;
      }

      if (drawdown.gt(maxDrawdown)) {
        maxDrawdown = drawdown;
      }

      equityCurve.push({
        date: trade.exitTime,
        balance,
        drawdown
      });
    }

    const maxDrawdownPercent = initialBalance > 0 
      ? (maxDrawdown.toNumber() / initialBalance) * 100 
      : 0;

    const avgDrawdown = drawdownCount > 0 
      ? drawdownSum.div(drawdownCount) 
      : new Decimal(0);

    return { equityCurve, maxDrawdown, maxDrawdownPercent, avgDrawdown };
  }

  private static calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Anualizado (asumiendo 252 trading days)
    return (avgReturn / stdDev) * Math.sqrt(252);
  }

  private static calculateSortinoRatio(returns: number[]): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const negativeReturns = returns.filter(r => r < 0);
    
    if (negativeReturns.length === 0) return 999;

    const downside = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
    const downsideStdDev = Math.sqrt(downside);

    if (downsideStdDev === 0) return 999;

    return (avgReturn / downsideStdDev) * Math.sqrt(252);
  }

  private static calculateBySymbol(trades: Trade[]): Record<string, SymbolMetrics> {
    const bySymbol: Record<string, SymbolMetrics> = {};

    for (const trade of trades) {
      if (!bySymbol[trade.symbol]) {
        bySymbol[trade.symbol] = {
          symbol: trade.symbol,
          trades: 0,
          winRate: 0,
          totalPnl: new Decimal(0),
          profitFactor: 0,
          avgConfidence: 0
        };
      }

      const metrics = bySymbol[trade.symbol];
      metrics.trades++;
      metrics.totalPnl = metrics.totalPnl.add(trade.pnl);
      metrics.avgConfidence += trade.confidence;
    }

    // Calcular promedios y ratios
    for (const symbol in bySymbol) {
      const metrics = bySymbol[symbol];
      const symbolTrades = trades.filter(t => t.symbol === symbol);
      const wins = symbolTrades.filter(t => t.status === 'WIN');
      const losses = symbolTrades.filter(t => t.status === 'LOSS');

      metrics.winRate = (wins.length / symbolTrades.length) * 100;
      metrics.avgConfidence = metrics.avgConfidence / symbolTrades.length;

      const totalWins = wins.reduce((sum, t) => sum.add(t.pnl), new Decimal(0));
      const totalLosses = losses.reduce((sum, t) => sum.add(t.pnl.abs()), new Decimal(0));
      metrics.profitFactor = totalLosses.toNumber() > 0 
        ? totalWins.div(totalLosses).toNumber() 
        : totalWins.toNumber() > 0 ? 999 : 0;
    }

    return bySymbol;
  }

  private static calculateByMonth(trades: Trade[]): Record<string, MonthlyMetrics> {
    const byMonth: Record<string, MonthlyMetrics> = {};

    for (const trade of trades) {
      if (!trade.exitTime) continue;

      const monthKey = `${trade.exitTime.getFullYear()}-${String(trade.exitTime.getMonth() + 1).padStart(2, '0')}`;
      
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = {
          month: monthKey,
          trades: 0,
          winRate: 0,
          pnl: new Decimal(0)
        };
      }

      const metrics = byMonth[monthKey];
      metrics.trades++;
      metrics.pnl = metrics.pnl.add(trade.pnl);
    }

    // Calcular win rate por mes
    for (const monthKey in byMonth) {
      const monthTrades = trades.filter(t => {
        if (!t.exitTime) return false;
        const tKey = `${t.exitTime.getFullYear()}-${String(t.exitTime.getMonth() + 1).padStart(2, '0')}`;
        return tKey === monthKey;
      });
      
      const wins = monthTrades.filter(t => t.status === 'WIN');
      byMonth[monthKey].winRate = (wins.length / monthTrades.length) * 100;
    }

    return byMonth;
  }
}
