// src/trading/live-trader.ts
import { ChildProcess, spawn } from 'child_process';
import { createInterface } from 'readline';
import prisma from '../database/prisma.client';
import { IndicatorsService } from '../services/indicators.service';

const SYMBOL       = 'frxGBPJPY';
const DERIV_SYMBOL = 'frxGBPJPY';
const MIN_CONFIDENCE = 0.65;
const LOT_SIZE       = 0.01;   // micro-lot para demo
const MAX_OPEN_TRADES = 2;

interface Prediction {
  prediction:    number;   // 0=DOWN, 1=NEUTRAL, 2=UP
  confidence:    number;
  probabilities: number[];
}

interface OpenTrade {
  id:          string;
  direction:   'LONG' | 'SHORT';
  entryPrice:  number;
  stopLoss:    number;
  takeProfit:  number;
  entryEpoch:  number;
  contractId?: string;
}

const FEATURE_NAMES = [
  'open','high','low','close',
  'rsi','macd','macdSignal','macdHistogram',
  'bbUpper','bbMiddle','bbLower',
  'ema9','ema21','ema50','stochK','stochD','atr',
  'close_lag1','close_lag2','close_lag3',
  'rsi_lag1','rsi_lag2','volume_change',
  'price_change_1','price_change_3','price_change_5',
  'close_sma_5','close_sma_10','close_sma_20',
  'close_std_5','close_std_10',
  'high_low_ratio','close_to_ema9_ratio','close_to_ema21_ratio',
  'rsi_momentum','macd_momentum','bb_position','stoch_momentum'
];

export class LiveTrader {
  private pythonProcess:   ChildProcess | null = null;
  private pythonReady:     boolean = false;
  private pendingResolves: Map<string, (r: Prediction) => void> = new Map();
  private indicatorsService = new IndicatorsService();
  private openTrades:      OpenTrade[] = [];

  // Historial para calcular lag features en tiempo real
  private priceHistory: number[] = [];
  private rsiHistory:   number[] = [];

