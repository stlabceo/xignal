const mysql = require('mysql2/promise');
const path = require('path');
const {
    assertSafeDatabaseFingerprint,
    assertSafeDbEnv,
} = require('../db-fingerprint-guard');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
assertSafeDbEnv({ context: 'runtime' });

const conn = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PW,
    database: process.env.MYSQL_DB,
    // connectTimeout: 5000,
    connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 20),
    waitForConnections: true,
    enableKeepAlive: true, // false by default.
    maxIdle: Number(process.env.MYSQL_POOL_IDLE_LIMIT || 10),
    idleTimeout: Number(process.env.MYSQL_POOL_IDLE_TIMEOUT || 60000),
    keepAliveInitialDelay: 0,
    queueLimit: 0,
})

const startupFingerprintCheck = assertSafeDatabaseFingerprint(conn, {
    context: 'runtime-fingerprint',
    host: process.env.MYSQL_HOST,
}).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
});

conn.__startupFingerprintCheck = startupFingerprintCheck;

module.exports = conn;
