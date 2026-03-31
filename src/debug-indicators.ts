import prisma from './database/prisma.client';

async function debug() {
  // Verificar cuántas velas hay
  const totalCandles = await prisma.candle.count({ where: { symbol: 'R_10' } });
  console.log(`📊 Total velas: ${totalCandles}`);

  // Verificar cuántos indicadores hay
  const totalIndicators = await prisma.indicator.count();
  console.log(`📈 Total indicadores: ${totalIndicators}`);

  // Obtener una vela con indicadores
  const candle = await prisma.candle.findFirst({
    where: { 
      symbol: 'R_10',
      indicators: { some: {} } // Solo velas que TENGAN indicadores
    },
    include: { indicators: true },
  });

  if (candle) {
    console.log('\n✅ Vela encontrada con indicadores:');
    console.log(`Epoch: ${candle.epoch}`);
    console.log(`Close: ${candle.close}`);
    console.log(`Indicadores (${candle.indicators.length}):`);
    
    if (candle.indicators.length > 0) {
      const ind = candle.indicators[0];
      console.log('\n🔍 Primer indicador:');
      console.log(JSON.stringify(ind, null, 2));
      
      // Listar TODOS los campos
      console.log('\n📋 Campos disponibles:');
      Object.keys(ind).forEach(key => {
        console.log(`  - ${key}: ${typeof (ind as any)[key]}`);
      });
    }
  } else {
    console.log('\n❌ NO se encontraron velas con indicadores');
    
    // Verificar schema
    console.log('\n🔍 Revisando schema de Indicator...');
    const anyIndicator = await prisma.indicator.findFirst();
    if (anyIndicator) {
      console.log('Campos en tabla Indicator:');
      Object.keys(anyIndicator).forEach(key => {
        console.log(`  - ${key}`);
      });
    }
  }

  await prisma.$disconnect();
}

debug().catch(console.error);
