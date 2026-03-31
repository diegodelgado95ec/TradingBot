import { DerivClientService } from './src/services/deriv-client.service';

async function checkAvailability() {
  const client = new DerivClientService();
  await client.connect();

  const now = Math.floor(Date.now() / 1000);
  const days = 30;
  const startEpoch = now - (days * 24 * 60 * 60);

  console.log('\n🔍 DEBUG: Verificando request a Deriv API\n');
  console.log(`📅 Fecha actual: ${new Date(now * 1000).toISOString()}`);
  console.log(`📅 Start epoch (30 días atrás): ${startEpoch} (${new Date(startEpoch * 1000).toISOString()})`);
  console.log(`📅 End epoch (ahora): ${now} (${new Date(now * 1000).toISOString()})`);
  console.log(`📊 Velas esperadas: ${30 * 1440} (~43,200)\n`);

  try {
    const candles = await client.fetchCandlesInRange(
      'R_10',
      60,
      { startEpoch, endEpoch: now },
      5000
    );

    console.log(`✅ Respuesta de Deriv: ${candles.length} velas\n`);
    
    if (candles.length > 0) {
      const first = candles[0];
      const last = candles[candles.length - 1];
      
      console.log(`📦 Primera vela: epoch=${first.epoch} (${new Date(first.epoch * 1000).toISOString()})`);
      console.log(`📦 Última vela:  epoch=${last.epoch} (${new Date(last.epoch * 1000).toISOString()})`);
      
      const coverageDays = (last.epoch - first.epoch) / (24 * 60 * 60);
      console.log(`📊 Cobertura real: ${coverageDays.toFixed(1)} días\n`);
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }

  client.disconnect();
  process.exit(0);
}

checkAvailability();