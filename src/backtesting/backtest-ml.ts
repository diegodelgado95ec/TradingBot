import { PrismaClient }                          from '@prisma/client';
import { spawn, ChildProcessWithoutNullStreams }  from 'child_process';
import { createInterface }                        from 'readline';
import Decimal                                    from 'decimal.js';
import * as fs                                    from 'fs/promises';
import * as path                                  from 'path';
import { AdaptiveParamsCalculator }               from '../utils/adaptive-params';
import { TradeSimulator, Trade }                  from './trade-simulator';
import { MetricsCalculator, BacktestMetrics }     from './metrics-calculator';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

interface BacktestConfig {
  symbols:        string[];
  startDate:      Date;
  endDate:        Date;
  initialBalance: number;
  minConfidence:  number;
  maxOpenTrades:  number;
  slippagePips:   number;   // ← commissionPercent eliminado
  timeframe:      string;
}

interface IndicatorSnapshot {
  rsi?:           number;
  macd?:          number;
  macdSignal?:    number;
  macdHistogram?: number;
  bbUpper?:       number;
  bbMiddle?:      number;
  bbLower?:       number;
  ema9?:          number;
  ema21?:         number;
  ema50?:         number;
  stochK?:        number;
  stochD?:        number;
  atr?:           number;
}

interface CandleWithIndicators {
  id:         number;
  symbol:     string;
  timestamp:  Date;
  open:       number;
  high:       number;
  low:        number;
  close:      number;
  volume:     number;
  indicators: IndicatorSnapshot;
}

interface Prediction {
  prediction:    number;   // 0=DOWN, 1=NEUTRAL, 2=UP
  confidence:    number;
  probabilities: [number, number, number];
}

// ─────────────────────────────────────────────
// Proceso Python persistente (singleton por backtest)
// ─────────────────────────────────────────────

class MLPredictor {
  private process:          ChildProcessWithoutNullStreams | null = null;
  private ready:            boolean = false;
  private pendingResolvers: Array<(line: string) => void> = [];

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn('python', ['predict_server.py'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.on('error', (err) => reject(err));

      this.process.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.error(`  ⚠️  Python stderr: ${msg}`);
      });

      const rl = createInterface({ input: this.process.stdout });

      rl.on('line', (line: string) => {
        if (!this.ready) {
          if (line.trim() === 'READY') {
            this.ready = true;
            resolve();
          }
          return;
        }
        const resolver = this.pendingResolvers.shift();
        if (resolver) resolver(line);
      });
    });
  }

  private sendChunk(featuresChunk: Record<string, number>[]): Promise<(Prediction | null)[]> {
    if (!this.process || !this.ready) {
      throw new Error('MLPredictor no inicializado. Llama initialize() primero.');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout esperando respuesta de Python (60s)'));
      }, 60_000);

      this.pendingResolvers.push((line: string) => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(line);
          if (parsed.error) {
            reject(new Error(`Python error: ${parsed.error}`));
          } else {
            resolve(parsed as Prediction[]);
          }
        } catch (e) {
          reject(new Error(`Parse error en respuesta Python: ${e}`));
        }
      });

      this.process!.stdin.write(JSON.stringify(featuresChunk) + '\n');
    });
  }

  /**
   * Predice en chunks de 8K — modelo cargado UNA sola vez en memoria.
   * No re-lanza el proceso Python entre chunks (elimina ~3s de overhead por chunk).
   */
  async batchPredict(
    candles:         CandleWithIndicators[],
    prepareFeatures: (c: CandleWithIndicators, history: SymbolHistory) => Record<string, number>,
    history:         SymbolHistory
  ): Promise<(Prediction | null)[]> {
    const CHUNK_SIZE = 8_000;
    const results:   (Prediction | null)[] = [];
    const total =    candles.length;

    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk    = candles.slice(i, i + CHUNK_SIZE);
      const chunkEnd = Math.min(i + CHUNK_SIZE, total);

      process.stdout.write(
        `\r  🤖 Predicciones: ${chunkEnd.toLocaleString()}/${total.toLocaleString()} velas...`
      );

      // prepareFeatures actualiza el historial de forma secuencial dentro del chunk
      const features     = chunk.map(c => prepareFeatures(c, history));
      const chunkResults = await this.sendChunk(features);
      results.push(...chunkResults);
    }

    process.stdout.write('\n');
    return results;
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      try {
        this.process.stdin.write('EXIT\n');
        this.process.stdin.end();
        await new Promise<void>(r => this.process!.on('close', r));
      } catch (_) { /* proceso ya cerrado */ }
      this.process = null;
      this.ready   = false;
    }
  }
}

