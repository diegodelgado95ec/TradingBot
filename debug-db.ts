import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  // Rango real de frxEURUSD
  const r = await prisma.candle.aggregate({
    where: { symbol: 'frxEURUSD' },
    _min: { epoch: true },
    _max: { epoch: true },
    _count: true
  });

  console.log('Count:', r._count);
  console.log('Min epoch:', r._min.epoch, '→', new Date((r._min.epoch ?? 0) * 1000).toISOString());
  console.log('Max epoch:', r._max.epoch, '→', new Date((r._max.epoch ?? 0) * 1000).toISOString());

  // Prueba filtro con época 2025
  const start = Math.floor(new Date('2025-01-01').getTime() / 1000);
  const end   = Math.floor(new Date('2025-12-31').getTime() / 1000);
  console.log('\nFiltro 2025 → start epoch:', start, '| end epoch:', end);

  const count2025 = await prisma.candle.count({
    where: {
      symbol: 'frxEURUSD',
      epoch: { gte: start, lte: end }
    }
  });
  console.log('Velas frxEURUSD en 2025:', count2025);

  // Prueba filtro 2020-2025
  const start2020 = Math.floor(new Date('2020-01-01').getTime() / 1000);
  const count2020 = await prisma.candle.count({
    where: {
      symbol: 'frxEURUSD',
      epoch: { gte: start2020, lte: end }
    }
  });
  console.log('Velas frxEURUSD en 2020-2025:', count2020);

  // Primeras 3 velas
  const sample = await prisma.candle.findMany({
    where: { symbol: 'frxEURUSD' },
    orderBy: { epoch: 'asc' },
    take: 3
  });
  console.log('\nPrimeras 3 velas:');
  sample.forEach(c => console.log(c));

  await prisma.$disconnect();
}

run().catch(console.error);
