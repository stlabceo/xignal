const express = require("express");
const db = require("../database/connect/config");
const gridStats = require("../stats/grid-stats-ingest");

const router = express.Router();

const jsonOnly = (req, res, next) => {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return res.status(415).json({ ok: false, error: "JSON_ONLY" });
  }
  return next();
};

const normalizeRawValue = (value, fallback = "UNKNOWN") =>
  String(value || fallback).trim() || fallback;

const persistRawStatsAttempt = async ({ payload, validation, status }) => {
  const normalized = validation?.normalized || {};
  const payloadHash = gridStats.computeStatsPayloadHash(payload);
  const now = new Date();
  const [result] = await db.query(
    `INSERT INTO strategy_stats_raw
      (source, category, strategyCode, strategyDisplayName, symbol, timeframe, calcMode,
       payloadHash, rawJson, receivedAt, validationStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rawJson = VALUES(rawJson),
       receivedAt = VALUES(receivedAt),
       validationStatus = VALUES(validationStatus),
       id = LAST_INSERT_ID(id)`,
    [
      normalizeRawValue(normalized.source, "tradingview"),
      normalizeRawValue(normalized.category, "grid"),
      normalizeRawValue(normalized.strategyCode, "SQZGRID"),
      normalizeRawValue(normalized.strategyDisplayName, "SQZ+GRID"),
      normalizeRawValue(normalized.symbol),
      normalizeRawValue(normalized.timeframe),
      normalizeRawValue(normalized.calcMode),
      payloadHash,
      JSON.stringify(payload || {}),
      now,
      status,
    ]
  );
  return {
    rawId: Number(result.insertId || 0),
    payloadHash,
  };
};

router.post("/grid/validate", jsonOnly, async (req, res) => {
  const payload = req.body || {};
  const validation = gridStats.validateGridStatsPayload(payload);
  return res.status(validation.ok ? 200 : 400).json({
    ok: validation.ok,
    errors: validation.errors,
    normalized: validation.normalized,
  });
});

router.post("/grid", jsonOnly, async (req, res) => {
  const payload = req.body || {};
  const validation = gridStats.validateGridStatsPayload(payload);
  if (!validation.ok) {
    const rejected = await persistRawStatsAttempt({
      payload,
      validation,
      status: "REJECTED",
    }).catch(() => null);
    return res.status(400).json({
      ok: false,
      error: "GRID_STATS_VALIDATION_FAILED",
      errors: validation.errors,
      normalized: validation.normalized,
      rejectedRawId: rejected?.rawId || null,
      payloadHash: rejected?.payloadHash || gridStats.computeStatsPayloadHash(payload),
    });
  }

  const payloadHash = gridStats.computeStatsPayloadHash(payload);
  const metrics = gridStats.expandGridStatsMetrics(payload);
  const bestcases = gridStats.extractGridStatsBestcases(payload);
  const rankRows = gridStats.buildLandingRankRows(bestcases);
  const now = new Date();

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [rawResult] = await connection.query(
      `INSERT INTO strategy_stats_raw
        (source, category, strategyCode, strategyDisplayName, symbol, timeframe, calcMode,
         payloadHash, rawJson, receivedAt, validationStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        validation.normalized.source,
        validation.normalized.category,
        validation.normalized.strategyCode,
        validation.normalized.strategyDisplayName,
        validation.normalized.symbol,
        validation.normalized.timeframe,
        validation.normalized.calcMode,
        payloadHash,
        JSON.stringify(payload),
        now,
      ]
    );
    const rawId = Number(rawResult.insertId || 0);

    const [existingRows] = await connection.query(
      `SELECT COUNT(*) AS count FROM strategy_stats_metric WHERE rawId = ?`,
      [rawId]
    );
    const alreadyExpanded = Number(existingRows?.[0]?.count || 0) > 0;

    if (!alreadyExpanded) {
      for (const metric of metrics) {
        await connection.query(
          `INSERT INTO strategy_stats_metric
            (rawId, category, strategyCode, symbol, timeframe, periodKey, tp,
             winRate, netProfit, source, calculatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rawId,
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
            rawId,
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
    return res.json({
      ok: true,
      duplicate: alreadyExpanded,
      rawId,
      payloadHash,
      metricCount: metrics.length,
      bestcaseCount: bestcases.length,
      rankingRows: rankRows.length,
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ ok: false, error: "GRID_STATS_INGEST_FAILED" });
  } finally {
    connection.release();
  }
});

router.get("/grid/rankings", async (req, res) => {
  const period = String(req.query.period || "1M").trim().toUpperCase();
  const [rows] = await db.query(
    `SELECT *
       FROM landing_strategy_rank_cache
      WHERE category = 'grid'
        AND periodKey = ?
      ORDER BY score DESC, winRate DESC, updatedAt DESC
      LIMIT 50`,
    [period]
  );
  return res.json({ ok: true, period, rows });
});

router.get("/grid/latest", async (req, res) => {
  const symbol = gridStats.normalizeGridStatsSymbol(req.query.symbol);
  const timeframe = gridStats.normalizeGridStatsTimeframe(req.query.timeframe);
  if (!symbol || !timeframe) {
    return res.status(400).json({ ok: false, error: "SYMBOL_TIMEFRAME_REQUIRED" });
  }
  const [rows] = await db.query(
    `SELECT *
       FROM strategy_stats_bestcase
      WHERE category = 'grid'
        AND symbol = ?
        AND timeframe = ?
      ORDER BY calculatedAt DESC
      LIMIT 10`,
    [symbol, timeframe]
  );
  return res.json({ ok: true, symbol, timeframe, rows });
});

module.exports = router;
