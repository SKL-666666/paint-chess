// ai.js — 人机对战 AI（玩家 B 由 AI 控制）
// 策略：概率图 + 期望收益评估 + 防御意识（公平，不窥探敌方真实位置）
(function () {
  'use strict';
  const HF = (window.HF = window.HF || {});
  HF.ai = {};

  // 难度：0=简单 1=普通 2=困难
  HF.ai.difficulty = 1;

  // ===== AI 布阵：王放死角，护卫声东击西分散进攻，禁止中线，强随机性 =====
  HF.ai.doSetup = function (player) {
    const st = HF.state;
    const minY = player === 'A' ? HF.SETUP_A_MIN_Y : HF.SETUP_B_MIN_Y;
    const maxY = player === 'A' ? HF.SETUP_A_MAX_Y : HF.SETUP_B_MAX_Y;
    const occupied = new Set();
    const key = (x, y) => x + ',' + y;
    // 禁止中线 y=0；布阵区不含中线时正常，含中线则排除
    const inZone = (x, y) => y >= minY && y <= maxY && y !== 0 && HF.inBoard(x, y);
    // 避开敌方已放置的棋子
    const enemy = player === 'A' ? 'B' : 'A';
    for (const pc of st.players[enemy].pieces) occupied.add(key(pc.x, pc.y));
    const placed = [];

    // 评估格点对王的隐蔽性：死角最高 + 障碍物遮挡 + 靠己方底线
    function concealment(x, y) {
      let score = 0;
      const isEdgeX = Math.abs(x) >= HF.BOARD_MAX - 1;
      const isBackY = player === 'A' ? (y <= minY + 0.5) : (y >= maxY - 0.5);
      if (isEdgeX && isBackY) score += 10;
      else if (isEdgeX || isBackY) score += 4;
      score += Math.abs(x) * 0.4;
      const edgeBonus = player === 'A' ? -y : y;
      score += edgeBonus * 0.6;
      for (const ob of st.obstacles) {
        const ocx = (ob.x1 + ob.x2) / 2, ocy = (ob.y1 + ob.y2) / 2;
        const d = Math.hypot(ocx - x, ocy - y);
        if (d > 0.5 && d < 3) score += 2.5;
        else if (d < 4) score += 1;
      }
      return score;
    }

    // 从候选中按分数取前 K 个，再随机选一个（增加随机性，避免每局相同）
    function pickFromCandidates(candidates, topK) {
      candidates.sort((a, b) => b.score - a.score);
      const k = Math.min(topK, candidates.length);
      return candidates[Math.floor(Math.random() * k)];
    }

    // 王：收集所有候选，取前4随机选
    const kingCands = [];
    for (let x = HF.BOARD_MIN; x <= HF.BOARD_MAX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (!inZone(x, y)) continue;
        kingCands.push({ x, y, score: concealment(x, y) + Math.random() * 0.5 });
      }
    }
    const kingPick = pickFromCandidates(kingCands, 4);
    if (!kingPick) return;  // 候选为空时安全退出
    const kingPos = { x: kingPick.x, y: kingPick.y };
    placed.push({ x: kingPos.x, y: kingPos.y, type: 'king' });
    occupied.add(key(kingPos.x, kingPos.y));

    // 护卫：声东击西 — 第1个贴王防御，后续分散向敌方推进
    function distToNearest(x, y) {
      let m = Infinity;
      for (const p of placed) m = Math.min(m, Math.hypot(x - p.x, y - p.y));
      return m;
    }
    for (let i = 0; i < HF.MAX_GUARDS; i++) {
      const guardCands = [];
      for (let x = HF.BOARD_MIN; x <= HF.BOARD_MAX; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (!inZone(x, y) || occupied.has(key(x, y))) continue;
          const dKing = Math.hypot(x - kingPos.x, y - kingPos.y);
          const dNear = distToNearest(x, y);
          let score = dNear * 1.5;
          if (i === 0) {
            if (dKing >= 1.5 && dKing <= 2.5) score += 6;
          } else {
            const enemyDir = player === 'A' ? y : -y;
            score += enemyDir * 1.0;
            if (dKing >= 3) score += 3;
            for (const p of placed) {
              if (p.type === 'guard') {
                if (p.x === x) score -= 4;
                if (p.y === y) score -= 3;
              }
            }
          }
          score += Math.random() * 1.2;  // 增大随机性
          guardCands.push({ x, y, score });
        }
      }
      const pick = pickFromCandidates(guardCands, 3);
      if (pick) {
        placed.push({ x: pick.x, y: pick.y, type: 'guard' });
        occupied.add(key(pick.x, pick.y));
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
  // 共振加成 + 未探索区域奖励 + 王命中权重
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
          score -= pc.type === 'king' ? 1000 : 15;
          break;
        }
      }
    }
    // 2. 期望敌方命中：曲线上每点找最近格点，累加概率
    const covered = new Set();
    const hitCells = [];
    // 收集己方历史轨迹覆盖的格点（打过的不加分）
    const explored = new Set();
    for (const tr of st.trails) {
      if (tr.player !== myPlayer) continue;
      for (const pt of tr.points) explored.add(Math.round(pt.x) + ',' + Math.round(pt.y));
    }
    for (const pt of result.points) {
      const gx = Math.round(pt.x), gy = Math.round(pt.y);
      const k = gx + ',' + gy;
      if (covered.has(k)) continue;
      const p = prob.grid.get(k);
      if (p && p > 0) {
        const kingChance = 1 / prob.aliveCount;
        let cellScore = p * (10 + kingChance * 100);  // 提高王命中权重
        // 未探索区域额外奖励（信息收集）
        if (!explored.has(k)) cellScore *= 1.3;
        score += cellScore;
        covered.add(k);
        hitCells.push({ x: gx, y: gy, prob: p });
      }
    }
    // 3. 共振连锁加成
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
  // 判断曲线描述是否为强大函数（三角/参数化）
  function isPowerfulDesc(desc) {
    if (desc.kind === 'param') return true;
    const expr = desc.expr || '';
    return /sin|cos|tan|tanh/.test(expr);
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

  // ===== AI 决策（类人化：局势判断 → 战略选择 → 战术执行） =====
  HF.ai.decide = function (myPlayer) {
    const st = HF.state;
    const enemyPlayer = myPlayer === 'A' ? 'B' : 'A';
    const myPieces = st.players[myPlayer].pieces.filter(p => p.alive);
    const myKing = myPieces.find(p => p.type === 'king');
    if (!myKing) return null;

    const prob = HF.ai.enemyProbMap(enemyPlayer);
    if (prob.aliveCount === 0) return null;
    const topTargets = prob.candidates.slice(0, 6);
    const enemyKingGuess = prob.candidates[0];  // 最可能是王的位置
    const myTraps = st.players[myPlayer].traps.length;
    const canLaser = true;
    const canTrap = myTraps < HF.MAX_TRAPS && st.difficulty >= 1;

    // === 局势判断 ===
    const danger = kingDanger(myPlayer);
    const myGuardCount = myPieces.filter(p => p.type === 'guard').length;
    const enemyGuardCount = Math.max(0, prob.aliveCount - 1);  // 敌方护卫数 = 存活数 - 王
    const isLateGame = myGuardCount <= 2 || enemyGuardCount <= 2;
    const isWinning = myGuardCount > enemyGuardCount;
    const myBlock = st.difficulty === 2 ? st.mandatoryBlocks[myPlayer] : null;

    let bestAction = null;
    let bestScore = -Infinity;

    // === 1. 防御优先：王高危时立即应对 ===
    if (danger >= 2 && HF.ai.difficulty >= 1) {
      const enemyTrails = st.trails.filter(t => t.player !== myPlayer);
      if (enemyTrails.length) {
        const lastTrail = enemyTrails[enemyTrails.length - 1];
        let nearestEnemyPt = null, ned = Infinity;
        for (const pt of lastTrail.points) {
          const d = Math.hypot(pt.x - myKing.x, pt.y - myKing.y);
          if (d < ned) { ned = d; nearestEnemyPt = pt; }
        }
        if (nearestEnemyPt) {
          // 策略A：护卫挡枪（移到王与敌方轨迹连线中点）
          const bx = Math.round((myKing.x + nearestEnemyPt.x) / 2);
          const by = Math.round((myKing.y + nearestEnemyPt.y) / 2);
          let bestBlocker = null, bestBlockScore = -Infinity;
          for (const guard of myPieces.filter(p => p.type === 'guard')) {
            for (const dir of HF.DIRECTIONS) {
              for (const steps of [1, 2]) {
                const nx = guard.x + dir.dx * steps, ny = guard.y + dir.dy * steps;
                if (!HF.inBoard(nx, ny)) continue;
                if (myPieces.some(p => p.id !== guard.id && p.x === nx && p.y === ny)) continue;
                const distToBlock = Math.hypot(nx - bx, ny - by);
                let s = -distToBlock * 3;
                if (distToBlock < 0.5) s += 10;
                s += Math.random() * 0.3;
                if (s > bestBlockScore) { bestBlockScore = s; bestBlocker = { pieceId: guard.id, dx: dir.dx * steps, dy: dir.dy * steps }; }
              }
            }
          }
          if (bestBlocker && bestBlockScore > 4) {
            return { type: 'move', pieceId: bestBlocker.pieceId, dx: bestBlocker.dx, dy: bestBlocker.dy };
          }
        }
      }
      // 策略B：王逃跑（远离所有敌方轨迹和高概率区）
      let bestKingMove = null, bestKingScore = -Infinity;
      for (const dir of HF.DIRECTIONS) {
        for (const steps of [1, 2]) {
          const nx = myKing.x + dir.dx * steps;
          const ny = myKing.y + dir.dy * steps;
          if (!HF.inBoard(nx, ny)) continue;
          if (myPieces.some(p => p.id !== myKing.id && p.x === nx && p.y === ny)) continue;
          let threat = 0;
          for (const tr of st.trails.filter(t => t.player !== myPlayer)) {
            for (const pt of tr.points) threat = Math.max(threat, 3 - Math.hypot(nx - pt.x, ny - pt.y));
          }
          for (const t of topTargets) {
            if (Math.hypot(nx - t.x, ny - t.y) < 2) threat += t.prob * 5;
          }
          // 类人：逃跑时偏向己方底线（安全区）
          const safeBias = myPlayer === 'A' ? -ny * 0.3 : ny * 0.3;
          const s = -threat + safeBias + Math.random() * 0.3;
          if (s > bestKingScore) { bestKingScore = s; bestKingMove = { dx: dir.dx * steps, dy: dir.dy * steps }; }
        }
      }
      if (bestKingMove) {
        return { type: 'move', pieceId: myKing.id, dx: bestKingMove.dx, dy: bestKingMove.dy };
      }
    }

    // === 2. 激光射击评估 ===
    if (canLaser) {
      // 类人：优先用最靠近敌方概率密集区的锚点射击
      const anchorsByProximity = myPieces.map(pc => {
        let nearness = 0;
        for (const t of topTargets) nearness += t.prob / (1 + Math.hypot(pc.x - t.x, pc.y - t.y));
        return { piece: pc, nearness };
      }).sort((a, b) => b.nearness - a.nearness);

      for (const { piece: anchor } of anchorsByProximity) {
        const descs = [];
        // 针对性曲线：穿过高概率目标
        for (const desc of targetedCurves({ x: anchor.x, y: anchor.y }, topTargets.slice(0, 3))) {
          descs.push(desc);
        }
        // 强制方块曲线
        if (myBlock) {
          for (const desc of targetedCurves({ x: anchor.x, y: anchor.y }, [myBlock])) {
            descs.push(desc);
          }
        }
        // 通用模板探索
        const exploreCount = HF.ai.difficulty === 2 ? 5 : (HF.ai.difficulty === 1 ? 3 : 1);
        for (const tmpl of AI_TEMPLATES) {
          for (let v = 0; v < exploreCount; v++) descs.push(tmpl(anchor.x, anchor.y));
        }

        for (const desc of descs) {
          const r = buildCurveSimple(desc);
          if (!r.ok) continue;
          if (isPowerfulDesc(desc) && st.powerfulLaserCredits[myPlayer] <= 0) continue;
          const dist = HF.anchorDistance(r.curve, anchor.x, anchor.y);
          if (dist >= 0.5) continue;
          // 强制方块检查（硬过滤：不合规直接跳过，避免违规判负）
          const passesBlock = myBlock ? HF.checkMandatoryBlock(r.curve, myPlayer) : true;
          if (myBlock && !passesBlock) continue;
          let score = expectedLaserScore(r.curve, { x: anchor.x, y: anchor.y }, anchor.id, myPlayer, prob);
          // 避免误伤己方王
          if (myKing.id !== anchor.id) {
            const myResult = HF.generateLaser(r.curve, { x: anchor.x, y: anchor.y }, [myKing], anchor.id, true);
            for (const pt of myResult.points) {
              if (Math.hypot(pt.x - myKing.x, pt.y - myKing.y) < 0.6) { score -= 200; break; }
            }
          }
          // 类人：强力函数留到关键时刻（残局或能击杀王时加分）
          if (isPowerfulDesc(desc)) {
            if (isLateGame) score += 5;  // 残局值得用
            else score -= 3;             // 开局不浪费
          }
          // 近期曲线降分
          if (isRecentCurve(r.label)) score -= 5;
          score += Math.random() * 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestAction = { type: 'laser', pieceId: anchor.id, curve: r.curve, label: r.label };
          }
        }
      }
    }

    // === 3. 陷阱策略（类人：防御+进攻双线） ===
    if (canTrap) {
      // 策略A：王周围防御陷阱（仅危险时或早期）
      if (danger >= 1 || myTraps === 0) {
        for (const dir of HF.DIRECTIONS) {
          const tx = myKing.x + dir.dx, ty = myKing.y + dir.dy;
          if (!HF.inBoard(tx, ty)) continue;
          if (myPieces.some(p => p.alive && p.x === tx && p.y === ty)) continue;
          if (st.players[myPlayer].traps.some(t => t.x === tx && t.y === ty)) continue;
          let trailNear = 0;
          for (const tr of st.trails.filter(t => t.player !== myPlayer)) {
            for (const pt of tr.points) {
              if (Math.hypot(pt.x - tx, pt.y - ty) < 1.5) trailNear += 1;
            }
          }
          if (trailNear > 0 || danger >= 1) {
            const score = 5 + trailNear * 2 + danger * 3 + Math.random() * 0.3;
            if (score > bestScore) {
              bestScore = score;
              bestAction = { type: 'trap', pieceId: myKing.id, x: tx, y: ty };
            }
          }
        }
      }
      // 策略B：进攻陷阱埋在敌方高概率路径上（困难难度）
      if (HF.ai.difficulty === 2) {
        for (const t of topTargets.slice(0, 4)) {
          for (const piece of myPieces) {
            if (Math.hypot(piece.x - t.x, piece.y - t.y) > 3) continue;
            for (const dir of HF.DIRECTIONS) {
              const tx = piece.x + dir.dx, ty = piece.y + dir.dy;
              if (!HF.inBoard(tx, ty)) continue;
              if (myPieces.some(p => p.alive && p.x === tx && p.y === ty)) continue;
              if (st.players[myPlayer].traps.some(tr => tr.x === tx && tr.y === ty)) continue;
              const tp = prob.grid.get(tx + ',' + ty) || 0;
              // 类人：优先埋在敌方可能移动到的格点（路径预测）
              const score = tp * 35 + 3 + Math.random() * 0.3;
              if (score > bestScore) {
                bestScore = score;
                bestAction = { type: 'trap', pieceId: piece.id, x: tx, y: ty };
              }
            }
          }
        }
      }
    }

    // === 4. 移动策略（类人：局势驱动——劣势保守、优势进攻） ===
    // 为每个护卫分配不同进攻目标（声东击西）
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
            // 王：仅劣势且危险时才移动，否则不动
            if (!isWinning && danger >= 1) {
              let dng = 0;
              for (const t of topTargets) {
                if (Math.hypot(nx - t.x, ny - t.y) < 2) dng += t.prob * 10;
              }
              score = -dng + 1;  // 给点基础分鼓励移动
            } else {
              continue;  // 优势时不挪王
            }
          } else {
            const myTarget = assignTargets[piece.id] || enemyKingGuess;
            if (myTarget) {
              const dOld = Math.hypot(piece.x - myTarget.x, piece.y - myTarget.y);
              const dNew = Math.hypot(nx - myTarget.x, ny - myTarget.y);
              score = (dOld - dNew) * 2.5;
            }
            const tp = prob.grid.get(nx + ',' + ny) || 0;
            score -= tp * 4;
            // 类人：劣势时护卫回防王（靠近己方王）
            if (!isWinning) {
              const dKingOld = Math.hypot(piece.x - myKing.x, piece.y - myKing.y);
              const dKingNew = Math.hypot(nx - myKing.x, ny - myKing.y);
              if (dKingNew < dKingOld && dKingNew <= 3) score += 2;
            }
            // 类人：优势时护卫激进推进（靠近敌方区域）
            if (isWinning) {
              const enemyDir = myPlayer === 'A' ? ny : -ny;
              score += enemyDir * 0.5;
            }
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

    // 类人：无强力额度且当前行动收益不高时，跳过回合积攒额度（残局更倾向跳过）
    if (st.powerfulLaserCredits[myPlayer] <= 0 && bestScore < 8) {
      const skipChance = isLateGame ? 0.45 : 0.2;
      if (Math.random() < skipChance) {
        return { type: 'skip' };
      }
    }

    return bestAction;
  };
})();
