import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const count = await prisma.candle.count();
  const oldest = await prisma.candle.findFirst({ orderBy: { epoch: 'asc' } });
  const newest = await prisma.candle.findFirst({ orderBy: { epoch: 'desc' } });
  
  console.log(`\n📊 Datos en base de datos:`);
  console.log(`  Total velas: ${count.toLocaleString()}`);
  if (oldest) console.log(`  Más antigua: ${new Date(Number(oldest.epoch) * 1000).toLocaleString()}`);
  if (newest) console.log(`  Más reciente: ${new Date(Number(newest.epoch) * 1000).toLocaleString()}`);
  console.log('');
  
  await prisma.$disconnect();
}

check();