// ─────────────────────────────────────────────
// Historial por símbolo (desacoplado de la clase)
// ─────────────────────────────────────────────

interface SymbolHistory {
  prices: number[];
  rsis:   number[];
}

function freshHistory(): SymbolHistory {
  return { prices: [], rsis: [] };
}

// ─────────────────────────────────────────────
// Feature engineering (función pura — recibe historial explícito)
// ─────────────────────────────────────────────

function prepareFeatures(
  candle:  CandleWithIndicators,
  history: SymbolHistory
): Record<string, number> {
  const ind   = candle.indicators;
  const close = candle.close;
  const rsi   = ind.rsi ?? 50;

  history.prices.push(close);
  history.rsis.push(rsi);
  if (history.prices.length > 25) history.prices.shift();
  if (history.rsis.length   > 25) history.rsis.shift();

  const prices = history.prices;
  const rsis   = history.rsis;
  const n      = prices.length;

  const close_lag1 = n >= 2 ? prices[n - 2] : close;
  const close_lag2 = n >= 3 ? prices[n - 3] : close;
  const close_lag3 = n >= 4 ? prices[n - 4] : close;
  const close_lag5 = n >= 6 ? prices[n - 6] : close;
  const rsi_lag1   = n >= 2 ? rsis[n - 2]   : rsi;
  const rsi_lag2   = n >= 3 ? rsis[n - 3]   : rsi;

  const sma = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : close;

  const std = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = sma(arr);
    return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length);
  };

  const last5  = prices.slice(-5);
  const last10 = prices.slice(-10);
  const last20 = prices.slice(-20);

  const bbRange     = (ind.bbUpper ?? close) - (ind.bbLower ?? close);
  const bb_position = bbRange !== 0
    ? (close - (ind.bbLower ?? close)) / bbRange
    : 0.5;

  const safe = (val: number, fallback: number) =>
    isFinite(val) && !isNaN(val) ? val : fallback;

  return {
    open:                  candle.open,
    high:                  candle.high,
    low:                   candle.low,
    close,
    rsi,
    macd:                  ind.macd          ?? 0,
    macdSignal:            ind.macdSignal    ?? 0,
    macdHistogram:         ind.macdHistogram ?? 0,
    bbUpper:               ind.bbUpper       ?? close,
    bbMiddle:              ind.bbMiddle      ?? close,
    bbLower:               ind.bbLower       ?? close,
    ema9:                  ind.ema9          ?? close,
    ema21:                 ind.ema21         ?? close,
    ema50:                 ind.ema50         ?? close,
    stochK:                ind.stochK        ?? 50,
    stochD:                ind.stochD        ?? 50,
    atr:                   ind.atr           ?? 0.001,
    close_lag1,
    close_lag2,
    close_lag3,
    rsi_lag1,
    rsi_lag2,
    volume_change:         0,
    price_change_1:        safe(close_lag1 !== 0 ? (close - close_lag1) / close_lag1 : 0, 0),
    price_change_3:        safe(close_lag3 !== 0 ? (close - close_lag3) / close_lag3 : 0, 0),
    price_change_5:        safe(close_lag5 !== 0 ? (close - close_lag5) / close_lag5 : 0, 0),
    close_sma_5:           sma(last5),
    close_sma_10:          sma(last10),
    close_sma_20:          sma(last20),
    close_std_5:           std(last5),
    close_std_10:          std(last10),
    high_low_ratio:        safe(candle.low !== 0 ? (candle.high - candle.low) / candle.low : 0, 0),
    close_to_ema9_ratio:   safe((ind.ema9  ?? close) !== 0 ? (close - (ind.ema9  ?? close)) / (ind.ema9  ?? close) : 0, 0),
    close_to_ema21_ratio:  safe((ind.ema21 ?? close) !== 0 ? (close - (ind.ema21 ?? close)) / (ind.ema21 ?? close) : 0, 0),
    rsi_momentum:          rsi - rsi_lag1,
    macd_momentum:         (ind.macd ?? 0) - (ind.macdSignal ?? 0),
    bb_position,
    stoch_momentum:        (ind.stochK ?? 50) - (ind.stochD ?? 50),
  };
}

