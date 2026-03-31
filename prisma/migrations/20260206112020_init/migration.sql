-- CreateTable
CREATE TABLE "ticks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "epoch" BIGINT NOT NULL,
    "quote" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "candles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "epoch" BIGINT NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL,
    "timeframe" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "indicators" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candleId" TEXT NOT NULL,
    "bbUpper" REAL,
    "bbMiddle" REAL,
    "bbLower" REAL,
    "bbWidth" REAL,
    "bbPercentB" REAL,
    "rsi" REAL,
    "macd" REAL,
    "macdSignal" REAL,
    "macdHistogram" REAL,
    "ema9" REAL,
    "ema21" REAL,
    "ema50" REAL,
    "stochK" REAL,
    "stochD" REAL,
    "atr" REAL,
    "vwap" REAL,
    "obv" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "indicators_candleId_fkey" FOREIGN KEY ("candleId") REFERENCES "candles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ml_features" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candleId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "epoch" BIGINT NOT NULL,
    "closePrice" REAL NOT NULL,
    "priceChangePct" REAL,
    "highLowRange" REAL,
    "closeOpenRatio" REAL,
    "rsiNormalized" REAL,
    "bbPosition" REAL,
    "macdStrength" REAL,
    "trendDirection" INTEGER,
    "isBullishEngulfing" BOOLEAN NOT NULL DEFAULT false,
    "isBearishEngulfing" BOOLEAN NOT NULL DEFAULT false,
    "candleBodySize" REAL,
    "upperShadowRatio" REAL,
    "lowerShadowRatio" REAL,
    "atrNormalized" REAL,
    "volatilityRegime" TEXT,
    "priceDirectionNext1m" INTEGER,
    "priceDirectionNext5m" INTEGER,
    "profitPotential" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ml_features_candleId_fkey" FOREIGN KEY ("candleId") REFERENCES "candles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entryEpoch" BIGINT NOT NULL,
    "entryPrice" REAL NOT NULL,
    "exitEpoch" BIGINT,
    "exitPrice" REAL,
    "quantity" REAL NOT NULL,
    "stopLoss" REAL NOT NULL,
    "takeProfit" REAL NOT NULL,
    "pnl" REAL,
    "pnlPercentage" REAL,
    "commission" REAL,
    "durationSeconds" INTEGER,
    "exitReason" TEXT,
    "mlConfidence" REAL,
    "wasProfitable" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "model_performance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelVersion" TEXT NOT NULL,
    "trainedAt" DATETIME NOT NULL,
    "trainingSamples" INTEGER NOT NULL,
    "validationAccuracy" REAL NOT NULL,
    "testAccuracy" REAL NOT NULL,
    "precision" REAL NOT NULL,
    "recall" REAL NOT NULL,
    "f1Score" REAL NOT NULL,
    "winRate" REAL,
    "profitFactor" REAL,
    "sharpeRatio" REAL,
    "maxDrawdown" REAL,
    "totalTrades" INTEGER,
    "avgWin" REAL,
    "avgLoss" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "rl_experiences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episode" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "stateFeatures" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reward" REAL NOT NULL,
    "nextStateFeatures" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ticks_symbol_epoch_idx" ON "ticks"("symbol", "epoch");

-- CreateIndex
CREATE INDEX "candles_symbol_timeframe_epoch_idx" ON "candles"("symbol", "timeframe", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "candles_symbol_epoch_timeframe_key" ON "candles"("symbol", "epoch", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "indicators_candleId_key" ON "indicators"("candleId");

-- CreateIndex
CREATE UNIQUE INDEX "ml_features_candleId_key" ON "ml_features"("candleId");

-- CreateIndex
CREATE INDEX "ml_features_symbol_epoch_idx" ON "ml_features"("symbol", "epoch");

-- CreateIndex
CREATE INDEX "trades_symbol_entryEpoch_idx" ON "trades"("symbol", "entryEpoch");

-- CreateIndex
CREATE INDEX "rl_experiences_episode_step_idx" ON "rl_experiences"("episode", "step");
