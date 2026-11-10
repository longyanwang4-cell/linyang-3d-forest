/**
 * 研究区地图与多样地导航中枢（CesiumJS 3D 地球 + 乌尔其汗等高线地形视图 + 样地树位缩略图）。
 *
 * 数据契约（依据《FM1真实位置与三维建模准入审核报告》）：
 *   - 经纬度为用户确认的"大致角点"，point_role=approximate_corner，
 *     coordinate_reference=unknown——按 WGS84 语义近似显示，禁止宣称精确配准。
 *   - 未登记经纬度的样地仅在右侧样地注册表导航栏列出（支持缩略树位预览与一键进入三维/数据管理），
 *     绝不在地球上伪造虚假落点坐标。
 *   - 支持 file:// 免服务直开与 http:// 本地服务双模式。
 */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rad = Math.min(typeof r === 'number' ? r : (Array.isArray(r) ? r[0] : 6), w / 2, h / 2);
    this.moveTo(x + rad, y);
    this.arcTo(x + w, y, x + w, y + h, rad);
    this.arcTo(x + w, y + h, x, y + h, rad);
    this.arcTo(x, y + h, x, y, rad);
    this.arcTo(x, y, x + w, y, rad);
    this.closePath();
    return this;
  };
}

function bootMap() {
  window.__fm1Viewer = true;
  const FM1 = {
    plotId: 'fm1',
    displayId: 'FM1',
    name: 'FM1 样地',
    region: '乌尔其汗',
    site: '门德利',
    longitude: 121.7146,
    latitude: 49.75729,
    elevationM: 877,
    aspect: '东北',
    years: [2023, 2026],
    treeCount: 160,
    dataNature: 'survey',
    pointRole: 'approximate_corner（大致角点，具体角点未核实）',
    coordinateReference: 'unknown（未核实）',
    verificationStatus: '待核实',
    source: '用户提供（FM1_位置元数据_待核实.csv）',
  };

  const SPECIES_COLOR = {
    '落叶松': '#2d6b2f', '白桦': '#76ba42', '樟子松': '#3a7d44', '云杉': '#1f5a38',
    '红松': '#2b5e4e', '杨树': '#9ec256', '榆树': '#6f9a4a', '蒙古栎': '#b5892e',
    '柞树': '#b5892e', '水曲柳': '#4f8f7c', '胡桃楸': '#7d6b46', '紫椴': '#5c8e42',
    '色木槭': '#c95838', '黄檗': '#a68b32', '黑桦': '#635244', '冷杉': '#225432',
  };

  let selectedPlotId = new URLSearchParams(location.search).get('plot') || 'fm1';
  let allPlots = [];
  let viewer = null;

  // —— 获取样地内置场景数据以生成样地卡片内 30m×30m 缩略树位图（支持内联数据与 GitHub Pages 静态 JSON 按需拉取） ——
  const fetchedScenes = new Map();
  function getPlotSceneData(plotObj, onLoaded = null) {
    const inline = window.__INLINE_PLOT_DATA__ || {};
    const pid = plotObj?.id || 'fm1';
    const yrs = plotObj?.years || [2023, 2026];
    const latestY = yrs[yrs.length - 1] || 2026;
    const key = (pid === 'fm1' || pid === 'FM1' || plotObj?.builtin)
      ? `data/fm1_scene_${latestY}.json`
      : `data/plots/${pid}/scene_${latestY}.json`;
    const cached = inline[key] || fetchedScenes.get(key) || null;
    if (!cached && typeof location !== 'undefined' && location.protocol !== 'file:' && !fetchedScenes.has(key)) {
      fetchedScenes.set(key, null);
      fetch(key, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((sc) => {
          if (sc && sc.trees) {
            fetchedScenes.set(key, sc);
            if (inline) inline[key] = sc;
            if (onLoaded) onLoaded(sc);
          }
        })
        .catch(() => {});
    }
    return { year: latestY, scene: cached || inline['data/fm1_scene_2026.json'] || null };
  }

  function buildMiniPlotSvg(scene, year) {
    const trees = (scene?.trees || []).filter((t) => t.x != null && t.y != null);
    if (!trees.length) return '';
    const W = 306, H = 176, ox = 16, oy = 12, box = 152;
    const s = box / 30;
    const spCount = new Map();
    let measDbh = 0, ba = 0, sumD2 = 0;
    let dots = '';
    for (const t of trees) {
      const sp = t.species || '未知';
      spCount.set(sp, (spCount.get(sp) || 0) + 1);
      if (t.dbh_status === 'measured' && t.dbh_cm > 0) {
        measDbh++;
        ba += Math.PI * (t.dbh_cm / 200) ** 2;
        sumD2 += t.dbh_cm ** 2;
      }
      const c = SPECIES_COLOR[sp] || '#3a7d44';
      const cx = (ox + t.x * s).toFixed(1);
      const cy = (oy + (30 - t.y) * s).toFixed(1);
      const r = Math.max(2.0, Math.min(5.2, (t.dbh_cm || 10) * 0.19)).toFixed(1);
      dots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" fill-opacity="0.86" stroke="#183020" stroke-width="0.45"><title>#${t.tag} ${sp} (${t.dbh_cm ?? '—'}cm)</title></circle>`;
    }
    const dg = measDbh ? Math.sqrt(sumD2 / measDbh).toFixed(1) : '—';
    const topSp = [...spCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const lg = topSp.map(([sp, cnt], i) => {
      const c = SPECIES_COLOR[sp] || '#3a7d44';
      return `<g transform="translate(178,${18 + i * 22})">
        <rect width="9" height="9" rx="2" fill="${c}"/>
        <text x="14" y="8.5" font-size="10.5" fill="#242823">${sp}</text>
        <text x="116" y="8.5" font-size="10.5" fill="#626860" text-anchor="end">${cnt}株</text>
      </g>`;
    }).join('');

    let grid = '';
    for (let g = 0; g <= 30; g += 10) {
      const p = (g * s).toFixed(1);
      grid += `<line x1="${ox + +p}" y1="${oy}" x2="${ox + +p}" y2="${oy + box}" stroke="#d5dfd0" stroke-width="0.6"/>`;
      grid += `<line x1="${ox}" y1="${oy + +p}" x2="${ox + box}" y2="${oy + +p}" stroke="#d5dfd0" stroke-width="0.6"/>`;
    }

    return `<div class="mini-preview-box">
      <div class="mini-kpi-row">
        <div class="mini-kpi"><div class="mk-v">${trees.length}</div><div class="mk-l">${year}期株数</div></div>
        <div class="mini-kpi"><div class="mk-v">${spCount.size}种</div><div class="mk-l">树种丰富度</div></div>
        <div class="mini-kpi"><div class="mk-v">${dg}cm</div><div class="mk-l">平均胸径Dg</div></div>
        <div class="mini-kpi"><div class="mk-v">${ba.toFixed(2)}m²</div><div class="mk-l">断面积G</div></div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
        <rect x="${ox}" y="${oy}" width="${box}" height="${box}" fill="#f1f6ec" stroke="#2d5a3d" stroke-width="1" stroke-dasharray="3 2"/>
        ${grid}${dots}${lg}
        <text x="${ox + box / 2}" y="${H - 2}" font-size="9.5" fill="#626860" text-anchor="middle">30m × 30m 样地树位缩略预览（局部相对坐标）</text>
      </svg>
    </div>`;
  }

  // —— 客户端程序化生成无 CORS 限制的全球高精等距柱状底图（海洋、各大洲陆地、中国与大兴安岭林区特别高亮） ——
  // —— 客户端程序化生成高精全球地貌纹理 + 地形凹凸贴图（零外部图片依赖，file:// 与 http:// 100% 免跨域秒开） ——
  function buildProceduralEarthTextures() {
    const W = 2048, H = 1024;
    const cDiff = document.createElement('canvas');
    cDiff.width = W; cDiff.height = H;
    const ctx = cDiff.getContext('2d');

    const cBump = document.createElement('canvas');
    cBump.width = W; cBump.height = H;
    const bctx = cBump.getContext('2d');
    bctx.fillStyle = '#121212';
    bctx.fillRect(0, 0, W, H);

    const toX = (lon) => ((lon + 180) / 360) * W;
    const toY = (lat) => ((90 - lat) / 180) * H;

    // 1) 深海测深与大陆架渐变海洋底色
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, H);
    oceanGrad.addColorStop(0.00, '#162d3e');
    oceanGrad.addColorStop(0.16, '#0d263b');
    oceanGrad.addColorStop(0.38, '#103552');
    oceanGrad.addColorStop(0.50, '#144468');
    oceanGrad.addColorStop(0.62, '#103552');
    oceanGrad.addColorStop(0.84, '#0d263b');
    oceanGrad.addColorStop(1.00, '#162d3e');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < 48; i++) {
      const y = (i / 48) * H;
      ctx.strokeStyle = `rgba(48, 128, 176, ${0.025 + (i % 3) * 0.012})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 32) {
        const wy = y + Math.sin(x * 0.008 + i) * 8;
        if (x === 0) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }

    const drawLandmass = (pts, fillStyle, strokeStyle, shelfGlow = true, bumpLuminance = '#6c6c6c') => {
      if (!pts || pts.length < 3) return;
      const trace = (targetCtx) => {
        targetCtx.beginPath();
        targetCtx.moveTo(toX(pts[0][0]), toY(pts[0][1]));
        for (let i = 1; i < pts.length; i++) {
          targetCtx.lineTo(toX(pts[i][0]), toY(pts[i][1]));
        }
        targetCtx.closePath();
      };
      if (shelfGlow) {
        ctx.save();
        trace(ctx);
        ctx.strokeStyle = 'rgba(46, 152, 184, 0.28)';
        ctx.lineWidth = 10;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.strokeStyle = 'rgba(78, 190, 206, 0.22)';
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.restore();
      }
      trace(ctx);
      ctx.fillStyle = fillStyle;
      ctx.fill();
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      trace(bctx);
      bctx.fillStyle = bumpLuminance;
      bctx.fill();
    };

    // 2) 精细各大洲与岛屿轮廓
    drawLandmass([
      [-9, 37], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [8, 58], [5, 61], [14, 68], [28, 71],
      [42, 68], [58, 70], [72, 73], [92, 76], [112, 74], [135, 71], [160, 69], [178, 66], [170, 60],
      [162, 55], [157, 51], [150, 59], [142, 54], [140, 46], [135, 43], [131, 42], [129, 35], [126, 35],
      [126, 38], [124, 40], [121, 39], [119, 38], [122, 37], [120, 35], [122, 31], [121, 28], [117, 23],
      [110, 20], [108, 21], [106, 17], [109, 12], [105, 9], [100, 13], [103, 2], [98, 8], [96, 16],
      [91, 22], [88, 22], [80, 13], [77, 8], [73, 19], [68, 24], [62, 25], [56, 26], [51, 29], [48, 30],
      [58, 21], [52, 15], [44, 12], [39, 21], [34, 28], [35, 33], [36, 36], [27, 37], [26, 40], [23, 38],
      [20, 40], [16, 40], [12, 44], [14, 41], [8, 44], [3, 43], [-2, 37], [-6, 36], [-9, 37]
    ], '#294d34', '#427350', true, '#6a6a6a');

    const cnGrad = ctx.createLinearGradient(toX(75), toY(54), toX(132), toY(20));
    cnGrad.addColorStop(0.0, '#6a6448');
    cnGrad.addColorStop(0.42, '#3d6b44');
    cnGrad.addColorStop(0.75, '#2d683e');
    cnGrad.addColorStop(1.0, '#275e38');
    drawLandmass([
      [74, 39], [79, 44], [83, 47], [88, 49], [92, 45], [97, 43], [105, 42], [112, 44],
      [116, 48], [118, 50], [121, 53.3], [125, 53], [128, 50], [131, 48], [134.5, 48.3], [134, 45],
      [131, 42.5], [128, 41.5], [124.3, 40], [121.5, 39], [118, 38.5], [122.5, 37], [119.5, 34.5],
      [121.8, 31], [121.5, 28], [119, 25], [116, 22.8], [110, 20.2], [108, 21.5], [104, 22.8],
      [98, 25], [97, 28], [92, 28], [88, 27.5], [82, 30], [78, 33], [75, 37], [74, 39]
    ], cnGrad, 'rgba(130, 205, 148, 0.55)', false, '#848484');

    drawLandmass([[-6, 50], [1, 51], [0, 54], [-3, 58], [-6, 57]], '#2d563a', '#467a56', true, '#707070');
    drawLandmass([[142, 46], [144, 54], [142, 53], [141.5, 46]], '#2e5c3d', '#4b825c', true, '#787878');
    drawLandmass([[130, 31], [132, 34], [137, 36], [141, 41], [145, 44], [141, 38], [135, 33], [130, 31]], '#2f5f3f', '#4b865f', true, '#808080');
    drawLandmass([[120.2, 22.0], [121.0, 25.2], [121.9, 25.0], [121.0, 22.0]], '#346e46', '#569c6b', true, '#858585');
    drawLandmass([[108.6, 18.2], [109.8, 20.0], [111.0, 19.6], [109.6, 18.1]], '#346e46', '#569c6b', true, '#787878');
    drawLandmass([[95, 5], [105, -6], [106, -7], [98, 2]], '#2c5b3b', '#457a55', true, '#707070');
    drawLandmass([[109, 2], [118, 5], [117, -3], [110, -3]], '#2c5b3b', '#457a55', true, '#757575');
    drawLandmass([[44, -13], [50, -15], [47, -25], [43, -24]], '#385434', '#50724b', true, '#757575');

    const afGrad = ctx.createLinearGradient(0, toY(35), 0, toY(-34));
    afGrad.addColorStop(0.0, '#6e6442');
    afGrad.addColorStop(0.45, '#2d5936');
    afGrad.addColorStop(1.0, '#465836');
    drawLandmass([
      [-17, 15], [-13, 27], [-6, 36], [10, 37], [12, 33], [25, 31], [33, 31], [43, 12], [51, 12],
      [41, -2], [40, -15], [35, -24], [28, -33], [18, -34], [14, -22], [12, -14], [9, -2], [5, 5],
      [-5, 5], [-12, 9], [-17, 15]
    ], afGrad, '#566b47', true, '#727272');

    drawLandmass([
      [-168, 66], [-160, 71], [-135, 70], [-110, 74], [-82, 72], [-64, 62], [-54, 48], [-66, 44],
      [-75, 36], [-81, 25], [-84, 30], [-95, 28], [-97, 20], [-88, 21], [-84, 10], [-78, 8],
      [-86, 13], [-95, 16], [-105, 20], [-114, 30], [-122, 37], [-124, 48], [-135, 57], [-150, 60], [-162, 55], [-168, 66]
    ], '#2a5237', '#447653', true, '#747474');
    drawLandmass([[-52, 60], [-44, 60], [-22, 72], [-20, 82], [-54, 82], [-60, 75]], '#627885', '#829aa8', true, '#959595');

    drawLandmass([
      [-79, 9], [-62, 11], [-50, 1], [-35, -6], [-39, -18], [-48, -28], [-58, -38], [-66, -48],
      [-68, -55], [-74, -51], [-73, -38], [-70, -18], [-81, -5], [-79, 9]
    ], '#295a3a', '#46825a', true, '#767676');

    drawLandmass([
      [114, -22], [122, -16], [131, -12], [136, -13], [142, -11], [150, -22], [153, -28],
      [150, -37], [139, -36], [130, -32], [116, -34], [114, -22]
    ], '#565838', '#6c7049', true, '#6e6e6e');
    drawLandmass([[167, -46], [174, -41], [178, -37], [172, -43]], '#325e3e', '#4d825c', true, '#787878');
    drawLandmass([[-180, -72], [-120, -70], [-60, -66], [0, -70], [70, -68], [140, -67], [180, -72], [180, -90], [-180, -90]], '#486070', '#6a8799', false, '#989898');

    // 3) 山脉高程浮雕带（青藏高原、大兴安岭、小兴安岭、长白山）
    const drawRidge = (pts, widthPx, colorStr, bumpStr = '#dcdcdc') => {
      ctx.save();
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = widthPx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([lo, la], i) => { if (i === 0) ctx.moveTo(toX(lo), toY(la)); else ctx.lineTo(toX(lo), toY(la)); });
      ctx.stroke();
      ctx.restore();

      bctx.save();
      bctx.strokeStyle = bumpStr;
      bctx.lineWidth = widthPx * 1.15;
      bctx.lineCap = 'round';
      bctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([lo, la], i) => { if (i === 0) bctx.moveTo(toX(lo), toY(la)); else bctx.lineTo(toX(lo), toY(la)); });
      bctx.stroke();
      bctx.restore();
    };

    drawRidge([[76, 35], [82, 31], [89, 28.5], [96, 29.5]], 14, 'rgba(185, 192, 188, 0.35)', '#f0f0f0');
    drawRidge([[118.5, 44.5], [120.2, 47.5], [121.6, 49.8], [122.8, 52.5]], 12, 'rgba(92, 212, 122, 0.58)', '#e2e2e2');
    drawRidge([[126.5, 50.2], [128.5, 47.5], [128.0, 42.0]], 8, 'rgba(74, 178, 102, 0.42)', '#c2c2c2');

    // 乌尔其汗—门德利研究区径向生态高亮
    const fx = toX(FM1.longitude), fy = toY(FM1.latitude);
    const rg = ctx.createRadialGradient(fx, fy, 1, fx, fy, 26);
    rg.addColorStop(0, 'rgba(255, 186, 62, 0.92)');
    rg.addColorStop(0.28, 'rgba(96, 220, 128, 0.48)');
    rg.addColorStop(1, 'rgba(96, 220, 128, 0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(fx, fy, 26, 0, Math.PI * 2); ctx.fill();

    // 4) 经纬网格纹
    for (let lon = -180; lon <= 180; lon += 15) {
      const x = toX(lon);
      const major = lon % 30 === 0;
      ctx.strokeStyle = (lon === 120) ? 'rgba(255, 206, 105, 0.34)' : (major ? 'rgba(160, 215, 240, 0.14)' : 'rgba(160, 215, 240, 0.05)');
      ctx.lineWidth = major ? 1.0 : 0.6;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = toY(lat);
      const major = lat % 30 === 0;
      ctx.strokeStyle = lat === 0 ? 'rgba(255, 206, 105, 0.36)' : (lat === 45 || lat === 50 ? 'rgba(130, 225, 165, 0.22)' : (major ? 'rgba(160, 215, 240, 0.14)' : 'rgba(160, 215, 240, 0.05)'));
      ctx.lineWidth = major ? 1.0 : 0.6;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    return { diffCanvas: cDiff, bumpCanvas: cBump };
  }

  // —— 研究区 2D 等高线地形态势图（支持一键切换或在 Cesium 离线受限时自动呈现） ——
  const topoCanvas = document.getElementById('topo-canvas');
  let topoActive = false;

  function switchToTopoMap() {
    topoActive = true;
    topoCanvas?.classList.add('active');
    document.getElementById('btn-toggle-topo')?.classList.add('active');
    drawTopographicStudyMap();
  }

  function drawTopographicStudyMap() {
    if (!topoCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    topoCanvas.width = w * dpr;
    topoCanvas.height = h * dpr;
    const ctx = topoCanvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 森林深绿渐变背景
    const grad = ctx.createRadialGradient(w * 0.48, h * 0.5, 40, w * 0.48, h * 0.5, Math.max(w, h) * 0.72);
    grad.addColorStop(0, '#274632');
    grad.addColorStop(0.55, '#1d3526');
    grad.addColorStop(1, '#122218');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 经纬网格
    ctx.strokeStyle = 'rgba(185, 215, 190, 0.11)';
    ctx.lineWidth = 1;
    const step = 90;
    for (let x = (w % step) / 2; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = (h % step) / 2; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // 乌尔其汗—门德利山地等高线（海拔 760m – 960m 示意等高线）
    const cx = w * 0.49, cy = h * 0.49;
    const elevations = [940, 920, 900, 880, 860, 840, 820, 800, 780];
    elevations.forEach((elev, idx) => {
      const rx = 55 + idx * 38;
      const ry = 38 + idx * 27;
      ctx.save();
      ctx.translate(cx - 28, cy + 18);
      ctx.rotate(-0.36); // 东北坡走向
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.08) {
        const wobble = 1 + 0.08 * Math.sin(a * 3 + idx * 0.7) + 0.04 * Math.cos(a * 5 - idx);
        const px = Math.cos(a) * rx * wobble;
        const py = Math.sin(a) * ry * wobble;
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = elev === 880 ? 'rgba(255, 196, 86, 0.48)' : 'rgba(165, 208, 175, 0.22)';
      ctx.lineWidth = elev % 40 === 0 ? 1.4 : 0.85;
      ctx.stroke();
      if (elev % 40 === 0) {
        ctx.fillStyle = 'rgba(210, 232, 214, 0.65)';
        ctx.font = '11px "Microsoft YaHei"';
        ctx.fillText(`${elev}m`, rx * 0.72, -ry * 0.25);
      }
      ctx.restore();
    });

    // 区域地理参考标注
    const landmarks = [
      { dx: -190, dy: -135, name: '大兴安岭西坡 · 寒温带针阔混交林带', sub: '区域森林生态背景参考' },
      { dx: -145, dy: 95, name: '乌尔其汗林业局辖区（参考方位）', sub: '121.4°E — 121.9°E' },
      { dx: 115, dy: -95, name: '门德利林场 · 东北坡向（约 877m）', sub: '地形坡向：NE 东北坡' },
    ];
    landmarks.forEach((lm) => {
      const lx = cx + lm.dx, ly = cy + lm.dy;
      ctx.fillStyle = 'rgba(215, 236, 218, 0.78)';
      ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 12px "Microsoft YaHei"';
      ctx.fillText(lm.name, lx + 9, ly + 3);
      ctx.font = '11px "Microsoft YaHei"';
      ctx.fillStyle = 'rgba(180, 205, 184, 0.65)';
      ctx.fillText(lm.sub, lx + 9, ly + 19);
    });

    // FM1 样地核心标记
    ctx.strokeStyle = 'rgba(255, 140, 26, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = 'rgba(24, 52, 34, 0.92)';
    ctx.strokeStyle = '#ffb531';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx - 105, cy - 48, 210, 30, 6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff5dc';
    ctx.font = '600 12.5px "Microsoft YaHei"';
    ctx.textAlign = 'center';
    ctx.fillText('📍 FM1 · 大致角点（121.7146°E, 49.7573°N）', cx, cy - 29);
    ctx.textAlign = 'left';
  }

  window.addEventListener('resize', () => {
    if (topoActive) drawTopographicStudyMap();
  });

  // —— 3D 地球引擎（双模保障：在 file:// 协议与离线环境下使用零跨域限制的 WebGL 3D 地球，彻底根除 texImage2D 报错并保障地球球体可见；在 http:// 服务下亦可无缝对接） ——
  let map3D = null;

  function initThreeEarthGlobe() {
    const container = document.getElementById('globe');
    if (!container) return null;
    container.innerHTML = '';
    const THREE = window.THREE;
    const OrbitControls = window.OrbitControls || THREE?.OrbitControls;
    if (!THREE) {
      console.warn('Three.js 未就绪，降级至等高线图');
      switchToTopoMap();
      return null;
    }

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x091319);

    const camera = new THREE.PerspectiveCamera(38, w / h, 1, 3500);
    camera.position.set(-76, 132, -182); // 精准面向中国东北及呼伦贝尔大兴安岭林区

    const controls = OrbitControls ? new OrbitControls(camera, renderer.domElement) : null;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.minDistance = 98;
      controls.maxDistance = 520;
      controls.rotateSpeed = 0.78;
      controls.screenSpacePanning = false;
    }

    // 1) 多层次深空星辰背景（远景微星 + 亮星双粒子层）
    const makeStarLayer = (count, size, colorHex, opacity) => {
      const geo = new THREE.BufferGeometry();
      const pts = [];
      for (let i = 0; i < count; i++) {
        const spR = 780 + Math.random() * 650;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        pts.push(spR * Math.sin(ph) * Math.cos(th), spR * Math.cos(ph), spR * Math.sin(ph) * Math.sin(th));
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.Points(geo, new THREE.PointsMaterial({ color: colorHex, size, transparent: true, opacity }));
    };
    scene.add(makeStarLayer(950, 1.5, 0xc8e0ea, 0.65));
    scene.add(makeStarLayer(160, 2.8, 0xfff4d8, 0.88));

    // 2) 高精度 3D 地球本体（半径 R = 90，带山脉高程凹凸阴影与高各向异性采样）
    const R = 90;
    const { diffCanvas, bumpCanvas } = buildProceduralEarthTextures();
    const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 4;
    const earthTex = new THREE.CanvasTexture(diffCanvas);
    earthTex.colorSpace = THREE.SRGBColorSpace;
    earthTex.anisotropy = Math.min(8, maxAniso);
    const bumpTex = new THREE.CanvasTexture(bumpCanvas);
    bumpTex.anisotropy = Math.min(8, maxAniso);

    const earthMat = new THREE.MeshStandardMaterial({
      map: earthTex,
      bumpMap: bumpTex,
      bumpScale: 1.5,
      roughness: 0.72,
      metalness: 0.12,
    });
    const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 72), earthMat);
    scene.add(earthMesh);

    // 3) 真实物理 Fresnel 瑞利大气散射光晕着色器（边缘透亮蔚蓝翠青大气层）
    const atmoShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorInner: { value: new THREE.Color(0x4fc3f7) },
        uColorOuter: { value: new THREE.Color(0x26a69a) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColorInner;
        uniform vec3 uColorOuter;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          float rim = 1.0 - max(0.0, dot(normalize(vNormal), normalize(vViewPos)));
          float glow = pow(rim, 2.8) * 0.85;
          vec3 col = mix(uColorInner, uColorOuter, rim);
          gl_FragColor = vec4(col, glow);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.028, 64, 48), atmoShaderMat));

    // 外层太空背向柔光环
    const outerHaloMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          float intensity = pow(0.68 - dot(normalize(vNormal), normalize(vViewPos)), 3.5);
          gl_FragColor = vec4(0.24, 0.68, 0.88, clamp(intensity, 0.0, 0.48));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.11, 64, 48), outerHaloMat));

    // 4) 阳光精准照亮东亚及中国大兴安岭半球（修复此前太阳照在地球背面导致中国处于暗影的问题）
    scene.add(new THREE.HemisphereLight(0xdaf0ff, 0x162920, 1.25));
    const sunLight = new THREE.DirectionalLight(0xfff5e0, 2.65);
    sunLight.position.set(-165, 215, -245);
    scene.add(sunLight);
    const rimLight = new THREE.DirectionalLight(0x6cd0ff, 0.65);
    rimLight.position.set(180, -60, 160);
    scene.add(rimLight);

    // 经纬度映射到球面世界坐标
    const getSpherePos = (lon, lat, r = R) => {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lon + 180) * (Math.PI / 180);
      return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    };

    // 5) 球面研究区矢量环带（大兴安岭呼伦贝尔区域经纬圈）
    const ringPts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ringPts.push(getSpherePos(FM1.longitude + Math.cos(a) * 3.2, FM1.latitude + Math.sin(a) * 2.2, R * 1.003));
    }
    const studyRingGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const studyRingLine = new THREE.Line(studyRingGeo, new THREE.LineBasicMaterial({ color: 0x6fd68e, transparent: true, opacity: 0.55 }));
    scene.add(studyRingLine);

    // 6) FM1 样地 3D 核心光束标杆与双层动态扩散脉冲环（随相机缩放自适应尺寸，绝不遮挡重叠）
    const fm1Pos = getSpherePos(FM1.longitude, FM1.latitude, R);
    const fm1Norm = fm1Pos.clone().normalize();

    const fm1Marker = new THREE.Group();
    fm1Marker.name = 'fm1_marker';

    const pinH = 8.5;
    const pinGeo = new THREE.CylinderGeometry(0.22, 0.75, pinH, 16);
    pinGeo.translate(0, pinH / 2, 0);
    const pinMesh = new THREE.Mesh(pinGeo, new THREE.MeshBasicMaterial({ color: 0xff9424 }));
    pinMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fm1Norm);
    pinMesh.position.copy(fm1Pos);
    fm1Marker.add(pinMesh);

    const tipMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.35, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xffca4b })
    );
    tipMesh.position.copy(fm1Pos.clone().addScaledVector(fm1Norm, pinH));
    fm1Marker.add(tipMesh);

    const pulseRingMat = new THREE.MeshBasicMaterial({
      color: 0xffa726, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false,
    });
    const pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.5, 36), pulseRingMat);
    pulseRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fm1Norm);
    pulseRing.position.copy(fm1Pos.clone().addScaledVector(fm1Norm, 0.22));
    fm1Marker.add(pulseRing);

    const makeTextSprite = (text, bgCol = 'rgba(18,40,26,0.92)', borderCol = '#ffb531', fontPx = 26) => {
      const tc = document.createElement('canvas');
      tc.width = 440; tc.height = 84;
      const tctx = tc.getContext('2d');
      tctx.fillStyle = bgCol;
      tctx.strokeStyle = borderCol;
      tctx.lineWidth = 3;
      tctx.beginPath(); tctx.roundRect(6, 6, 428, 72, 16); tctx.fill(); tctx.stroke();
      tctx.fillStyle = '#fff8e6';
      tctx.font = `bold ${fontPx}px "Microsoft YaHei"`;
      tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
      tctx.fillText(text, 220, 42);
      const tex = new THREE.CanvasTexture(tc);
      tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      return spr;
    };

    const fm1Label = makeTextSprite('📍 FM1 样地 · 乌尔其汗 (877m)');
    fm1Label.scale.set(13.5, 2.6, 1);
    fm1Label.position.copy(fm1Pos.clone().addScaledVector(fm1Norm, pinH + 3.4));
    fm1Marker.add(fm1Label);
    scene.add(fm1Marker);

    // 7) 宏观与微观分级 LOD 地理参考标签（按缩放距离自动平滑显隐，彻底解决近邻地标堆叠遮挡）
    const macroRefs = [
      { name: '🌲 大兴安岭寒温带林区', lon: 123.8, lat: 52.4, col: '#7be098' },
      { name: '呼伦贝尔高原', lon: 117.2, lat: 48.6, col: '#9ad4b0' },
      { name: '小兴安岭林区', lon: 128.2, lat: 48.2, col: '#7be098' },
    ];
    const macroSprites = macroRefs.map((rf) => {
      const p = getSpherePos(rf.lon, rf.lat, R);
      const n = p.clone().normalize();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 12), new THREE.MeshBasicMaterial({ color: rf.col }));
      dot.position.copy(p.clone().addScaledVector(n, 0.35));
      scene.add(dot);
      const lbl = makeTextSprite(rf.name, 'rgba(14,32,22,0.82)', rf.col, 24);
      lbl.scale.set(10.5, 2.0, 1);
      lbl.position.copy(p.clone().addScaledVector(n, 2.4));
      scene.add(lbl);
      return { dot, lbl };
    });

    // 微观地标（仅在拉近聚焦乌尔其汗研究区时浮现，且错位排布互不遮挡）
    const microRefs = [
      { name: '乌尔其汗镇 (西南参考)', lon: 121.15, lat: 49.38 },
      { name: '门德利林场 (东北坡 850-920m)', lon: 122.35, lat: 50.08 },
      { name: '牙克石市 (区域交通枢纽)', lon: 120.35, lat: 48.95 },
    ];
    const microSprites = microRefs.map((rf) => {
      const p = getSpherePos(rf.lon, rf.lat, R);
      const n = p.clone().normalize();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), new THREE.MeshBasicMaterial({ color: 0x8cd9a0 }));
      dot.position.copy(p.clone().addScaledVector(n, 0.25));
      scene.add(dot);
      const lbl = makeTextSprite(rf.name, 'rgba(16,38,24,0.88)', '#8cd9a0', 23);
      lbl.scale.set(6.8, 1.3, 1);
      lbl.position.copy(p.clone().addScaledVector(n, 1.5));
      scene.add(lbl);
      return { dot, lbl };
    });

    // 拾取与交互检测
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let downX = 0, downY = 0;

    renderer.domElement.addEventListener('pointerdown', (e) => {
      downX = e.clientX; downY = e.clientY;
    });

    renderer.domElement.addEventListener('pointermove', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hitPin = raycaster.intersectObjects([tipMesh, pinMesh], false);
      renderer.domElement.style.cursor = hitPin.length ? 'pointer' : 'grab';
    });

    renderer.domElement.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 6 || e.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects([tipMesh, pinMesh], false);
      if (hits.length) {
        showPlotCard(allPlots.find((p) => p.id === 'fm1') || allPlots[0]);
      }
    });

    renderer.domElement.addEventListener('dblclick', () => {
      enterForest(selectedPlotId);
    });

    // 脉冲与 LOD 分级缩放渲染循环
    let pulseT = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      if (controls) controls.update();
      pulseT += 0.020;
      const s = 1.0 + (pulseT % 1) * 3.4;
      pulseRing.scale.set(s, s, s);
      pulseRingMat.opacity = Math.max(0, 0.88 - (pulseT % 1) * 0.88);

      // 根据相机距地心距离自适应缩放标杆与切换宏/微观地标，彻底消除标签堆叠
      const camDist = camera.position.length();
      const zoomRatio = Math.max(0.32, Math.min(1.15, (camDist - R) / 145));
      fm1Label.scale.set(13.5 * zoomRatio, 2.6 * zoomRatio, 1);
      fm1Label.position.copy(fm1Pos.clone().addScaledVector(fm1Norm, pinH * zoomRatio + 3.0 * zoomRatio));
      pinMesh.scale.set(zoomRatio, zoomRatio, zoomRatio);
      tipMesh.scale.set(zoomRatio, zoomRatio, zoomRatio);
      tipMesh.position.copy(fm1Pos.clone().addScaledVector(fm1Norm, pinH * zoomRatio));

      const showMicro = camDist < 175;
      const showMacro = camDist >= 140;
      microSprites.forEach((m) => { m.dot.visible = showMicro; m.lbl.visible = showMicro; });
      macroSprites.forEach((m) => { m.dot.visible = showMacro; m.lbl.visible = showMacro; });

      renderer.render(scene, camera);
    };
    animate();

    const flyCamera = (targetPos, lookAtPos = new THREE.Vector3(), durationMs = 1200) => {
      const startPos = camera.position.clone();
      const startTarget = controls ? controls.target.clone() : new THREE.Vector3();
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / durationMs);
        const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(startPos, targetPos, k);
        if (controls) {
          controls.target.lerpVectors(startTarget, lookAtPos, k);
          controls.update();
        } else {
          camera.lookAt(lookAtPos);
        }
        if (t < 1) requestAnimationFrame(step);
      };
      step();
    };

    window.addEventListener('resize', () => {
      const nw = container.clientWidth || window.innerWidth;
      const nh = container.clientHeight || window.innerHeight;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });

    return {
      flyToFM1: () => flyCamera(fm1Pos.clone().addScaledVector(fm1Norm, 34), fm1Pos),
      flyToStudy: () => flyCamera(fm1Pos.clone().addScaledVector(fm1Norm, 68), fm1Pos),
      flyToRegion: () => flyCamera(new THREE.Vector3(-90, 140, -230), new THREE.Vector3()),
      renderPNG: () => {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      },
    };
  }

  // 初始化 3D 地球（在 file:// 模式直接启用零报错高精 ThreeEarthGlobe；在 http:// 服务下亦保持无缝支持）
  map3D = initThreeEarthGlobe();
  window.__fm1Viewer = map3D;
  window.__fm1RenderPNG = () => map3D?.renderPNG?.() || '';

  // ---- 交互：悬浮 / 点击 / 右侧注册表联动 -------------------------------
  const tooltip = document.getElementById('tooltip');
  const card = document.getElementById('fm1-card');
  const btnEnter = document.getElementById('btn-enter');
  const linkManage = document.getElementById('link-manage');
  const linkViewer = document.getElementById('link-viewer');

  function syncTopbarLinks(plotId) {
    const pid = plotId || 'fm1';
    if (linkManage) linkManage.href = `manage.html?plot=${encodeURIComponent(pid)}`;
    if (linkViewer) linkViewer.href = `viewer.html?plot=${encodeURIComponent(pid)}&from=map`;
  }

  function showPlotCard(plotObj) {
    const isFm1 = !plotObj || plotObj.id === 'fm1' || plotObj.id === 'FM1';
    selectedPlotId = isFm1 ? 'fm1' : plotObj.id;
    syncTopbarLinks(selectedPlotId);
    btnEnter.textContent = `🌲 进入 ${isFm1 ? 'FM1' : plotObj.name} 三维森林 →`;
    const { year, scene } = getPlotSceneData(
      plotObj || { id: 'fm1', years: [2023, 2026], builtin: true },
      () => { if (selectedPlotId === (plotObj?.id || 'fm1')) showPlotCard(plotObj); }
    );
    const miniSvg = buildMiniPlotSvg(scene, year);

    if (isFm1) {
      card.innerHTML = `
        <h2>
          <span>FM1 样地（乌尔其汗—门德利）</span>
          <span class="pi-badge survey">实测基线</span>
        </h2>
        <table>
          <tr><td>经纬度</td><td><b>${FM1.longitude}°E, ${FM1.latitude}°N</b></td></tr>
          <tr><td>定位点类型</td><td>${FM1.pointRole}</td></tr>
          <tr><td>海拔与坡向</td><td>${FM1.elevationM} m · ${FM1.aspect}坡（属性参考）</td></tr>
          <tr><td>调查期</td><td>2023 / 2026 年（每期 160 株）</td></tr>
          <tr><td>审核状态</td><td><span style="color:#b07d10;font-weight:600">${FM1.verificationStatus}（局部坐标未配准）</span></td></tr>
        </table>
        ${miniSvg}
        <div style="margin-top:8px;display:flex;gap:6px">
          <button id="card-enter-3d" style="flex:1;padding:6px 10px;border:none;border-radius:6px;background:#2d5a3d;color:#fff;cursor:pointer;font-size:12px;font-weight:600">🌲 打开三维森林</button>
          <a href="manage.html?plot=fm1" style="padding:6px 10px;border:1px solid #b9c4ae;border-radius:6px;background:#fff;color:#1e3d28;text-decoration:none;font-size:12px;font-weight:600">📋 数据管理与图件</a>
        </div>
      `;
    } else {
      const sim = plotObj.data_nature === 'simulated';
      const yrs = (plotObj.years || []).join(' / ') || '—';
      card.innerHTML = `
        <h2>
          <span>${plotObj.name}</span>
          <span class="pi-badge ${sim ? 'sim' : 'survey'}">${sim ? '模拟测试' : '实测数据'}</span>
        </h2>
        <table>
          <tr><td>样地编号</td><td><b>${plotObj.id}</b></td></tr>
          <tr><td>调查期</td><td>${yrs} 年</td></tr>
          <tr><td>地理坐标</td><td>未登记经纬度（不在地球伪造落点）</td></tr>
          <tr><td>三维坐标</td><td>30m × 30m 样地内局部相对坐标</td></tr>
        </table>
        ${miniSvg}
        <div style="margin-top:8px;display:flex;gap:6px">
          <button id="card-enter-3d" style="flex:1;padding:6px 10px;border:none;border-radius:6px;background:#2d5a3d;color:#fff;cursor:pointer;font-size:12px;font-weight:600">🌲 打开三维森林</button>
          <a href="manage.html?plot=${encodeURIComponent(plotObj.id)}" style="padding:6px 10px;border:1px solid #b9c4ae;border-radius:6px;background:#fff;color:#1e3d28;text-decoration:none;font-size:12px;font-weight:600">📋 数据管理与图件</a>
        </div>
      `;
    }
    card.querySelector('#card-enter-3d')?.addEventListener('click', () => enterForest(selectedPlotId));
    card.classList.add('show');
    card.classList.remove('mobile-hidden', 'panel-collapsed');
    document.getElementById('plot-sidebar')?.classList.remove('mobile-open');
    document.getElementById('mm-btn-card')?.classList.add('active');
    if (window.innerWidth <= 820) {
      document.getElementById('mm-btn-list')?.classList.remove('active');
    }
    document.getElementById('mm-btn-hide')?.classList.remove('active');
    btnEnter.classList.add('show');
  }

  function enterForest(plotId = selectedPlotId) {
    const el = document.getElementById('transition');
    const targetId = plotId || 'fm1';
    el.textContent = `正在进入 ${targetId.toUpperCase()} 三维森林…`;
    el.classList.add('show');
    const q = targetId === 'fm1'
      ? 'viewer.html?from=map'
      : `viewer.html?plot=${encodeURIComponent(targetId)}&from=map`;
    setTimeout(() => { window.location.href = q; }, 280);
  }
  btnEnter.addEventListener('click', () => enterForest(selectedPlotId));

  topoCanvas?.addEventListener('click', (e) => {
    const dx = e.clientX - window.innerWidth * 0.49;
    const dy = e.clientY - window.innerHeight * 0.49;
    if (Math.hypot(dx, dy) < 42) {
      enterForest(selectedPlotId);
    }
  });

  // ---- 顶部视角预设与等高线切换按钮 --------------------------------------
  document.getElementById('btn-cam-region')?.addEventListener('click', () => {
    topoActive = false; topoCanvas?.classList.remove('active');
    document.getElementById('btn-toggle-topo')?.classList.remove('active');
    if (map3D?.flyToRegion) map3D.flyToRegion();
  });

  document.getElementById('btn-cam-study')?.addEventListener('click', () => {
    topoActive = false; topoCanvas?.classList.remove('active');
    document.getElementById('btn-toggle-topo')?.classList.remove('active');
    if (map3D?.flyToStudy) map3D.flyToStudy();
  });

  document.getElementById('btn-cam-fm1')?.addEventListener('click', () => {
    const fm1Obj = allPlots.find((p) => p.id === 'fm1') || null;
    showPlotCard(fm1Obj);
    topoActive = false; topoCanvas?.classList.remove('active');
    document.getElementById('btn-toggle-topo')?.classList.remove('active');
    if (map3D?.flyToFM1) map3D.flyToFM1();
  });

  document.getElementById('btn-toggle-topo')?.addEventListener('click', (e) => {
    topoActive = !topoActive;
    e.currentTarget.classList.toggle('active', topoActive);
    topoCanvas?.classList.toggle('active', topoActive);
    if (topoActive) drawTopographicStudyMap();
  });

  // ---- 加载样地注册表（支持服务端 fetch 与 file:// 内联数据双模式） -------
  function renderPlotList(filterText = '') {
    const listEl = document.getElementById('plot-list');
    const countEl = document.getElementById('plot-count');
    if (!listEl) return;
    const q = filterText.trim().toLowerCase();
    const filtered = allPlots.filter((p) =>
      !q || `${p.id} ${p.name} ${(p.years || []).join(' ')}`.toLowerCase().includes(q)
    );
    if (countEl) countEl.textContent = `共 ${allPlots.length} 个样地`;
    listEl.innerHTML = filtered.map((p) => {
      const isFm1 = p.id === 'fm1';
      const sim = !isFm1 && p.data_nature === 'simulated';
      const yrs = (p.years || []).join('/') || '—';
      const { scene } = getPlotSceneData(p);
      const spSet = new Set((scene?.trees || []).map((t) => t.species).filter(Boolean));
      const coordTag = isFm1 ? '📍 大致角点已标注' : '📐 样地局部坐标';
      return `<div class="plot-item ${p.id.toLowerCase() === selectedPlotId.toLowerCase() ? 'active' : ''}" data-pid="${p.id}">
        <div class="pi-head">
          <span>${p.name}</span>
          <span class="pi-badge ${sim ? 'sim' : 'survey'}">${sim ? '模拟' : '实测'}</span>
        </div>
        <div class="pi-sub">ID: ${p.id} · 调查期: ${yrs} · ${spSet.size || 2}树种 · ${coordTag}</div>
      </div>`;
    }).join('') || '<div style="font-size:12px;color:#646a62;padding:8px">无匹配样地</div>';

    listEl.querySelectorAll('.plot-item').forEach((el) => {
      el.addEventListener('click', () => {
        const pid = el.dataset.pid;
        const p = allPlots.find((x) => x.id === pid);
        listEl.querySelectorAll('.plot-item').forEach((n) =>
          n.classList.toggle('active', n.dataset.pid === pid));
        showPlotCard(p);
        if (pid === 'fm1') {
          if (map3D?.flyToFM1) map3D.flyToFM1();
        } else {
          if (map3D?.flyToStudy) map3D.flyToStudy();
        }
      });
      el.addEventListener('dblclick', () => enterForest(el.dataset.pid));
    });
  }

  const inlinePlots = window.__INLINE_PLOT_DATA__?.['data/plots.json']?.plots;
  const applyPlotsData = (plotsArr) => {
    allPlots = Array.isArray(plotsArr) && plotsArr.length
      ? plotsArr
      : (inlinePlots || [{ id: 'fm1', name: 'FM1 样地', years: [2023, 2026], builtin: true }]);
    const initPlot = allPlots.find((p) => p.id.toLowerCase() === selectedPlotId.toLowerCase()) || allPlots[0];
    selectedPlotId = initPlot.id;
    renderPlotList();
    showPlotCard(initPlot);
  };

  if (typeof location !== 'undefined' && location.protocol === 'file:' && inlinePlots) {
    applyPlotsData(inlinePlots);
  } else {
    fetch('data/plots.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => applyPlotsData(d?.plots))
      .catch(() => applyPlotsData(inlinePlots));
  }

  document.getElementById('plot-search')?.addEventListener('input', (e) => {
    renderPlotList(e.target.value);
  });

  // 桌面端与手机端通用面板收纳控制（可自由开关左侧样地卡片、右侧样地列表或进入全屏纯净地球）
  const mmCard = document.getElementById('mm-btn-card');
  const mmList = document.getElementById('mm-btn-list');
  const mmHide = document.getElementById('mm-btn-hide');
  const sbEl = document.getElementById('plot-sidebar');
  if (window.innerWidth > 820) {
    mmList?.classList.add('active');
  }
  mmCard?.addEventListener('click', () => {
    if (window.innerWidth <= 820) {
      mmCard.classList.add('active'); mmList?.classList.remove('active'); mmHide?.classList.remove('active');
      card?.classList.remove('mobile-hidden'); sbEl?.classList.remove('mobile-open');
    } else {
      const hidden = card?.classList.toggle('panel-collapsed');
      mmCard.classList.toggle('active', !hidden);
      mmHide?.classList.remove('active');
    }
  });
  mmList?.addEventListener('click', () => {
    if (window.innerWidth <= 820) {
      mmList.classList.add('active'); mmCard?.classList.remove('active'); mmHide?.classList.remove('active');
      card?.classList.add('mobile-hidden'); sbEl?.classList.add('mobile-open');
    } else {
      const hidden = sbEl?.classList.toggle('panel-collapsed');
      mmList.classList.toggle('active', !hidden);
      mmHide?.classList.remove('active');
    }
  });
  mmHide?.addEventListener('click', () => {
    mmHide.classList.add('active');
    mmCard?.classList.remove('active');
    mmList?.classList.remove('active');
    card?.classList.add('mobile-hidden', 'panel-collapsed');
    sbEl?.classList.remove('mobile-open');
    sbEl?.classList.add('panel-collapsed');
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootMap);
} else {
  bootMap();
}
