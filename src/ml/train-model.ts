import * as fs from 'fs';
import prisma from '../database/prisma.client';

interface TrainingData {
  features: number[][];
  labels: number[];
}

class MLTrainer {
  
  async prepareTrainingData(symbol: string): Promise<TrainingData> {
    console.log('🔄 Preparando datos de entrenamiento...\n');

    const features = await prisma.mLFeature.findMany({
      where: { 
        symbol,
        NOT: { priceDirectionNext1m: null }
      },
      orderBy: { epoch: 'asc' },
    });

    console.log(`📊 Total de samples: ${features.length}`);

    const featureVectors: number[][] = [];
    const labels: number[] = [];

    for (const feature of features) {
      const vector = [
        feature.priceChangePct || 0,
        feature.highLowRange || 0,
        feature.closeOpenRatio || 1,
        feature.rsiNormalized || 0.5,
        feature.bbPosition || 0.5,
        feature.macdStrength || 0,
        feature.trendDirection || 0,
        feature.isBullishEngulfing ? 1 : 0,
        feature.isBearishEngulfing ? 1 : 0,
        feature.candleBodySize || 0,
        feature.upperShadowRatio || 0,
        feature.lowerShadowRatio || 0,
        feature.atrNormalized || 0,
      ];

      featureVectors.push(vector);
      labels.push(feature.priceDirectionNext1m!);
    }

    const upCount = labels.filter(l => l === 1).length;
    const downCount = labels.filter(l => l === -1).length;
    const neutralCount = labels.filter(l => l === 0).length;

    console.log('\n📈 Distribución de clases:');
    console.log(`  UP:      ${upCount} (${((upCount/labels.length)*100).toFixed(1)}%)`);
    console.log(`  DOWN:    ${downCount} (${((downCount/labels.length)*100).toFixed(1)}%)`);
    console.log(`  NEUTRAL: ${neutralCount} (${((neutralCount/labels.length)*100).toFixed(1)}%)`);

    return { features: featureVectors, labels };
  }

  splitData(data: TrainingData, trainRatio = 0.7, valRatio = 0.15) {
    const totalSamples = data.features.length;
    const trainSize = Math.floor(totalSamples * trainRatio);
    const valSize = Math.floor(totalSamples * valRatio);

    console.log('\n✂️ División del dataset:');
    console.log(`  Train:      ${trainSize} (${(trainRatio*100).toFixed(0)}%)`);
    console.log(`  Validation: ${valSize} (${(valRatio*100).toFixed(0)}%)`);
    console.log(`  Test:       ${totalSamples - trainSize - valSize} (${((1-trainRatio-valRatio)*100).toFixed(0)}%)`);

    return {
      train: {
        features: data.features.slice(0, trainSize),
        labels: data.labels.slice(0, trainSize),
      },
      validation: {
        features: data.features.slice(trainSize, trainSize + valSize),
        labels: data.labels.slice(trainSize, trainSize + valSize),
      },
      test: {
        features: data.features.slice(trainSize + valSize),
        labels: data.labels.slice(trainSize + valSize),
      },
    };
  }

  async exportForPython(symbol: string) {
    const data = await this.prepareTrainingData(symbol);
    const split = this.splitData(data);

    const output = {
      feature_names: [
        'priceChangePct',
        'highLowRange',
        'closeOpenRatio',
        'rsiNormalized',
        'bbPosition',
        'macdStrength',
        'trendDirection',
        'isBullishEngulfing',
        'isBearishEngulfing',
        'candleBodySize',
        'upperShadowRatio',
        'lowerShadowRatio',
        'atrNormalized',
      ],
      train: split.train,
      validation: split.validation,
      test: split.test,
    };

    const filename = 'ml_dataset.json';
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    
    console.log(`\n✅ Dataset exportado a: ${filename}`);
    console.log(`📦 Listo para entrenar con Python/scikit-learn\n`);
  }

  simpleClassifier(data: TrainingData) {
    console.log('\n🤖 Entrenando clasificador simple (baseline)...\n');

    const { features, labels } = data;
    
    let correct = 0;
    const predictions: number[] = [];

    for (let i = 0; i < features.length; i++) {
      const [priceChange, , , rsi, bbPos, macd, trend] = features[i];
      
      let prediction = 0;

      if (rsi < 0.3 && bbPos < 0.2) {
        prediction = 1;
      } else if (rsi > 0.7 && bbPos > 0.8) {
        prediction = -1;
      }
      else if (macd > 0 && trend === 1) {
        prediction = 1;
      } else if (macd < 0 && trend === -1) {
        prediction = -1;
      }
      else if (priceChange > 0.05) {
        prediction = 1;
      } else if (priceChange < -0.05) {
        prediction = -1;
      }

      predictions.push(prediction);
      if (prediction === labels[i]) correct++;
    }

    const accuracy = (correct / labels.length) * 100;

    console.log('📊 Resultados del clasificador simple:');
    console.log(`  Accuracy: ${accuracy.toFixed(2)}%`);
    console.log(`  Correct:  ${correct}/${labels.length}`);
    
    const classes = [-1, 0, 1];
    console.log('\n📈 Métricas por clase:');
    
    for (const cls of classes) {
      const truePositives = predictions.filter((p, i) => p === cls && labels[i] === cls).length;
      const predicted = predictions.filter(p => p === cls).length;
      const actual = labels.filter(l => l === cls).length;
      
      const precision = predicted > 0 ? (truePositives / predicted) * 100 : 0;
      const recall = actual > 0 ? (truePositives / actual) * 100 : 0;
      
      const className = cls === 1 ? 'UP' : cls === -1 ? 'DOWN' : 'NEUTRAL';
      console.log(`  ${className}:`);
      console.log(`    Precision: ${precision.toFixed(1)}%`);
      console.log(`    Recall:    ${recall.toFixed(1)}%`);
    }

    return { accuracy, predictions };
  }
}

export { MLTrainer };
