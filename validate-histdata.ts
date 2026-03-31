import { PrismaClient } from '@prisma/client';
import { DerivClientService } from './src/services/deriv-client.service';

const prisma = new PrismaClient();

const SYMBOL_MAP: Record<string, string> = {
  'frxEURUSD': 'frxEURUSD',
  'frxGBPUSD': 'frxGBPUSD',
  'frxUSDJPY': 'frxUSDJPY',
  'frxGBPJPY': 'frxGBPJPY',
  'frxAUDUSD': 'frxAUDUSD'
};

async function validatePair(dbSymbol: string, derivSymbol: string) {
  console.log(`\n🔍 Validando ${dbSymbol}...`);

  // Obtener últimas 100 velas de DB
  const dbCandles = await prisma.candle.findMany({
    where: { symbol: dbSymbol, timeframe: 60 },
    orderBy: { epoch: 'desc' },
    take: 100
  });

  if (dbCandles.length === 0) {
    console.log(`   ⚠️  No hay datos en DB`);
    return false;
  }

  console.log(`   📊 DB: ${dbCandles.length} velas | ${new Date(dbCandles[dbCandles.length-1].epoch * 1000).toISOString().slice(0, 16)} → ${new Date(dbCandles[0].epoch * 1000).toISOString().slice(0, 16)}`);

  // Obtener mismas velas de Deriv
  const client = new DerivClientService();
  await client.connect();

  try {
    const derivCandles = await client.fetchCandlesInRange(
      derivSymbol,
      60,
      { 
        startEpoch: dbCandles[dbCandles.length - 1].epoch, 
        endEpoch: dbCandles[0].epoch 
      },
      5000
    );

    console.log(`   📊 Deriv: ${derivCandles.length} velas`);

    // Comparar precios
    let matches = 0;
    let totalCompared = 0;

    for (const db of dbCandles.slice(0, 50)) {
      const deriv = derivCandles.find(d => d.epoch === db.epoch);
      
      if (!deriv) continue;
      
      totalCompared++;
      const diff = Math.abs(db.close - deriv.close);
      
      if (diff < 0.00001) { // Tolerance: 0.1 pip
        matches++;
      }
    }

    const accuracy = totalCompared > 0 ? ((matches / totalCompared) * 100).toFixed(1) : '0.0';
    const isValid = matches >= (totalCompared * 0.95);
    
    console.log(`   ${isValid ? '✅' : '⚠️ '} Coincidencia: ${matches}/${totalCompared} (${accuracy}%)`);

    client.disconnect();
    return isValid;

  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    client.disconnect();
    return false;
  }
}

async function main() {
  console.log('\n🔍 VALIDACIÓN CRUZADA: HistData vs Deriv\n');

  let validated = 0;
  let total = 0;

  for (const [dbSymbol, derivSymbol] of Object.entries(SYMBOL_MAP)) {
    total++;
    const isValid = await validatePair(dbSymbol, derivSymbol);
    if (isValid) validated++;
    
    // Delay entre requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n📊 RESULTADO FINAL: ${validated}/${total} pares validados (>95% match)\n`);
  
  if (validated >= Math.ceil(total * 0.8)) {
    console.log('✅ DATOS CONFIABLES: Proceder con entrenamiento ML\n');
  } else {
    console.log('⚠️  REVISAR DATOS: Baja confiabilidad\n');
  }

  await prisma.$disconnect();
}

main();
