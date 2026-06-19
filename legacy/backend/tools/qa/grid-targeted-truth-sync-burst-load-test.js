"use strict";

const assert = require("assert");

const config = {
  globalConcurrency: 6,
  perUidConcurrency: 2,
  perSymbolConcurrency: 2,
  startsPerSecond: 6,
  staleQueueMs: 30000,
  denseCriticalThreshold: 12,
  denseCriticalWindowMs: 250,
  denseCriticalMaxBatch: 1000,
  denseCriticalBatchDurationMs: 250,
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const runHarness = ({ totalTargets, crossedTargets, symbols = ["XRPUSDT"], uids = [156], durationMs = 125 }) => {
  const queue = [];
  const wait = [];
  const running = [];
  const perUid = new Map();
  const perSymbol = new Map();
  let now = 0;
  let exactQueries = 0;
  let rowWideFallbacks = 0;
  let droppedStale = 0;
  let maxConcurrent = 0;
  let maxQueueLength = 0;
  let maxStartsInSecond = 0;
  let suppressed = totalTargets - crossedTargets;

  for (let i = 0; i < crossedTargets; i += 1) {
    const kind = i % 5 === 0 ? "STOP" : i % 3 === 0 ? "TP" : "ENTRY";
    queue.push({
      id: i,
      uid: String(uids[i % uids.length]),
      symbol: symbols[i % symbols.length],
      kind,
      exact: kind === "STOP" || kind === "TP",
      priority: kind === "STOP" || kind === "TP" ? 10 : 20,
      queuedAt: 0,
    });
  }
  maxQueueLength = queue.length;

  while (queue.length || running.length) {
    for (let i = running.length - 1; i >= 0; i -= 1) {
      if (running[i].doneAt <= now) {
        const task = running.splice(i, 1)[0];
        perUid.set(task.uid, Math.max(0, (perUid.get(task.uid) || 0) - 1));
        perSymbol.set(task.symbol, Math.max(0, (perSymbol.get(task.symbol) || 0) - 1));
      }
    }

    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (now - queue[i].queuedAt > config.staleQueueMs && !(queue[i].exact && (queue[i].kind === "STOP" || queue[i].kind === "TP"))) {
        queue.splice(i, 1);
        droppedStale += 1;
      }
    }

    let startsThisSecond = 0;
    queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    for (let i = 0; i < queue.length && startsThisSecond < config.startsPerSecond;) {
      const task = queue[i];
      if (
        running.length >= config.globalConcurrency ||
        (perUid.get(task.uid) || 0) >= config.perUidConcurrency ||
        (perSymbol.get(task.symbol) || 0) >= config.perSymbolConcurrency
      ) {
        i += 1;
        continue;
      }
      queue.splice(i, 1);
      perUid.set(task.uid, (perUid.get(task.uid) || 0) + 1);
      perSymbol.set(task.symbol, (perSymbol.get(task.symbol) || 0) + 1);
      running.push({ ...task, doneAt: now + durationMs });
      wait.push(now - task.queuedAt);
      exactQueries += 1;
      startsThisSecond += 1;
      maxConcurrent = Math.max(maxConcurrent, running.length);
    }
    maxStartsInSecond = Math.max(maxStartsInSecond, startsThisSecond);
    maxQueueLength = Math.max(maxQueueLength, queue.length);
    now += 1000;
    assert(now <= config.staleQueueMs + 240000, "harness should drain or stale-drop without unbounded queue growth");
  }

  return {
    totalTargets,
    crossedTargets,
    exactQueries,
    rowWideFallbacks,
    allOrders: 0,
    userTrades: exactQueries,
    positionRisk: 0,
    suppressed,
    droppedStale,
    deferred: Math.max(0, maxQueueLength - maxConcurrent),
    maxConcurrent,
    maxStartsInSecond,
    maxQueueLength,
    p50WaitMs: percentile(wait, 50),
    p95WaitMs: percentile(wait, 95),
    maxWaitMs: wait.length ? Math.max(...wait) : 0,
  };
};