// ─────────────────────────────────────────────
// Carga de velas con paginación (fix error Prisma)
// ─────────────────────────────────────────────

async function loadCandlesForSymbol(
  symbol:     string,
  startEpoch: number,
  endEpoch:   number,
  timeframe:  string
): Promise<CandleWithIndicators[]> {
  const CHUNK_SIZE = 50_000;
  const result:    CandleWithIndicators[] = [];
  let   skip =     0;

  while (true) {
    const rows = await prisma.candle.findMany({
      where: {
        symbol,
        timeframe,
        epoch: { gte: startEpoch, lte: endEpoch },
        // ← Fix: excluir velas sin indicadores (causa del error napi string)
        indicators: {
          some: {
            rsi:  { not: null },
            ema9: { not: null },
          }
        }
      },
      include:  { indicators: { take: 1 } },
      orderBy:  { epoch: 'asc' },
      skip,
      take:     CHUNK_SIZE,
    });

    if (rows.length === 0) break;

    for (const c of rows) {
      const ind = c.indicators[0];
      result.push({
        id:        c.id,
        symbol:    c.symbol,
        timestamp: new Date(c.epoch * 1000),
        open:      c.open,
        high:      c.high,
        low:       c.low,
        close:     c.close,
        volume:    0,
        indicators: {
          rsi:           ind?.rsi           ?? undefined,
          macd:          ind?.macd          ?? undefined,
          macdSignal:    ind?.macdSignal    ?? undefined,
          macdHistogram: ind?.macdHistogram ?? undefined,
          bbUpper:       ind?.bbUpper       ?? undefined,
          bbMiddle:      ind?.bbMiddle      ?? undefined,
          bbLower:       ind?.bbLower       ?? undefined,
          ema9:          ind?.ema9          ?? undefined,
          ema21:         ind?.ema21         ?? undefined,
          ema50:         ind?.ema50         ?? undefined,
          stochK:        ind?.stochK        ?? undefined,
          stochD:        ind?.stochD        ?? undefined,
          atr:           ind?.atr           ?? undefined,
        }
      });
    }

    skip += CHUNK_SIZE;
    // Pequeña pausa para no saturar SQLite entre chunks grandes
    if (skip % 200_000 === 0) await new Promise(r => setTimeout(r, 20));
  }

  return result;
}

// ─────────────────────────────────────────────
// MLBacktester
// ─────────────────────────────────────────────

export class MLBacktester {
  private config:       BacktestConfig;
  private simulator:    TradeSimulator;
  private predictor:    MLPredictor;
  private balance:      Decimal;
  private openTrades:   Trade[] = [];
  private closedTrades: Trade[] = [];

  constructor(config: Partial<BacktestConfig> = {}) {
    this.config = {
      symbols:        config.symbols        ?? ['frxEURUSD','frxGBPUSD','frxUSDJPY','frxGBPJPY','frxAUDUSD'],
      startDate:      config.startDate      ?? new Date('2020-01-01'),
      endDate:        config.endDate        ?? new Date('2025-12-31'),
      initialBalance: config.initialBalance ?? 10_000,
      minConfidence:  config.minConfidence  ?? 0.65,
      maxOpenTrades:  config.maxOpenTrades  ?? 3,
      slippagePips:   config.slippagePips   ?? 0.5,
      timeframe:      config.timeframe      ?? '60',
    };

    this.simulator = new TradeSimulator({
      slippagePips:    this.config.slippagePips,
      fixedCommission: 0.07,
    });

    this.predictor = new MLPredictor();
    this.balance   = new Decimal(this.config.initialBalance);
  }

