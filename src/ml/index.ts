
import { MLTrainer } from './train-model';

import prisma from '../database/prisma.client';

async function main() {
  console.log('🤖 Sistema de Machine Learning\n');
  console.log('='.repeat(50));
  
  const trainer = new MLTrainer();
  
  try {
    const data = await trainer.prepareTrainingData('R_10');
    
    const split = trainer.splitData(data);
    
    console.log('\n🎯 Entrenando en conjunto de entrenamiento:');
    const results = trainer.simpleClassifier(split.train);
    
    console.log('\n🎯 Validación:');
    trainer.simpleClassifier(split.validation);
    
    console.log('\n🧪 Test:');
    trainer.simpleClassifier(split.test);
    
    await trainer.exportForPython('R_10');
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Entrenamiento completado!');
    console.log('\n📋 Próximos pasos:');
    console.log('  1. Revisa ml_dataset.json');
    console.log('  2. Usa Python + scikit-learn para mejor modelo');
    console.log('  3. O ejecuta: npm run trade (para trading en vivo)\n');
    
    await prisma.$disconnect();
    process.exit(0);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
