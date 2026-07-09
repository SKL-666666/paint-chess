// ai.js — 人机对战 AI（玩家 B 由 AI 控制）
// 策略：概率图 + 期望收益评估 + 防御意识（公平，不窥探敌方真实位置）
(function () {
  'use strict';
  const HF = (window.HF = window.HF || {});
  HF.ai = {};

  // 难度：0=简单 1=普通 2=困难
  HF.ai.difficulty = 1;

  // ===== AI 布阵：王放障碍物阴影区，护卫分散 =====
  HF.ai.doSetup = function (player) {
    const st = HF.state;
    const minY = player === 'A' ? HF.BOARD_MIN : HF.HALF_B_MIN_Y;
    const maxY = player === 'A' ? HF.HALF_A_MAX_Y : HF.BOARD_MAX;
    const occupied = new Set();
    const key = (x, y) => x + ',' + y;
    const inZone = (x, y) => y >= minY && y <= maxY && HF.inBoard(x, y);
    const placed = [];

    // 评估格点对王的隐蔽性：被障碍物遮挡越多越好 + 靠边
    function concealment(x, y) {
      let score = Math.abs(x) * 0.5 + (player === 'B' ? y : -y) * 0.5; // 靠边
      // 从敌方方向(中部)到 (x,y) 的射线被几个障碍物遮挡
      const enemyCenterY = player === 'B' ? 0 : 0;
      for (const ob of st.obstacles) {
        // 粗略：障碍物中心是否在 (x,y) 与敌中部之间
        const ocx = (ob.x1 + ob.x2) / 2, ocy = (ob.y1 + ob.y2) / 2;
        const dist = HF.math.distPointToSegment({ x, y }, { x: ocx, y: ocy }, { x: ocx, y: ocy });
        // 王到障碍物距离适中(1-3)算有遮挡
        const d = Math.hypot(ocx - x, ocy - y);
        if (d > 0.5 && d < 4) score += 1.5;
      }
      return score;
    }

    // 王：选隐蔽性最高的角落格点
    let kingPos = null, kingScore = -Infinity;
    for (let x = HF.BOARD_MIN; x <= HF.BOARD_MAX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (!inZone(x, y)) continue;
        const s = concealment(x, y) + Math.random() * 0.3;
        if (s > kingScore) { kingScore = s; kingPos = { x, y }; }
      }
    }
    placed.push({ x: kingPos.x, y: kingPos.y, type: 'king' });
    occupied.add(key(kingPos.x, kingPos.y));

    // 护卫：分散放置，与王距离 2-4，不在王与中部连线上
    function distToNearest(x, y) {
      let m = Infinity;
      for (const p of placed) m = Math.min(m, Math.hypot(x - p.x, y - p.y));
      return m;
    }
    for (let i = 0; i < HF.MAX_GUARDS; i++) {
      let best = null, bestScore = -Infinity;
      for (let x = HF.BOARD_MIN; x <= HF.BOARD_MAX; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (!inZone(x, y) || occupied.has(key(x, y))) continue;
          const dKing = Math.hypot(x - kingPos.x, y - kingPos.y);
          const dNear = distToNearest(x, y);
          let score = dNear;  // 与最近棋子距离
          if (dKing >= 2 && dKing <= 4) score += 3;  // 与王适中
          // 不在王到中部的直接连线上（避免挡王或被一锅端）
          const angleKing = Math.atan2(kingPos.y, kingPos.x);
          const angleHere = Math.atan2(y, x);
          if (Math.abs(angleKing - angleHere) > 0.3) score += 1;
          score += Math.random() * 0.5;
          if (score > bestScore) { bestScore = score; best = { x, y }; }
        }
      }
      if (best) {
        placed.push({ x: best.x, y: best.y, type: 'guard' });
        occupied.add(key(best.x, best.y));
      }
    }

    st.players[player].pieces = placed.map((p, i) => ({
      id: player + '-' + i, owner: player, type: p.type,
      x: p.x, y: p.y, alive: true,
    }));
  };

  // ===== 敌方位置概率图 =====
  HF.ai.enemyProbMap = function (enemyPlayer) {
    const st = HF.state;
    const enemyMinY = enemyPlayer === 'A' ? HF.BOARD_MIN : HF.HALF_B_MIN_Y;
    const enemyMaxY = enemyPlayer === 'A' ? HF.HALF_A_MAX_Y : HF.BOARD_MAX;
    const grid = new Map();
    const aliveEnemies = st.players[enemyPlayer].pieces.filter(p => p.alive);
    const aliveCount = aliveEnemies.length;
    if (aliveCount === 0) return { grid, candidates: [], aliveCount: 0 };

    // 基础概率：布阵区内均匀分布
    const cells = [];
    for (let x = HF.BOARD_MIN; x <= HF.BOARD_MAX; x++) {
      for (let y = enemyMinY; y <= enemyMaxY; y++) cells.push({ x, y });
    }
    let base = 1 / cells.length;
    for (const c of cells) grid.set(c.x + ',' + c.y, base);

    // 已知敌方棋子死亡位置曾经存在过（爆炸点）-> 排除
    // （碰撞爆炸点记录在 trails 中无，暂略）

    // 利用敌方轨迹线索：锚点必在轨迹曲线 0.5 邻域内
    const enemyTrails = st.trails.filter(tr => tr.player === enemyPlayer);
    for (const tr of enemyTrails) {
      const boosted = new Set();
      for (const pt of tr.points) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const gx = Math.round(pt.x) + dx;
            const gy = Math.round(pt.y) + dy;
            const k = gx + ',' + gy;
            if (grid.has(k) && Math.hypot(gx - pt.x, gy - pt.y) < 0.7) boosted.add(k);
          }
        }
      }
      for (const [k, v] of grid) {
        if (boosted.has(k)) grid.set(k, v * 3);
        else grid.set(k, v * 0.5);
      }
    }

    // 归一化
    let total = 0;
    for (const v of grid.values()) total += v;
    if (total > 0) for (const [k, v] of grid) grid.set(k, v / total);

    const candidates = [];
    for (const [k, prob] of grid) {
      const [x, y] = k.split(',').map(Number);
      candidates.push({ x, y, prob });
    }
    candidates.sort((a, b) => b.prob - a.prob);
    return { grid, candidates, aliveCount };
  };

  // ===== 期望收益评估（公平，不窥探敌方真实位置） =====
  // 基于概率图估算激光命中敌方的期望得分；己方棋子用真实位置（避免误伤）
  // 共振加成：命中点附近 1 格内若有其他高概率格点，额外加分
  function expectedLaserScore(curve, anchor, anchorId, myPlayer, prob) {
    const st = HF.state;
    const myPieces = st.players[myPlayer].pieces.filter(p => p.alive && p.id !== anchorId);
    const result = HF.generateLaser(curve, anchor, myPieces, anchorId, true);

    let score = 0;
    // 1. 己方误伤检查（真实位置）
    for (const pc of myPieces) {
      for (let i = 0; i < result.points.length - 1; i++) {
        const d = HF.math.distPointToSegment({ x: pc.x, y: pc.y }, result.points[i], result.points[i + 1]);
        if (d < 0.5) {
          score -= pc.type === 'king' ? 1000 : 12;
          break;
        }
      }
    }
    // 2. 期望敌方命中：曲线上每点找最近格点，累加概率
    const covered = new Set();
    const hitCells = [];
    for (const pt of result.points) {
      const gx = Math.round(pt.x), gy = Math.round(pt.y);
      const k = gx + ',' + gy;
      if (covered.has(k)) continue;
      const p = prob.grid.get(k);
      if (p && p > 0) {
        const kingChance = 1 / prob.aliveCount;
        score += p * (8 + kingChance * 80);
        covered.add(k);
        hitCells.push({ x: gx, y: gy, prob: p });
      }
    }
    // 3. 共振连锁加成：每个命中格点 RESONANCE_RADIUS 内有其他高概率格点 → 额外收益
    for (const hc of hitCells) {
      let clusterBonus = 0;
      for (const [k, p] of prob.grid) {
        if (p <= 0) continue;
        const [ox, oy] = k.split(',').map(Number);
        const d = Math.hypot(ox - hc.x, oy - hc.y);
        if (d > 0.01 && d <= HF.RESONANCE_RADIUS) {
          clusterBonus += p * 6;
        }
      }
      score += clusterBonus;
    }
    // 4. 覆盖范围小奖励
    score += result.points.length * 0.01;
    return score;
  }

  // ===== 针对性曲线生成：构造穿过高概率目标的曲线 =====
  // 给定锚点和目标格点，生成若干候选曲线描述
  function targetedCurves(anchor, targets) {
    const out = [];
    const ax = anchor.x, ay = anchor.y;
    for (const t of targets) {
      // 直线过锚点和目标方向
      const dx = t.x - ax, dy = t.y - ay;
      if (Math.abs(dx) > 0.1) {
        const a = dy / dx;
        const b = ay - a * ax;
        out.push({ kind: 'explicit', expr: 'y=' + fmt(a) + '*x+' + fmt(b) });
      } else {
        // 垂直线
        out.push({ kind: 'explicit', expr: 'x=' + fmt(ax) });
      }
      // 抛物线过锚点，顶点在锚点附近，弯向目标
      const a1 = 0.2 * (Math.random() > 0.5 ? 1 : -1);
      out.push({ kind: 'explicit', expr: 'y=' + fmt(a1) + '*x^2+' + fmt(ay - a1 * ax * ax) });
    }
    return out;
  }

  // 通用模板（随机探索）
  const AI_TEMPLATES = [
    (ax, ay) => { const a = (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 2.5); return { kind: 'explicit', expr: 'y=' + fmt(a) + '*x+' + fmt(ay - a * ax) }; },
    (ax, ay) => ({ kind: 'explicit', expr: 'y=' + fmt(ay) }),
    (ax, ay) => ({ kind: 'explicit', expr: 'x=' + fmt(ax) }),
    (ax, ay) => { const a = (Math.random() > 0.5 ? 1 : -1) * (0.05 + Math.random() * 0.4); return { kind: 'explicit', expr: 'y=' + fmt(a) + '*x^2+' + fmt(ay - a * ax * ax) }; },
    (ax, ay) => { const a = 0.8 + Math.random() * 2; const b = 0.3 + Math.random() * 1.2; return { kind: 'explicit', expr: 'y=' + fmt(a) + '*sin(' + fmt(b) + '*x+' + fmt(-b * ax) + ')' }; },
  ];

  function fmt(v) { return Math.abs(v) < 1e-9 ? '0' : (Math.round(v * 1000) / 1000).toString(); }

  function buildCurveSimple(desc) {
    if (desc.kind === 'explicit') {
      const parsed = HF.parseFunction(desc.expr);
      if (!parsed.ok) return { ok: false };
      return { ok: true, curve: HF.makeCurve(parsed), label: desc.expr };
    }
    if (desc.kind === 'param') {
      const parsed = HF.parseParametric(desc.xExpr, desc.yExpr, desc.tMin, desc.tMax);
      if (!parsed.ok) return { ok: false };
      return { ok: true, curve: { mode: 'param', cx: parsed.cx, cy: parsed.cy, tMin: parsed.tMin, tMax: parsed.tMax }, label: desc.label };
    }
    return { ok: false };
  }

  // ===== 王的危险评估 =====
  // 敌方上一步轨迹若延伸方向接近己方王，危险高
  function kingDanger(myPlayer) {
    const st = HF.state;
    const myKing = st.players[myPlayer].pieces.find(p => p.type === 'king' && p.alive);
    if (!myKing) return 0;
    const enemyTrails = st.trails.filter(tr => tr.player !== myPlayer);
    if (!enemyTrails.length) return 0;
    const last = enemyTrails[enemyTrails.length - 1];
    let minDist = Infinity;
    for (const pt of last.points) {
      minDist = Math.min(minDist, Math.hypot(pt.x - myKing.x, pt.y - myKing.y));
    }
    // 轨迹离王越近越危险（< 1.5 高危）
    if (minDist < 0.7) return 3;
    if (minDist < 1.5) return 2;
    if (minDist < 2.5) return 1;
    return 0;
  }

  // ===== AI 决策 =====
  HF.ai.decide = function (myPlayer) {
    const st = HF.state;
    const enemyPlayer = myPlayer === 'A' ? 'B' : 'A';
    const myPieces = st.players[myPlayer].pieces.filter(p => p.alive);
    const myKing = myPieces.find(p => p.type === 'king');
    if (!myKing) return null;

    const prob = HF.ai.enemyProbMap(enemyPlayer);
    if (prob.aliveCount === 0) return null;
    const topTargets = prob.candidates.slice(0, 6);
    const myTraps = st.players[myPlayer].traps.length;
    const canLaser = true;  // 能量机制已移除，激光随时可用
    const canTrap = myTraps < HF.MAX_TRAPS;

    let bestAction = null;
    let bestScore = -Infinity;

    // === 防御检查：王危险高时优先移动王 ===
    const danger = kingDanger(myPlayer);
    if (danger >= 2 && HF.ai.difficulty >= 1) {
      let bestKingMove = null, bestKingScore = -Infinity;
      for (const dir of HF.DIRECTIONS) {
        for (const steps of [1, 2]) {
          const nx = myKing.x + dir.dx * steps;
          const ny = myKing.y + dir.dy * steps;
          if (!HF.inBoard(nx, ny)) continue;
          if (myPieces.some(p => p.id !== myKing.id && p.x === nx && p.y === ny)) continue;
          let d = 0;
          for (const tr of st.trails.filter(t => t.player !== myPlayer)) {
            for (const pt of tr.points) d = Math.max(d, 3 - Math.hypot(nx - pt.x, ny - pt.y));
          }
          for (const t of topTargets) {
            if (Math.hypot(nx - t.x, ny - t.y) < 2) d += t.prob * 5;
          }
          const s = -d + Math.random() * 0.3;
          if (s > bestKingScore) { bestKingScore = s; bestKingMove = { dx: dir.dx * steps, dy: dir.dy * steps }; }
        }
      }
      if (bestKingMove) {
        return { type: 'move', pieceId: myKing.id, dx: bestKingMove.dx, dy: bestKingMove.dy };
      }
    }

    // === 候选 1：激光发射 ===
    if (canLaser) {
      for (const anchor of myPieces) {
        const descs = [];
        for (const desc of targetedCurves({ x: anchor.x, y: anchor.y }, topTargets.slice(0, 3))) {
          descs.push(desc);
        }
        const exploreCount = HF.ai.difficulty === 2 ? 4 : (HF.ai.difficulty === 1 ? 2 : 1);
        for (const tmpl of AI_TEMPLATES) {
          for (let v = 0; v < exploreCount; v++) descs.push(tmpl(anchor.x, anchor.y));
        }

        for (const desc of descs) {
          const r = buildCurveSimple(desc);
          if (!r.ok) continue;
          const dist = HF.anchorDistance(r.curve, anchor.x, anchor.y);
          if (dist >= 0.5) continue;
          let score = expectedLaserScore(r.curve, { x: anchor.x, y: anchor.y }, anchor.id, myPlayer, prob);
          if (myKing.id !== anchor.id) {
            const myResult = HF.generateLaser(r.curve, { x: anchor.x, y: anchor.y }, [myKing], anchor.id, true);
            for (const pt of myResult.points) {
              if (Math.hypot(pt.x - myKing.x, pt.y - myKing.y) < 0.6) { score -= 200; break; }
            }
          }
          score += Math.random() * 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestAction = { type: 'laser', pieceId: anchor.id, curve: r.curve, label: r.label };
          }
        }
      }
    }

    // === 候选 2：埋设陷阱（未满上限，困难/普通难度才用） ===
    if (canTrap && HF.ai.difficulty >= 1) {
      // 策略 A：在己方王周围埋陷阱（防御）
      for (const dir of HF.DIRECTIONS) {
        const tx = myKing.x + dir.dx, ty = myKing.y + dir.dy;
        if (!HF.inBoard(tx, ty)) continue;
        if (myPieces.some(p => p.alive && p.x === tx && p.y === ty)) continue;
        if (st.players[myPlayer].traps.some(t => t.x === tx && t.y === ty)) continue;
        // 王周围有敌方轨迹经过时优先埋
        let trailNear = 0;
        for (const tr of st.trails.filter(t => t.player !== myPlayer)) {
          for (const pt of tr.points) {
            if (Math.hypot(pt.x - tx, pt.y - ty) < 1.5) trailNear += 1;
          }
        }
        if (trailNear > 0 || danger >= 1) {
          const score = 4 + trailNear * 2 + danger * 2 + Math.random() * 0.3;
          if (score > bestScore) {
            bestScore = score;
            bestAction = { type: 'trap', pieceId: myKing.id, x: tx, y: ty };
          }
        }
      }
      // 策略 B：在高概率敌方路径上埋陷阱（进攻，困难难度）
      if (HF.ai.difficulty === 2) {
        for (const t of topTargets.slice(0, 3)) {
          // 选离己方某棋子相邻的高概率格
          for (const piece of myPieces) {
            if (Math.hypot(piece.x - t.x, piece.y - t.y) > 3) continue;
            for (const dir of HF.DIRECTIONS) {
              const tx = piece.x + dir.dx, ty = piece.y + dir.dy;
              if (!HF.inBoard(tx, ty)) continue;
              if (myPieces.some(p => p.alive && p.x === tx && p.y === ty)) continue;
              if (st.players[myPlayer].traps.some(tr => tr.x === tx && tr.y === ty)) continue;
              const tp = prob.grid.get(tx + ',' + ty) || 0;
              const score = tp * 30 + 2 + Math.random() * 0.3;
              if (score > bestScore) {
                bestScore = score;
                bestAction = { type: 'trap', pieceId: piece.id, x: tx, y: ty };
              }
            }
          }
        }
      }
    }

    // === 候选 3：移动 ===
    const enemyKingGuess = prob.candidates[0];
    for (const piece of myPieces) {
      for (const dir of HF.DIRECTIONS) {
        for (const steps of [1, 2]) {
          const nx = piece.x + dir.dx * steps;
          const ny = piece.y + dir.dy * steps;
          if (!HF.inBoard(nx, ny)) continue;
          if (myPieces.some(p => p.id !== piece.id && p.x === nx && p.y === ny)) continue;
          let score = 0;
          if (piece.type === 'king') {
            let dng = 0;
            for (const t of topTargets) {
              if (Math.hypot(nx - t.x, ny - t.y) < 2) dng += t.prob * 10;
            }
            score = -dng;
          } else {
            if (enemyKingGuess) {
              const dOld = Math.hypot(piece.x - enemyKingGuess.x, piece.y - enemyKingGuess.y);
              const dNew = Math.hypot(nx - enemyKingGuess.x, ny - enemyKingGuess.y);
              score = (dOld - dNew) * 2;
            }
            const tp = prob.grid.get(nx + ',' + ny) || 0;
            score -= tp * 4;
          }
          score += Math.random() * 0.3;
          score -= 3;
          if (score > bestScore) {
            bestScore = score;
            bestAction = { type: 'move', pieceId: piece.id, dx: dir.dx * steps, dy: dir.dy * steps };
          }
        }
      }
    }

    // 简单难度：有概率随机行动
    if (HF.ai.difficulty === 0 && bestAction && Math.random() < 0.3) {
      const moves = [];
      for (const piece of myPieces) {
        for (const dir of HF.DIRECTIONS) {
          for (const steps of [1, 2]) {
            const nx = piece.x + dir.dx * steps, ny = piece.y + dir.dy * steps;
            if (HF.inBoard(nx, ny) && !myPieces.some(p => p.id !== piece.id && p.x === nx && p.y === ny)) {
              moves.push({ type: 'move', pieceId: piece.id, dx: dir.dx * steps, dy: dir.dy * steps });
            }
          }
        }
      }
      if (moves.length) return moves[Math.floor(Math.random() * moves.length)];
    }

    return bestAction;
  };
})();