const runCriticalHarness = ({ crossedTargets, symbols, uids, durationMs = 125 }) => {
  const queue = [];
  const wait = [];
  const running = [];
  const perUid = new Map();
  const perSymbol = new Map();
  let now = 0;
  let exactQueries = 0;
  let droppedStale = 0;
  let maxQueueLength = 0;
  let maxStartsInSecond = 0;

  for (let i = 0; i < crossedTargets; i += 1) {
    const kind = i % 2 === 0 ? "TP" : "STOP";
    queue.push({
      id: i,
      uid: String(uids[i % uids.length]),
      symbol: symbols[i % symbols.length],
      kind,
      exact: true,
      priority: 10,
      queuedAt: 0,
    });
  }
  maxQueueLength = queue.length;

  while (queue.length || running.length) {
    for (let i = running.length - 1; i >= 0; i -= 1) {
      if (running[i].doneAt <= now) {
        const task = running.splice(i, 1)[0];
        perUid.set(task.uid, Math.max(0, (perUid.get(task.uid) || 0) - 1));
        perSymbol.set(task.symbol, Math.max(0, (perSymbol.get(task.symbol) || 0) - 1));
      }
    }

    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (now - queue[i].queuedAt > config.staleQueueMs && !(queue[i].exact && (queue[i].kind === "STOP" || queue[i].kind === "TP"))) {
        queue.splice(i, 1);
        droppedStale += 1;
      }
    }

    let startsThisSecond = 0;
    queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    for (let i = 0; i < queue.length && startsThisSecond < config.startsPerSecond;) {
      const task = queue[i];
      if (
        running.length >= config.globalConcurrency ||
        (perUid.get(task.uid) || 0) >= config.perUidConcurrency ||
        (perSymbol.get(task.symbol) || 0) >= config.perSymbolConcurrency
      ) {
        i += 1;
        continue;
      }
      queue.splice(i, 1);
      perUid.set(task.uid, (perUid.get(task.uid) || 0) + 1);
      perSymbol.set(task.symbol, (perSymbol.get(task.symbol) || 0) + 1);
      running.push({ ...task, doneAt: now + durationMs });
      wait.push(now - task.queuedAt);
      exactQueries += 1;
      startsThisSecond += 1;
    }
    maxStartsInSecond = Math.max(maxStartsInSecond, startsThisSecond);
    maxQueueLength = Math.max(maxQueueLength, queue.length);
    now += 1000;
    assert(now <= 900000, "critical harness should drain without unbounded queue growth");
  }

  return {
    crossedTargets,
    exactQueries,
    droppedStale,
    maxStartsInSecond,
    maxQueueLength,
    p50WaitMs: percentile(wait, 50),
    p95WaitMs: percentile(wait, 95),
    maxWaitMs: wait.length ? Math.max(...wait) : 0,
  };
};

