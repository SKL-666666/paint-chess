// ai.js — 人机对战 AI（玩家 B 由 AI 控制）
// 策略：概率图 + 期望收益评估 + 防御意识（公平，不窥探敌方真实位置）
(function () {
  'use strict';
  const HF = (window.HF = window.HF || {});
  HF.ai = {};

  // 难度：0=简单 1=普通 2=困难
  HF.ai.difficulty = 1;

  // ===== AI 布阵：王放死角，护卫声东击西分散进攻 =====
  HF.ai.doSetup = function (player) {
    const st = HF.state;
    const minY = player === 'A' ? HF.SETUP_A_MIN_Y : HF.SETUP_B_MIN_Y;
    const maxY = player === 'A' ? HF.SETUP_A_MAX_Y : HF.SETUP_B_MAX_Y;
    const occupied = new Set();
    const key = (x, y) => x + ',' + y;
    const inZone = (x, y) => y >= minY && y <= maxY && HF.inBoard(x, y);
    // 共享中线：避开敌方已放置的棋子
    const enemy = player === 'A' ? 'B' : 'A';
    for (const pc of st.players[enemy].pieces) occupied.add(key(pc.x, pc.y));
    const placed = [];

    // 评估格点对王的隐蔽性：死角最高 + 障碍物遮挡 + 靠己方底线
    function concealment(x, y) {
      let score = 0;
      // 死角（靠边 + 靠底线）最高分
      const isEdgeX = Math.abs(x) >= HF.BOARD_MAX - 1;
      const isBackY = player === 'A' ? (y <= minY + 0.5) : (y >= maxY - 0.5);
      if (isEdgeX && isBackY) score += 10;        // 真正的死角
      else if (isEdgeX || isBackY) score += 4;    // 靠边
      score += Math.abs(x) * 0.4;                  // 越靠边越好
      const edgeBonus = player === 'A' ? -y : y;   // 靠近己方底线
      score += edgeBonus * 0.6;
      // 障碍物近距遮挡（0.5~3 格内最佳）
      for (const ob of st.obstacles) {
        const ocx = (ob.x1 + ob.x2) / 2, ocy = (ob.y1 + ob.y2) / 2;
        const d = Math.hypot(ocx - x, ocy - y);
        if (d > 0.5 && d < 3) score += 2.5;
        else if (d < 4) score += 1;
      }
      return score;
    }

    // 王：选隐蔽性最高的格点（死角优先）
    let kingPos = null, kingScore = -Infinity;
    for (let x = HF.BOARD_MIN; x <= HF.BOARD_MAX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (!inZone(x, y)) continue;
        const s = concealment(x, y) + Math.random() * 0.2;
        if (s > kingScore) { kingScore = s; kingPos = { x, y }; }
      }
    }
    placed.push({ x: kingPos.x, y: kingPos.y, type: 'king' });
    occupied.add(key(kingPos.x, kingPos.y));

    // 护卫：声东击西 — 第1个贴王防御，后续分散向敌方推进
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
          let score = dNear * 1.5;  // 分散
          if (i === 0) {
            // 第1护卫：贴王防御（距离1.5~2.5）
            if (dKing >= 1.5 && dKing <= 2.5) score += 6;
          } else {
            // 后续护卫：向敌方推进（声东击西）
            const enemyDir = player === 'A' ? y : -y;  // 越靠近敌方越好
            score += enemyDir * 1.0;
            if (dKing >= 3) score += 3;  // 远离王
            // 避免与已有护卫在同一线（防一条曲线全灭）
            for (const p of placed) {
              if (p.type === 'guard') {
                if (p.x === x) score -= 4;
                if (p.y === y) score -= 3;
              }
            }
          }
          score += Math.random() * 0.4;
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
    // 敌方布阵区：中线到倒数第二排之间 + 移动可达区域
    const enemySetupMinY = enemyPlayer === 'A' ? HF.SETUP_A_MIN_Y : HF.SETUP_B_MIN_Y;
    const enemySetupMaxY = enemyPlayer === 'A' ? HF.SETUP_A_MAX_Y : HF.SETUP_B_MAX_Y;
    const grid = new Map();
    const aliveEnemies = st.players[enemyPlayer].pieces.filter(p => p.alive);
    const aliveCount = aliveEnemies.length;
    if (aliveCount === 0) return { grid, candidates: [], aliveCount: 0 };

    // 基础概率：敌方可能在的 y 范围（布阵区 ± 4 格移动范围）
    const enemyMinY = enemyPlayer === 'A' ? Math.max(HF.BOARD_MIN, enemySetupMinY - 4) : enemySetupMinY;
    const enemyMaxY = enemyPlayer === 'B' ? Math.min(HF.BOARD_MAX, enemySetupMaxY + 4) : enemySetupMaxY;
    const cells = [];
    for (let x = HF.BOARD_MIN; x <= HF.BOARD_MAX; x++) {
      for (let y = enemyMinY; y <= enemyMaxY; y++) cells.push({ x, y });
    }
    // 布阵区内概率更高
    for (const c of cells) {
      const inSetup = c.y >= enemySetupMinY && c.y <= enemySetupMaxY;
      const boost = inSetup ? 2 : 1;
      grid.set(c.x + ',' + c.y, boost);
    }
    let total = 0;
    for (const v of grid.values()) total += v;
    if (total > 0) for (const [k, v] of grid) grid.set(k, v / total);

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
    total = 0;
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

  // 通用模板（随机探索）— 多样化曲线
  const AI_TEMPLATES = [
    (ax, ay) => { const a = (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 2.5); return { kind: 'explicit', expr: 'y=' + fmt(a) + '*x+' + fmt(ay - a * ax) }; },
    (ax, ay) => ({ kind: 'explicit', expr: 'y=' + fmt(ay) }),
    (ax, ay) => ({ kind: 'explicit', expr: 'x=' + fmt(ax) }),
    (ax, ay) => { const a = (Math.random() > 0.5 ? 1 : -1) * (0.05 + Math.random() * 0.4); return { kind: 'explicit', expr: 'y=' + fmt(a) + '*x^2+' + fmt(ay - a * ax * ax) }; },
    (ax, ay) => { const a = 0.8 + Math.random() * 2; const b = 0.3 + Math.random() * 1.2; return { kind: 'explicit', expr: 'y=' + fmt(a) + '*sin(' + fmt(b) + '*x+' + fmt(-b * ax) + ')' }; },
    (ax, ay) => { const a = 0.8 + Math.random() * 2; const b = 0.3 + Math.random() * 1.2; return { kind: 'explicit', expr: 'y=' + fmt(a) + '*cos(' + fmt(b) + '*x+' + fmt(-b * ax) + ')' }; },
    (ax, ay) => { const a = (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 1.5); const b = (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 1.5); return { kind: 'explicit', expr: 'y=' + fmt(a) + '*abs(' + fmt(b) + '*(x-' + fmt(ax) +'))+' + fmt(ay) }; },
    (ax, ay) => { const a = (Math.random() > 0.5 ? 1 : -1) * (0.02 + Math.random() * 0.15); return { kind: 'explicit', expr: 'y=' + fmt(a) + '*x^3+' + fmt(ay - a * ax * ax * ax) }; },
    (ax, ay) => { const a = 1 + Math.random() * 2; return { kind: 'explicit', expr: 'y=' + fmt(a) + '*tanh(x-' + fmt(ax) + ')+' + fmt(ay) }; },
    (ax, ay) => { const a = 1 + Math.random() * 2; return { kind: 'explicit', expr: 'y=' + fmt(a) + '*exp(-0.3*(x-' + fmt(ax) +')^2)+' + fmt(ay) }; },
  ];

  // 记录 AI 近期用过的曲线标签，避免重复
  HF.ai.recentLasers = [];
  const MAX_RECENT = 3;

  function isRecentCurve(label) {
    return HF.ai.recentLasers.indexOf(label) >= 0;
  }
  function recordLaser(label) {
    HF.ai.recentLasers.push(label);
    if (HF.ai.recentLasers.length > MAX_RECENT) HF.ai.recentLasers.shift();
  }

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
      // 困难模式：强制方块目标
      const myBlock = st.difficulty === 2 ? st.mandatoryBlocks[myPlayer] : null;
      for (const anchor of myPieces) {
        const descs = [];
        for (const desc of targetedCurves({ x: anchor.x, y: anchor.y }, topTargets.slice(0, 3))) {
          descs.push(desc);
        }
        // 困难模式：生成经过锚点+强制方块的曲线
        if (myBlock) {
          for (const desc of targetedCurves({ x: anchor.x, y: anchor.y }, [myBlock])) {
            descs.push(desc);
          }
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
          // 生成激光轨迹用于检查强制方块
          const laserRes = HF.generateLaser(r.curve, { x: anchor.x, y: anchor.y }, [], anchor.id, true);
          const passesBlock = myBlock ? HF.checkMandatoryBlock(laserRes.points, myPlayer) : true;
          // 困难模式：未经过强制方块的曲线大幅降分（发射即判负）
          let blockPenalty = 0;
          if (myBlock && !passesBlock) blockPenalty = 2000;
          let score = expectedLaserScore(r.curve, { x: anchor.x, y: anchor.y }, anchor.id, myPlayer, prob);
          score -= blockPenalty;
          if (myKing.id !== anchor.id) {
            const myResult = HF.generateLaser(r.curve, { x: anchor.x, y: anchor.y }, [myKing], anchor.id, true);
            for (const pt of myResult.points) {
              if (Math.hypot(pt.x - myKing.x, pt.y - myKing.y) < 0.6) { score -= 200; break; }
            }
          }
          // 近期用过的曲线降分，鼓励多样性
          if (isRecentCurve(r.label)) score -= 5;
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

    // === 候选 3：移动（分散进攻，不同护卫瞄准不同目标） ===
    const enemyKingGuess = prob.candidates[0];
    // 为每个护卫分配不同进攻目标（声东击西，避免集中）
    const guards = myPieces.filter(p => p.type === 'guard');
    const assignTargets = [];
    for (let gi = 0; gi < guards.length; gi++) {
      const ti = gi % Math.min(topTargets.length, guards.length);
      assignTargets[guards[gi].id] = topTargets[ti] || enemyKingGuess;
    }
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
            // 分散进攻：每个护卫追自己分配的目标
            const myTarget = assignTargets[piece.id] || enemyKingGuess;
            if (myTarget) {
              const dOld = Math.hypot(piece.x - myTarget.x, piece.y - myTarget.y);
              const dNew = Math.hypot(nx - myTarget.x, ny - myTarget.y);
              score = (dOld - dNew) * 2.5;
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
