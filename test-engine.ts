import { BacktestEngine } from './src/backtesting/backtest-engine';

console.log('Tipo de BacktestEngine:', typeof BacktestEngine);
console.log('Es constructor:', BacktestEngine.constructor);

const engine = new BacktestEngine();
console.log('✅ Engine creado correctamente');