  async run(): Promise<BacktestMetrics> {
    console.log('🚀 Iniciando Backtest ML...\n');
    console.log('📊 Configuración:');
    console.log(`  - Símbolos:    ${this.config.symbols.join(', ')}`);
    console.log(`  - Período:     ${this.config.startDate.toISOString().split('T')[0]} → ${this.config.endDate.toISOString().split('T')[0]}`);
    console.log(`  - Balance:     $${this.config.initialBalance}`);
    console.log(`  - Confianza:   ${(this.config.minConfidence * 100).toFixed(0)}%`);
    console.log(`  - Max trades:  ${this.config.maxOpenTrades}\n`);

    // Inicializar proceso Python UNA sola vez para todos los símbolos
    console.log('  🐍 Cargando modelo Python...');
    await this.predictor.initialize();
    console.log('  ✅ Modelo listo\n');

    try {
      for (const symbol of this.config.symbols) {
        console.log(`\n🔄 Procesando ${symbol}...`);
        await this.processSymbol(symbol);
      }
    } finally {
      // Garantizar cierre del proceso Python incluso si hay error
      await this.predictor.shutdown();
    }

    this.closeAllOpenTrades();

    console.log('\n📊 Calculando métricas...');
    const metrics = MetricsCalculator.calculate(this.closedTrades, this.config.initialBalance);
    await this.generateReports(metrics, this.closedTrades);

    return metrics;
  }

  private async processSymbol(symbol: string): Promise<void> {
    const startEpoch = Math.floor(this.config.startDate.getTime() / 1000);
    const endEpoch   = Math.floor(this.config.endDate.getTime()   / 1000);

    console.log(`  📥 Cargando velas...`);
    const candles = await loadCandlesForSymbol(symbol, startEpoch, endEpoch, this.config.timeframe);

    if (candles.length === 0) {
      console.log(`  ⚠️  Sin datos para ${symbol}`);
      return;
    }
    console.log(`  ✅ ${candles.length.toLocaleString()} velas cargadas`);

    // ← Historial NUEVO por símbolo — evita contaminación entre pares
    const history = freshHistory();

    const predictions = await this.predictor.batchPredict(candles, prepareFeatures, history);
    console.log(`  ✅ Predicciones listas — simulando trades...`);

    await this.simulateSymbol(symbol, candles, predictions);
  }

  private async simulateSymbol(
    symbol:      string,
    candles:     CandleWithIndicators[],
    predictions: (Prediction | null)[]
  ): Promise<void> {
    for (let i = 50; i < candles.length; i++) {
      const candle     = candles[i];
      const prediction = predictions[i];

      this.updateOpenTrades(candle);

      if (!prediction)                                           continue;
      if (prediction.confidence < this.config.minConfidence)    continue;
      if (prediction.prediction === 1)                          continue; // NEUTRAL
      if (this.openTrades.length >= this.config.maxOpenTrades)  continue;

      const direction     = prediction.prediction === 2 ? 'UP' : 'DOWN';
      const atr           = candle.indicators.atr ?? 0.001;
      const recentCandles = candles.slice(Math.max(0, i - 24), i);
      const recentVol     = AdaptiveParamsCalculator.calculateRecentVolatility(recentCandles);
      const params        = AdaptiveParamsCalculator.calculate(
        symbol, candle.close, atr,
        this.balance.toNumber(), recentVol
      );

      if (!params.viable || params.stake.lte(0))     continue;
      if (params.stake.gt(this.balance))             continue;

      const trade = this.simulator.openTrade(
        symbol, direction, candle.timestamp, candle.close,
        params.stake, params.stopLoss, params.takeProfit, prediction.confidence
      );

      this.openTrades.push(trade);
      this.balance = this.balance.sub(params.stake);
    }

    const closed  = this.closedTrades.filter(t => t.symbol === symbol);
    const wins    = closed.filter(t => t.status === 'WIN').length;
    const winRate = closed.length > 0 ? (wins / closed.length * 100).toFixed(1) : '0';
    console.log(`  📊 Cerrados: ${closed.length} | WR: ${winRate}% | Balance: $${this.balance.toFixed(2)}`);
  }

