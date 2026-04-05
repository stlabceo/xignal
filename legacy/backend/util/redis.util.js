const redisUtil = require('redis');
const redis = require("redis");
const redisClient = redis.createClient(
    {
        legacyMode: true
    }
);

redisClient.on('connect', () => console.log('Connected to Redis!'));
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

module.exports = redisClient;