import DerivAPI from '@deriv/deriv-api';
import dotenv from 'dotenv';
import prisma from '../database/prisma.client';
import LiveTrader from './live-trader';

dotenv.config();

const APP_ID = parseInt(process.env.DERIV_APP_ID || '0');
const API_TOKEN = process.env.DERIV_API_TOKEN || '';

async function main() {
  console.log('🤖 SISTEMA DE TRADING AUTOMÁTICO');
  console.log('='.repeat(60));
  console.log('⚠️  MODO DEMO - No ejecuta trades reales aún');
  console.log('='.repeat(60) + '\n');

  const connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

  connection.onopen = () => {
    console.log('🔌 Conectado a Deriv API');
    connection.send(JSON.stringify({ authorize: API_TOKEN }));
  };

  connection.onmessage = async (msg) => {
    const data = JSON.parse(msg.data.toString());

    if (data.authorize) {
      console.log(`✅ Autorizado: ${data.authorize.email}`);
      console.log(`💰 Balance: ${data.authorize.balance} ${data.authorize.currency}\n`);

      // Iniciar trader
      const trader = new LiveTrader(connection);
      await trader.start('R_10');
    }

    if (data.error) {
      console.error('❌ Error:', data.error.message);
      await prisma.$disconnect();
      process.exit(1);
    }
  };

  connection.onerror = async (error) => {
    console.error('❌ Error de conexión:', error);
    await prisma.$disconnect();
    process.exit(1);
  };
}

main();
