const { Queue } = require('bullmq');
const QueueMQ = require('ioredis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Conexão ioredis reutilizável para o BullMQ
const redisConnection = new QueueMQ(redisUrl, {
  maxRetriesPerRequest: null
});

// Inicialização da fila 'scrape-queue'
const scrapeQueue = new Queue('scrape-queue', {
  connection: redisConnection
});

console.log('[REDIS/BULLMQ] Fila "scrape-queue" inicializada com sucesso.');

module.exports = {
  scrapeQueue,
  redisConnection
};