  // ══════════════════════════════════════
  // INICIAR SERVIDOR PYTHON
  // ══════════════════════════════════════
  async startPythonServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pythonProcess = spawn('python', ['predict_server.py'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const rl = createInterface({ input: this.pythonProcess.stdout! });

      rl.on('line', (line) => {
        line = line.trim();

        if (line === 'READY') {
          this.pythonReady = true;
          console.log('🐍 predict_server.py listo');
          resolve();
          return;
        }

        // Respuestas de predicción
        try {
          const results: Prediction[] = JSON.parse(line);
          // El servidor siempre responde 1 predicción en live
          const key = 'live';
          const resolver = this.pendingResolves.get(key);
          if (resolver) {
            this.pendingResolves.delete(key);
            resolver(results[0]);
          }
        } catch {
          // línea de error del servidor
          console.error('⚠️ Python error:', line);
        }
      });

      this.pythonProcess.stderr!.on('data', (d) =>
        process.stderr.write(`[Python] ${d}`)
      );

      this.pythonProcess.on('exit', (code) => {
        console.log(`⚠️ Python process exited with code ${code}`);
        this.pythonReady = false;
      });

      setTimeout(() => reject(new Error('Python server timeout')), 15_000);
    });
  }

  // ══════════════════════════════════════
  // PREDECIR CON UNA VELA
  // ══════════════════════════════════════
  private async predict(features: number[]): Promise<Prediction> {
    if (!this.pythonReady || !this.pythonProcess) {
      throw new Error('Python server not ready');
    }

    return new Promise((resolve) => {
      this.pendingResolves.set('live', resolve);
      const payload = JSON.stringify([features]) + '\n';
      this.pythonProcess!.stdin!.write(payload);
    });
  }

  // ══════════════════════════════════════
  // CONSTRUIR FEATURES DE UNA VELA
  // ══════════════════════════════════════
  private buildFeatures(candle: any, ind: any): number[] {
    const close = candle.close;
    const rsi   = ind.rsi ?? 50;

    this.priceHistory.push(close);
    this.rsiHistory.push(rsi);
    if (this.priceHistory.length > 25) this.priceHistory.shift();
    if (this.rsiHistory.length   > 25) this.rsiHistory.shift();

    const n = this.priceHistory.length;
    const h = this.priceHistory;
    const r = this.rsiHistory;

    const sma = (arr: number[]) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : close;
    const std = (arr: number[]) => {
      if (arr.length < 2) return 0;
      const m = sma(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };

    const lag1 = n >= 2 ? h[n-2] : close;
    const lag2 = n >= 3 ? h[n-3] : close;
    const lag3 = n >= 4 ? h[n-4] : close;
    const lag5 = n >= 6 ? h[n-6] : close;
    const rLag1 = n >= 2 ? r[n-2] : rsi;
    const rLag2 = n >= 3 ? r[n-3] : rsi;

    const bbRange    = (ind.bbUpper ?? close) - (ind.bbLower ?? close);
    const bbPosition = bbRange !== 0
      ? (close - (ind.bbLower ?? close)) / bbRange
      : 0.5;

    return [
      candle.open, candle.high, candle.low, close,
      rsi,
      ind.macd          ?? 0,
      ind.macdSignal    ?? 0,
      ind.macdHistogram ?? 0,
      ind.bbUpper       ?? close,
      ind.bbMiddle      ?? close,
      ind.bbLower       ?? close,
      ind.ema9          ?? close,
      ind.ema21         ?? close,
      ind.ema50         ?? close,
      ind.stochK        ?? 50,
      ind.stochD        ?? 50,
      ind.atr           ?? 0.001,
      lag1, lag2, lag3,
      rLag1, rLag2,
      0,   // volume_change
      lag1 !== 0 ? (close - lag1) / lag1 : 0,
      lag3 !== 0 ? (close - lag3) / lag3 : 0,
      lag5 !== 0 ? (close - lag5) / lag5 : 0,
      sma(h.slice(-5)),  sma(h.slice(-10)), sma(h.slice(-20)),
      std(h.slice(-5)),  std(h.slice(-10)),
      candle.low !== 0 ? (candle.high - candle.low) / candle.low : 0,
      (ind.ema9  ?? close) !== 0 ? (close - (ind.ema9  ?? close))  / (ind.ema9  ?? close)  : 0,
      (ind.ema21 ?? close) !== 0 ? (close - (ind.ema21 ?? close))  / (ind.ema21 ?? close)  : 0,
      rsi   - rLag1,
      (ind.macd ?? 0) - (ind.macdSignal ?? 0),
      bbPosition,
      (ind.stochK ?? 50) - (ind.stochD ?? 50),
    ];
  }

  // ══════════════════════════════════════
  // PROCESAR VELA NUEVA (llamado cada minuto)
  // ══════════════════════════════════════
  async onNewCandle(candle: any, derivApi: any): Promise<void> {
    // 1. Calcular indicadores y guardar en DB
    await this.indicatorsService.calculateIndicators(SYMBOL, '60', 60);

 const candleDb = await prisma.candle.findFirst({
      where:   { symbol: SYMBOL, timeframe: '60', epoch: Number(candle.epoch) },
      include: { indicators: true },
      orderBy: { epoch: 'desc' },
    });

    const ind = candleDb?.indicators?.[0];

    if (!ind?.rsi || !ind?.ema9) {
      console.log('⏳ Indicadores no disponibles aún...');
      return;
    }

    // 2. Construir features y predecir
    const features = this.buildFeatures(candle, ind);
    const pred     = await this.predict(features);

    const dirLabel = ['⬇️ DOWN', '➡️ NEUTRAL', '⬆️  UP'][pred.prediction];
    const time     = new Date().toLocaleTimeString();

    console.log(`\n[${time}] ${SYMBOL} | ${dirLabel} | Conf: ${(pred.confidence * 100).toFixed(1)}%`);

    // 3. Gestión de trades abiertos — cerrar si hay señal contraria
    await this.manageOpenTrades(candle.close, pred, derivApi);

    // 4. Abrir trade si señal direccional con alta confianza
    if (pred.confidence >= MIN_CONFIDENCE && pred.prediction !== 1) {
      if (this.openTrades.length < MAX_OPEN_TRADES) {
        await this.openTrade(candle, ind, pred, derivApi);
      } else {
        console.log('⏸️  Max trades abiertos alcanzado');
      }
    }
  }

  // ══════════════════════════════════════
  // ABRIR TRADE EN DERIV (DEMO)
  // ══════════════════════════════════════
  private async openTrade(
    candle: any,
    ind:    any,
    pred:   Prediction,
    api:    any
  ): Promise<void> {
    const direction = pred.prediction === 2 ? 'LONG' : 'SHORT';
    const atr       = ind.atr ?? (candle.close * 0.0002);
    const sl        = direction === 'LONG'
      ? candle.close - atr * 1.5
      : candle.close + atr * 1.5;
    const tp        = direction === 'LONG'
      ? candle.close + atr * 2.5
      : candle.close - atr * 2.5;

    console.log(`\n🎯 Abriendo ${direction} | Entry: ${candle.close} | SL: ${sl.toFixed(5)} | TP: ${tp.toFixed(5)}`);

    try {
      // ── Deriv API: pedir proposal ──────────────────────
      const proposal = await api.proposal({
        proposal:      1,
        amount:        10,           // $10 por trade en demo
        basis:         'stake',
        contract_type: direction === 'LONG' ? 'CALL' : 'PUT',
        currency:      'USD',
        duration:      5,
        duration_unit: 'm',
        symbol:        DERIV_SYMBOL,
      });

      if (proposal?.proposal?.id) {
        const buy = await api.buy({
          buy:   proposal.proposal.id,
          price: proposal.proposal.ask_price,
        });

        const trade: OpenTrade = {
          id:         buy.buy.contract_id.toString(),
          direction,
          entryPrice: candle.close,
          stopLoss:   sl,
          takeProfit: tp,
          entryEpoch: candle.epoch,
          contractId: buy.buy.contract_id.toString(),
        };

        this.openTrades.push(trade);

        // Guardar en DB
        await prisma.trade.create({
        data: {
          symbol:       SYMBOL,
          direction,
          entryEpoch:   Number(candle.epoch),   // ✅ Int
          entryPrice:   candle.close,
          quantity:     LOT_SIZE,
          stopLoss:     sl,
          takeProfit:   tp,
          mlConfidence: pred.confidence,
          contractId:   buy.buy.contract_id.toString(),
          status:       'OPEN',
        },
      });

        console.log(`✅ Trade abierto — Contract ID: ${buy.buy.contract_id}`);
      }
    } catch (err: any) {
      console.error('❌ Error al abrir trade:', err.message);
    }
  }

  // ══════════════════════════════════════
  // GESTIÓN DE TRADES ABIERTOS
  // ══════════════════════════════════════
  private async manageOpenTrades(
    currentPrice: number,
    pred: Prediction,
    api:  any
  ): Promise<void> {
    for (const trade of [...this.openTrades]) {
      const hitSL = trade.direction === 'LONG'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;
      const hitTP = trade.direction === 'LONG'
        ? currentPrice >= trade.takeProfit
        : currentPrice <= trade.takeProfit;

      // Señal contraria con alta confianza
      const reversal =
        (trade.direction === 'LONG'  && pred.prediction === 0 && pred.confidence >= MIN_CONFIDENCE) ||
        (trade.direction === 'SHORT' && pred.prediction === 2 && pred.confidence >= MIN_CONFIDENCE);

      if (hitSL || hitTP || reversal) {
        const reason = hitSL ? 'SL' : hitTP ? 'TP' : 'REVERSAL';
        console.log(`\n🔒 Cerrando trade ${trade.id} por ${reason} | Precio: ${currentPrice}`);
        this.openTrades = this.openTrades.filter(t => t.id !== trade.id);
      }
    }
  }

  // ══════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════
  stop(): void {
    if (this.pythonProcess) {
      this.pythonProcess.stdin!.write('EXIT\n');
      this.pythonProcess.kill();
    }
  }
}