  private updateOpenTrades(candle: CandleWithIndicators): void {
    for (const trade of this.openTrades.filter(t => t.symbol === candle.symbol)) {
      const updated = this.simulator.updateTrade(
        trade, candle.timestamp, candle.high, candle.low, candle.close
      );

      if (updated.status !== 'OPEN') {
        this.balance = this.balance.add(updated.stake).add(updated.pnl);
        this.closedTrades.push(updated);
        this.openTrades = this.openTrades.filter(t => t.id !== updated.id);
      }
    }
  }

  private closeAllOpenTrades(): void {
    if (this.openTrades.length === 0) return;
    console.log(`\n⚠️  Cerrando ${this.openTrades.length} trades abiertos al precio actual...`);

    for (const trade of this.openTrades) {
      const closed = this.simulator.closeTrade(
        trade, this.config.endDate, trade.entryPrice.toNumber()
      );
      this.balance = this.balance.add(closed.stake).add(closed.pnl);
      this.closedTrades.push(closed);
    }
    this.openTrades = [];
  }

  // ─── Reportes ─────────────────────────────

  private async generateReports(metrics: BacktestMetrics, trades: Trade[]): Promise<void> {
    const ts         = new Date().toISOString().replace(/[:.]/g, '-');
    const reportsDir = path.join(process.cwd(), 'backtest-results');
    await fs.mkdir(reportsDir, { recursive: true });

    const toNum = (v: Decimal) => v.toNumber();

    const summary = {
      config:  this.config,
      metrics: {
        ...metrics,
        totalPnl:         toNum(metrics.totalPnl),
        avgWin:           toNum(metrics.avgWin),
        avgLoss:          toNum(metrics.avgLoss),
        largestWin:       toNum(metrics.largestWin),
        largestLoss:      toNum(metrics.largestLoss),
        maxDrawdown:      toNum(metrics.maxDrawdown),
        avgDrawdown:      toNum(metrics.avgDrawdown),
        totalCommissions: toNum(metrics.totalCommissions),
        totalSlippage:    toNum(metrics.totalSlippage),
        bySymbol: Object.fromEntries(
          Object.entries(metrics.bySymbol).map(([k, v]) => [k, { ...v, totalPnl: toNum(v.totalPnl) }])
        ),
        byMonth: Object.fromEntries(
          Object.entries(metrics.byMonth).map(([k, v]) => [k, { ...v, pnl: toNum(v.pnl) }])
        ),
      },
      finalBalance: this.balance.toNumber(),
    };

    const paths = {
      summary:    path.join(reportsDir, `summary_${ts}.json`),
      trades:     path.join(reportsDir, `trades_${ts}.csv`),
      equity:     path.join(reportsDir, `equity_curve_${ts}.csv`),
      bySymbol:   path.join(reportsDir, `by_symbol_${ts}.csv`),
    };

    await Promise.all([
      fs.writeFile(paths.summary,  JSON.stringify(summary, null, 2)),
      fs.writeFile(paths.trades,   this.tradesToCSV(trades)),
      fs.writeFile(paths.equity,   this.equityCurveToCSV(metrics.equityCurve)),
      fs.writeFile(paths.bySymbol, this.symbolMetricsToCSV(metrics.bySymbol)),
    ]);

    console.log('\n✅ Reportes guardados en backtest-results/');
    this.printSummary(metrics);
  }

