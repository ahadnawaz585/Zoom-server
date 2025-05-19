import { Bot } from '../types';

export const generateBots = (count: number, existingBots: Bot[]): Bot[] => {
  console.log(`[${new Date().toISOString()}] Generating ${count} new bots`);
  const newBots: Bot[] = [];
  const maxId = existingBots.length ? Math.max(...existingBots.map(b => b.id)) : 0;

  for (let i = 1; i <= count; i++) {
    newBots.push({ id: maxId + i, name: `Bot${maxId + i}`, status: 'ready' });
  }
  console.log(`[${new Date().toISOString()}] Generated ${newBots.length} bots`);
  return newBots;
};