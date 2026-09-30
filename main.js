/* 五子棋主逻辑：由 gomoku.html 内联脚本拆分而来（2026-09-28 结构优化） */
(() => {
  const SIZE = 15;            // 15x15 board
  const CELL = 36;            // cell size in px
  const PAD = 24;             // padding around grid
  const LOGICAL_SIZE = CELL * (SIZE - 1) + PAD * 2; // 552 逻辑像素
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  let DPR = 1;                // 实际渲染像素比（见 setupCanvas）

  // UI refs
  const turnStone = document.getElementById('turnStone');
  const turnText = document.getElementById('turnText');
  const moveCountEl = document.getElementById('moveCount');
  const lastMoveEl = document.getElementById('lastMove');
  const undoBtn = document.getElementById('undoBtn');
  const restartBtn = document.getElementById('restartBtn');
  const overlay = document.getElementById('overlay');
  const winnerStone = document.getElementById('winnerStone');
  const winnerText = document.getElementById('winnerText');
  const winDetail = document.getElementById('winDetail');
  const winStamp = document.getElementById('winStamp');
  const againBtn = document.getElementById('againBtn');
  const pvpBtn = document.getElementById('pvpBtn');
  const aiBtn = document.getElementById('aiBtn');
  const aiOpts = document.getElementById('aiOpts');
  const aiColorSel = document.getElementById('aiColorSel');
  const aiLevelSel = document.getElementById('aiLevelSel');

  let board = [];       // 0 empty, 1 black, 2 white
  let history = [];     // {x, y, player}
  let currentPlayer = 1;
  let gameOver = false;
  let hoverPos = null;  // {x, y}
  let overlayTimer = null; // 胜负弹窗延迟计时器（开局前必须清理）

  // 人机对战状态
  const BLACK = 1;          // 黑方常量（AI 执黑先行判定用）
  let mode = 'pvp';          // 'pvp' 双人 | 'ai' 人机
  let aiColor = 2;           // AI 执子颜色（默认执白，玩家执黑先行）
  let humanColor = 1;
  let aiThinking = false;    // AI 推演中（锁定落子/悔棋）
  let aiJobSeq = 0;          // 任务序号：丢弃过期推演结果
  let aiDelayTimer = null;

  const COL_LABELS = 'ABCDEFGHJKLMNOP'; // skip I

  /* ---------- procedural kaya wood (pre-rendered once) ---------- */
  const wood = document.createElement('canvas');

  // 按设备像素比渲染：位图放大 DPR 倍，CSS 显示尺寸保持 552，高分屏清晰
  function setupCanvas() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(LOGICAL_SIZE * DPR);
    canvas.height = canvas.width;
    wood.width = canvas.width;
    wood.height = canvas.height;
  }

  function buildWood() {
    const w = LOGICAL_SIZE, h = LOGICAL_SIZE; // 木纹在逻辑坐标下绘制
    const g = wood.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    let seed = 20260927;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    // base kaya tone
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#e8c789');
    bg.addColorStop(0.45, '#ddb777');
    bg.addColorStop(1, '#d6ab6a');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // long, gently waving grain lines
    for (let i = 0; i < 82; i++) {
      const x0 = rnd() * w;
      const amp = 1 + rnd() * 4.5;
      const freq = 0.004 + rnd() * 0.011;
      const phase = rnd() * Math.PI * 2;
      const shade = 95 + rnd() * 70;
      g.strokeStyle = `rgba(${shade | 0}, ${(shade * 0.62) | 0}, ${(shade * 0.3) | 0}, ${(0.03 + rnd() * 0.09).toFixed(3)})`;
      g.lineWidth = 0.5 + rnd() * 1.3;
      g.beginPath();
      for (let yy = 0; yy <= h; yy += 4) {
        const xx = x0 + Math.sin(yy * freq + phase) * amp
                     + Math.sin(yy * freq * 2.7 + phase) * amp * 0.3;
        yy === 0 ? g.moveTo(xx, yy) : g.lineTo(xx, yy);
      }
      g.stroke();
    }

    // soft wide bands
    for (let i = 0; i < 6; i++) {
      const x = rnd() * w;
      const bw = 8 + rnd() * 26;
      const band = g.createLinearGradient(x - bw, 0, x + bw, 0);
      band.addColorStop(0, 'rgba(140,90,40,0)');
      band.addColorStop(0.5, `rgba(140,90,40,${(0.03 + rnd() * 0.05).toFixed(3)})`);
      band.addColorStop(1, 'rgba(140,90,40,0)');
      g.fillStyle = band;
      g.fillRect(x - bw, 0, bw * 2, h);
    }

    // faint knots
    for (let k = 0; k < 2; k++) {
      const kx = w * (0.2 + rnd() * 0.6);
      const ky = h * (0.15 + rnd() * 0.7);
      for (let r = 3; r < 14; r += 2.5) {
        g.strokeStyle = `rgba(120,75,35,${Math.max(0.02, 0.1 - r * 0.005).toFixed(3)})`;
        g.beginPath();
        g.ellipse(kx, ky, r * 1.7, r, 0.4, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // warm top sheen
    const sheen = g.createLinearGradient(0, 0, 0, h);
    sheen.addColorStop(0, 'rgba(255,242,205,0.2)');
    sheen.addColorStop(0.22, 'rgba(255,242,205,0)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, w, h);

    // edge vignette
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.36, w / 2, h / 2, h * 0.88);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(120,70,20,0.22)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);

    // ---- 静态棋盘层：网格/边框/星位/坐标标签一并烘焙进木纹画布，避免逐帧重绘 ----
    g.strokeStyle = '#775228';
    g.lineWidth = 1.1;
    for (let i = 0; i < SIZE; i++) {
      g.beginPath();
      g.moveTo(PAD, boardToPx(i));
      g.lineTo(LOGICAL_SIZE - PAD, boardToPx(i));
      g.stroke();
      g.beginPath();
      g.moveTo(boardToPx(i), PAD);
      g.lineTo(boardToPx(i), LOGICAL_SIZE - PAD);
      g.stroke();
    }

    g.lineWidth = 2.2;
    g.strokeStyle = '#68451f';
    g.strokeRect(PAD, boardToPx(0), CELL * (SIZE - 1), CELL * (SIZE - 1));

    const stars = [[3,3],[3,11],[11,3],[11,11],[7,7],[3,7],[11,7],[7,3],[7,11]];
    g.fillStyle = '#4a3018';
    stars.forEach(([x, y]) => {
      g.beginPath();
      g.arc(boardToPx(x), boardToPx(y), 3.2, 0, Math.PI * 2);
      g.fill();
    });

    g.fillStyle = 'rgba(107,74,37,0.7)';
    g.font = '11.5px "Cormorant Garamond", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < SIZE; i++) {
      g.fillText(COL_LABELS[i], boardToPx(i), PAD / 2);
      g.fillText(COL_LABELS[i], boardToPx(i), LOGICAL_SIZE - PAD / 2);
      g.fillText(String(SIZE - i), PAD / 2, boardToPx(i));
      g.fillText(String(SIZE - i), LOGICAL_SIZE - PAD / 2, boardToPx(i));
    }
  }

  /* ---------- animation loop ---------- */
  let effects = [];   // {type, start, duration, ...}
  let rafOn = false;

  function kick() {
    if (reduced || rafOn) return;
    rafOn = true;
    requestAnimationFrame(loop);
  }
  function loop(t) {
    draw(t);
    effects = effects.filter(e => t - e.start < e.duration);
    if (effects.length) requestAnimationFrame(loop);
    else { draw(performance.now()); rafOn = false; }
  }

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function initBoard() {
    aiJobSeq++;                        // 使推演中的 AI 任务失效
    clearTimeout(aiDelayTimer);
    aiThinking = false;
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    history = [];
    currentPlayer = 1;
    gameOver = false;
    hoverPos = null;
    effects = [];
    clearTimeout(overlayTimer);
    winnerStone.style.background = '';
    overlay.classList.remove('show');
    updateUI();
    draw();
    if (mode === 'ai' && aiColor === BLACK) requestAiMove(); // 玩家执白时 AI 先行
  }

  function boardToPx(i) { return PAD + i * CELL; }

  function drawBoard() {
    // 木纹、网格、星位、坐标标签已一次性烘焙进 wood 画布。
    // 必须显式给定逻辑尺寸：wood 的位图分辨率是 LOGICAL_SIZE*DPR，
    // 若只传 (0,0)，drawImage 会按位图固有像素绘制，在已 setTransform(DPR)
    // 的坐标系里被二次放大，导致高分屏右下棋盘被裁出画布。
    ctx.drawImage(wood, 0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
  }

  function drawStone(x, y, player, alpha = 1, scale = 1) {
    const cx = boardToPx(x);
    const cy = boardToPx(y);
    const r = CELL * 0.45 * scale;

    // settling shadow
    ctx.save();
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + 3, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body
    const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    if (player === 1) {
      grad.addColorStop(0, '#737373');
      grad.addColorStop(0.4, '#2c2c2c');
      grad.addColorStop(1, '#050505');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.6, '#eaeaea');
      grad.addColorStop(1, '#b4b4b4');
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // glossy highlight
    const hl = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 0, cx - r * 0.4, cy - r * 0.4, r * 0.6);
    if (player === 1) {
      hl.addColorStop(0, 'rgba(255,255,255,0.32)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      hl.addColorStop(0, 'rgba(255,255,255,0.92)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLastMoveMarker(x, y) {
    const cx = boardToPx(x);
    const cy = boardToPx(y);
    ctx.save();
    ctx.strokeStyle = '#b23a2e';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawAim(x, y) {
    const cx = boardToPx(x);
    const cy = boardToPx(y);
    const d = CELL * 0.64;
    const L = 5;
    ctx.save();
    ctx.strokeStyle = 'rgba(107,74,37,0.55)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const ticks = [
      [cx, cy - d, cx, cy - d - L],
      [cx, cy + d, cx, cy + d + L],
      [cx - d, cy, cx - d - L, cy],
      [cx + d, cy, cx + d + L, cy]
    ];
    ticks.forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawHover() {
    if (!hoverPos || gameOver) return;
    const { x, y } = hoverPos;
    if (board[y][x] !== 0) return;
    drawAim(x, y);
    drawStone(x, y, currentPlayer, 0.38);
  }

  function drawWinLine(line, t) {
    const fx = effects.find(e => e.type === 'win');
    const start = line[0], end = line[line.length - 1];
    const sx = boardToPx(start[0]), sy = boardToPx(start[1]);
    const ex = boardToPx(end[0]), ey = boardToPx(end[1]);
    let frac = 1;
    if (fx) frac = easeInOutCubic(clamp01((t - fx.start) / fx.duration));
    const px = sx + (ex - sx) * frac;
    const py = sy + (ey - sy) * frac;

    ctx.save();
    ctx.strokeStyle = 'rgba(192,69,58,0.92)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#c0453a';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.restore();
  }

  function draw(t = performance.now()) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBoard();

    const drop = effects.find(e => e.type === 'drop');

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (board[y][x] === 0) continue;
        if (drop && drop.x === x && drop.y === y) {
          const p = clamp01((t - drop.start) / drop.duration);
          // falls from 1.35x with a gentle settle
          const s = 1.35 - 0.35 * easeOutBack(p);
          drawStone(x, y, board[y][x], 1, s);
        } else {
          drawStone(x, y, board[y][x]);
        }
      }
    }

    if (gameOver && winLineCache) drawWinLine(winLineCache, t);

    if (history.length) {
      const last = history[history.length - 1];
      drawLastMoveMarker(last.x, last.y);
    }

    drawHover();
  }

  let winLineCache = null;

  function getCellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    // 绘制走逻辑坐标（ctx 已按 DPR 缩放），事件坐标必须换算到同一逻辑坐标系，
    // 不能用 canvas.width（设备像素），否则高分屏上鼠标与棋子位置错位
    const scaleX = LOGICAL_SIZE / rect.width;
    const scaleY = LOGICAL_SIZE / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const x = Math.round((px - PAD) / CELL);
    const y = Math.round((py - PAD) / CELL);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    const dx = px - boardToPx(x);
    const dy = py - boardToPx(y);
    if (Math.hypot(dx, dy) > CELL * 0.5) return null;
    return { x, y };
  }

  function placeStone(x, y) {
    if (gameOver || board[y][x] !== 0) return;
    board[y][x] = currentPlayer;
    history.push({ x, y, player: currentPlayer });

    if (!reduced) {
      effects.push({ type: 'drop', x, y, start: performance.now(), duration: 380 });
    }

    const winLine = checkWin(x, y, currentPlayer);
    if (winLine) {
      winLineCache = winLine;
      gameOver = true;
      if (!reduced) effects.push({ type: 'win', start: performance.now() + 220, duration: 720 });
      showWin(currentPlayer, winLine);
      updateUI();
      kick();
      if (reduced) draw();
      return;
    }

    if (history.length === SIZE * SIZE) {
      gameOver = true;
      showDraw();
      updateUI();
      return;
    }

    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateUI();
    if (mode === 'ai') requestAiMove(); // 轮到 AI 时触发推演
    kick();
    if (reduced) draw();
  }

  function checkWin(x, y, player) {
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    for (const [dx, dy] of dirs) {
      const line = [[x, y]];
      let nx = x + dx, ny = y + dy;
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === player) {
        line.push([nx, ny]);
        nx += dx; ny += dy;
      }
      nx = x - dx; ny = y - dy;
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === player) {
        line.unshift([nx, ny]);
        nx -= dx; ny -= dy;
      }
      if (line.length >= 5) return line.slice(0, 5);
    }
    return null;
  }

  function undo() {
    if (history.length === 0 || aiThinking) return;
    if (mode === 'ai') {
      // 成对回退（AI + 玩家），保证回到"轮到玩家"的局面
      const steps = Math.min(2, history.length);
      for (let i = 0; i < steps; i++) {
        const last = history.pop();
        board[last.y][last.x] = 0;
      }
      gameOver = false;
      winLineCache = null;
      clearTimeout(overlayTimer);
      overlay.classList.remove('show');
      currentPlayer = humanColor;
      updateUI();
      draw();
      if (history.length === 0 && aiColor === BLACK) requestAiMove(); // 退回空盘后仍由 AI 先行
      return;
    }
    if (gameOver) return;
    const last = history.pop();
    board[last.y][last.x] = 0;
    currentPlayer = last.player;
    updateUI();
    draw();
  }

  function updateUI() {
    turnStone.className = 'stone-indicator ' + (currentPlayer === 1 ? 'stone-black' : 'stone-white');
    turnText.textContent = aiThinking ? 'AI 思考中…' : (currentPlayer === 1 ? '黑棋' : '白棋') + '执子';
    moveCountEl.textContent = history.length;
    if (history.length) {
      const l = history[history.length - 1];
      lastMoveEl.textContent = COL_LABELS[l.x] + (SIZE - l.y);
      if (turnStone.animate) {
        try {
          turnStone.animate(
            [{ transform: 'scale(0.72)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
            { duration: 320, easing: 'cubic-bezier(0.34,1.56,0.64,1)' }
          );
        } catch (err) { /* no-op */ }
      }
    } else {
      lastMoveEl.textContent = '—';
    }
    undoBtn.disabled = aiThinking || (mode === 'ai' ? history.length === 0 : (history.length === 0 || gameOver));
  }

  function showWin(player, line) {
    winnerStone.style.background = '';
    winnerStone.className = 'winner-stone ' + (player === 1 ? 'stone-black' : 'stone-white');
    if (mode === 'ai') {
      winnerText.textContent = player === humanColor ? '你赢了' : '电脑获胜';
    } else {
      winnerText.textContent = (player === 1 ? '黑棋' : '白棋') + '获胜';
    }
    winStamp.textContent = '胜';
    const start = line[0], end = line[line.length - 1];
    winDetail.textContent = `五子连珠：${COL_LABELS[start[0]]}${SIZE - start[1]} → ${COL_LABELS[end[0]]}${SIZE - end[1]}`;
    overlayTimer = setTimeout(() => overlay.classList.add('show'), 600);
  }

  function showDraw() {
    winnerStone.className = 'winner-stone';
    winnerStone.style.background = 'linear-gradient(135deg, #3d342c, #8d8378)';
    winnerText.textContent = '平局';
    winStamp.textContent = '和';
    winDetail.textContent = '棋盘已满，握手言和';
    overlayTimer = setTimeout(() => overlay.classList.add('show'), 400);
  }

  /* ---------- floating dust motes ---------- */
  const motesEl = document.getElementById('motes');
  if (!reduced) {
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.className = 'mote';
      const sz = (0.8 + Math.random() * 1.7).toFixed(1);
      s.style.left = Math.random() * 100 + '%';
      s.style.width = s.style.height = sz + 'px';
      s.style.animationDuration = (11 + Math.random() * 12).toFixed(1) + 's';
      s.style.animationDelay = (-Math.random() * 20).toFixed(1) + 's';
      motesEl.appendChild(s);
    }
  }

  /* ---------- events ---------- */
  canvas.addEventListener('click', (e) => {
    if (mode === 'ai' && currentPlayer === aiColor) return; // AI 回合由程序落子
    const cell = getCellFromEvent(e);
    if (cell) placeStone(cell.x, cell.y);
  });

  // mousemove 触发的高频重绘经 rAF 节流；动画循环运行时每帧已重绘，无需额外调度
  let hoverRafPending = false;
  function scheduleHoverDraw() {
    if (hoverRafPending || rafOn) return;
    hoverRafPending = true;
    requestAnimationFrame(() => {
      hoverRafPending = false;
      if (!rafOn) draw();
    });
  }

  canvas.addEventListener('mousemove', (e) => {
    hoverPos = getCellFromEvent(e);
    scheduleHoverDraw();
  });

  canvas.addEventListener('mouseleave', () => {
    hoverPos = null;
    scheduleHoverDraw();
  });

  undoBtn.addEventListener('click', undo);
  restartBtn.addEventListener('click', () => { winLineCache = null; initBoard(); });
  againBtn.addEventListener('click', () => { winLineCache = null; initBoard(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'u' || e.key === 'U') undo();
    if (e.key === 'r' || e.key === 'R') { winLineCache = null; initBoard(); }
    if (e.key === 'Escape') {
      clearTimeout(overlayTimer);
      overlay.classList.remove('show');
    }
  });

  /* ---------- 人机对战 AI ---------- */
  function aiDepth() {
    const lv = parseInt(aiLevelSel.value, 10) || 2;
    return lv === 1 ? 1 : lv === 3 ? 4 : 2; // 初/中/高级 → 搜索深度 1/2/4
  }

  // 核心引擎：启发式棋型评分 + 候选点裁剪 + α-β 剪枝极小极大搜索。
  // 函数自包含（不引用外部变量），便于通过 toString() 注入 Web Worker。
  function findBestMove(board, player, maxDepth) {
    const SIZE = 15;
    const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const FIVE = 10000000, OPEN_FOUR = 800000, FOUR = 60000,
          OPEN_THREE = 9000, THREE = 900, OPEN_TWO = 350, TWO = 100,
          ONE = 12;

    // player 若落子在 (x,y) 完成的棋型得分（按四个方向累加）
    function scoreCell(x, y, p) {
      if (board[y][x] !== 0) return 0;
      let total = 0;
      for (const [dx, dy] of DIRS) {
        let count = 1, open = 0;
        let nx = x + dx, ny = y + dy;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === p) { count++; nx += dx; ny += dy; }
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === 0) open++;
        nx = x - dx; ny = y - dy;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === p) { count++; nx -= dx; ny -= dy; }
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === 0) open++;
        let s;
        if (count >= 5) s = FIVE;
        else if (count === 4) s = open === 2 ? OPEN_FOUR : FOUR;
        else if (count === 3) s = open === 2 ? OPEN_THREE : open === 1 ? THREE : 80;
        else if (count === 2) s = open === 2 ? OPEN_TWO : open === 1 ? TWO : 30;
        else if (count === 1) s = open === 2 ? ONE : open === 1 ? 6 : 1;
        else s = 1;
        total += s;
      }
      return total;
    }

    // 占据该点的攻防综合价值（己方进攻分 + 对方在该点的威胁分）
    function moveValue(x, y, p) {
      return scoreCell(x, y, p) + scoreCell(x, y, 3 - p);
    }

    // 候选点：已有棋子周围 2 格内的空位，按价值降序；空盘取天元
    function candidates(p) {
      let occupied = false;
      for (let y = 0; y < SIZE && !occupied; y++)
        for (let x = 0; x < SIZE; x++)
          if (board[y][x] !== 0) { occupied = true; break; }
      if (!occupied) return [{ x: 7, y: 7, v: 0 }];
      const mark = new Set();
      const cand = [];
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (board[y][x] === 0) continue;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
              if (board[ny][nx] !== 0) continue;
              const key = ny * SIZE + nx;
              if (!mark.has(key)) {
                mark.add(key);
                cand.push({ x: nx, y: ny, v: 0 });
              }
            }
          }
        }
      }
      for (const c of cand) c.v = moveValue(c.x, c.y, p);
      cand.sort((a, b) => b.v - a.v);
      return cand;
    }

    function search(p, depth, alpha, beta) {
      const cand = candidates(p).slice(0, 12);
      if (cand.length === 0) return 0;
      if (depth <= 0) return cand[0].v;
      let best = -Infinity;
      for (const c of cand) {
        // 注意：scoreCell 只统计空点棋型，必须在落子前评估
        const win = scoreCell(c.x, c.y, p) >= FIVE;
        const mv0 = win ? 0 : moveValue(c.x, c.y, p);
        board[c.y][c.x] = p;
        const val = win ? FIVE + depth : mv0 - search(3 - p, depth - 1, -beta, -alpha); // 落子即成五优先于后续推演
        board[c.y][c.x] = 0;
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    const cand = candidates(player).slice(0, 18);
    if (cand.length === 0) return null;
    let bestMove = cand[0], bestVal = -Infinity;
    for (const c of cand) {
      const win = scoreCell(c.x, c.y, player) >= FIVE; // 落子前评估：该点尚为空
      const mv0 = win ? 0 : moveValue(c.x, c.y, player);
      board[c.y][c.x] = player;
      const val = win ? FIVE : mv0 - search(3 - player, maxDepth - 1, -Infinity, Infinity) + Math.random() * 5; // 轻微随机，棋路多变
      board[c.y][c.x] = 0;
      if (val > bestVal) { bestVal = val; bestMove = c; }
    }
    return { x: bestMove.x, y: bestMove.y };
  }

  function requestAiMove() {
    if (mode !== 'ai' || gameOver || currentPlayer !== aiColor) return;
    aiThinking = true;
    updateUI();
    const seq = ++aiJobSeq;
    const snapshot = board.map(row => row.slice()); // 快照，防止推演期间棋盘变化
    aiDelayTimer = setTimeout(() => {
      if (seq !== aiJobSeq) return;
      if (aiWorker) aiWorker.postMessage({ seq, board: snapshot, player: currentPlayer, depth: aiDepth() });
      else finishAi(seq, findBestMove(snapshot, currentPlayer, aiDepth())); // 无 Worker 环境回退主线程
    }, 380);
  }

  function finishAi(seq, move) {
    if (seq !== aiJobSeq) return; // 过期结果（已重开/切换模式）直接丢弃
    aiThinking = false;
    updateUI();
    if (move && !gameOver && mode === 'ai') placeStone(move.x, move.y);
  }

  let aiWorker = null;
  try {
    const src = 'self.onmessage=function(e){var d=e.data;var m=(' + findBestMove.toString() +
                ')(d.board,d.player,d.depth);self.postMessage({seq:d.seq,move:m});};';
    aiWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    aiWorker.onmessage = (e) => finishAi(e.data.seq, e.data.move);
  } catch (err) {
    aiWorker = null; // 个别环境禁用 Worker 时回退到主线程同步计算
  }

  function setMode(m) {
    mode = m;
    pvpBtn.classList.toggle('active', m === 'pvp');
    aiBtn.classList.toggle('active', m === 'ai');
    aiOpts.hidden = (m !== 'ai');
    winLineCache = null;
    initBoard();
  }

  function applyAiSettings() {
    aiColor = parseInt(aiColorSel.value, 10) || 2;
    humanColor = 3 - aiColor;
    winLineCache = null;
    initBoard();
  }

  pvpBtn.addEventListener('click', () => setMode('pvp'));
  aiBtn.addEventListener('click', () => setMode('ai'));
  aiColorSel.addEventListener('change', applyAiSettings);
  aiLevelSel.addEventListener('change', () => { winLineCache = null; initBoard(); });

  setupCanvas();
  buildWood();
  initBoard();

  // 字体加载完成后重绘静态层，保证坐标标签使用目标西文字体
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      buildWood();
      if (!rafOn) draw();
    });
  }

  // 跨屏拖动 / 浏览器缩放导致像素比变化时重建棋盘
  let resizePending = false;
  window.addEventListener('resize', () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      setupCanvas();
      buildWood();
      if (!rafOn) draw();
    });
  });
})();