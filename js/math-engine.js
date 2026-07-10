// math-engine.js — 函数解析、距离校验、垂足、镜面反射行进、命中判定
(function () {
  'use strict';
  const HF = (window.HF = window.HF || {});
  const math = window.math;

  const ALLOWED_FUNCS = new Set([
    'sin', 'cos', 'tan', 'abs', 'sqrt', 'exp', 'log',
    'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'min', 'max', 'floor', 'ceil', 'round'
  ]);
  const ALLOWED_OPS = new Set(['+', '-', '*', '/', '^', 'unaryMinus', 'parentheses']);

  // ===== 函数解析 =====
  // input 形如 "y=0.5x+3" / "x=4" / "y=2*sin(x)"
  HF.parseFunction = function (input) {
    if (typeof input !== 'string') return { ok: false, msg: '请输入函数' };
    const raw = input.replace(/\s+/g, '');
    if (raw.length === 0) return { ok: false, msg: '表达式为空' };
    const m = raw.match(/^(y|x)=(.+)$/i);
    if (!m) return { ok: false, msg: '需形如 y=f(x) 或 x=c' };
    const side = m[1].toLowerCase();
    const expr = m[2];
    if (expr.length === 0) return { ok: false, msg: '表达式为空' };

    let compiled;
    try {
      const node = math.parse(preprocess(expr));
      validateAST(node);
      compiled = node.compile();
    } catch (e) {
      return { ok: false, msg: '表达式非法: ' + (e.message || '') };
    }
    return { ok: true, type: side, compiled, raw };
  };

  // 隐式乘法预处理：0.5x -> 0.5*x ; 2sin -> 2*sin ; )( -> )*( ; 3( -> 3*(
  function preprocess(e) {
    let s = e;
    s = s.replace(/(\d)([a-zA-Z(])/g, '$1*$2');   // 数字后接字母/(
    s = s.replace(/\)([a-zA-Z(])/g, ')*$1');       // ) 后接字母/(
    return s; // math.js 原生支持 ^ 幂运算，无需替换
  }

  function validateAST(node, varName) {
    const vn = varName || 'x';
    const t = node.type;
    if (t === 'ConstantNode' || t === 'SymbolNode') {
      if (t === 'SymbolNode' && node.name !== vn) throw new Error('未知变量 ' + node.name);
      return;
    }
    if (t === 'OperatorNode') {
      if (!ALLOWED_OPS.has(node.op)) throw new Error('不允许的运算符 ' + node.op);
      node.args.forEach(c => validateAST(c, vn));
      return;
    }
    if (t === 'FunctionNode') {
      if (!ALLOWED_FUNCS.has(node.fn.name || node.fn)) throw new Error('不允许的函数 ' + (node.fn.name || node.fn));
      node.args.forEach(c => validateAST(c, vn));
      return;
    }
    if (t === 'ParenthesisNode') { validateAST(node.content, vn); return; }
    if (t === 'UnaryMinus') { node.args.forEach(c => validateAST(c, vn)); return; }
    throw new Error('不允许的语法: ' + t);
  }

  // 安全求值
  function evalY(compiled, x) {
    try {
      const v = compiled.evaluate({ x });
      if (typeof v === 'number' && isFinite(v)) return v;
      return NaN;
    } catch (e) { return NaN; }
  }

  // ===== 参数化曲线解析（用于隐函数如圆、椭圆等） =====
  // xExpr/yExpr 含变量 t；返回 {ok, cx, cy, tMin, tMax}
  HF.parseParametric = function (xExpr, yExpr, tMin, tMax) {
    try {
      const nx = math.parse(preprocess(xExpr));
      const ny = math.parse(preprocess(yExpr));
      validateAST(nx, 't');
      validateAST(ny, 't');
      return { ok: true, cx: nx.compile(), cy: ny.compile(), tMin, tMax };
    } catch (e) {
      return { ok: false, msg: '参数式非法: ' + (e.message || '') };
    }
  };

  // 统一曲线求值 C(t) -> {x,y} 或 null
  function evalCurve(curve, t) {
    if (curve.mode === 'y') {
      const y = evalY(curve.compiled, t);
      return isNaN(y) ? null : { x: t, y };
    }
    if (curve.mode === 'x') {
      return { x: curve.c, y: t };
    }
    if (curve.mode === 'param') {
      const x = evalT(curve.cx, t);
      const y = evalT(curve.cy, t);
      if (isNaN(x) || isNaN(y)) return null;
      return { x, y };
    }
    return null;
  }
  function evalT(compiled, t) {
    try {
      const v = compiled.evaluate({ t });
      return (typeof v === 'number' && isFinite(v)) ? v : NaN;
    } catch (e) { return NaN; }
  }

  // 把 parseFunction 结果或 parseParametric 结果包装成统一 curve
  HF.makeCurve = function (parsed) {
    if (parsed.mode) return parsed; // 已是 curve
    if (parsed.type === 'x') {
      const c = parseConst(parsed.raw, 'x');
      if (c === null) return null;
      return { mode: 'x', c, tMin: HF.BOARD_MIN, tMax: HF.BOARD_MAX };
    }
    return { mode: 'y', compiled: parsed.compiled, tMin: HF.BOARD_MIN, tMax: HF.BOARD_MAX };
  };

  // ===== 锚点距离校验（统一参数化） =====
  HF.anchorDistance = function (parsed, x0, y0) {
    const curve = HF.makeCurve(parsed);
    if (!curve) return Infinity;
    let best = Infinity;
    const step = (curve.tMax - curve.tMin) / 2000;
    for (let t = curve.tMin; t <= curve.tMax + 1e-9; t += step) {
      const p = evalCurve(curve, t);
      if (!p) continue;
      const d = Math.hypot(p.x - x0, p.y - y0);
      if (d < best) best = d;
    }
    return best;
  };

  // 垂足 Q（统一参数化）
  HF.footPoint = function (parsed, x0, y0) {
    const curve = HF.makeCurve(parsed);
    if (!curve) return null;
    let best = Infinity, bt = curve.tMin, bx = 0, by = 0;
    const step = (curve.tMax - curve.tMin) / 2000;
    for (let t = curve.tMin; t <= curve.tMax + 1e-9; t += step) {
      const p = evalCurve(curve, t);
      if (!p) continue;
      const d = Math.hypot(p.x - x0, p.y - y0);
      if (d < best) { best = d; bt = t; bx = p.x; by = p.y; }
    }
    if (best === Infinity) return null;
    return { x: bx, y: by, t: bt };
  };

  function parseConst(raw, side) {
    const m = raw.replace(/\s+/g, '').match(new RegExp('^' + side + '=(.+)$', 'i'));
    if (!m) return null;
    try {
      const v = math.evaluate(preprocess(m[1]));
      if (typeof v === 'number' && isFinite(v)) return v;
    } catch (e) {}
    return null;
  }

  // ===== 几何辅助 =====
  HF.math = HF.math || {};
  HF.math.distPointToSegment = function (p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const len2 = vx * vx + vy * vy;
    let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * vx, cy = a.y + t * vy;
    return Math.hypot(p.x - cx, p.y - cy);
  };

  // 两线段交点，返回 {x,y} 或 null；t 为在线段1上的参数
  HF.math.segmentIntersect = function (p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-12) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), t, u };
  };

  // 反射矩阵 R = I - 2 n nᵀ （n 单位法向）
  function reflectMatrix(nx, ny) {
    return [
      [1 - 2 * nx * nx, -2 * nx * ny],
      [-2 * nx * ny, 1 - 2 * ny * ny],
    ];
  }
  function applyMat(M, v) {
    return [M[0][0] * v[0] + M[0][1] * v[1], M[1][0] * v[0] + M[1][1] * v[1]];
  }

  // ===== 激光生成：曲线行进 + 累积反射 + 命中判定 =====
  // func: parseFunction 结果或 curve 对象；anchor: {x,y}；pieces: 所有棋子（含敌我），anchorId 排除
  // forPreview: true 时跳过命中判定，返回完整曲线（预览用）
  // 返回 { points: [[x,y],...], hits: [{piece, point:{x,y}}] }
  HF.generateLaser = function (func, anchor, allPieces, anchorPieceId, forPreview) {
    const curve = HF.makeCurve(func);
    if (!curve) return { points: [], hits: [] };
    const Q = HF.footPoint(func, anchor.x, anchor.y);
    if (!Q) return { points: [], hits: [] };

    const obstacles = HF.state.obstacles;
    const dt = (curve.tMax - curve.tMin) / 3000;

    // 统一曲线求值
    function C(t) {
      return evalCurve(curve, t);
    }

    const hits = [];

    // 工具函数
    function transform(M, b, p) {
      const v = applyMat(M, [p.x, p.y]);
      return { x: v[0] + b[0], y: v[1] + b[1] };
    }
    function matMul(A, B) {
      return [
        [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
        [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
      ];
    }
    function closestOnSegment(p, a, b) {
      const vx = b.x - a.x, vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      let t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      return { x: a.x + t * vx, y: a.y + t * vy };
    }
    function clipToBounds(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const ts = [];
      if (dx !== 0) { ts.push((HF.BOARD_MIN - a.x) / dx); ts.push((HF.BOARD_MAX - a.x) / dx); }
      if (dy !== 0) { ts.push((HF.BOARD_MIN - a.y) / dy); ts.push((HF.BOARD_MAX - a.y) / dy); }
      let best = null;
      for (const t of ts) {
        if (t < 1e-9 || t > 1 + 1e-9) continue;
        const px = a.x + t * dx, py = a.y + t * dy;
        if (px >= HF.BOARD_MIN - 1e-6 && px <= HF.BOARD_MAX + 1e-6 &&
            py >= HF.BOARD_MIN - 1e-6 && py <= HF.BOARD_MAX + 1e-6) {
          if (!best || t < best.t) best = { x: px, y: py };
        }
      }
      return best ? best : a;
    }

    // 单方向行进，返回该方向的有序点列表与命中
    function march(tStart, dir) {
      const pts = [];
      let M = [[1, 0], [0, 1]];
      let b = [0, 0];
      let t = tStart + dir * dt;
      let prev = Q;
      let steps = 0;
      const MAX_STEPS = 3000;
      while (steps++ < MAX_STEPS) {
        if (t < curve.tMin || t > curve.tMax) break;
        const orig = C(t);
        if (!orig) { t += dir * dt; continue; }
        let cur = transform(M, b, orig);

        // 检测与障碍交点（取最近）
        let hit = null, hitObs = null;
        for (const ob of obstacles) {
          const is = HF.math.segmentIntersect(prev, cur, { x: ob.x1, y: ob.y1 }, { x: ob.x2, y: ob.y2 });
          if (!is) continue;
          const d1 = Math.hypot(is.x - ob.x1, is.y - ob.y1);
          const d2 = Math.hypot(is.x - ob.x2, is.y - ob.y2);
          if (d1 < 0.05 || d2 < 0.05) continue; // 端点特例：不反射
          if (!hit || is.t < hit.t) { hit = is; hitObs = ob; }
        }

        if (hit && hitObs) {
          pts.push({ x: hit.x, y: hit.y });
          const odx = hitObs.x2 - hitObs.x1, ody = hitObs.y2 - hitObs.y1;
          const olen = Math.hypot(odx, ody);
          const ux = odx / olen, uy = ody / olen;
          const nx = -uy, ny = ux;
          const R = reflectMatrix(nx, ny);
          const P0 = { x: hitObs.x1, y: hitObs.y1 };
          M = matMul(R, M);
          const Rb = applyMat(R, b);
          const RP0 = applyMat(R, [P0.x, P0.y]);
          b = [Rb[0] + P0.x - RP0[0], Rb[1] + P0.y - RP0[1]];
          prev = { x: hit.x, y: hit.y };
          cur = transform(M, b, orig);
        }

        // 命中棋子检测（预览模式跳过，显示完整曲线）
        if (!forPreview) {
          let hitPiece = null, hitPoint = null, hitDist = Infinity;
          for (const pc of allPieces) {
            if (!pc.alive) continue;
            if (pc.id === anchorPieceId) continue;
            const d = HF.math.distPointToSegment({ x: pc.x, y: pc.y }, prev, cur);
            if (d < 0.5 && d < hitDist) {
              hitDist = d; hitPiece = pc;
              hitPoint = closestOnSegment({ x: pc.x, y: pc.y }, prev, cur);
            }
          }
          if (hitPiece) {
            pts.push(hitPoint);
            hits.push({ piece: hitPiece, point: hitPoint });
            return pts; // 一击即止
          }
        }

        // 出界裁剪
        if (cur.x < HF.BOARD_MIN - 0.001 || cur.x > HF.BOARD_MAX + 0.001 ||
            cur.y < HF.BOARD_MIN - 0.001 || cur.y > HF.BOARD_MAX + 0.001) {
          pts.push(clipToBounds(prev, cur));
          return pts;
        }

        pts.push(cur);
        prev = cur;
        t += dir * dt;
      }
      return pts;
    }

    const forward = march(Q.t, +1);
    const backward = march(Q.t, -1);
    // 拼接为连续折线：反向(倒序) + Q + 正向
    const points = backward.slice().reverse().concat([Q], forward);
    return { points, hits };
  };
})();
