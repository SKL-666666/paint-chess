// game-state.js — 游戏状态、障碍物生成、布阵、回合、胜负判定
(function () {
  'use strict';
  const HF = (window.HF = window.HF || {});

  HF.BOARD_MIN = -5;
  HF.BOARD_MAX = 5;
  // 布阵区：双方共享中线 y=0（A:y∈[-3,0], B:y∈[0,3]）
  HF.SETUP_A_MIN_Y = -3;  // A 最后（靠底线）
  HF.SETUP_A_MAX_Y = 0;   // A 最前（中线，与 B 共享）
  HF.SETUP_B_MIN_Y = 0;   // B 最前（中线，与 A 共享）
  HF.SETUP_B_MAX_Y = 3;   // B 最后（靠底线）
  HF.MAX_GUARDS = 4;

  // 创新玩法常量
  HF.MAX_TRAPS = 3;               // 每方最多陷阱数
  HF.RESONANCE_RADIUS = 1.0;      // 共振连锁半径
  HF._nextPieceId = 0;            // 棋子ID单调递增计数器（避免重复）

  // 8 个移动方向
  HF.DIRECTIONS = [
    { dx: 0, dy: 1, name: '上' },
    { dx: 0, dy: -1, name: '下' },
    { dx: 1, dy: 0, name: '右' },
    { dx: -1, dy: 0, name: '左' },
    { dx: 1, dy: 1, name: '右上' },
    { dx: 1, dy: -1, name: '右下' },
    { dx: -1, dy: 1, name: '左上' },
    { dx: -1, dy: -1, name: '左下' },
  ];

  function freshState() {
    return {
      phase: 'title',          // title|handoff|setup|play|result
      mode: '2p',              // 2p|ai|net  （ai 模式下 B 为 AI，net 为联机）
      difficulty: 1,           // 0=简单 1=普通 2=困难（所有模式通用）
      handoffReason: '',       // 交接屏文案
      setupPlayer: 'A',        // 布阵当前玩家
      setupType: 'king',       // 布阵待放类型
      turn: 'A',               // 当前回合玩家
      myRole: null,            // 联机模式下本机角色 'A'|'B'
      players: {
        A: { pieces: [], traps: [] },
        B: { pieces: [], traps: [] },
      },
      obstacles: [],
      trails: [],              // 历史激光轨迹
      currentLaser: null,      // 本回合激光 {points, hits, startTime}
      explosions: [],          // {x,y,startTime}
      turnCount: 1,
      playerTurnCount: { A: 0, B: 0 },  // 各玩家自己的回合数（困难模式方块刷新用）
      mandatoryBlocks: { A: null, B: null }, // 困难模式强制方块 {x,y}
      winner: null,            // null|'A'|'B'|'draw'
      winReason: '',
      selectedPieceId: null,
      actionMode: 'move',      // move|laser|trap
      busy: false,             // 动作动画进行中，禁止操作
      previewLaser: null,      // 预览激光轨迹（未发射，实时渲染）
      resonanceChain: null,    // 共振连锁动画 {chains, startTime}
      powerfulLaserCredits: { A: 0, B: 0 },  // 强力函数额度（按玩家区分，跳过回合+1）
    };
  }
  // 强大函数类型：三角函数、椭圆、玫瑰线、螺旋线、心形线、双纽线（覆盖面广）
  HF.POWERFUL_PRESETS = ['sin', 'cos', 'tan', 'tanh', '椭圆', '玫瑰线', '螺旋线', '心形线', '双纽线', '正弦+余弦'];

  HF.newGame = function () {
    HF.state = freshState();
    HF.state.obstacles = HF.generateObstacles();
    HF._nextPieceId = 0;  // 重置ID计数器
    if (HF.ai && HF.ai.recentLasers) HF.ai.recentLasers = [];  // 重置AI曲线记忆
  };

  // 生成 4 块镜面线段，位置与角度全随机，4 块位于棋盘 4 个不同象限确保分散
  HF.generateObstacles = function () {
    const segs = [];
    // 4 个象限的中心，确保 4 块镜子在不同位置
    const quadrants = [
      { cx: -2.5, cy: -1.2 },  // 左下
      { cx: 2.5, cy: -1.2 },   // 右下
      { cx: -2.5, cy: 1.2 },   // 左上
      { cx: 2.5, cy: 1.2 },    // 右上
    ];
    for (const q of quadrants) {
      let placed = false;
      for (let attempt = 0; attempt < 50 && !placed; attempt++) {
        // 在象限中心附近随机偏移
        const cx = q.cx + (Math.random() - 0.5) * 1.5;
        const cy = q.cy + (Math.random() - 0.5) * 0.8;
        const ang = Math.random() * Math.PI;
        const len = 1.2 + Math.random() * 1.5;       // 1.2..2.7
        const dx = Math.cos(ang) * len / 2;
        const dy = Math.sin(ang) * len / 2;
        const seg = {
          x1: cx - dx, y1: cy - dy,
          x2: cx + dx, y2: cy + dy,
        };
        if (seg.x1 < -4.5 || seg.x1 > 4.5 || seg.x2 < -4.5 || seg.x2 > 4.5) continue;
        if (Math.abs(seg.y1) > 2.5 || Math.abs(seg.y2) > 2.5) continue;
        // 与已有线段保持距离
        const ok = segs.every(s => segDist(seg, s) > 0.5);
        if (!ok) continue;
        segs.push(seg);
        placed = true;
      }
    }
    return segs;
  };

  // 两线段最短距离（a 端点到 b 线段，b 端点到 a 线段，不含自身）
  function segDist(a, b) {
    let m = Infinity;
    // a 的端点到 b 线段
    m = Math.min(m, pointSeg(a.x1, a.y1, b), pointSeg(a.x2, a.y2, b));
    // b 的端点到 a 线段
    m = Math.min(m, pointSeg(b.x1, b.y1, a), pointSeg(b.x2, b.y2, a));
    return m;
  }
  function pointSeg(px, py, seg) {
    return HF.math ? HF.math.distPointToSegment({ x: px, y: py }, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 })
      : Math.hypot(px - seg.x1, py - seg.y1);
  }

  // ===== 布阵 =====
  HF.placeSetupPiece = function (player, type, x, y) {
    const st = HF.state;
    if (!inSetupZone(player, y)) return { ok: false, msg: '只能在布阵区内放置（A:y∈[-3,0] B:y∈[0,3]）' };
    if (occupied(st, player, x, y)) return { ok: false, msg: '该格已有己方棋子' };
    // 共享中线 y=0：不能放在敌方已占用的格子上
    const enemy = player === 'A' ? 'B' : 'A';
    if (st.players[enemy].pieces.some(pc => pc.x === x && pc.y === y)) return { ok: false, msg: '该格已被占用' };
    const p = st.players[player].pieces;
    const kings = p.filter(pc => pc.type === 'king').length;
    const guards = p.filter(pc => pc.type === 'guard').length;
    if (type === 'king' && kings >= 1) return { ok: false, msg: '王只能放置 1 枚' };
    if (type === 'guard' && guards >= HF.MAX_GUARDS) return { ok: false, msg: '护卫最多 4 枚' };
    p.push({ id: `${player}-${HF._nextPieceId++}`, type, x, y, alive: true });
    return { ok: true };
  };

  HF.removeSetupPiece = function (player, x, y) {
    const p = HF.state.players[player].pieces;
    const i = p.findIndex(pc => pc.x === x && pc.y === y);
    if (i >= 0) { p.splice(i, 1); return true; }
    return false;
  };

  HF.setupComplete = function (player) {
    const p = HF.state.players[player].pieces;
    return p.filter(x => x.type === 'king').length === 1
      && p.filter(x => x.type === 'guard').length === HF.MAX_GUARDS;
  };

  function inSetupZone(player, y) {
    // 布阵区：中线到倒数第二排之间（禁止最后两排靠边）
    if (player === 'A') return y >= HF.SETUP_A_MIN_Y && y <= HF.SETUP_A_MAX_Y;
    return y >= HF.SETUP_B_MIN_Y && y <= HF.SETUP_B_MAX_Y;
  }
  function occupied(st, player, x, y) {
    return st.players[player].pieces.some(pc => pc.x === x && pc.y === y);
  }

  // ===== 移动 =====
  // dx,dy 为 8 方向 × 1 或 2 步（|dx|,|dy| ∈ {0,1,2} 且 |dx|==|dy| 或其一为0）
  // 返回 { ok, collision, trapHit, deadMine, deadEnemy, kingDead, moved }
  HF.movePiece = function (player, pieceId, dx, dy) {
    const st = HF.state;
    const mine = st.players[player].pieces.find(p => p.id === pieceId && p.alive);
    if (!mine) return { ok: false, msg: '棋子不存在' };
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const legal = (adx === ady || adx === 0 || ady === 0) && Math.max(adx, ady) <= 2 && Math.max(adx, ady) >= 1;
    if (!legal) return { ok: false, msg: '非法移动方向' };
    const nx = mine.x + dx, ny = mine.y + dy;
    if (nx < HF.BOARD_MIN || nx > HF.BOARD_MAX || ny < HF.BOARD_MIN || ny > HF.BOARD_MAX)
      return { ok: false, msg: '越界' };
    if (st.players[player].pieces.some(p => p.alive && p.x === nx && p.y === ny))
      return { ok: false, msg: '目标格有己方棋子' };

    const enemy = player === 'A' ? 'B' : 'A';
    const enemyPiece = st.players[enemy].pieces.find(p => p.alive && p.x === nx && p.y === ny);
    // 陷阱检测：敌方陷阱在目标格
    const enemyTraps = st.players[enemy].traps;
    const trapIdx = enemyTraps.findIndex(t => t.x === nx && t.y === ny);

    let res = { ok: true, collision: false, trapHit: false, kingDead: [], moved: null };
    if (enemyPiece) {
      mine.alive = false;
      enemyPiece.alive = false;
      res.collision = true;
      res.deadMine = mine;
      res.deadEnemy = enemyPiece;
      if (mine.type === 'king') res.kingDead.push(player);
      if (enemyPiece.type === 'king') res.kingDead.push(enemy);
      st.explosions.push({ x: nx, y: ny, startTime: performance.now() });
    } else if (trapIdx >= 0) {
      // 踩中敌方陷阱：移动方死亡，陷阱消耗
      mine.alive = false;
      res.trapHit = true;
      res.deadMine = mine;
      if (mine.type === 'king') res.kingDead.push(player);
      enemyTraps.splice(trapIdx, 1);
      st.explosions.push({ x: nx, y: ny, startTime: performance.now() });
    } else {
      mine.x = nx; mine.y = ny;
      res.moved = mine;
    }
    return res;
  };

  // ===== 埋设陷阱 =====
  // 在 (x,y) 埋设陷阱，消耗本回合
  HF.placeTrap = function (player, x, y) {
    const st = HF.state;
    if (!HF.inBoard(x, y)) return { ok: false, msg: '越界' };
    if (st.players[player].traps.length >= HF.MAX_TRAPS) return { ok: false, msg: '陷阱已达上限(' + HF.MAX_TRAPS + ')' };
    if (st.players[player].traps.some(t => t.x === x && t.y === y)) return { ok: false, msg: '该格已有陷阱' };
    // 不能埋在己方棋子下
    if (st.players[player].pieces.some(p => p.alive && p.x === x && p.y === y)) return { ok: false, msg: '不能在己方棋子上埋陷阱' };
    // 不能埋在敌方棋子上（会暴露位置）
    const enemy = player === 'A' ? 'B' : 'A';
    if (st.players[enemy].pieces.some(p => p.alive && p.x === x && p.y === y)) return { ok: false, msg: '该格不可用' };
    st.players[player].traps.push({ x, y });
    return { ok: true };
  };

  // ===== 共振连锁 =====
  // 激光命中后，命中点 RESONANCE_RADIUS 内的其他存活棋子被连锁引爆
  // hitPoints: [{x, y}] 命中点列表
  // 返回 { newlyKilled, chains }
  HF.applyResonance = function (hitPoints) {
    const st = HF.state;
    const chains = [];
    const newlyKilled = [];
    const deadSet = new Set();
    for (const hp of hitPoints) {
      const chain = { source: { x: hp.x, y: hp.y }, targets: [] };
      for (const playerKey of ['A', 'B']) {
        for (const pc of st.players[playerKey].pieces) {
          if (!pc.alive) continue;
          if (deadSet.has(pc)) continue;
          const d = Math.hypot(pc.x - hp.x, pc.y - hp.y);
          if (d <= HF.RESONANCE_RADIUS && d > 0.01) {
            pc.alive = false;
            deadSet.add(pc);
            newlyKilled.push(pc);
            chain.targets.push({ x: pc.x, y: pc.y, owner: playerKey, type: pc.type });
            st.explosions.push({ x: pc.x, y: pc.y, startTime: performance.now() });
          }
        }
      }
      if (chain.targets.length) chains.push(chain);
    }
    if (chains.length) {
      st.resonanceChain = { chains, startTime: performance.now() };
    }
    return { newlyKilled, chains };
  };

  // ===== 胜负判定 =====
  // 检查当前是否有人胜，设置 winner / winReason
  // 联机模式下，若对方棋子未同步（列表为空），跳过对方王存活判定，避免误判
  HF.checkWin = function (context) {
    const st = HF.state;
    const kingA = st.players.A.pieces.find(p => p.type === 'king' && p.alive);
    const kingB = st.players.B.pieces.find(p => p.type === 'king' && p.alive);
    const aAlive = !!kingA, bAlive = !!kingB;
    // 联机模式：双方棋子必须都已同步（列表非空）才判胜负
    if (st.mode === 'net') {
      const aHasPieces = st.players.A.pieces.length > 0;
      const bHasPieces = st.players.B.pieces.length > 0;
      if (!aHasPieces || !bHasPieces) return false;
    }
    if (!aAlive && !bAlive) {
      st.winner = 'draw'; st.winReason = '双方王同时陨落'; st.phase = 'result'; return true;
    }
    if (!aAlive) {
      st.winner = 'B'; st.winReason = kingWinReason(context, 'B'); st.phase = 'result'; return true;
    }
    if (!bAlive) {
      st.winner = 'A'; st.winReason = kingWinReason(context, 'A'); st.phase = 'result'; return true;
    }
    return false;
  };

  function kingWinReason(ctx, winner) {
    if (!ctx) return '敌王已亡';
    if (ctx.cause === 'laser') {
      const shooter = ctx.shooter;
      const victim = winner === 'A' ? 'B' : 'A';
      if (shooter === winner) return '激光斩首敌王';
      return `${shooter} 方激光误伤己方王`;
    }
    if (ctx.cause === 'collision') return '致命撞击敌王';
    if (ctx.cause === 'trap') return '敌王踏入陷阱';
    if (ctx.cause === 'mandatory_fail') {
      const loser = winner === 'A' ? 'B' : 'A';
      return `${loser} 方函数未经过强制方块`;
    }
    return '敌王已亡';
  }

  // ===== 回合切换 =====
  HF.endTurn = function () {
    const st = HF.state;
    st.turn = st.turn === 'A' ? 'B' : 'A';
    st.turnCount++;
    st.selectedPieceId = null;
    st.actionMode = 'move';
    st.currentLaser = null;
    st.previewLaser = null;
    st.resonanceChain = null;
  };

  // 工具：获取当前玩家存活棋子
  HF.alivePieces = function (player) {
    return HF.state.players[player].pieces.filter(p => p.alive);
  };

  // 坐标合法
  HF.inBoard = function (x, y) {
    return x >= HF.BOARD_MIN && x <= HF.BOARD_MAX && y >= HF.BOARD_MIN && y <= HF.BOARD_MAX;
  };

  // ===== 困难模式：强制方块（A/B 交替，全局回合制） =====
  // 规则：全局 turnCount 奇数→A需击中方块，偶数→B需击中方块；每回合开始生成新方块（一次性）
  // mandatoryBlocks.player = {x,y} 表示该玩家本回合需击中的方块；null 表示无要求
  HF.generateMandatoryBlock = function (player) {
    const st = HF.state;
    const allPieces = st.players.A.pieces.concat(st.players.B.pieces);
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = HF.BOARD_MIN + Math.floor(Math.random() * (HF.BOARD_MAX - HF.BOARD_MIN + 1));
      const y = HF.BOARD_MIN + Math.floor(Math.random() * (HF.BOARD_MAX - HF.BOARD_MIN + 1));
      if (!HF.inBoard(x, y)) continue;
      if (allPieces.some(p => p.alive && p.x === x && p.y === y)) continue;
      st.mandatoryBlocks[player] = { x, y };
      return { x, y };
    }
    st.mandatoryBlocks[player] = { x: 0, y: 0 };
    return { x: 0, y: 0 };
  };

  // 检查函数曲线是否经过指定玩家的强制方块（距离 < 0.5 视为经过）
  // 传入曲线对象，判定完整函数曲线（非激光截断点）
  HF.checkMandatoryBlock = function (curve, player) {
    const st = HF.state;
    const blk = st.mandatoryBlocks[player];
    if (!blk) return true; // 无方块要求则通过
    if (!curve) return false;
    if (Array.isArray(curve)) {
      for (const pt of curve) {
        if (Math.hypot(pt.x - blk.x, pt.y - blk.y) < 0.5) return true;
      }
      return false;
    }
    const tMin = curve.tMin, tMax = curve.tMax;
    const N = 2000;
    const step = (tMax - tMin) / N;
    for (let i = 0; i <= N; i++) {
      const t = tMin + i * step;
      let p = null;
      try {
        if (curve.mode === 'y') p = { x: t, y: curve.compiled.evaluate({ x: t }) };
        else if (curve.mode === 'x') p = { x: curve.c, y: t };
        else if (curve.mode === 'param') p = { x: curve.cx.evaluate({ t }), y: curve.cy.evaluate({ t }) };
      } catch (e) { continue; }
      if (!p || isNaN(p.x) || isNaN(p.y)) continue;
      if (Math.hypot(p.x - blk.x, p.y - blk.y) < 0.5) return true;
    }
    return false;
  };

  // 强制方块未经过：发射方判负
  HF.mandatoryFail = function (shooter) {
    const st = HF.state;
    st.winner = shooter === 'A' ? 'B' : 'A';
    st.winReason = kingWinReason({ cause: 'mandatory_fail' }, st.winner);
    st.phase = 'result';
    return true;
  };

  // 回合开始时刷新强制方块（困难模式：大回合交替，A/B各操作一次为1大回合）
  // 大回合 = ceil(turnCount/2)；奇数大回合→A需击中，偶数大回合→B需击中
  // 当前操作者若==需击中玩家则生成方块，否则本回合自由
  HF.refreshMandatoryBlockIfNeeded = function () {
    const st = HF.state;
    if (st.difficulty !== 2) return;
    st.mandatoryBlocks.A = null;
    st.mandatoryBlocks.B = null;
    const bigTurn = Math.ceil(st.turnCount / 2);  // 大回合号
    const active = bigTurn % 2 === 1 ? 'A' : 'B';   // 该大回合需击中的玩家
    // 只有当前操作者==需击中玩家时才生成方块
    if (st.turn === active) {
      HF.generateMandatoryBlock(active);
    }
  };

  // 初始默认状态（标题屏阶段，避免渲染循环访问 undefined；点开始时 newGame 重置）
  HF.state = freshState();
})();
