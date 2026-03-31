import { GapDetector } from './src/data/gap-detector';

/**
 * 🔍 Solo análisis de gaps (preview sin descargar)
 */
async function main() {
  const detector = new GapDetector();
  
  const configs = [
    { symbol: 'R_10', timeframe: '1m' },
    { symbol: 'R_10', timeframe: '5m' },
    { symbol: 'R_10', timeframe: '15m' },
    { symbol: 'R_25', timeframe: '1m' },
    { symbol: 'R_25', timeframe: '5m' },
    { symbol: 'R_25', timeframe: '15m' },
    { symbol: 'R_50', timeframe: '1m' },
    { symbol: 'R_50', timeframe: '5m' },
  ];

  try {
    const results = await detector.detectAllGaps(configs, 730);
    
    console.log('\n📋 DETALLE POR STREAM:');
    results.forEach(r => {
      console.log(`\n${r.symbol} ${r.timeframe}:`);
      console.log(`  Existentes: ${r.existingCount.toLocaleString()}`);
      console.log(`  Faltantes: ${r.totalMissing.toLocaleString()}`);
      console.log(`  Gaps: ${r.gaps.length}`);
    });

    await detector.disconnect();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
