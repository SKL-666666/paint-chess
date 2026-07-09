// ui.js — 屏幕控制器、布阵/对战交互、热座切换、结果
(function () {
  'use strict';
  const HF = (window.HF = window.HF || {});

  const $ = (id) => document.getElementById(id);
  let canvas;

  HF.ui = {
    init() {
      canvas = $('canvas');
      HF.renderer.init(canvas);

      // 标题屏
      $('btn-start-2p').addEventListener('click', () => onStart('2p'));
      $('btn-start-ai').addEventListener('click', () => onStart('ai'));
      $('btn-start-net').addEventListener('click', () => $('net-panel').classList.toggle('hidden'));
      $('tab-create').addEventListener('click', () => switchNetTab('create'));
      $('tab-join').addEventListener('click', () => switchNetTab('join'));
      $('btn-create-room').addEventListener('click', onCreateRoom);
      $('btn-join-room').addEventListener('click', onJoinRoom);
      $('diff-easy').addEventListener('click', () => setDifficulty(0));
      $('diff-normal').addEventListener('click', () => setDifficulty(1));
      $('diff-hard').addEventListener('click', () => setDifficulty(2));
      $('btn-rules').addEventListener('click', () => $('rules-panel').classList.toggle('hidden'));
      // 联机回调
      HF.net.onStatus = (msg) => { $('net-status').textContent = msg; };
      HF.net.onReady = onNetReady;
      HF.net.onAction = onNetAction;
      HF.net.onLeave = onNetLeave;
      // 交接屏
      $('btn-ready').addEventListener('click', onReady);
      // 布阵
      $('type-king').addEventListener('click', () => setSetupType('king'));
      $('type-guard').addEventListener('click', () => setSetupType('guard'));
      $('btn-confirm-setup').addEventListener('click', onConfirmSetup);
      // 激光发射（输入函数即射击）
      $('btn-fire').addEventListener('click', onFire);
      $('laser-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') onFire(); });
      // 陷阱模式
      $('btn-trap').addEventListener('click', () => setActionMode('trap'));
      $('btn-move').addEventListener('click', () => setActionMode('move'));
      // 结果
      $('btn-restart').addEventListener('click', onRestart);
      // canvas 交互
      canvas.addEventListener('pointerdown', onCanvasDown);
      window.addEventListener('resize', () => { HF.renderer.resize(); });
      // 预设面板
      renderPresets();
    },
  };

  // ===== 预设函数：每个 4 参数（h,k 控制平移 + 2 形状参数），支持显函数与参数化隐函数 =====
  // build(vals) -> {kind:'explicit', expr} 或 {kind:'param', xExpr, yExpr, tMin, tMax, label}
  function P(name, min, max, step, def) { return { name, min, max, step, def }; }
  const HI = P('h', -10, 10, 0.1, 0);   // 水平平移
  const KI = P('k', -10, 10, 0.1, 0);   // 垂直平移
  const PI2 = 6.2832;
  const PRESETS = [
    // === 显函数 ===
    { name: '直线 y=a(x-h)+b+k', params:[P('a',-10,10,0.1,1),P('b',-10,10,0.1,0),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*(x-'+fmt(v.h)+')+'+fmt(v.b)+'+'+fmt(v.k)}; } },
    { name: '二次 y=a(x-h)²+b(x-h)+k', params:[P('a',-5,5,0.05,0.5),P('b',-10,10,0.1,0),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*(x-'+fmt(v.h)+')^2+'+fmt(v.b)+'*(x-'+fmt(v.h)+')+'+fmt(v.k)}; } },
    { name: '三次 y=a(x-h)³+b(x-h)+k', params:[P('a',-2,2,0.02,0.2),P('b',-8,8,0.1,0),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*(x-'+fmt(v.h)+')^3+'+fmt(v.b)+'*(x-'+fmt(v.h)+')+'+fmt(v.k)}; } },
    { name: '四次 y=a(x-h)⁴+b(x-h)²+k', params:[P('a',-1,1,0.005,0.1),P('b',-5,5,0.05,0),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*(x-'+fmt(v.h)+')^4+'+fmt(v.b)+'*(x-'+fmt(v.h)+')^2+'+fmt(v.k)}; } },
    { name: '反比例 y=a/(b(x-h))+k', params:[P('a',-10,10,0.1,1),P('b',-8,8,0.1,1),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'/('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '正弦 y=a·sin(b(x-h))+k', params:[P('a',-10,10,0.1,1),P('b',-8,8,0.1,1),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*sin('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '余弦 y=a·cos(b(x-h))+k', params:[P('a',-10,10,0.1,1),P('b',-8,8,0.1,1),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*cos('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '正切 y=a·tan(b(x-h))+k', params:[P('a',-8,8,0.1,1),P('b',-5,5,0.05,0.5),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*tan('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '绝对值 y=a|b(x-h)|+k', params:[P('a',-8,8,0.1,1),P('b',-8,8,0.1,1),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*abs('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '平方根 y=a√(b(x-h))+k', params:[P('a',-8,8,0.1,1),P('b',0.1,8,0.1,1),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*sqrt('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '指数 y=a·exp(b(x-h))+k', params:[P('a',-5,5,0.05,1),P('b',-3,3,0.05,0.5),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*exp('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '对数 y=a·ln|b(x-h)|+k', params:[P('a',-8,8,0.1,1),P('b',0.1,8,0.1,1),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*log(abs('+fmt(v.b)+'*(x-'+fmt(v.h)+')))+'+fmt(v.k)}; } },
    { name: '双曲 y=a·tanh(b(x-h))+k', params:[P('a',-10,10,0.1,2),P('b',-5,5,0.1,1),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*tanh('+fmt(v.b)+'*(x-'+fmt(v.h)+'))+'+fmt(v.k)}; } },
    { name: '高斯 y=a·exp(-b(x-h)²)+k', params:[P('a',-8,8,0.1,2),P('b',0.02,5,0.05,0.5),HI,KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*exp(-'+fmt(v.b)+'*(x-'+fmt(v.h)+')^2)+'+fmt(v.k)}; } },
    { name: '正弦+余弦叠加', params:[P('a',-8,8,0.1,1),P('b',-8,8,0.1,0.5),P('c',0.1,8,0.1,1.5),KI],
      build(v){ return {kind:'explicit', expr:'y='+fmt(v.a)+'*sin(x)+'+fmt(v.b)+'*cos('+fmt(v.c)+'*x)+'+fmt(v.k)}; } },
    { name: '垂直线 x=h', params:[HI,P('_',-1,1,1,0),P('_',-1,1,1,0),P('_',-1,1,1,0)],
      build(v){ return {kind:'explicit', expr:'x='+fmt(v.h)}; } },
    // === 参数化隐函数 ===
    { name: '椭圆 (x-h)²/a²+(y-k)²/b²=1', params:[P('a',0.3,10,0.1,2),P('b',0.3,10,0.1,2),HI,KI],
      build(v){ return {kind:'param', xExpr:fmt(v.h)+'+'+fmt(v.a)+'*cos(t)', yExpr:fmt(v.k)+'+'+fmt(v.b)+'*sin(t)', tMin:0, tMax:PI2, label:'椭圆'}; } },
    { name: '玫瑰线 r=a·cos(b·t)', params:[P('a',0.3,10,0.1,2),P('b',1,8,1,2),HI,KI],
      build(v){ return {kind:'param', xExpr:fmt(v.h)+'+'+fmt(v.a)+'*cos('+fmt(v.b)+'*t)*cos(t)', yExpr:fmt(v.k)+'+'+fmt(v.a)+'*cos('+fmt(v.b)+'*t)*sin(t)', tMin:0, tMax:PI2, label:'玫瑰线'}; } },
    { name: '螺旋线', params:[P('a',0.05,2,0.05,0.3),P('b',0.5,8,0.5,2),HI,KI],
      build(v){ return {kind:'param', xExpr:fmt(v.h)+'+'+fmt(v.a)+'*t*cos('+fmt(v.b)+'*t)', yExpr:fmt(v.k)+'+'+fmt(v.a)+'*t*sin('+fmt(v.b)+'*t)', tMin:0, tMax:12.566, label:'螺旋线'}; } },
    { name: '心形线', params:[P('a',0.1,5,0.1,1),P('b',0.1,5,0.1,1),HI,KI],
      build(v){ return {kind:'param', xExpr:fmt(v.h)+'+'+fmt(v.a)+'*(2*cos(t)-cos(2*t))', yExpr:fmt(v.k)+'+'+fmt(v.b)+'*(2*sin(t)-sin(2*t))', tMin:0, tMax:PI2, label:'心形线'}; } },
    { name: '双纽线 (x²+y²)²=a²(x²-y²)', params:[P('a',0.5,10,0.1,2),P('_',-1,1,1,0),HI,KI],
      build(v){ const a2=v.a*v.a; return {kind:'param', xExpr:fmt(v.h)+'+sqrt('+fmt(a2)+'*cos(2*t))*cos(t)', yExpr:fmt(v.k)+'+sqrt('+fmt(a2)+'*cos(2*t))*sin(t)', tMin:-0.785, tMax:3.927, label:'双纽线'}; } },
  ];
  function fmt(v){ return Math.abs(v)<1e-9?'0':(Math.round(v*1000)/1000).toString(); }

  let activePresetIdx = -1;
  let presetValues = {};

  function renderPresets() {
    const list = $('preset-list');
    list.innerHTML = '';
    PRESETS.forEach((p, idx) => {
      const el = document.createElement('button');
      el.className = 'preset-item';
      el.innerHTML = `<span class="preset-name">${p.name}</span>`;
      el.addEventListener('click', () => selectPreset(idx));
      list.appendChild(el);
    });
  }

  function selectPreset(idx) {
    const st = HF.state;
    if (st.phase !== 'play') { flashHint('请先进入对战'); return; }
    if (!st.selectedPieceId) { flashHint('请先点击棋子选择锚点'); return; }
    activePresetIdx = idx;
    const p = PRESETS[idx];
    presetValues[idx] = {};
    for (const prm of p.params) presetValues[idx][prm.name] = prm.def;
    renderPresetControls();
    updatePreview();
  }

  function renderPresetControls() {
    const list = $('preset-list');
    list.innerHTML = '';
    PRESETS.forEach((p, idx) => {
      const el = document.createElement('button');
      el.className = 'preset-item' + (idx === activePresetIdx ? ' active' : '');
      el.innerHTML = `<span class="preset-name">${p.name}</span>`;
      el.addEventListener('click', () => selectPreset(idx));
      list.appendChild(el);
    });
    // 滑块控制区：常驻在预设列表下方（独立容器），选中预设时显示
    const ctrlBox = $('preset-controls');
    ctrlBox.innerHTML = '';
    if (activePresetIdx < 0) {
      ctrlBox.classList.add('hidden');
      return;
    }
    const p = PRESETS[activePresetIdx];
    const realParams = p.params.filter(prm => prm.name !== '_');
    if (!realParams.length) {
      ctrlBox.classList.add('hidden');
      return;
    }
    ctrlBox.classList.remove('hidden');
    for (const prm of realParams) {
      const val = presetValues[activePresetIdx][prm.name];
      const row = document.createElement('div');
      row.className = 'slider-row';
      row.innerHTML = `<label>${prm.name}</label><input type="range" min="${prm.min}" max="${prm.max}" step="${prm.step}" value="${val}"><span class="slider-val">${fmt(val)}</span>`;
      const range = row.querySelector('input');
      const valEl = row.querySelector('.slider-val');
      range.addEventListener('input', () => {
        presetValues[activePresetIdx][prm.name] = parseFloat(range.value);
        valEl.textContent = fmt(parseFloat(range.value));
        updatePreview();
      });
      ctrlBox.appendChild(row);
    }
  }

  // 根据预设描述构造 curve 对象
  function buildCurve(desc) {
    if (desc.kind === 'explicit') {
      const parsed = HF.parseFunction(desc.expr);
      if (!parsed.ok) return { ok: false, msg: parsed.msg };
      return { ok: true, curve: HF.makeCurve(parsed), label: desc.expr };
    }
    if (desc.kind === 'param') {
      const parsed = HF.parseParametric(desc.xExpr, desc.yExpr, desc.tMin, desc.tMax);
      if (!parsed.ok) return { ok: false, msg: parsed.msg };
      return { ok: true, curve: { mode: 'param', cx: parsed.cx, cy: parsed.cy, tMin: parsed.tMin, tMax: parsed.tMax }, label: desc.label };
    }
    return { ok: false, msg: '未知类型' };
  }

  // 实时预览：根据当前预设参数生成曲线 → 完整渲染（预览模式，不截断）
  function updatePreview() {
    const st = HF.state;
    st.previewLaser = null;
    if (activePresetIdx < 0) return;
    if (!st.selectedPieceId) return;
    const anchor = st.players[st.turn].pieces.find(pc => pc.id === st.selectedPieceId && pc.alive);
    if (!anchor) return;
    const p = PRESETS[activePresetIdx];
    const vals = presetValues[activePresetIdx];
    const desc = p.build(vals);
    $('laser-input').value = desc.label || desc.expr || '';
    const r = buildCurve(desc);
    if (!r.ok) { flashHint(r.msg); return; }
    const dist = HF.anchorDistance(r.curve, anchor.x, anchor.y);
    const allPieces = st.players.A.pieces.concat(st.players.B.pieces);
    const result = HF.generateLaser(r.curve, { x: anchor.x, y: anchor.y }, allPieces, anchor.id, true);
    st.previewLaser = { points: result.points };
    if (dist < 0.5) {
      flashHint('预览：' + r.label + ' ✓');
    } else {
      flashHint('预览：' + r.label + ' (距锚点' + dist.toFixed(2) + '，需<0.5)');
    }
  }

  // ===== 屏幕显隐 =====
  function showOverlay(name) {
    ['title', 'handoff', 'result'].forEach(n => {
      $('screen-' + n).classList.toggle('active', n === name);
    });
  }
  function hideOverlays() {
    ['title', 'handoff', 'result'].forEach(n => $('screen-' + n).classList.remove('active'));
  }
  function showGameArea(on) {
    $('game-area').classList.toggle('hidden', !on);
  }
  function refreshTopbar() {
    const st = HF.state;
    HF.renderer.resize();
    const setupTypes = $('setup-types');
    const confirmBtn = $('btn-confirm-setup');
    const laserPanel = $('laser-panel');
    const actionModes = $('action-modes');
    setupTypes.classList.add('hidden');
    confirmBtn.classList.add('hidden');
    actionModes.classList.add('hidden');
    if (st.phase === 'setup') {
      laserPanel.classList.add('hidden');
      setupTypes.classList.remove('hidden');
      confirmBtn.classList.remove('hidden');
      confirmBtn.disabled = !HF.setupComplete(st.setupPlayer);
      const p = st.players[st.setupPlayer].pieces;
      const kings = p.filter(x => x.type === 'king').length;
      const guards = p.filter(x => x.type === 'guard').length;
      $('info').textContent = `玩家 ${st.setupPlayer} 布阵 — 王 ${kings}/1 · 护卫 ${guards}/${HF.MAX_GUARDS}`;
    } else if (st.phase === 'play') {
      laserPanel.classList.remove('hidden');
      actionModes.classList.remove('hidden');
      const pl = st.players[st.turn];
      const alive = HF.alivePieces(st.turn).length;
      $('info').textContent = `玩家 ${st.turn} · 第 ${st.turnCount}回合 · 存活${alive} · 陷阱${pl.traps.length}/${HF.MAX_TRAPS}`;
      setActionMode(st.actionMode);
    }
  }

  // ===== 难度选择 =====
  function setDifficulty(d) {
    HF.ai.difficulty = d;
    $('diff-easy').classList.toggle('active', d === 0);
    $('diff-normal').classList.toggle('active', d === 1);
    $('diff-hard').classList.toggle('active', d === 2);
  }

  // ===== 行动模式切换 =====
  function setActionMode(mode) {
    const st = HF.state;
    if (st.phase !== 'play') return;
    st.actionMode = mode;
    $('btn-move').classList.toggle('active', mode === 'move');
    $('btn-trap').classList.toggle('active', mode === 'trap');
    if (mode === 'trap') {
      flashHint('陷阱模式：选中棋子后点击相邻格埋设(每方限' + HF.MAX_TRAPS + '个)');
    }
  }

  // ===== 流程入口 =====
  function onStart(mode) {
    HF.newGame();
    HF.state.mode = mode;
    if (mode === 'ai') {
      // 人机模式：玩家为 A，AI 为 B。A 先布阵
      HF.state.phase = 'handoff';
      HF.state.handoffReason = 'setup-A';
      $('handoff-text').textContent = '人机对战\n请布阵你的棋子';
      showOverlay('handoff');
    } else {
      HF.state.phase = 'handoff';
      HF.state.handoffReason = 'setup-A';
      $('handoff-text').textContent = '请将设备交给玩家 A\n准备布阵';
      showOverlay('handoff');
    }
  }

  function onReady() {
    const st = HF.state;
    // 联机 B 等待障碍物时，禁用按钮
    if (st.handoffReason === 'setup-B-wait-obstacles' || st.handoffReason === 'net-wait-B') {
      return;
    }
    if (st.handoffReason === 'setup-A' || st.handoffReason === 'setup-B') {
      st.phase = 'setup';
      st.setupPlayer = st.handoffReason === 'setup-A' ? 'A' : 'B';
      showGameArea(true);
      hideOverlays();
      refreshTopbar();
    } else {
      st.phase = 'play';
      showGameArea(true);
      hideOverlays();
      refreshTopbar();
    }
  }

  function onConfirmSetup() {
    const st = HF.state;
    if (!HF.setupComplete(st.setupPlayer)) return;
    if (st.setupPlayer === 'A') {
      if (st.mode === 'ai') {
        HF.ai.doSetup('B');
        st.turn = 'A';
        st.turnCount = 1;
        st.phase = 'play';
        showGameArea(true);
        hideOverlays();
        refreshTopbar();
      } else if (st.mode === 'net') {
        // 联机模式：A 布阵完成，通知对手（附带棋子位置供对方同步），等待 B
        HF.net.sendAction({ kind: 'setup_done', player: 'A', pieces: st.players.A.pieces.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, alive: p.alive })) });
        netMySetupDone = true;
        $('handoff-text').textContent = '布阵完成\n等待对手布阵...';
        st.handoffReason = 'net-wait-B';
        st.phase = 'handoff';
        showOverlay('handoff');
        tryStartNetGame();
      } else {
        st.handoffReason = 'setup-B';
        st.phase = 'handoff';
        $('handoff-text').textContent = '玩家 A 布阵完成\n请将设备交给玩家 B 准备布阵';
        showOverlay('handoff');
      }
    } else {
      if (st.mode === 'net') {
        // B 布阵完成（附带棋子位置供对方同步）
        HF.net.sendAction({ kind: 'setup_done', player: 'B', pieces: st.players.B.pieces.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, alive: p.alive })) });
        netMySetupDone = true;
        tryStartNetGame();
      } else {
        st.turn = 'A';
        st.turnCount = 1;
        st.handoffReason = 'turn-A';
        st.phase = 'handoff';
        $('handoff-text').textContent = `布阵完成\n请将设备交给玩家 A · 第 1 回合`;
        showOverlay('handoff');
      }
    }
  }

  // ===== 联机模式（PeerJS P2P）=====
  // 联机临时状态
  let netMyRole = null;
  let netOpponentSetupDone = false;
  let netMySetupDone = false;

  function switchNetTab(tab) {
    $('tab-create').classList.toggle('active', tab === 'create');
    $('tab-join').classList.toggle('active', tab === 'join');
    $('create-panel').classList.toggle('hidden', tab !== 'create');
    $('join-panel').classList.toggle('hidden', tab !== 'join');
    $('net-status').textContent = '';
  }

  // 创建房间（A 方）
  function onCreateRoom() {
    $('btn-create-room').disabled = true;
    $('net-status').textContent = '正在创建房间...';
    HF.net.createRoom().then((info) => {
      $('btn-create-room').disabled = false;
      $('room-code').textContent = info.code;
      $('room-code-display').classList.remove('hidden');
      netMyRole = 'A';
    }).catch(() => {
      $('btn-create-room').disabled = false;
    });
  }

  // 加入房间（B 方）
  function onJoinRoom() {
    const code = $('join-code-input').value.trim().toUpperCase();
    if (!code) { $('net-status').textContent = '请输入房间号'; return; }
    $('btn-join-room').disabled = true;
    $('net-status').textContent = '正在连接...';
    HF.net.joinRoom(code).then((info) => {
      $('btn-join-room').disabled = false;
      netMyRole = 'B';
    }).catch(() => {
      $('btn-join-room').disabled = false;
    });
  }

  // P2P 连接建立：开始初始化游戏
  function onNetReady() {
    HF.newGame();
    const st = HF.state;
    st.mode = 'net';
    st.myRole = netMyRole;
    st.setupPlayer = netMyRole;
    netOpponentSetupDone = false;
    netMySetupDone = false;

    if (netMyRole === 'A') {
      // A 生成障碍物并广播给 B
      HF.net.sendAction({ kind: 'obstacles', obstacles: st.obstacles });
      st.phase = 'handoff';
      st.handoffReason = 'setup-A';
      $('handoff-text').textContent = '联机对战 · 你是玩家 A\n请布阵你的棋子';
      showOverlay('handoff');
    } else {
      // B 清空障碍物，等待接收
      st.obstacles = [];
      st.phase = 'handoff';
      st.handoffReason = 'setup-B-wait-obstacles';
      $('handoff-text').textContent = '联机对战 · 你是玩家 B\n等待棋盘同步...';
      showOverlay('handoff');
    }
  }

  // 双方布阵完成，开始联机对战
  function tryStartNetGame() {
    if (!netMySetupDone || !netOpponentSetupDone) return;
    // 双方都布阵完成，A 先手
    const st = HF.state;
    st.turn = 'A';
    st.turnCount = 1;
    st.phase = 'play';
    st.handoffReason = '';
    netMySetupDone = false;
    netOpponentSetupDone = false;
    showGameArea(true);
    hideOverlays();
    refreshTopbar();
    // 如果我是 B，禁用交互直到 A 行动结束
    if (st.myRole === 'B') {
      st.busy = true;
      showMsg('等待玩家 A 行动...');
    }
  }

  // 收到对手动作
  function onNetAction(action) {
    const st = HF.state;
    if (!action) return;
    if (action.kind === 'obstacles') {
      // 接收 A 广播的障碍物
      if (st.myRole === 'B' && st.handoffReason === 'setup-B-wait-obstacles') {
        st.obstacles = action.obstacles;
        st.handoffReason = 'setup-B';
        $('handoff-text').textContent = '联机对战 · 你是玩家 B\n请布阵你的棋子';
      }
      return;
    }
    if (action.kind === 'setup_done') {
      if ((action.player === 'A' && st.myRole === 'B') ||
          (action.player === 'B' && st.myRole === 'A')) {
        // 同步对方棋子到本地 state（盲眼博弈：state 存双方棋子用于判定，renderer 只渲染己方）
        if (action.pieces && action.pieces.length) {
          st.players[action.player].pieces = action.pieces.map(p => ({
            id: p.id, type: p.type, x: p.x, y: p.y, alive: p.alive
          }));
        }
        netOpponentSetupDone = true;
        tryStartNetGame();
      }
      return;
    }
    if (st.phase !== 'play') return;
    // 重放对手动作
    replayOpponentAction(action);
  }

  function onNetLeave() {
    const st = HF.state;
    if (st.phase === 'play' || st.phase === 'setup') {
      showMsg('对手已离开');
      setTimeout(() => {
        HF.net.disconnect();
        HF.newGame();
        HF.state.phase = 'title';
        showGameArea(false);
        showOverlay('title');
      }, 1500);
    }
  }

  // 重放对手动作（执行相同逻辑，但不广播）
  function replayOpponentAction(action) {
    const st = HF.state;
    if (action.type === 'move') {
      const piece = st.players[st.turn].pieces.find(p => p.id === action.pieceId && p.alive);
      if (!piece) { nextTurnHandoffNet(); return; }
      st.busy = true;
      const res = HF.movePiece(st.turn, piece.id, action.dx, action.dy);
      if (res.collision) showMsg('对手移动 · 碰撞！两子同归于尽');
      else if (res.trapHit) showMsg('对手踩中陷阱！棋子阵亡');
      else showMsg('对手移动了一枚棋子');
      setTimeout(() => {
        st.busy = false;
        clearMsg();
        const ctx = res.collision ? { cause: 'collision' } : (res.trapHit ? { cause: 'trap' } : null);
        if (HF.checkWin(ctx)) { showResult(); return; }
        nextTurnHandoffNet();
      }, 1500);
    } else if (action.type === 'trap') {
      const res = HF.placeTrap(st.turn, action.x, action.y);
      if (res.ok) {
        st.busy = true;
        showMsg(`对手埋设陷阱 @(${action.x},${action.y})`);
        setTimeout(() => {
          st.busy = false;
          clearMsg();
          nextTurnHandoffNet();
        }, 1200);
      } else {
        nextTurnHandoffNet();
      }
    } else if (action.type === 'laser') {
      const anchor = st.players[st.turn].pieces.find(p => p.id === action.pieceId && p.alive);
      if (!anchor) { nextTurnHandoffNet(); return; }
      st.busy = true;
      // 重建 curve
      const r = buildCurveSimpleLocal(action.desc);
      if (!r.ok) { nextTurnHandoffNet(); return; }
      const allPieces = st.players.A.pieces.concat(st.players.B.pieces);
      const result = HF.generateLaser(r.curve, { x: anchor.x, y: anchor.y }, allPieces, anchor.id);
      st.currentLaser = { points: result.points, hits: result.hits, startTime: performance.now() };
      const killed = [];
      for (const h of result.hits) { h.piece.alive = false; killed.push(h.piece); }
      const hitPoints = result.hits.map(h => h.point);
      const resonance = HF.applyResonance(hitPoints);
      let msg;
      if (killed.length) {
        const names = killed.map(k => k.type === 'king' ? '王' : '护卫').join('、');
        msg = `对手激光命中：${names}`;
      } else {
        msg = '对手发射激光 · 未命中';
      }
      if (resonance.newlyKilled.length) msg += ` · 共振+${resonance.newlyKilled.length}`;
      showMsg(msg);
      const animTime = resonance.chains.length ? 4000 : 3100;
      setTimeout(() => {
        st.trails.push({ points: result.points, player: st.turn });
        st.currentLaser = null;
        st.resonanceChain = null;
        st.busy = false;
        clearMsg();
        const ctx = { cause: 'laser', shooter: st.turn };
        if (HF.checkWin(ctx)) { showResult(); return; }
        nextTurnHandoffNet();
      }, animTime);
    }
  }

  // 联机下的回合交接：轮到我则解锁，轮到对手则锁定
  function nextTurnHandoffNet() {
    const st = HF.state;
    HF.endTurn();
    st.phase = 'play';
    showGameArea(true);
    hideOverlays();
    refreshTopbar();
    if (st.turn === st.myRole) {
      st.busy = false;
      showMsg('轮到你了');
      setTimeout(() => clearMsg(), 1500);
    } else {
      st.busy = true;
      showMsg('对手思考中...');
    }
  }

  // 简易 curve 构建（用于重放对手激光）
  function buildCurveSimpleLocal(desc) {
    if (desc.kind === 'explicit') {
      const parsed = HF.parseFunction(desc.expr);
      if (!parsed.ok) return { ok: false };
      return { ok: true, curve: HF.makeCurve(parsed) };
    }
    if (desc.kind === 'param') {
      const parsed = HF.parseParametric(desc.xExpr, desc.yExpr, desc.tMin, desc.tMax);
      if (!parsed.ok) return { ok: false };
      return { ok: true, curve: { mode: 'param', cx: parsed.cx, cy: parsed.cy, tMin: parsed.tMin, tMax: parsed.tMax } };
    }
    return { ok: false };
  }

  function onRestart() {
    HF.net.disconnect();
    HF.newGame();
    HF.state.phase = 'title';
    showGameArea(false);
    showOverlay('title');
  }

  // ===== 布阵 =====
  function setSetupType(t) {
    HF.state.setupType = t;
    $('type-king').classList.toggle('active', t === 'king');
    $('type-guard').classList.toggle('active', t === 'guard');
  }

  // ===== Canvas 点击（智能交互：点棋子选中，点棋盘移动） =====
  function onCanvasDown(e) {
    const st = HF.state;
    if (st.busy) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const w = HF.renderer.s2w(px, py);
    if (!HF.inBoard(w.x, w.y)) return;

    if (st.phase === 'setup') {
      handleSetupClick(w);
    } else if (st.phase === 'play') {
      handlePlayClick(w);
    }
  }

  function handleSetupClick(w) {
    const st = HF.state;
    const player = st.setupPlayer;
    // 若点击已有己方棋子 -> 移除（仅布阵阶段允许重放）
    if (HF.removeSetupPiece(player, w.x, w.y)) {
      refreshTopbar();
      return;
    }
    const res = HF.placeSetupPiece(player, st.setupType, w.x, w.y);
    if (!res.ok) { flashHint(res.msg); return; }
    // 王/护卫放满后自动切换类型
    if (st.setupType === 'king') setSetupType('guard');
    else {
      const guards = st.players[player].pieces.filter(x => x.type === 'guard').length;
      if (guards >= HF.MAX_GUARDS) {
        const kings = st.players[player].pieces.filter(x => x.type === 'king').length;
        if (kings < 1) setSetupType('king');
      }
    }
    refreshTopbar();
  }

  // 对战阶段统一交互：
  // - 点击己方棋子 → 选中（作为移动对象/激光锚点）
  // - 已选中 + 点击棋盘 → 尝试移动（1-2 步直线）
  // - 点击其他己方棋子 → 改选
  // - 输入函数 + 发射 → 从选中棋子发射激光
  function handlePlayClick(w) {
    const st = HF.state;
    const player = st.turn;
    const mine = st.players[player].pieces;
    const sel = st.selectedPieceId ? mine.find(p => p.id === st.selectedPieceId && p.alive) : null;

    // 点击己方棋子 → 选中
    const target = mine.find(p => p.alive && p.x === w.x && p.y === w.y);
    if (target) {
      st.selectedPieceId = target.id;
      $('laser-hint').textContent = `选中 (${target.x},${target.y})`;
      if (activePresetIdx >= 0) updatePreview();
      return;
    }

    // 陷阱模式：选中棋子 + 点击相邻格 → 埋陷阱
    if (st.actionMode === 'trap' && sel) {
      const dx = w.x - sel.x, dy = w.y - sel.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const isAdjacent = (adx === ady || adx === 0 || ady === 0) && Math.max(adx, ady) === 1;
      if (isAdjacent) {
        executeTrap(sel, w.x, w.y);
        return;
      }
      flashHint('陷阱只能埋在相邻格(1步)');
      return;
    }

    // 移动模式：已选中 + 点击非棋子格 → 尝试移动
    if (sel) {
      const dx = w.x - sel.x, dy = w.y - sel.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const isStraight = (adx === ady || adx === 0 || ady === 0) && Math.max(adx, ady) <= 2 && Math.max(adx, ady) >= 1;
      if (isStraight) {
        executeMove(sel, dx, dy);
        return;
      }
      st.selectedPieceId = null;
      st.previewLaser = null;
      $('laser-hint').textContent = '';
    }
  }

  // ===== 执行移动 =====
  function executeMove(piece, dx, dy) {
    const st = HF.state;
    st.busy = true;
    const res = HF.movePiece(st.turn, piece.id, dx, dy);
    if (!res.ok) { flashHint(res.msg); st.busy = false; return; }
    st.selectedPieceId = null;
    st.previewLaser = null;
    // 联机模式广播
    if (st.mode === 'net') {
      HF.net.sendAction({ type: 'move', pieceId: piece.id, dx, dy });
    }
    if (res.collision) {
      showMsg('碰撞！两枚棋子同归于尽');
    } else if (res.trapHit) {
      showMsg('踩中敌方陷阱！棋子阵亡');
    } else {
      showMsg('已移动');
    }
    setTimeout(() => {
      st.busy = false;
      clearMsg();
      const ctx = res.collision ? { cause: 'collision' } : (res.trapHit ? { cause: 'trap' } : null);
      if (HF.checkWin(ctx)) { showResult(); return; }
      if (st.mode === 'net') nextTurnHandoffNet();
      else nextTurnHandoff();
    }, 1500);
  }

  // ===== 执行埋陷阱 =====
  function executeTrap(piece, x, y) {
    const st = HF.state;
    const res = HF.placeTrap(st.turn, x, y);
    if (!res.ok) { flashHint(res.msg); return; }
    st.busy = true;
    st.selectedPieceId = null;
    st.previewLaser = null;
    // 联机模式广播
    if (st.mode === 'net') {
      HF.net.sendAction({ type: 'trap', pieceId: piece.id, x, y });
    }
    showMsg(`埋设陷阱 @(${x},${y})`);
    setTimeout(() => {
      st.busy = false;
      clearMsg();
      if (st.mode === 'net') nextTurnHandoffNet();
      else nextTurnHandoff();
    }, 1200);
  }

  // ===== 执行激光发射 =====
  // 优先用当前选中预设的参数构建曲线；否则解析输入框文本
  function onFire() {
    const st = HF.state;
    if (st.busy) return;
    if (!st.selectedPieceId) { flashHint('请先选择锚点棋子'); return; }
    const anchor = st.players[st.turn].pieces.find(p => p.id === st.selectedPieceId && p.alive);
    if (!anchor) { flashHint('锚点无效'); return; }

    let curve, label, desc;
    if (activePresetIdx >= 0) {
      const p = PRESETS[activePresetIdx];
      const vals = presetValues[activePresetIdx];
      const built = p.build(vals);
      desc = built;
      const r = buildCurve(built);
      if (!r.ok) { flashHint(r.msg); return; }
      curve = r.curve; label = r.label;
    } else {
      const input = $('laser-input').value;
      const parsed = HF.parseFunction(input);
      if (!parsed.ok) { flashHint(parsed.msg); return; }
      curve = HF.makeCurve(parsed); label = input;
      desc = { kind: 'explicit', expr: input };
    }
    if (!curve) { flashHint('曲线无效'); return; }
    const dist = HF.anchorDistance(curve, anchor.x, anchor.y);
    if (dist >= 0.5) { flashHint(`锚点到曲线距离 ${dist.toFixed(2)} ≥ 0.5，发射无效`); return; }

    st.busy = true;
    st.previewLaser = null;
    // 联机模式广播（包含曲线描述供对手重放）
    if (st.mode === 'net') {
      HF.net.sendAction({ type: 'laser', pieceId: anchor.id, desc: desc });
    }
    const allPieces = st.players.A.pieces.concat(st.players.B.pieces);
    const result = HF.generateLaser(curve, { x: anchor.x, y: anchor.y }, allPieces, anchor.id);
    st.currentLaser = { points: result.points, hits: result.hits, startTime: performance.now() };

    // 销毁直接命中棋子
    const killed = [];
    for (const h of result.hits) {
      h.piece.alive = false;
      killed.push(h.piece);
    }
    // 共振连锁：命中点周围 1 格内其他棋子引爆
    const hitPoints = result.hits.map(h => h.point);
    const resonance = HF.applyResonance(hitPoints);

    $('laser-hint').textContent = '';
    let msg;
    if (killed.length) {
      const names = killed.map(k => k.type === 'king' ? '王' : '护卫').join('、');
      msg = `激光命中：${names}`;
    } else {
      msg = '激光未命中任何棋子';
    }
    if (resonance.newlyKilled.length) {
      const rNames = resonance.newlyKilled.map(k => k.type === 'king' ? '王' : '护卫').join('、');
      msg += ` · 共振连锁+${resonance.newlyKilled.length}(${rNames})`;
    }
    showMsg(msg);

    // 动画后处理（共振延长动画时间）
    const animTime = resonance.chains.length ? 4000 : 3100;
    setTimeout(() => {
      st.trails.push({ points: result.points, player: st.turn });
      st.currentLaser = null;
      st.resonanceChain = null;
      st.busy = false;
      clearMsg();
      const ctx = { cause: 'laser', shooter: st.turn };
      if (HF.checkWin(ctx)) { showResult(); return; }
      if (st.mode === 'net') nextTurnHandoffNet();
      else nextTurnHandoff();
    }, animTime);
  }

  function nextTurnHandoff() {
    const st = HF.state;
    HF.endTurn();
    // AI 模式下，AI 回合跳过交接屏，延迟后自动执行
    if (st.mode === 'ai' && st.turn === 'B') {
      st.phase = 'play';
      showGameArea(true);
      hideOverlays();
      refreshTopbar();
      const diffName = ['简单', '普通', '困难'][HF.ai.difficulty];
      showMsg(`AI(${diffName}) 思考中...`);
      const thinkTime = HF.ai.difficulty === 2 ? 1600 : (HF.ai.difficulty === 1 ? 1100 : 800);
      setTimeout(() => { clearMsg(); runAITurn(); }, thinkTime);
    } else {
      st.handoffReason = 'turn-' + st.turn;
      st.phase = 'handoff';
      $('handoff-text').textContent = `请将设备交给玩家 ${st.turn} · 第 ${st.turnCount} 回合`;
      showOverlay('handoff');
    }
  }

  // ===== AI 回合执行 =====
  function runAITurn() {
    const st = HF.state;
    const action = HF.ai.decide('B');
    if (!action) { nextTurnHandoff(); return; }

    if (action.type === 'laser') {
      executeAILaser(action);
    } else if (action.type === 'move') {
      executeAIMove(action);
    } else if (action.type === 'trap') {
      executeAITrap(action);
    }
  }

  function executeAIMove(action) {
    const st = HF.state;
    const piece = st.players.B.pieces.find(p => p.id === action.pieceId && p.alive);
    if (!piece) { nextTurnHandoff(); return; }
    st.busy = true;
    const res = HF.movePiece('B', piece.id, action.dx, action.dy);
    if (!res.ok) { st.busy = false; nextTurnHandoff(); return; }
    if (res.collision) showMsg('AI 移动 · 碰撞！两子同归于尽');
    else if (res.trapHit) showMsg('AI 踩中陷阱！棋子阵亡');
    else showMsg('AI 移动了一枚棋子');
    setTimeout(() => {
      st.busy = false;
      clearMsg();
      const ctx = res.collision ? { cause: 'collision' } : (res.trapHit ? { cause: 'trap' } : null);
      if (HF.checkWin(ctx)) { showResult(); return; }
      nextTurnHandoff();
    }, 1500);
  }

  function executeAITrap(action) {
    const st = HF.state;
    const piece = st.players.B.pieces.find(p => p.id === action.pieceId && p.alive);
    if (!piece) { nextTurnHandoff(); return; }
    const res = HF.placeTrap('B', action.x, action.y);
    if (!res.ok) { nextTurnHandoff(); return; }
    st.busy = true;
    showMsg(`AI 埋设陷阱 @(${action.x},${action.y})`);
    setTimeout(() => {
      st.busy = false;
      clearMsg();
      nextTurnHandoff();
    }, 1200);
  }

  function executeAILaser(action) {
    const st = HF.state;
    const anchor = st.players.B.pieces.find(p => p.id === action.pieceId && p.alive);
    if (!anchor) { nextTurnHandoff(); return; }
    st.busy = true;
    const allPieces = st.players.A.pieces.concat(st.players.B.pieces);
    const result = HF.generateLaser(action.curve, { x: anchor.x, y: anchor.y }, allPieces, anchor.id);
    st.currentLaser = { points: result.points, hits: result.hits, startTime: performance.now() };
    const killed = [];
    for (const h of result.hits) { h.piece.alive = false; killed.push(h.piece); }
    // 共振连锁
    const hitPoints = result.hits.map(h => h.point);
    const resonance = HF.applyResonance(hitPoints);

    let msg;
    if (killed.length) {
      const names = killed.map(k => k.type === 'king' ? '王' : '护卫').join('、');
      msg = `AI 激光命中：${names}`;
    } else {
      msg = 'AI 发射激光 · 未命中';
    }
    if (resonance.newlyKilled.length) {
      msg += ` · 共振+${resonance.newlyKilled.length}`;
    }
    showMsg(msg);

    const animTime = resonance.chains.length ? 4000 : 3100;
    setTimeout(() => {
      st.trails.push({ points: result.points, player: 'B' });
      st.currentLaser = null;
      st.resonanceChain = null;
      st.busy = false;
      clearMsg();
      const ctx = { cause: 'laser', shooter: 'B' };
      if (HF.checkWin(ctx)) { showResult(); return; }
      nextTurnHandoff();
    }, animTime);
  }

  function showResult() {
    const st = HF.state;
    st.phase = 'result';
    if (st.winner === 'draw') {
      $('result-title').textContent = '平局';
      $('result-title').style.color = '#888';
    } else {
      $('result-title').textContent = `玩家 ${st.winner} 获胜`;
      $('result-title').style.color = '#fd0';
    }
    $('result-reason').textContent = st.winReason || '';
    setTimeout(() => showOverlay('result'), 400);
  }

  // ===== 提示 =====
  let hintTimer = null;
  function flashHint(msg) {
    const el = $('laser-hint');
    el.textContent = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { el.textContent = ''; }, 2500);
  }
  function showMsg(msg) {
    const el = $('action-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function clearMsg() {
    $('action-msg').classList.add('hidden');
  }
})();
