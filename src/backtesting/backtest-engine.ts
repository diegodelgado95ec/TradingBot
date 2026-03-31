import prisma from '../database/prisma.client';
import { SignalGenerator } from '../trading/signal-generator';

interface Trade {
  id: number;
  entryTime: Date;
  exitTime: Date | null;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  pnl: number | null;
  pnlPercent: number | null;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'BREAKEVEN';
  exitReason: string | null;
  confidence: number;
}

interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number;
  totalPnL: number;
  totalPnLPercent: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  trades: Trade[];
}

class BacktestEngine {
  private signalGenerator: SignalGenerator;
  private trades: Trade[] = [];
  private tradeIdCounter = 1;
  private balance = 10000; // Capital inicial
  private initialBalance = 10000;
  private peakBalance = 10000;
  private maxDrawdown = 0;
  
  constructor() {
    this.signalGenerator = new SignalGenerator();
  }

  /**
   * Ejecuta backtesting en datos históricos
   */
  async runBacktest(
    symbol: string,
    startDate?: Date,
    endDate?: Date,
    positionSize: number = 0.02 // 2% del balance por trade
  ): Promise<BacktestResults> {
    console.log('\n🔙 INICIANDO BACKTESTING');
    console.log('='.repeat(60));
    console.log(`Símbolo:          ${symbol}`);
    console.log(`Capital inicial:  $${this.initialBalance.toLocaleString()}`);
    console.log(`Position size:    ${(positionSize * 100).toFixed(1)}% del balance`);
    console.log('='.repeat(60) + '\n');

    // Obtener todas las velas con indicadores
    const candles = await prisma.candle.findMany({
      where: {
        symbol,
        timeframe: '1m',
        ...(startDate && { createdAt: { gte: startDate } }),
        ...(endDate && { createdAt: { lte: endDate } }),
      },
      include: { indicators: true },
      orderBy: { epoch: 'asc' },
    });

    console.log(`📊 Procesando ${candles.length.toLocaleString()} velas...\n`);

    let openTrade: Trade | null = null;
    let candlesProcessed = 0;
    let signalsGenerated = 0;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      candlesProcessed++;

      // Mostrar progreso cada 1000 velas
      if (candlesProcessed % 1000 === 0) {
        const progress = (candlesProcessed / candles.length) * 100;
        console.log(`📈 Progreso: ${progress.toFixed(1)}% - Trades: ${this.trades.length} - Balance: $${this.balance.toFixed(2)}`);
      }

      // Si no tenemos indicadores, skip
      if (!candle.indicators || candle.indicators.length === 0) continue;


      // Verificar si hay trade abierto
      if (openTrade) {
        // Comprobar stop loss y take profit
        const shouldExit = this.checkExitConditions(openTrade, candle.close);
        
        if (shouldExit) {
          this.closeTrade(openTrade, candle.close, new Date(Number(candle.epoch) * 1000), shouldExit);
          openTrade = null;
        }
     } else {
  // Generar señal
        const ind = candle.indicators[0]; // 👈 Tomar el primer indicador
        
        if (!ind) continue; // Skip si no hay indicadores
        
        const signal = this.signalGenerator.generateSignal(candle.close, {
          rsi: ind.rsi,
          bbUpper: ind.bbUpper,
          bbMiddle: ind.bbMiddle,
          bbLower: ind.bbLower,
          bbPercentB: ind.bbPercentB,
          macd: ind.macd,
          macdSignal: ind.macdSignal,
          macdHistogram: ind.macdHistogram,
          ema9: ind.ema9,
          ema21: ind.ema21,
          ema50: ind.ema50,
          stochK: ind.stochK,
          stochD: ind.stochD,
          atr: ind.atr
        });
        
        if (signal.action !== 'HOLD' && signal.confidence >= 40) {
          signalsGenerated++;
          
          // Abrir trade
          const quantity = (this.balance * positionSize) / candle.close;
          
          openTrade = {
            id: this.tradeIdCounter++,
            entryTime: new Date(Number(candle.epoch) * 1000),
            exitTime: null,
            symbol,
            direction: signal.action === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: candle.close,
            exitPrice: null,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            pnl: null,
            pnlPercent: null,
            status: 'OPEN',
            exitReason: null,
            confidence: signal.confidence,
          };
        }
      }
    }

    // Cerrar trade abierto si quedó alguno
    if (openTrade) {
      const lastCandle = candles[candles.length - 1];
      this.closeTrade(openTrade, lastCandle.close, new Date(Number(lastCandle.epoch) * 1000), 'END_OF_DATA');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ BACKTESTING COMPLETADO');
    console.log('='.repeat(60) + '\n');

    return this.calculateResults();
  }

  /**
   * Verifica condiciones de salida
   */
  private checkExitConditions(trade: Trade, currentPrice: number): string | null {
    if (trade.direction === 'LONG') {
      if (currentPrice <= trade.stopLoss) return 'STOP_LOSS';
      if (currentPrice >= trade.takeProfit) return 'TAKE_PROFIT';
    } else {
      if (currentPrice >= trade.stopLoss) return 'STOP_LOSS';
      if (currentPrice <= trade.takeProfit) return 'TAKE_PROFIT';
    }
    return null;
  }

