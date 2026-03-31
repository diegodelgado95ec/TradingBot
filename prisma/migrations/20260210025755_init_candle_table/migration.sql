/*
  Warnings:

  - You are about to drop the `candles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `indicators` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ml_features` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `model_performance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rl_experiences` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ticks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `trades` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "candles";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "indicators";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ml_features";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "model_performance";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "rl_experiences";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ticks";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "trades";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Candle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "epoch" BIGINT NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Indicator" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "candleId" INTEGER NOT NULL,
    "rsi" REAL NOT NULL,
    "macd" REAL NOT NULL,
    "macdSignal" REAL NOT NULL,
    "macdHistogram" REAL NOT NULL,
    "bbUpper" REAL,
    "bbMiddle" REAL,
    "bbLower" REAL,
    "bbPercentB" REAL,
    "bbWidth" REAL,
    "ema9" REAL,
    "ema21" REAL,
    "ema50" REAL,
    "stochK" REAL NOT NULL,
    "stochD" REAL NOT NULL,
    "atr" REAL,
    CONSTRAINT "Indicator_candleId_fkey" FOREIGN KEY ("candleId") REFERENCES "Candle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Candle_symbol_timeframe_epoch_idx" ON "Candle"("symbol", "timeframe", "epoch");

-- CreateIndex
CREATE INDEX "Candle_symbol_timeframe_idx" ON "Candle"("symbol", "timeframe");

-- CreateIndex
CREATE INDEX "Candle_epoch_idx" ON "Candle"("epoch");

-- CreateIndex
CREATE UNIQUE INDEX "Candle_symbol_timeframe_epoch_key" ON "Candle"("symbol", "timeframe", "epoch");

-- CreateIndex
CREATE INDEX "Indicator_candleId_idx" ON "Indicator"("candleId");

-- CreateIndex
CREATE UNIQUE INDEX "Indicator_candleId_key" ON "Indicator"("candleId");