  private tradesToCSV(trades: Trade[]): string {
    const h = ['ID','Symbol','Direction','Entry Time','Entry Price',
                'Exit Time','Exit Price','Stake','Stop Loss','Take Profit',
                'Status','PnL','PnL %','Commission','Confidence'].join(',');
    const rows = trades.map(t => [
      t.id, t.symbol, t.direction,
      t.entryTime.toISOString(),
      t.entryPrice.toFixed(5),
      t.exitTime?.toISOString() ?? '',
      t.exitPrice?.toFixed(5)  ?? '',
      t.stake.toFixed(2),
      t.stopLoss.toFixed(5),
      t.takeProfit.toFixed(5),
      t.status,
      t.pnl.toFixed(2),
      t.pnlPercent.toFixed(2),
      t.commission.toFixed(2),
      (t.confidence * 100).toFixed(1),
    ].join(','));
    return [h, ...rows].join('\n');
  }

  private equityCurveToCSV(
    curve: Array<{ date: Date; balance: Decimal; drawdown: Decimal }>
  ): string {
    const h = ['Date','Balance','Drawdown'].join(',');
    const rows = curve.map(c => [
      c.date.toISOString(), c.balance.toFixed(2), c.drawdown.toFixed(2)
    ].join(','));
    return [h, ...rows].join('\n');
  }

  private symbolMetricsToCSV(bySymbol: Record<string, any>): string {
    const h = ['Symbol','Trades','Win Rate %','Total PnL','Profit Factor','Avg Confidence %'].join(',');
    const rows = Object.values(bySymbol).map((m: any) => [
      m.symbol, m.trades,
      m.winRate.toFixed(2),
      m.totalPnl.toFixed(2),
      m.profitFactor.toFixed(2),
      (m.avgConfidence * 100).toFixed(1),
    ].join(','));
    return [h, ...rows].join('\n');
  }

  private printSummary(metrics: BacktestMetrics): void {
    const sep = '='.repeat(60);
    console.log(`\n${sep}\n📊 RESUMEN DEL BACKTEST\n${sep}`);
    console.log(`\n🎯 Performance:`);
    console.log(`  Trades:         ${metrics.totalTrades}`);
    console.log(`  Win Rate:       ${metrics.winRate.toFixed(2)}%`);
    console.log(`  Profit Factor:  ${metrics.profitFactor.toFixed(2)}`);
    console.log(`  Sharpe:         ${metrics.sharpeRatio.toFixed(2)}`);
    console.log(`  Sortino:        ${metrics.sortinoRatio.toFixed(2)}`);
    console.log(`\n💰 PnL:`);
    console.log(`  Total:          $${metrics.totalPnl.toFixed(2)} (${metrics.totalPnlPercent >= 0 ? '+' : ''}${metrics.totalPnlPercent.toFixed(2)}%)`);
    console.log(`  Balance final:  $${this.balance.toFixed(2)}`);
    console.log(`  Avg Win:        $${metrics.avgWin.toFixed(2)}`);
    console.log(`  Avg Loss:       $${metrics.avgLoss.toFixed(2)}`);
    console.log(`\n📉 Riesgo:`);
    console.log(`  Max Drawdown:   $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPercent.toFixed(2)}%)`);
    console.log(`\n💸 Costos:`);
    console.log(`  Comisiones:     $${metrics.totalCommissions.toFixed(2)}`);
    console.log(`  Slippage:       $${metrics.totalSlippage.toFixed(2)}`);
    console.log(`\n📈 Por símbolo:`);
    for (const [sym, m] of Object.entries(metrics.bySymbol)) {
      const pnl = (m.totalPnl as Decimal).toFixed(2);
      console.log(`  ${sym.padEnd(12)} ${String(m.trades).padStart(5)} trades | WR ${m.winRate.toFixed(1).padStart(5)}% | $${pnl} | PF ${m.profitFactor.toFixed(2)}`);
    }
    console.log(`\n${sep}`);
  }
}

// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────

async function main() {
  const backtester = new MLBacktester({
    symbols:        ['frxEURUSD','frxGBPUSD','frxUSDJPY','frxGBPJPY','frxAUDUSD'],
    startDate:      new Date('2024-01-01'),
    endDate:        new Date('2025-12-31'),
    initialBalance: 10_000,
    minConfidence:  0.70,
    maxOpenTrades:  2,
    slippagePips:   0.3,
    timeframe:      '60',
  });

  try {
    const metrics = await backtester.run();
    console.log('\n✅ Backtest completado');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error en backtest:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();