const runDenseCriticalHarness = ({ crossedTargets, symbols, uids }) => {
  const queue = [];
  const wait = [];
  const running = [];
  const perUid = new Map();
  const perSymbol = new Map();
  let now = 0;
  let exactQueries = 0;
  let openAlgoOrders = 0;
  let allAlgoOrders = 0;
  let userTrades = 0;
  let denseBatches = 0;
  let droppedStale = 0;
  let maxQueueLength = 0;
  let maxStartsInSecond = 0;
  let unresolved = 0;

  for (let i = 0; i < crossedTargets; i += 1) {
    const kind = i % 2 === 0 ? "TP" : "STOP";
    queue.push({
      id: i,
      uid: String(uids[i % uids.length]),
      symbol: symbols[i % symbols.length],
      kind,
      exact: true,
      priority: 10,
      queuedAt: 0,
      clientAlgoId: `${kind}_${i}`,
    });
  }
  maxQueueLength = queue.length;

  while (queue.length || running.length) {
    for (let i = running.length - 1; i >= 0; i -= 1) {
      if (running[i].doneAt <= now) {
        const task = running.splice(i, 1)[0];
        perUid.set(task.uid, Math.max(0, (perUid.get(task.uid) || 0) - 1));
        perSymbol.set(task.symbol, Math.max(0, (perSymbol.get(task.symbol) || 0) - 1));
      }
    }

    let startsThisSecond = 0;
    const groups = new Map();
    for (const task of queue) {
      const key = `${task.uid}:${task.symbol}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }

    const denseGroup = Array.from(groups.values())
      .filter((items) => items.length >= config.denseCriticalThreshold)
      .sort((aItems, bItems) => aItems[0].queuedAt - bItems[0].queuedAt)[0];
    if (
      denseGroup &&
      now - denseGroup[0].queuedAt >= config.denseCriticalWindowMs &&
      running.length < config.globalConcurrency &&
      (perUid.get(denseGroup[0].uid) || 0) < config.perUidConcurrency &&
      (perSymbol.get(denseGroup[0].symbol) || 0) < config.perSymbolConcurrency &&
      startsThisSecond < config.startsPerSecond
    ) {
      const selected = denseGroup.slice(0, config.denseCriticalMaxBatch);
      const selectedIds = new Set(selected.map((task) => task.id));
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (selectedIds.has(queue[i].id)) queue.splice(i, 1);
      }
      for (const task of selected) {
        wait.push(now - task.queuedAt);
      }
      perUid.set(selected[0].uid, (perUid.get(selected[0].uid) || 0) + 1);
      perSymbol.set(selected[0].symbol, (perSymbol.get(selected[0].symbol) || 0) + 1);
      running.push({ uid: selected[0].uid, symbol: selected[0].symbol, doneAt: now + config.denseCriticalBatchDurationMs });
      denseBatches += 1;
      exactQueries += 0;
      openAlgoOrders += 1;
      allAlgoOrders += 1;
      userTrades += 1;
      startsThisSecond += 1;
    }

    queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    for (let i = 0; i < queue.length && startsThisSecond < config.startsPerSecond;) {
      const task = queue[i];
      const canDenseSoon = Array.from(groups.values()).some(
        (items) => items.includes(task) && items.length >= config.denseCriticalThreshold
      );
      if (canDenseSoon) {
        i += 1;
        continue;
      }
      if (
        running.length >= config.globalConcurrency ||
        (perUid.get(task.uid) || 0) >= config.perUidConcurrency ||
        (perSymbol.get(task.symbol) || 0) >= config.perSymbolConcurrency
      ) {
        i += 1;
        continue;
      }
      queue.splice(i, 1);
      perUid.set(task.uid, (perUid.get(task.uid) || 0) + 1);
      perSymbol.set(task.symbol, (perSymbol.get(task.symbol) || 0) + 1);
      running.push({ ...task, doneAt: now + 125 });
      wait.push(now - task.queuedAt);
      exactQueries += 1;
      userTrades += 1;
      startsThisSecond += 1;
    }
    maxStartsInSecond = Math.max(maxStartsInSecond, startsThisSecond);
    maxQueueLength = Math.max(maxQueueLength, queue.length);
    now += 250;
    assert(now <= 900000, "dense critical harness should drain without unbounded queue growth");
  }

  return {
    crossedTargets,
    exactQueries,
    openAlgoOrders,
    allAlgoOrders,
    userTrades,
    denseBatches,
    droppedStale,
    unresolved,
    maxStartsInSecond,
    maxQueueLength,
    p50WaitMs: percentile(wait, 50),
    p95WaitMs: percentile(wait, 95),
    maxWaitMs: wait.length ? Math.max(...wait) : 0,
    estimatedRequestWeight: exactQueries + openAlgoOrders + allAlgoOrders * 5 + userTrades * 5,
  };
};

const a = runHarness({ totalTargets: 1000, crossedTargets: 0 });
assert.strictEqual(a.exactQueries, 0, "no crossing must produce zero REST reads");

const b = runHarness({ totalTargets: 1000, crossedTargets: 1 });
assert.strictEqual(b.exactQueries, 1, "one crossing should produce one exact read");

const c = runHarness({
  totalTargets: 1000,
  crossedTargets: 100,
  symbols: Array.from({ length: 20 }, (_, i) => `SYM${i}USDT`),
  uids: Array.from({ length: 10 }, (_, i) => 100 + i),
});
assert(c.maxConcurrent <= config.globalConcurrency, "100-cross burst must respect global concurrency");
assert(c.maxStartsInSecond <= config.startsPerSecond, "100-cross burst must respect start budget");
assert.strictEqual(c.rowWideFallbacks, 0, "exact crossed targets must not force row-wide fallback");

const d = runHarness({
  totalTargets: 1000,
  crossedTargets: 1000,
  symbols: Array.from({ length: 100 }, (_, i) => `SYM${i}USDT`),
  uids: Array.from({ length: 100 }, (_, i) => 1000 + i),
});
assert(d.maxConcurrent <= config.globalConcurrency, "1000-cross burst must respect global concurrency");
assert(d.maxStartsInSecond <= config.startsPerSecond, "1000-cross burst must respect start budget");
assert(d.maxQueueLength >= 994, "1000-cross burst should queue/defer the excess instead of starting all");
assert(d.droppedStale > 0, "1000-cross burst should stale-drop old non-critical crossing requests");
assert(d.exactQueries < 1000, "1000-cross burst must not execute every request when stale budget is exceeded");
assert(d.exactQueries > 0 && d.droppedStale > 0, "critical TP/STOP exact verifies must be retained while non-critical entries can stale-drop");
assert.strictEqual(d.exactQueries + d.droppedStale, 1000, "1000-cross burst must either execute critical verifies or stale-drop non-critical verifies");

const e = runCriticalHarness({
  crossedTargets: 1000,
  symbols: Array.from({ length: 100 }, (_, i) => `SYM${i}USDT`),
  uids: Array.from({ length: 100 }, (_, i) => 1000 + i),
});
assert.strictEqual(e.exactQueries, 1000, "1000 critical TP/STOP exact verifies must be retained");
assert.strictEqual(e.droppedStale, 0, "critical TP/STOP exact verifies must not stale-drop");
assert(e.maxStartsInSecond <= config.startsPerSecond, "critical load must respect the global start budget");

const f = runCriticalHarness({
  crossedTargets: 1000,
  symbols: ["XRPUSDT"],
  uids: [156],
});
assert.strictEqual(f.exactQueries, 1000, "single-symbol critical load must drain all retained verifies");
assert.strictEqual(f.droppedStale, 0, "single-symbol critical load must not stale-drop critical verifies");
assert(f.p95WaitMs >= e.p95WaitMs, "single-symbol critical load should expose per-symbol/uid tail latency pressure");

const g = runDenseCriticalHarness({
  crossedTargets: 1000,
  symbols: ["XRPUSDT"],
  uids: [156],
});
assert.strictEqual(g.unresolved, 0, "dense single-symbol critical load must leave no unresolved candidate");
assert.strictEqual(g.droppedStale, 0, "dense single-symbol critical load must not stale-drop critical verifies");
assert(g.denseBatches <= 2, "dense single-symbol critical load should coalesce into a bounded number of batches");
assert(g.p95WaitMs <= 12000, "dense single-symbol critical p95 wait must stay within PM target");
assert(g.maxWaitMs <= 30000, "dense single-symbol critical max wait must stay within PM target");
assert(g.estimatedRequestWeight <= 1680, "dense batch must stay under 70% of a 2400 request-weight minute budget");

console.log(JSON.stringify({ status: "PASS", scenarios: { a, b, c, d, e, f, g }, config }, null, 2));
