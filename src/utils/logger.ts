export const logger = {
  info: (...args: any[]) => console.log('ℹ️', ...args),
  error: (...args: any[]) => console.error('❌', ...args),
  warn: (...args: any[]) => console.warn('⚠️', ...args),
  success: (...args: any[]) => console.log('✅', ...args),
};
