console.log('🔍 [DEBUG] Script iniciado');

import { BacktestEngine } from './backtest-engine';
import prisma from '../database/prisma.client';

console.log('🔍 [DEBUG] Imports completados');

async function main() {
  console.log('🔙 SISTEMA DE BACKTESTING\n');
  
  try {
    console.log('🔍 [DEBUG] Creando engine...');
    const engine = new BacktestEngine();
    
    console.log('🔍 [DEBUG] Iniciando backtesting...');
    const results = await engine.runBacktest(
      'R_10',
      undefined,
      undefined,
      0.02
    );
    
    console.log('🔍 [DEBUG] Backtesting completado, mostrando resultados...');
    engine.displayResults(results);
    
    console.log('🔍 [DEBUG] Guardando resultados...');
    await engine.saveResults(results);
    
    console.log('\n🏆 MEJORES 5 TRADES:\n');
    const bestTrades = results.trades
      .filter(t => t.status === 'WIN')
      .sort((a, b) => (b.pnlPercent || 0) - (a.pnlPercent || 0))
      .slice(0, 5);
    
    bestTrades.forEach((t, i) => {
      console.log(`${i + 1}. ${t.direction} - Entry: $${t.entryPrice.toFixed(2)} → Exit: $${t.exitPrice?.toFixed(2)} - PnL: +${t.pnlPercent?.toFixed(2)}% ($${t.pnl?.toFixed(2)})`);
    });
    
    console.log('\n💔 PEORES 5 TRADES:\n');
    const worstTrades = results.trades
      .filter(t => t.status === 'LOSS')
      .sort((a, b) => (a.pnlPercent || 0) - (b.pnlPercent || 0))
      .slice(0, 5);
    
    worstTrades.forEach((t, i) => {
      console.log(`${i + 1}. ${t.direction} - Entry: $${t.entryPrice.toFixed(2)} → Exit: $${t.exitPrice?.toFixed(2)} - PnL: ${t.pnlPercent?.toFixed(2)}% ($${t.pnl?.toFixed(2)})`);
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 Siguiente paso: Mejorar modelo con Python ML\n');
    
    await prisma.$disconnect();
    process.exit(0);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await prisma.$disconnect();
    process.exit(1);
  }
}

console.log('🔍 [DEBUG] Llamando main()...');

main().catch(error => {
  console.error('❌ Error no capturado:', error);
  console.error(error.stack);
  process.exit(1);
});
