// const db = require('mysql');

// const conn = db.createConnection({
//     host:'localhost',
//     port:3306,
//     user:'root',
//     password:'zx2356',
//     database:'seon'
// });
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const conn = mysql.createPool({
    host: process.env.MYSQL_HOST,
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

module.exports = conn;