  /**
   * Cierra un trade
   */
  private closeTrade(trade: Trade, exitPrice: number, exitTime: Date, reason: string) {
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.exitReason = reason;

    // Calcular PnL
    if (trade.direction === 'LONG') {
      trade.pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
    } else {
      trade.pnlPercent = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
    }

    // Aplicar PnL al balance (2% position size)
    const positionValue = this.balance * 0.02;
    trade.pnl = (positionValue * trade.pnlPercent) / 100;
    this.balance += trade.pnl;

    // Actualizar drawdown
    if (this.balance > this.peakBalance) {
      this.peakBalance = this.balance;
    }
    const currentDrawdown = ((this.peakBalance - this.balance) / this.peakBalance) * 100;
    if (currentDrawdown > this.maxDrawdown) {
      this.maxDrawdown = currentDrawdown;
    }

    // Determinar status
    if (trade.pnlPercent! > 0.1) trade.status = 'WIN';
    else if (trade.pnlPercent! < -0.1) trade.status = 'LOSS';
    else trade.status = 'BREAKEVEN';

    this.trades.push(trade);
  }

  /**
   * Calcula resultados finales
   */
  private calculateResults(): BacktestResults {
    const winningTrades = this.trades.filter(t => t.status === 'WIN');
    const losingTrades = this.trades.filter(t => t.status === 'LOSS');
    const breakEvenTrades = this.trades.filter(t => t.status === 'BREAKEVEN');

    const totalPnL = this.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalPnLPercent = ((this.balance - this.initialBalance) / this.initialBalance) * 100;

    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    const winRate = this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0;

    // Calcular Sharpe Ratio (simplificado)
    const returns = this.trades.map(t => t.pnlPercent || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Anualizado

    return {
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      breakEvenTrades: breakEvenTrades.length,
      winRate,
      totalPnL,
      totalPnLPercent,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown: this.maxDrawdown,
      sharpeRatio,
      trades: this.trades,
    };
  }

  /**
   * Muestra resultados formateados
   */
  displayResults(results: BacktestResults) {
    console.log('📊 RESULTADOS DEL BACKTESTING\n');
    console.log('='.repeat(60));
    
    console.log('\n💰 RENDIMIENTO:');
    console.log(`  Balance inicial:    $${this.initialBalance.toLocaleString()}`);
    console.log(`  Balance final:      $${this.balance.toFixed(2).toLocaleString()}`);
    console.log(`  PnL Total:          $${results.totalPnL.toFixed(2)} (${results.totalPnLPercent >= 0 ? '+' : ''}${results.totalPnLPercent.toFixed(2)}%)`);
    console.log(`  Max Drawdown:       ${results.maxDrawdown.toFixed(2)}%`);
    console.log(`  Sharpe Ratio:       ${results.sharpeRatio.toFixed(2)}`);
    
    console.log('\n📈 TRADES:');
    console.log(`  Total:              ${results.totalTrades}`);
    console.log(`  Ganadores:          ${results.winningTrades} (${results.winRate.toFixed(1)}%)`);
    console.log(`  Perdedores:         ${results.losingTrades} (${((results.losingTrades/results.totalTrades)*100).toFixed(1)}%)`);
    console.log(`  Break-even:         ${results.breakEvenTrades}`);
    
    console.log('\n💵 PROMEDIOS:');
    console.log(`  Ganancia promedio:  $${results.avgWin.toFixed(2)}`);
    console.log(`  Pérdida promedio:   $${results.avgLoss.toFixed(2)}`);
    console.log(`  Profit Factor:      ${results.profitFactor.toFixed(2)}`);
    
    console.log('\n' + '='.repeat(60));
    
    // Evaluar performance
    console.log('\n🎯 EVALUACIÓN:\n');
    
    if (results.winRate >= 55) console.log('  ✅ Win rate aceptable (>55%)');
    else console.log('  ⚠️ Win rate bajo (<55%)');
    
    if (results.profitFactor >= 1.5) console.log('  ✅ Profit factor bueno (>1.5)');
    else console.log('  ⚠️ Profit factor bajo (<1.5)');
    
    if (results.maxDrawdown <= 20) console.log('  ✅ Drawdown controlado (<20%)');
    else console.log('  ⚠️ Drawdown alto (>20%)');
    
    if (results.totalPnLPercent > 0) console.log(`  ✅ Rentable (+${results.totalPnLPercent.toFixed(2)}%)`);
    else console.log(`  ❌ No rentable (${results.totalPnLPercent.toFixed(2)}%)`);
    
    console.log('');
  }

  /**
   * Guarda resultados en base de datos
   */
  async saveResults(results: BacktestResults) {
    console.log('💾 Guardando resultados en base de datos...');
    
    for (const trade of results.trades) {
      await prisma.trade.create({
        data: {
          symbol: trade.symbol,
          direction: trade.direction,
          entryEpoch: BigInt(Math.floor(trade.entryTime.getTime() / 1000)),
          entryPrice: trade.entryPrice,
          exitEpoch: trade.exitTime ? BigInt(Math.floor(trade.exitTime.getTime() / 1000)) : null,
          exitPrice: trade.exitPrice,
          quantity: 1,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          pnl: trade.pnl,
          pnlPercentage: trade.pnlPercent,
          exitReason: trade.exitReason,
          mlConfidence: trade.confidence,
          wasProfitable: trade.status === 'WIN',
        },
      });
    }
    
    console.log(`✅ ${results.trades.length} trades guardados\n`);
  }
}

export { BacktestEngine };