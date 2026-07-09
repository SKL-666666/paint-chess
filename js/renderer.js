// renderer.js — Canvas 绘制：棋盘、网格、障碍、棋子、激光、爆炸
(function () {
  'use strict';
  const HF = (window.HF = window.HF || {});

  let canvas, ctx;
  let cssSize = 0;     // CSS 像素边长
  let dpr = 1;
  // 世界 [-10,10] -> 像素 [pad, size-pad]
  let pad = 0;
  let scale = 0;       // 1 世界单位 = scale 像素

  HF.renderer = {
    init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      this.resize();
    },
    resize() {
      if (!canvas) return;
      const wrap = canvas.parentElement;
      const rect = wrap.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      cssSize = Math.max(120, Math.min(rect.width, rect.height));
      canvas.style.width = cssSize + 'px';
      canvas.style.height = cssSize + 'px';
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pad = cssSize * 0.04;
      scale = (cssSize - pad * 2) / (HF.BOARD_MAX - HF.BOARD_MIN);
    },
    size() { return cssSize; },
    // 世界 -> 屏幕
    w2s(x, y) {
      return { px: pad + (x - HF.BOARD_MIN) * scale, py: pad + (HF.BOARD_MAX - y) * scale };
    },
    // 屏幕 -> 世界格点（四舍五入到整数）
    s2w(px, py) {
      const x = (px - pad) / scale + HF.BOARD_MIN;
      const y = HF.BOARD_MAX - (py - pad) / scale;
      return { x: Math.round(x), y: Math.round(y) };
    },
    s2wExact(px, py) {
      return { x: (px - pad) / scale + HF.BOARD_MIN, y: HF.BOARD_MAX - (py - pad) / scale };
    },
    draw() {
      if (!ctx || !HF.state) return;
      ctx.clearRect(0, 0, cssSize, cssSize);
      drawBoard();
      drawSetupZone();
      drawObstacles();
      drawTraps();
      drawTrails();
      drawCurrentLaser();
      drawResonanceChain();
      drawPreviewLaser();
      drawPieces();
      drawSelection();
      drawArrows();
      drawTrapHints();
      drawExplosions();
      drawTrapCount();
      drawBorder();
    },
  };

  function drawBoard() {
    // 背景
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cssSize, cssSize);
    // 网格
    ctx.lineWidth = 1;
    for (let i = HF.BOARD_MIN; i <= HF.BOARD_MAX; i++) {
      const isAxis = i === 0;
      ctx.strokeStyle = isAxis ? '#4a4a4a' : '#1c1c1c';
      const a = HF.renderer.w2s(i, HF.BOARD_MIN), b = HF.renderer.w2s(i, HF.BOARD_MAX);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      const c = HF.renderer.w2s(HF.BOARD_MIN, i), d = HF.renderer.w2s(HF.BOARD_MAX, i);
      ctx.beginPath(); ctx.moveTo(c.px, c.py); ctx.lineTo(d.px, d.py); ctx.stroke();
    }
  }

  function drawBorder() {
    const a = HF.renderer.w2s(HF.BOARD_MIN, HF.BOARD_MAX);
    const span = scale * (HF.BOARD_MAX - HF.BOARD_MIN);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.px, a.py, span, span);
  }

  function drawSetupZone() {
    const st = HF.state;
    if (st.phase !== 'setup') return;
    const player = st.setupPlayer;
    const yTop = player === 'A' ? HF.HALF_A_MAX_Y : HF.BOARD_MAX;
    const yBot = player === 'A' ? HF.BOARD_MIN : HF.HALF_B_MIN_Y;
    const tl = HF.renderer.w2s(HF.BOARD_MIN, yTop);
    const h = scale * (yTop - yBot);
    const w = scale * (HF.BOARD_MAX - HF.BOARD_MIN);
    ctx.fillStyle = 'rgba(0,255,255,0.05)';
    ctx.fillRect(tl.px, tl.py, w, h);
    ctx.strokeStyle = 'rgba(0,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.px, tl.py, w, h);
  }

  function drawObstacles() {
    const st = HF.state;
    ctx.save();
    ctx.shadowColor = '#0ff';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const ob of st.obstacles) {
      const a = HF.renderer.w2s(ob.x1, ob.y1), b = HF.renderer.w2s(ob.x2, ob.y2);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    }
    ctx.restore();
    // 端点小点
    ctx.fillStyle = '#0ff';
    for (const ob of st.obstacles) {
      const a = HF.renderer.w2s(ob.x1, ob.y1), b = HF.renderer.w2s(ob.x2, ob.y2);
      ctx.beginPath(); ctx.arc(a.px, a.py, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(b.px, b.py, 2, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTrails() {
    const st = HF.state;
    if (!st.trails.length) return;
    // 确定观察者视角：人机模式始终为 A；联机模式为 myRole；双人热座为当前回合对手
    let viewer;
    if (st.mode === 'ai') viewer = 'A';
    else if (st.mode === 'net') viewer = st.myRole;
    else viewer = st.turn;
    // 显示所有敌方历史轨迹；敌方最后一条（上一步）用橙色高亮
    const enemyTrails = st.trails.filter(tr => tr.player !== viewer);
    if (!enemyTrails.length) return;
    const lastEnemy = enemyTrails[enemyTrails.length - 1];
    ctx.lineJoin = 'round';
    // 旧敌方轨迹：浅青色，清晰可见
    ctx.strokeStyle = 'rgba(120,200,220,0.35)';
    ctx.lineWidth = 1.5;
    for (const tr of enemyTrails) {
      if (tr === lastEnemy) continue;
      drawPolyline(tr.points);
    }
    // 敌方上一步：橙色高亮 + 辉光
    ctx.save();
    ctx.shadowColor = '#f80';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(255,136,0,0.75)';
    ctx.lineWidth = 2.2;
    drawPolyline(lastEnemy.points);
    ctx.restore();
  }

  function drawCurrentLaser() {
    const st = HF.state;
    if (!st.currentLaser) return;
    const laser = st.currentLaser;
    const age = (performance.now() - laser.startTime) / 1000;
    // 3 秒动画：前 0.5s 渐亮，之后渐淡到 0.35 透明度残留
    let alpha;
    if (age < 0.4) alpha = age / 0.4;
    else if (age < 3) alpha = 1 - (age - 0.4) / 2.6 * 0.65;
    else alpha = 0.35;
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawPolyline(laser.points);
    ctx.restore();
    // 命中标记
    for (const h of laser.hits) {
      const p = HF.renderer.w2s(h.point.x, h.point.y);
      ctx.strokeStyle = `rgba(255,80,80,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.px, p.py, 8, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawPreviewLaser() {
    const st = HF.state;
    if (!st.previewLaser) return;
    const pts = st.previewLaser.points;
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(0,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    drawPolyline(pts);
    ctx.restore();
  }

  function drawPolyline(pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    const first = HF.renderer.w2s(pts[0].x, pts[0].y);
    ctx.moveTo(first.px, first.py);
    for (let i = 1; i < pts.length; i++) {
      const p = HF.renderer.w2s(pts[i].x, pts[i].y);
      ctx.lineTo(p.px, p.py);
    }
    ctx.stroke();
  }

  function drawPieces() {
    const st = HF.state;
    let player = null;
    if (st.phase === 'setup') player = st.setupPlayer;
    else if (st.phase === 'play' || st.phase === 'laser-anim') {
      // 双人热座：显示当前回合玩家；人机：始终显示人类(A)；联机：显示自己角色
      if (st.mode === 'ai') player = 'A';
      else if (st.mode === 'net') player = st.myRole;
      else player = st.turn;
    }
    if (!player) return;
    const pieces = st.players[player].pieces.filter(p => p.alive);
    for (const pc of pieces) {
      drawPiece(pc, player);
    }
  }

  function drawPiece(pc, player) {
    const p = HF.renderer.w2s(pc.x, pc.y);
    const r = scale * 0.32;
    if (pc.type === 'king') {
      ctx.save();
      ctx.shadowColor = '#fd0';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fd0';
      ctx.beginPath();
      // 王形：菱形/星
      ctx.moveTo(p.px, p.py - r);
      ctx.lineTo(p.px + r, p.py);
      ctx.lineTo(p.px, p.py + r);
      ctx.lineTo(p.px - r, p.py);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('王', p.px, p.py + 1);
    } else {
      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.px, p.py, r * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawSelection() {
    const st = HF.state;
    if (st.phase !== 'play' && st.phase !== 'setup') return;
    const id = st.selectedPieceId;
    if (id == null) return;
    const player = st.phase === 'setup' ? st.setupPlayer : st.turn;
    const pc = st.players[player].pieces.find(p => p.id === id && p.alive);
    if (!pc) return;
    const p = HF.renderer.w2s(pc.x, pc.y);
    const r = scale * 0.42;
    const t = performance.now() / 300;
    const pulse = 0.5 + 0.5 * Math.sin(t);
    ctx.strokeStyle = `rgba(0,255,255,${0.5 + pulse * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2); ctx.stroke();
  }

  function drawArrows() {
    const st = HF.state;
    if (st.phase !== 'play') return;
    if (!st.selectedPieceId) return;
    if (st.actionMode === 'trap') return; // 陷阱模式不显示移动箭头
    const player = st.turn;
    const pc = st.players[player].pieces.find(p => p.id === st.selectedPieceId && p.alive);
    if (!pc) return;
    // 1 格可达：实心小点；2 格可达：空心环
    for (const dir of HF.DIRECTIONS) {
      // 1 步
      const n1x = pc.x + dir.dx, n1y = pc.y + dir.dy;
      if (HF.inBoard(n1x, n1y) && !st.players[player].pieces.some(p => p.alive && p.x === n1x && p.y === n1y)) {
        const ap = HF.renderer.w2s(n1x, n1y);
        ctx.fillStyle = '#0ff';
        ctx.beginPath(); ctx.arc(ap.px, ap.py, 4, 0, Math.PI * 2); ctx.fill();
      }
      // 2 步
      const n2x = pc.x + dir.dx * 2, n2y = pc.y + dir.dy * 2;
      if (HF.inBoard(n2x, n2y) && !st.players[player].pieces.some(p => p.alive && p.x === n2x && p.y === n2y)) {
        const ap = HF.renderer.w2s(n2x, n2y);
        ctx.strokeStyle = '#0ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ap.px, ap.py, 6, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function drawExplosions() {
    const st = HF.state;
    const now = performance.now();
    st.explosions = st.explosions.filter(e => now - e.startTime < 2500);
    for (const e of st.explosions) {
      const age = (now - e.startTime) / 2500;
      const alpha = 1 - age;
      const p = HF.renderer.w2s(e.x, e.y);
      const r = scale * 0.4 * (0.6 + age * 0.8);
      ctx.strokeStyle = `rgba(255,60,60,${alpha})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.px - r, p.py - r); ctx.lineTo(p.px + r, p.py + r);
      ctx.moveTo(p.px + r, p.py - r); ctx.lineTo(p.px - r, p.py + r);
      ctx.stroke();
    }
  }

  // ===== 陷阱：仅绘制己方陷阱（敌方陷阱不可见） =====
  function drawTraps() {
    const st = HF.state;
    if (st.phase !== 'play' && st.phase !== 'setup') return;
    let player;
    if (st.phase === 'setup') player = st.setupPlayer;
    else if (st.mode === 'net') player = st.myRole;   // 联机：只看自己的陷阱
    else player = st.turn;                              // 热座/人机：当前回合玩家
    const traps = st.players[player].traps;
    if (!traps || !traps.length) return;
    const t = performance.now() / 600;
    const pulse = 0.5 + 0.5 * Math.sin(t);
    for (const tr of traps) {
      const p = HF.renderer.w2s(tr.x, tr.y);
      const r = scale * 0.18;
      ctx.save();
      ctx.shadowColor = '#f0c';
      ctx.shadowBlur = 8 + pulse * 6;
      ctx.strokeStyle = `rgba(255,0,170,${0.6 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      // 菱形陷阱标记
      ctx.beginPath();
      ctx.moveTo(p.px, p.py - r);
      ctx.lineTo(p.px + r, p.py);
      ctx.lineTo(p.px, p.py + r);
      ctx.lineTo(p.px - r, p.py);
      ctx.closePath();
      ctx.stroke();
      // 中心点
      ctx.fillStyle = `rgba(255,0,170,${0.4 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(p.px, p.py, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ===== 陷阱模式提示：选中棋子周围可埋陷阱的格 =====
  function drawTrapHints() {
    const st = HF.state;
    if (st.phase !== 'play') return;
    if (st.actionMode !== 'trap') return;
    if (!st.selectedPieceId) return;
    const player = st.turn;
    const pc = st.players[player].pieces.find(p => p.id === st.selectedPieceId && p.alive);
    if (!pc) return;
    const canAfford = true;  // 能量机制已移除
    const trapCount = st.players[player].traps.length;
    for (const dir of HF.DIRECTIONS) {
      const nx = pc.x + dir.dx, ny = pc.y + dir.dy;
      if (!HF.inBoard(nx, ny)) continue;
      // 已有己方棋子或己方陷阱 → 跳过
      if (st.players[player].pieces.some(p => p.alive && p.x === nx && p.y === ny)) continue;
      if (st.players[player].traps.some(t => t.x === nx && t.y === ny)) continue;
      const p = HF.renderer.w2s(nx, ny);
      const r = scale * 0.3;
      const color = (canAfford && trapCount < HF.MAX_TRAPS) ? 'rgba(255,0,170,0.5)' : 'rgba(120,120,120,0.3)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ===== 共振连锁动画 =====
  function drawResonanceChain() {
    const st = HF.state;
    if (!st.resonanceChain) return;
    const rc = st.resonanceChain;
    const age = (performance.now() - rc.startTime) / 1000;
    if (age > 3) { st.resonanceChain = null; return; }
    for (const chain of rc.chains) {
      const src = HF.renderer.w2s(chain.source.x, chain.source.y);
      // 源点扩散环
      const expandR = scale * (0.3 + age * 1.2);
      const alpha = Math.max(0, 1 - age / 2);
      ctx.save();
      ctx.strokeStyle = `rgba(180,100,255,${alpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(src.px, src.py, expandR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // 连接线 source -> targets
      for (const tgt of chain.targets) {
        const tp = HF.renderer.w2s(tgt.x, tgt.y);
        ctx.save();
        ctx.strokeStyle = `rgba(200,120,255,${alpha})`;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#c8f';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(src.px, src.py);
        ctx.lineTo(tp.px, tp.py);
        ctx.stroke();
        ctx.restore();
        // 目标点环
        const tgtR = scale * 0.35 * (1 + Math.sin(age * 8) * 0.2);
        ctx.strokeStyle = `rgba(200,120,255,${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tp.px, tp.py, tgtR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ===== 陷阱计数（右上角） =====
  function drawTrapCount() {
    const st = HF.state;
    if (st.phase !== 'play' && st.phase !== 'setup') return;
    const player = st.phase === 'setup' ? st.setupPlayer : (st.mode === 'net' ? st.myRole : st.turn);
    const pl = st.players[player];
    if (!pl) return;
    const x = cssSize - pad - scale * 4 - 4;
    const y = pad - 14;
    if (y < 4) return;
    ctx.fillStyle = '#8aa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`陷阱 ${pl.traps.length}/${HF.MAX_TRAPS}`, x, y - 2);
  }
})();
