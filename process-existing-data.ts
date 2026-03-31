import prisma from './src/database/prisma.client';
import { IndicatorsService } from './src/services/indicators.service';
import FeaturesService from './src/services/features.service';

async function main() {
  console.log('🔄 PROCESANDO DATOS EXISTENTES\n');
  console.log('='.repeat(60));
  
  const count = await prisma.candle.count();
  console.log(`📊 Total de velas en DB: ${count.toLocaleString()}\n`);
  
  console.log('📈 PASO 1: Calculando indicadores técnicos...');
  const indicatorsService = new IndicatorsService();
  await indicatorsService.calculateIndicators('R_10', '1m', count);
  
  console.log('\n🧠 PASO 2: Generando features de ML...');
  const featuresService = new FeaturesService();
  await featuresService.generateFeatures('R_10', '1m');
  
  console.log('\n📤 PASO 3: Exportando dataset...');
  await featuresService.exportToCSV('R_10', '1m', 'training_data_30days.csv');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ PROCESAMIENTO COMPLETADO');
  console.log('='.repeat(60));
  
  const stats = {
    candles: await prisma.candle.count(),
    indicators: await prisma.indicator.count(),
    features: await prisma.mLFeature.count(),
  };
  
  console.log('\n📋 Resumen:');
  console.log(`  Velas:       ${stats.candles.toLocaleString()}`);
  console.log(`  Indicadores: ${stats.indicators.toLocaleString()}`);
  console.log(`  Features ML: ${stats.features.toLocaleString()}`);
  console.log('\n🎯 Siguiente paso: npm run train\n');
  
  await prisma.$disconnect();
  process.exit(0);
}

main();
