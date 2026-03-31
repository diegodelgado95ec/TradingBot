console.log('=== DEBUG SIGNAL GENERATOR ===');

const module1 = require('./src/trading/signal-generator');
console.log('Module completo:', Object.keys(module1));
console.log('SignalGenerator tipo:', typeof module1.SignalGenerator);
console.log('SignalGenerator value:', module1.SignalGenerator);

console.log('\n=== Intentando import ES6 ===');
import('./src/trading/signal-generator').then(module2 => {
  console.log('Module ES6:', Object.keys(module2));
  console.log('SignalGenerator ES6:', module2.SignalGenerator);
  console.log('default ES6:', module2.default);
});
