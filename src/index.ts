import DerivAPI from '@deriv/deriv-api';
import dotenv from 'dotenv';
import prisma from './database/prisma.client';
import { IndicatorsService } from './services/indicators.service';
import FeaturesService from './services/features.service';

dotenv.config();

const APP_ID = parseInt(process.env.DERIV_APP_ID || '0');
const API_TOKEN = process.env.DERIV_API_TOKEN || '';

async function main() {
  console.log('🚀 Iniciando sistema de trading ML...\n');

  const connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
  const api = new DerivAPI({ connection });

  connection.onopen = async () => {
    try {
      console.log('🔌 Conexión establecida');
      console.log('🔑 Autorizando...');
      
      connection.send(JSON.stringify({
        authorize: API_TOKEN
      }));

    } catch (error: any) {
      console.error('❌ Error en autorización:', error.message);
      connection.close();
      await prisma.$disconnect();
      process.exit(1);
    }
  };

  let authorized = false;

  connection.onmessage = async (msg) => {
    try {
      const data = JSON.parse(msg.data.toString());
      
      if (data.authorize && !authorized) {
        authorized = true;
        console.log(`✅ Usuario: ${data.authorize.email}`);
        console.log(`✅ Balance: ${data.authorize.balance} ${data.authorize.currency}\n`);

        console.log('📊 Descargando velas históricas de R_10 (1 minuto)...');
        
        connection.send(JSON.stringify({
          ticks_history: 'R_10',
          count: 500, // Aumentamos a 500 para tener más datos
          end: 'latest',
          style: 'candles',
          granularity: 60
        }));
      }

      if (data.candles) {
        const candles = data.candles;
        console.log(`✅ Descargadas ${candles.length} velas\n`);

        console.log('💾 Guardando velas en SQLite...');
        let savedCount = 0;

        for (const candle of candles) {
          await prisma.candle.upsert({
            where: {
              symbol_epoch_timeframe: {
                symbol: 'R_10',
                epoch: BigInt(candle.epoch),
                timeframe: '1m',
              },
            },
            create: {
              symbol: 'R_10',
              epoch: BigInt(candle.epoch),
              open: Number(candle.open),
              high: Number(candle.high),
              low: Number(candle.low),
              close: Number(candle.close),
              timeframe: '1m',
            },
            update: {
              open: Number(candle.open),
              high: Number(candle.high),
              low: Number(candle.low),
              close: Number(candle.close),
            },
          });
          savedCount++;
        }
        console.log(`✅ ${savedCount} velas guardadas\n`);

        // Calcular indicadores
        const indicatorsService = new IndicatorsService();
        await indicatorsService.calculateIndicators('R_10', '1m', 500);

        // ============================================
        // NUEVO: GENERAR FEATURES DE ML
        // ============================================
        const featuresService = new FeaturesService();
        await featuresService.generateFeatures('R_10', '1m');
        
        // Exportar a CSV para entrenamiento
        await featuresService.exportToCSV('R_10', '1m', 'training_data.csv');

        // Mostrar algunas features de ejemplo
        console.log('\n📊 Ejemplos de features generadas:\n');
        const sampleFeatures = await prisma.mLFeature.findMany({
          take: 3,
          orderBy: { epoch: 'desc' },
        });

        for (const feature of sampleFeatures) {
          const date = new Date(Number(feature.epoch) * 1000);
          console.log(`${date.toLocaleTimeString()}`);
          console.log(`  Close Price: ${feature.closePrice.toFixed(2)}`);
          console.log(`  RSI Normalized: ${feature.rsiNormalized?.toFixed(3) || 'N/A'}`);
          console.log(`  BB Position: ${feature.bbPosition?.toFixed(3) || 'N/A'}`);
          console.log(`  Trend Direction: ${feature.trendDirection === 1 ? 'UP' : feature.trendDirection === -1 ? 'DOWN' : 'NEUTRAL'}`);
          console.log(`  Bullish Pattern: ${feature.isBullishEngulfing ? 'YES' : 'NO'}`);
          console.log(`  Volatility: ${feature.volatilityRegime}`);
          console.log(`  Target (1m): ${feature.priceDirectionNext1m === 1 ? 'UP' : feature.priceDirectionNext1m === -1 ? 'DOWN' : 'NEUTRAL'}`);
          console.log(`  Profit Potential: ${feature.profitPotential?.toFixed(3)}%`);
          console.log('');
        }

        console.log('\n🎉 Pipeline completo ejecutado!');
        console.log(`📊 Velas: ${await prisma.candle.count()}`);
        console.log(`📈 Indicadores: ${await prisma.indicator.count()}`);
        console.log(`🧠 Features ML: ${await prisma.mLFeature.count()}\n`);

        connection.close();
        await prisma.$disconnect();
        process.exit(0);
      }

      if (data.error) {
        console.error('❌ Error de API:', data.error.message);
        connection.close();
        await prisma.$disconnect();
        process.exit(1);
      }

    } catch (error: any) {
      console.error('❌ Error procesando respuesta:', error.message);
      connection.close();
      await prisma.$disconnect();
      process.exit(1);
    }
  };

  connection.onerror = async (error) => {
    console.error('❌ Error de conexión:', error);
    await prisma.$disconnect();
    process.exit(1);
  };
}

main();
