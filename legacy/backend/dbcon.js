var exports = module.exports = {};
const db = require('./database/connect/config');

const RETRYABLE_DB_ERROR_CODES = new Set([
    'ER_CON_COUNT_ERROR',
    'PROTOCOL_CONNECTION_LOST',
    'ECONNRESET',
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT',
]);

const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const withDbRetry = async (label, fn, maxAttempts = 3) => {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (!RETRYABLE_DB_ERROR_CODES.has(error?.code) || attempt === maxAttempts) {
                throw error;
            }

            console.log(`[DB RETRY] ${label} attempt ${attempt} failed with ${error.code}`);
            await sleep(150 * attempt);
        }
    }

    throw lastError;
};

exports.DBCall = async function (sp, params) {
    try {
        return await withDbRetry(sp, async () => {
            let connection = null;

            try {
                connection = await db.getConnection();
                await connection.beginTransaction();
                const reData = await connection.query(sp, params);
                await connection.commit();
                return reData[0][0];
            } catch (error) {
                try {
                    if (connection) {
                        await connection.rollback();
                    }
                } catch (rollbackError) {
                }

                throw error;
            } finally {
                if (connection) {
                    connection.release();
                }
            }
        });
    } catch (error) {
        console.log('~!!!!!!!!!!!!!!!!!!!');
        console.error('Error:', error);
        return false;
    }
};

exports.DBOriginCall = async function (sp, params) {
    try {
        const reData = await withDbRetry(sp, async () => {
            return await db.query(sp, params);
        });

        return reData[0];
    } catch (error) {
        console.log(sp + " error : " + error);
        return false;
    }
};

exports.DBOneCall = async function (sp, params) {
    try {
        const reData = await withDbRetry(sp, async () => {
            return await db.query(sp, params);
        });

        return reData[0][0][0];
    } catch (error) {
        console.log(sp + " error : " + error);
        return false;
    }
};

exports.DBPageCall = async function (sp, params) {
    try {
        const reData = await withDbRetry(sp, async () => {
            return await db.query(sp, params);
        });

        return { item: reData[0][0], pageInfo: reData[0][1][0] };
    } catch (error) {
        console.log(sp + " error : " + error);
        return false;
    }
};
