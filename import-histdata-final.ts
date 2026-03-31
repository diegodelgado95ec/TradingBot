import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const SYMBOL_MAP: Record<string, string> = {
  'eurusd': 'frxEURUSD',
  'gbpusd': 'frxGBPUSD',
  'usdjpy': 'frxUSDJPY',
  'gbpjpy': 'frxGBPJPY',
  'audusd': 'frxAUDUSD'
};

function parseTimestamp(datetime: string): number {
  const d = datetime.substring(0, 8);
  const t = datetime.substring(9, 15);
  
  const date = new Date(Date.UTC(
    parseInt(d.substring(0, 4)),
    parseInt(d.substring(4, 6)) - 1,
    parseInt(d.substring(6, 8)),
    parseInt(t.substring(0, 2)),
    parseInt(t.substring(2, 4)),
    parseInt(t.substring(4, 6))
  ));
  
  return Math.floor(date.getTime() / 1000);
}

async function importCsv(filePath: string, pairCode: string) {
  console.log(`\n📥 ${path.basename(filePath)}...`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);

  console.log(`   📊 ${lines.length.toLocaleString()} filas`);

  const BATCH_SIZE = 5000;
  let imported = 0;

  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const batch = lines.slice(i, i + BATCH_SIZE);
    
    const data = batch
      .map(line => {
        try {
          const parts = line.split(';');
          if (parts.length < 5) return null;

          const epoch = parseTimestamp(parts[0]);
          const open = parseFloat(parts[1]);
          const high = parseFloat(parts[2]);
          const low = parseFloat(parts[3]);
          const close = parseFloat(parts[4]);

          if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;

          return {
            symbol: SYMBOL_MAP[pairCode],
            timeframe: '60',
            epoch,
            open,
            high,
            low,
            close,
            createdAt: new Date()
          };
        } catch {
          return null;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (data.length > 0) {
      // Usar transacción con createMany
      await prisma.$transaction(
        data.map(d => 
          prisma.candle.upsert({
            where: {
              symbol_timeframe_epoch: {
                symbol: d.symbol,
                timeframe: d.timeframe,
                epoch: d.epoch
              }
            },
            create: d,
            update: {}
          })
        )
      );
      
      imported += data.length;
    }

    const progress = (((i + batch.length) / lines.length) * 100).toFixed(1);
    console.log(`   ${progress}% | ${imported.toLocaleString()} importadas`);
  }

  console.log(`   ✅ ${imported.toLocaleString()} velas`);
}

async function main() {
  console.log('🚀 IMPORTACIÓN HISTDATA (TRANSACCIONES)\n');

  const files = fs.readdirSync('./data').filter(f => f.endsWith('.csv'));
  
  const pairFiles: Record<string, string[]> = {};
  
  for (const file of files) {
    const pair = file.split('_')[0].toLowerCase();
    if (SYMBOL_MAP[pair]) {
      if (!pairFiles[pair]) pairFiles[pair] = [];
      pairFiles[pair].push(path.join('./data', file));
    }
  }

  for (const [pair, paths] of Object.entries(pairFiles)) {
    console.log(`\n🔵 ${pair.toUpperCase()}`);
    for (const p of paths.sort()) {
      await importCsv(p, pair);
    }
  }

  console.log('\n\n📊 RESUMEN:\n');
  
  for (const [_, symbol] of Object.entries(SYMBOL_MAP)) {
    const count = await prisma.candle.count({ where: { symbol, timeframe: '60' } });
    
    if (count > 0) {
      const first = await prisma.candle.findFirst({ where: { symbol, timeframe: '60' }, orderBy: { epoch: 'asc' } });
      const last = await prisma.candle.findFirst({ where: { symbol, timeframe: '60' }, orderBy: { epoch: 'desc' } });
      const firstDate = new Date(first!.epoch * 1000).toISOString().slice(0, 10);
      const lastDate = new Date(last!.epoch * 1000).toISOString().slice(0, 10);
      
      console.log(`   ✅ ${symbol}: ${count.toLocaleString()} velas | ${firstDate} → ${lastDate}`);
    }
  }

  console.log('\n🎉 COMPLETO\n');
  await prisma.$disconnect();
}

main();
