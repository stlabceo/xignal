const db = require("../../database/connect/config");
const gridStats = require("../../stats/grid-stats-ingest");

const parseIdSet = () =>
  new Set(
    String(process.env.GRID_STATS_RAW_IDS || "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0)
  );

const main = async () => {
  const idSet = parseIdSet();
  const where = ["validationStatus = 'REJECTED'"];
  const params = [];
  if (idSet.size > 0) {
    where.push(`id IN (${Array.from(idSet).map(() => "?").join(",")})`);
    params.push(...Array.from(idSet));
  }

  const [rows] = await db.query(
    `SELECT id, rawJson
       FROM strategy_stats_raw
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC`,
    params
  );

  const result = {
    scanned: rows.length,
    converted: [],
    skipped: [],
  };

  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.rawJson || "{}");
    } catch (error) {
      result.skipped.push({ id: row.id, reason: "RAW_JSON_PARSE_FAILED" });
      continue;
    }

    const validation = gridStats.validateGridStatsPayload(payload);
    if (!validation.ok) {
      result.skipped.push({ id: row.id, reason: "VALIDATION_FAILED", errors: validation.errors });
      continue;
    }

    const metrics = gridStats.expandGridStatsMetrics(payload);
    const bestcases = gridStats.extractGridStatsBestcases(payload);
    const rankRows = gridStats.buildLandingRankRows(bestcases);
    const now = new Date();
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE strategy_stats_raw
            SET source = ?,
                category = ?,
                strategyCode = ?,
                strategyDisplayName = ?,
                symbol = ?,
                timeframe = ?,
                calcMode = ?,
                rawJson = ?,
                validationStatus = 'VALID'
          WHERE id = ?`,
        [
          validation.normalized.source,
          validation.normalized.category,
          validation.normalized.strategyCode,
          validation.normalized.strategyDisplayName,
          validation.normalized.symbol,
          validation.normalized.timeframe,
          validation.normalized.calcMode,
          JSON.stringify(payload),
          row.id,
        ]
      );

      await connection.query(`DELETE FROM strategy_stats_metric WHERE rawId = ?`, [row.id]);
      await connection.query(`DELETE FROM strategy_stats_bestcase WHERE rawId = ?`, [row.id]);

      for (const metric of metrics) {
        await connection.query(
          `INSERT INTO strategy_stats_metric
            (rawId, category, strategyCode, symbol, timeframe, periodKey, tp,
             winRate, netProfit, source, calculatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            metric.category,
            metric.strategyCode,
            metric.symbol,
            metric.timeframe,
            metric.periodKey,
            metric.tp,
            metric.winRate,
            metric.netProfit,
            metric.source,
            now,
          ]
        );
      }

      for (const best of bestcases) {
        await connection.query(
          `INSERT INTO strategy_stats_bestcase
            (rawId, category, strategyCode, symbol, timeframe, periodKey,
             bestTp, bestWinRate, bestNetProfit, source, calculatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            best.category,
            best.strategyCode,
            best.symbol,
            best.timeframe,
            best.periodKey,
            best.bestTp,
            best.bestWinRate,
            best.bestNetProfit,
            best.source,
            now,
          ]
        );
      }

      for (const rank of rankRows) {
        await connection.query(
          `INSERT INTO landing_strategy_rank_cache
            (category, periodKey, rankNo, strategyCode, strategyDisplayName, symbol, timeframe,
             score, bestTp, netProfit, winRate, source, updatedAt)
           VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             strategyDisplayName = VALUES(strategyDisplayName),
             score = VALUES(score),
             bestTp = VALUES(bestTp),
             netProfit = VALUES(netProfit),
             winRate = VALUES(winRate),
             source = VALUES(source),
             updatedAt = VALUES(updatedAt)`,
          [
            rank.category,
            rank.periodKey,
            rank.strategyCode,
            rank.strategyDisplayName,
            rank.symbol,
            rank.timeframe,
            rank.score,
            rank.bestTp,
            rank.netProfit,
            rank.winRate,
            rank.source,
            now,
          ]
        );
      }

      await connection.commit();
      result.converted.push({
        id: row.id,
        symbol: validation.normalized.symbol,
        timeframe: validation.normalized.timeframe,
        metricCount: metrics.length,
        bestcaseCount: bestcases.length,
        rankingRows: rankRows.length,
      });
    } catch (error) {
      await connection.rollback();
      result.skipped.push({ id: row.id, reason: "DB_WRITE_FAILED", message: error.message });
    } finally {
      connection.release();
    }
  }

  console.log(JSON.stringify(result, null, 2));
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
