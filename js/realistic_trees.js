/**
 * 高颜值程序化树木三维建模引擎（兴安落叶松 / 东北白桦 / 东北多树种）。
 *
 * 解决痛点：
 * 1. 彻底告别“圆锥体/球体插在短木棍上”的简陋几何感；
 * 2. 第一层样方树（ForestScene 160 株）：
 *    每树种预构建 4 套共享自然变体几何（全高通直微弯主干 + 3D 轮生/分叉枝条骨架 +
 *    带顶点环境光遮蔽 AO 的立体曲率叶簇云），配合 512×512 高清植物学针叶簇/锯齿白桦叶贴图
 *    与 1K PBR 树皮法线贴图，每棵树仅 3 个 Mesh（trunk + branch + foliage），60+ FPS 流畅运行；
 * 3. 弹窗单木高精度检视（TreePortrait）：
 *    按单木实测 DBH、树高 H、南北/东西冠幅（NS/EW）实时生成多级分枝（主干+主枝+次级侧枝+细枝）
 *    与高密度叶簇，严格保证 y=1.3m 处树干半径 === DBH/2（误差 0.0000m）、树冠最高点 === H（误差 0.000m）。
 */

(function () {
const THREE = window.THREE;
const resolveSpeciesProfile = window.resolveSpeciesProfile;

// ============================================================ 确定性随机数与数学工具

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function rgbStr(r, g, b, a = 1) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return a < 1 ? `rgba(${c(r)},${c(g)},${c(b)},${a})` : `rgb(${c(r)},${c(g)},${c(b)})`;
}

// ============================================================ 高清植物学贴图合成器（512×512 RGBA）

const _TEX_CACHE = new Map();

/**
 * 合成 512×512 针叶树枝叶簇贴图（兴安落叶松/红松/云杉/樟子松）：
 * 含木质小枝主轴、侧生短枝叶枕与成簇放射的柔细针叶束（深色内层遮蔽 + 亮色叶尖）。
 */
function getBotanicalNeedleTexture(kindKey = 'larch_summer', baseHex = 0x2f6134, tipHex = 0x6fa84e) {
  const cacheKey = `needle_${kindKey}_${baseHex.toString(16)}_${tipHex.toString(16)}`;
  if (_TEX_CACHE.has(cacheKey)) return _TEX_CACHE.get(cacheKey);
  if (typeof document === 'undefined') return null;

  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  const rand = mulberry32(baseHex ^ tipHex ^ 0x13579bdf);
  const [br, bg, bb] = hexToRgb(baseHex);
  const [tr, tg, tb] = hexToRgb(tipHex);

  // 辅助：在 (cx, cy) 绘制一簇短枝针叶玫瑰束（fascicle rosette）
  const drawFascicle = (cx, cy, radius, needleCount, angleCenter, spread) => {
    // 底部环境光暗影核
    const gradCore = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius * 0.42);
    gradCore.addColorStop(0, rgbStr(br * 0.45, bg * 0.48, bb * 0.45, 0.92));
    gradCore.addColorStop(1, rgbStr(br * 0.6, bg * 0.6, bb * 0.6, 0.0));
    ctx.fillStyle = gradCore;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < needleCount; i++) {
      const f = i / Math.max(needleCount - 1, 1);
      const ang = angleCenter + (f - 0.5) * spread + (rand() - 0.5) * 0.18;
      const len = radius * (0.62 + 0.42 * rand());
      const curve = (rand() - 0.5) * radius * 0.16;
      const x1 = cx + Math.cos(ang) * len;
      const y1 = cy + Math.sin(ang) * len;
      const mx = cx + Math.cos(ang) * len * 0.52 - Math.sin(ang) * curve;
      const my = cy + Math.sin(ang) * len * 0.52 + Math.cos(ang) * curve;

      const shade = 0.78 + 0.42 * rand();
      const g = ctx.createLinearGradient(cx, cy, x1, y1);
      g.addColorStop(0, rgbStr(br * 0.58 * shade, bg * 0.62 * shade, bb * 0.58 * shade, 0.96));
      g.addColorStop(0.55, rgbStr(br * shade, bg * shade, bb * shade, 0.96));
      g.addColorStop(1, rgbStr(tr * shade, tg * shade, tb * shade, 0.88));

      ctx.strokeStyle = g;
      ctx.lineWidth = 2.2 + rand() * 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(mx, my, x1, y1);
      ctx.stroke();
    }
    // 短枝木质叶枕小点
    ctx.fillStyle = 'rgba(78, 54, 36, 0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
    ctx.fill();
  };

  // 绘制交叉分叉的针叶小枝组（从中心向四周自然伸展 7 条营养枝，每枝带多簇短枝针叶）
  const mainShoots = [
    { x0: 256, y0: 465, x1: 256, y1: 52, spurs: 7 },
    { x0: 256, y0: 410, x1: 82,  y1: 145, spurs: 5 },
    { x0: 256, y0: 410, x1: 430, y1: 145, spurs: 5 },
    { x0: 256, y0: 320, x1: 58,  y1: 275, spurs: 4 },
    { x0: 256, y0: 320, x1: 454, y1: 275, spurs: 4 },
    { x0: 256, y0: 230, x1: 125, y1: 72,  spurs: 4 },
    { x0: 256, y0: 230, x1: 387, y1: 72,  spurs: 4 },
  ];

  // 先画底层致密针叶簇（提供饱满树冠体积感）
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + rand() * 0.2;
    const d = 35 + rand() * 115;
    drawFascicle(
      256 + Math.cos(a) * d,
      258 + Math.sin(a) * d,
      68 + rand() * 26,
      28,
      a,
      Math.PI * 1.65
    );
  }

  // 再画木质细枝与表层高清晰度簇生针叶
  for (const sh of mainShoots) {
    ctx.strokeStyle = 'rgba(86, 58, 38, 0.85)';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sh.x0, sh.y0);
    ctx.lineTo(sh.x1, sh.y1);
    ctx.stroke();

    const ang = Math.atan2(sh.y1 - sh.y0, sh.x1 - sh.x0);
    for (let s = 1; s <= sh.spurs; s++) {
      const t = s / sh.spurs;
      const sx = sh.x0 + (sh.x1 - sh.x0) * t + (rand() - 0.5) * 10;
      const sy = sh.y0 + (sh.y1 - sh.y0) * t + (rand() - 0.5) * 10;
      const r = (1 - t * 0.28) * 76;
      drawFascicle(sx, sy, r, 30, ang, Math.PI * 1.45);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _TEX_CACHE.set(cacheKey, tex);
  return tex;
}

/**
 * 合成 512×512 阔叶树（白桦/蒙古栎/杨树/水曲柳/胡桃楸/色木槭）枝叶簇贴图：
 * 含柔韧分叉细枝、叶柄、三角状卵形锯齿叶片、主侧叶脉与透光层次。
 */
function getBotanicalBroadleafTexture(kindKey = 'birch_summer', baseHex = 0x5d8e3c, hiHex = 0x99c662) {
  const cacheKey = `broad_${kindKey}_${baseHex.toString(16)}_${hiHex.toString(16)}`;
  if (_TEX_CACHE.has(cacheKey)) return _TEX_CACHE.get(cacheKey);
  if (typeof document === 'undefined') return null;

  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  const rand = mulberry32(baseHex ^ hiHex ^ 0x2468ace0);
  const [br, bg, bb] = hexToRgb(baseHex);
  const [hr, hg, hb] = hexToRgb(hiHex);

  // 绘制单片带叶脉与锯齿缘的阔叶（白桦三角状卵形叶）
  const drawLeaf = (cx, cy, len, wid, angle, brightness) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // 叶柄
    ctx.strokeStyle = 'rgba(72, 58, 38, 0.85)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, len * 0.18);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // 叶片锯齿轮廓（三角状卵形，先端渐尖）
    const steps = 28;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps; // 0 -> 1 around perimeter
      const theta = u * Math.PI * 2;
      // 纵向 t ∈ [0(基部), 1(叶尖)]
      const ny = (1 - Math.cos(theta)) * 0.5;
      // 白桦叶宽包络：中下部最宽，向尖端渐尖
      const envW = Math.sin(theta) * Math.pow(1 - ny * 0.72, 0.58) * 1.25;
      const tooth = (ny > 0.08 && ny < 0.94) ? (i % 2 === 0 ? 1.06 : 0.95) : 1.0;
      const px = envW * wid * tooth;
      const py = -ny * len;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    const rL = (br + (hr - br) * brightness);
    const gL = (bg + (hg - bg) * brightness);
    const bL = (bb + (hb - bb) * brightness);
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, rgbStr(rL * 0.76, gL * 0.78, bL * 0.74, 0.97));
    grad.addColorStop(0.55, rgbStr(rL, gL, bL, 0.97));
    grad.addColorStop(1, rgbStr(rL * 1.14, gL * 1.14, bL * 1.08, 0.95));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = rgbStr(rL * 0.55, gL * 0.58, bL * 0.52, 0.65);
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // 主脉与侧脉
    ctx.strokeStyle = rgbStr(rL * 1.18, gL * 1.20, bL * 1.05, 0.55);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -len * 0.92);
    for (let v = 1; v <= 4; v++) {
      const vy = -len * (0.18 + v * 0.16);
      const vw = wid * (0.75 - v * 0.11);
      ctx.moveTo(0, vy);
      ctx.lineTo(vw, vy - len * 0.09);
      ctx.moveTo(0, vy);
      ctx.lineTo(-vw, vy - len * 0.09);
    }
    ctx.stroke();
    ctx.restore();
  };

  // 1) 底层深色内冠叶群（营造浓密树冠内部体积阴影）
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    const dist = 30 + rand() * 145;
    const lx = 256 + Math.cos(a) * dist;
    const ly = 262 + Math.sin(a) * dist;
    drawLeaf(lx, ly, 68 + rand() * 34, 28 + rand() * 14, a + Math.PI / 2 + (rand() - 0.5) * 0.9, rand() * 0.35);
  }

  // 2) 柔韧分叉白桦细枝骨架
  ctx.strokeStyle = 'rgba(92, 76, 62, 0.82)';
  ctx.lineCap = 'round';
  const twigs = [
    [[256, 470], [256, 250], [248, 70]],
    [[256, 390], [160, 270], [85, 155]],
    [[256, 390], [352, 270], [425, 155]],
    [[256, 290], [145, 195], [75, 265]],
    [[256, 290], [365, 195], [435, 265]],
  ];
  for (const tw of twigs) {
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(tw[0][0], tw[0][1]);
    ctx.quadraticCurveTo(tw[1][0], tw[1][1], tw[2][0], tw[2][1]);
    ctx.stroke();
  }

  // 3) 中上层受光面鲜亮叶片簇（自然错落交叠）
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const dist = 18 + rand() * 155;
    const lx = 256 + Math.cos(a) * dist;
    const ly = 252 + Math.sin(a) * dist;
    const bright = 0.38 + 0.62 * rand();
    drawLeaf(lx, ly, 62 + rand() * 32, 25 + rand() * 13, a + Math.PI / 2 + (rand() - 0.5) * 0.75, bright);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _TEX_CACHE.set(cacheKey, tex);
  return tex;
}

/**
 * 合成高真实感白桦树皮纹理（512×1024）：
 * 粉白横纹表皮 + 黑色横生皮孔 + Λ形枝痕黑结节 + 树基黑褐色深裂粗皮靴。
 */
function getHighResBirchBarkTexture() {
  const key = 'highres_birch_bark_v2';
  if (_TEX_CACHE.has(key)) return _TEX_CACHE.get(key);
  if (typeof document === 'undefined') return null;

  const W = 512, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(0x16882023);

  // 纵向主底色渐变（上部银白微暖，下部过渡到树基黑褐粗裂皮）
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0.0, '#ece8de');
  bgGrad.addColorStop(0.55, '#e5e0d4');
  bgGrad.addColorStop(0.80, '#d5cec0');
  bgGrad.addColorStop(0.90, '#726a60');
  bgGrad.addColorStop(1.0, '#36322d');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 横向纸质剥落微层理（白桦特有的环向丝光层纹）
  for (let y = 0; y < H * 0.88; y += 3) {
    const v = 222 + Math.round((rand() - 0.5) * 26);
    ctx.fillStyle = `rgba(${v},${v - 3},${v - 9},0.28)`;
    ctx.fillRect(0, y, W, 2);
  }

  // 细密深色横生皮孔（horizontal lenticels）
  for (let i = 0; i < 420; i++) {
    const y = rand() * H * 0.86;
    const x = rand() * W;
    const len = 8 + rand() * 34;
    const h = 1.2 + rand() * 2.4;
    ctx.fillStyle = rand() < 0.7 ? 'rgba(46,40,35,0.68)' : 'rgba(128,116,102,0.52)';
    ctx.fillRect(x, y, len, h);
    if (x + len > W) ctx.fillRect(0, y, x + len - W, h);
  }

  // 特征性 Λ 形黑褐色枝痕结节（自整枝留下的三角形黑斑）
  for (let i = 0; i < 18; i++) {
    const cx = rand() * W;
    const cy = H * (0.12 + rand() * 0.70);
    const bw = 22 + rand() * 36;
    const bh = 12 + rand() * 22;
    ctx.fillStyle = 'rgba(34, 30, 26, 0.86)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - bh * 0.65);
    ctx.quadraticCurveTo(cx + bw * 0.5, cy - bh * 0.1, cx + bw, cy + bh * 0.55);
    ctx.quadraticCurveTo(cx, cy + bh * 0.15, cx - bw, cy + bh * 0.55);
    ctx.quadraticCurveTo(cx - bw * 0.5, cy - bh * 0.1, cx, cy - bh * 0.65);
    ctx.fill();
  }

  // 树干基部 18% 黑褐色深纵裂粗皮靴（basal rough bark boot）
  for (let i = 0; i < 48; i++) {
    const x = (i / 48) * W + (rand() - 0.5) * 6;
    const topY = H * (0.76 + rand() * 0.14);
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(24,22,19,0.92)' : 'rgba(96,88,78,0.55)';
    ctx.lineWidth = 3 + rand() * 4;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + (rand() - 0.5) * 14, topY);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _TEX_CACHE.set(key, tex);
  return tex;
}

// ============================================================ 三维几何合并与构建工具

function mergeBufferGeometries(geos) {
  let totalVerts = 0, totalIdx = 0;
  let hasColor = false;
  for (const g of geos) {
    totalVerts += g.getAttribute('position').count;
    totalIdx += g.index ? g.index.count : g.getAttribute('position').count;
    if (g.getAttribute('color')) hasColor = true;
  }
  const posArr = new Float32Array(totalVerts * 3);
  const nrmArr = new Float32Array(totalVerts * 3);
  const uvArr = new Float32Array(totalVerts * 2);
  const colArr = hasColor ? new Float32Array(totalVerts * 3) : null;
  const idxArr = new Uint32Array(totalIdx);

  let vOff = 0, iOff = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    const c = g.getAttribute('color');
    const cnt = p.count;
    posArr.set(p.array, vOff * 3);
    if (n) nrmArr.set(n.array, vOff * 3);
    if (u) uvArr.set(u.array, vOff * 2);
    if (colArr) {
      if (c) colArr.set(c.array, vOff * 3);
      else {
        for (let k = 0; k < cnt * 3; k++) colArr[vOff * 3 + k] = 1;
      }
    }
    if (g.index) {
      const ia = g.index.array;
      for (let k = 0; k < ia.length; k++) idxArr[iOff + k] = ia[k] + vOff;
      iOff += ia.length;
    } else {
      for (let k = 0; k < cnt; k++) idxArr[iOff + k] = vOff + k;
      iOff += cnt;
    }
    vOff += cnt;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  if (colArr) out.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  out.setIndex(new THREE.BufferAttribute(idxArr, 1));
  return out;
}

/** 沿 3D 折线扫掠生成渐变圆管 BufferGeometry（用于树干、轮生主枝、分叉侧枝）。 */
function buildSweptTube(points, radii, radialSegs = 6, vRepeat = 2.0) {
  const segs = points.length - 1;
  const ringLen = radialSegs + 1;
  const verts = (segs + 1) * ringLen;
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const idx = new Uint32Array(segs * radialSegs * 6);

  const dirs = [];
  for (let i = 0; i < segs; i++) {
    dirs.push(new THREE.Vector3().subVectors(points[i + 1], points[i]).normalize());
  }
  const upRef = new THREE.Vector3(0, 0, 1);
  const altRef = new THREE.Vector3(1, 0, 0);

  let vi = 0, ui = 0;
  for (let i = 0; i <= segs; i++) {
    const pt = points[i];
    const r = radii[i];
    const d = dirs[Math.min(i, segs - 1)];
    const ref = Math.abs(d.dot(upRef)) > 0.9 ? altRef : upRef;
    const side = new THREE.Vector3().crossVectors(d, ref).normalize();
    const binorm = new THREE.Vector3().crossVectors(side, d).normalize();
    const vCoord = (i / segs) * vRepeat;

    for (let k = 0; k <= radialSegs; k++) {
      const a = (k / radialSegs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = side.x * ca + binorm.x * sa;
      const ny = side.y * ca + binorm.y * sa;
      const nz = side.z * ca + binorm.z * sa;
      pos[vi] = pt.x + nx * r;
      pos[vi + 1] = pt.y + ny * r;
      pos[vi + 2] = pt.z + nz * r;
      nrm[vi] = nx;
      nrm[vi + 1] = ny;
      nrm[vi + 2] = nz;
      uv[ui] = k / radialSegs;
      uv[ui + 1] = vCoord;
      vi += 3;
      ui += 2;
    }
  }

  let ii = 0;
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < radialSegs; k++) {
      const a = i * ringLen + k;
      const b = a + 1;
      const c = (i + 1) * ringLen + k;
      const d = c + 1;
      idx[ii++] = a; idx[ii++] = c; idx[ii++] = b;
      idx[ii++] = b; idx[ii++] = c; idx[ii++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/**
 * 构建立体微曲叶簇团（Curved Foliage Cluster Patch）：
 * 每个叶簇点生成 2 张正交微拱曲面片（带球面外向法线 + 顶点 AO 与受光渐变色），
 * 从任何视角观察均呈蓬松立体的针叶簇/白桦叶团，绝无生硬平板感。
 */
function buildFoliageCloudGeometry(clusters) {
  // 每个 cluster 含 2 张交叉微曲卡（每卡 5 顶点：中心拱起 + 四角；4 个三角形 = 12 索引）
  const cardsPerCluster = 2;
  const vertsPerCard = 5;
  const idxPerCard = 12;
  const totalCards = clusters.length * cardsPerCluster;

  const pos = new Float32Array(totalCards * vertsPerCard * 3);
  const nrm = new Float32Array(totalCards * vertsPerCard * 3);
  const uv = new Float32Array(totalCards * vertsPerCard * 2);
  const col = new Float32Array(totalCards * vertsPerCard * 3);
  const idx = new Uint32Array(totalCards * idxPerCard);

  let vPtr = 0, uPtr = 0, iPtr = 0, vCount = 0;
  const up = new THREE.Vector3(0, 1, 0);

  for (const cl of clusters) {
    const { center, rx, ry, tiltX, yaw, shade, dome = 0.22 } = cl;
    const crownDist = Math.max(Math.hypot(center.x, center.z), 0.05);
    const outDir = new THREE.Vector3(center.x / crownDist, 0.35, center.z / crownDist).normalize();

    for (let cIdx = 0; cIdx < cardsPerCluster; cIdx++) {
      const a = yaw + cIdx * (Math.PI * 0.48);
      const ca = Math.cos(a), sa = Math.sin(a);
      const ct = Math.cos(tiltX), st = Math.sin(tiltX);

      // 局部标架：right, upVec, forward(拱起方向)
      const right = new THREE.Vector3(ca, 0, -sa);
      const upVec = new THREE.Vector3(sa * st, ct, ca * st);
      const fwd = new THREE.Vector3().crossVectors(right, upVec).normalize();

      // 5 个局部点：(0,0,dome), (-1,-1,0), (1,-1,0), (1,1,0), (-1,1,0)
      const localPts = [
        [0, 0, dome * rx, 0.5, 0.5, 1.05],
        [-rx, -ry, 0, 0, 1, 0.86],
        [ rx, -ry, 0, 1, 1, 0.86],
        [ rx,  ry, 0, 1, 0, 1.12],
        [-rx,  ry, 0, 0, 0, 1.12],
      ];

      for (const [lx, ly, lz, uCoord, vCoord, vBright] of localPts) {
        const wx = center.x + right.x * lx + upVec.x * ly + fwd.x * lz;
        const wy = center.y + right.y * lx + upVec.y * ly + fwd.y * lz;
        const wz = center.z + right.z * lx + upVec.z * ly + fwd.z * lz;
        pos[vPtr] = wx;
        pos[vPtr + 1] = wy;
        pos[vPtr + 2] = wz;

        // 球面化外向法线：让叶簇接收柔和立体的天光与阳光过渡
        const nx = outDir.x * 0.65 + (lx / Math.max(rx, 1e-3)) * 0.25;
        const ny = Math.max(0.25, outDir.y * 0.65 + (ly / Math.max(ry, 1e-3)) * 0.35);
        const nz = outDir.z * 0.65 + (lz / Math.max(rx, 1e-3)) * 0.25;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nrm[vPtr] = nx / nLen;
        nrm[vPtr + 1] = ny / nLen;
        nrm[vPtr + 2] = nz / nLen;

        const sc = Math.min(1.25, shade * vBright);
        col[vPtr] = sc;
        col[vPtr + 1] = sc;
        col[vPtr + 2] = sc;

        uv[uPtr] = uCoord;
        uv[uPtr + 1] = vCoord;
        vPtr += 3;
        uPtr += 2;
      }

      // 4 个扇形三角形：(0,1,2), (0,2,3), (0,3,4), (0,4,1)
      idx[iPtr++] = vCount; idx[iPtr++] = vCount + 1; idx[iPtr++] = vCount + 2;
      idx[iPtr++] = vCount; idx[iPtr++] = vCount + 2; idx[iPtr++] = vCount + 3;
      idx[iPtr++] = vCount; idx[iPtr++] = vCount + 3; idx[iPtr++] = vCount + 4;
      idx[iPtr++] = vCount; idx[iPtr++] = vCount + 4; idx[iPtr++] = vCount + 1;
      vCount += 5;
    }
  }

  void up;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// ============================================================ 第一层样方树（ForestScene）共享植物学变体池

/**
 * 单位全高校准树干（y ∈ [0, 1]，树基 y=0，贯顶 y=1）：
 * - 基部具自然根颈外扩（r=1.42）；
 * - 胸高段 r=1.00（保证 trunk.scale.set(dim.rB, dim.trunkH, dim.rB) 时 scale.x === dim.rB）；
 * - 上部通直微弯深入树冠至顶梢（r=0.14），彻底消除“短木棍顶着几何球”的割裂感。
 */
function buildFullHeightUnitTrunkGeo() {
  const pts = [
    new THREE.Vector2(1.42, 0.00),
    new THREE.Vector2(1.14, 0.04),
    new THREE.Vector2(1.00, 0.10),
    new THREE.Vector2(0.88, 0.25),
    new THREE.Vector2(0.72, 0.45),
    new THREE.Vector2(0.52, 0.68),
    new THREE.Vector2(0.32, 0.86),
    new THREE.Vector2(0.12, 1.00),
  ];
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 为网格计算「下暗上亮 + 内暗外亮」三维树冠体积环境光遮蔽顶点色（Vertex-Color Canopy AO），
 * 让每一层伞冠/叶团底部呈现自然深邃的林荫暗部、顶部呈现阳光受光亮部，单棵树轮廓顆顆分明。
 */
function applySculptedCanopyAO(geo, yMin, yMax, rimBoost = 0.16) {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const spanY = Math.max(yMax - yMin, 1e-3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ty = Math.max(0, Math.min(1, (y - yMin) / spanY)); // 0=本层底(暗), 1=本层顶(亮)
    const r = Math.min(1, Math.hypot(x, z));
    // 底部与内膛深色遮蔽 (0.50)，中上部与外缘受光高光 (1.18)
    const v = 0.50 + 0.56 * Math.pow(ty, 0.78) + rimBoost * r * (0.4 + 0.6 * ty);
    col[i * 3] = v;
    col[i * 3 + 1] = Math.min(1.24, v * 1.02);
    col[i * 3 + 2] = v * 0.96;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * 构建单层带轮生枝裙波浪边沿的针叶伞塔几何（局部 y ∈ [y0, y1]，底半径 rBot，顶半径 rTop）。
 */
function buildPagodaTierGeo(rBot, rTop, y0, y1, flutes = 12, waveAmp = 0.10, seed = 1) {
  const h = y1 - y0;
  const geo = new THREE.ConeGeometry(rBot, h, 20, 4, false);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = (y + h / 2) / Math.max(h, 1e-4); // 0(tier bottom) -> 1(tier top)
    const rad = Math.hypot(x, z);
    if (rad > 1e-4) {
      const ang = Math.atan2(z, x);
      // 落叶松/云杉特征性内凹伞弧线（concave pagoda slope）+ 轮生枝裙瓣状起伏
      const pagodaCurve = Math.pow(1 - u, 1.18) * (1 - rTop / Math.max(rBot, 1e-3)) + (rTop / Math.max(rBot, 1e-3));
      const targetR = rBot * pagodaCurve;
      const scaleR = targetR / Math.max(rad, 1e-4);
      const skirtWave = 1 + waveAmp * (1 - u * 0.65) * Math.cos(ang * flutes + seed);
      const skirtDroop = u < 0.25 ? -0.035 * h * Math.cos(ang * flutes + seed) : 0;
      pos.setXYZ(i, x * scaleR * skirtWave, y0 + u * h + skirtDroop, z * scaleR * skirtWave);
    } else {
      pos.setXYZ(i, x, y0 + u * h, z);
    }
  }
  geo.computeVertexNormals();
  return applySculptedCanopyAO(geo, y0, y1, 0.18);
}

/**
 * 构建单个自然有机叶团几何（用于白桦/阔叶树及樟子松伞顶叶团，已按冠长纵横比预校正 Y 缩放）。
 */
function buildOrganicPuffGeo(cx, cy, cz, rx, ry, rz, seed = 1) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const lobe = 1 + 0.08 * Math.sin(x * 3.8 + seed) * Math.cos(z * 3.5 - seed * 0.7);
    // 底部略收平、顶部饱满圆润
    const ny = y < 0 ? y * 0.78 : Math.pow(y, 0.88);
    pos.setXYZ(
      i,
      cx + x * rx * lobe,
      cy + ny * ry * lobe,
      cz + z * rz * lobe
    );
  }
  geo.computeVertexNormals();
  return applySculptedCanopyAO(geo, cy - ry * 0.85, cy + ry, 0.16);
}

/**
 * 模式 A（默认推荐 · layered）：「分层清晰林相（单木颗颗分明）」
 * - 兴安落叶松/云杉/红松：4 层分明的内凹伞塔轮生冠 + 层间透光留白 + 下暗上亮 AO 渐变；
 * - 东北白桦/阔叶树：清晰可见的白色/浅褐分叉主枝骨架 + 5 团错落有致的饱满圆润叶团（预校正纵横比）；
 * - 樟子松：高干分叉 + 3 团平顶伞形松冠。
 */
function buildSculptedCrownVariant(archetype, seed) {
  const rand = mulberry32(seed);
  const branchTubes = [];
  const crownParts = [];
  // 冠长 cLen 通常是冠半径 crownR 的 ~3.6 倍，因此在归一化冠空间(y∈[0,1])内，球团纵向半径取 rx / 3.4 保持真实球形
  const Y_ASPECT = 3.4;

  const isConifer = archetype.startsWith('conifer');
  const isSpire = archetype === 'conifer_spire';
  const isUmbrella = archetype === 'conifer_umbrella';

  if (isConifer && !isUmbrella) {
    // 针叶塔冠（落叶松 4 层分明伞塔；云杉 5 层窄尖塔）：层间留出清晰阴影阶梯，单木轮廓一目了然
    const tiers = isSpire
      ? [
          { rB: 0.90, rT: 0.24, y0: 0.02, y1: 0.30, fl: 14 },
          { rB: 0.76, rT: 0.20, y0: 0.23, y1: 0.50, fl: 13 },
          { rB: 0.60, rT: 0.16, y0: 0.43, y1: 0.69, fl: 12 },
          { rB: 0.44, rT: 0.11, y0: 0.62, y1: 0.86, fl: 10 },
          { rB: 0.26, rT: 0.01, y0: 0.80, y1: 1.00, fl: 8 },
        ]
      : [
          { rB: 0.98, rT: 0.28, y0: 0.04, y1: 0.36, fl: 11 },
          { rB: 0.80, rT: 0.22, y0: 0.29, y1: 0.59, fl: 10 },
          { rB: 0.58, rT: 0.15, y0: 0.52, y1: 0.81, fl: 9 },
          { rB: 0.34, rT: 0.01, y0: 0.74, y1: 1.00, fl: 8 },
        ];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const jitter = 0.94 + rand() * 0.12;
      crownParts.push(buildPagodaTierGeo(
        t.rB * jitter, t.rT * jitter, t.y0, t.y1, t.fl, 0.09, seed + i * 17
      ));
      // 每层伞底伸出 4 根可见轮生木质主枝托臂
      if (i < 3) {
        for (let b = 0; b < 4; b++) {
          const a = i * 1.1 + (b / 4) * Math.PI * 2 + (rand() - 0.5) * 0.25;
          const reach = t.rB * 0.76;
          const p0 = new THREE.Vector3(0, t.y0 + 0.02, 0);
          const p1 = new THREE.Vector3(Math.cos(a) * reach, t.y0 + 0.01, Math.sin(a) * reach);
          branchTubes.push(buildSweptTube([p0, p1], [0.045, 0.018], 5, 1.0));
        }
      }
    }
  } else if (isUmbrella) {
    // 樟子松：上部 3 团扁平宽圆伞冠 + 苍劲曲枝
    const puffs = [
      { x: 0.00, y: 0.74, z: 0.00, rx: 0.92, ry: 0.22, rz: 0.88 },
      { x: 0.34, y: 0.54, z: -0.20, rx: 0.66, ry: 0.18, rz: 0.64 },
      { x: -0.32, y: 0.62, z: 0.24, rx: 0.64, ry: 0.18, rz: 0.62 },
    ];
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      crownParts.push(buildOrganicPuffGeo(p.x, p.y, p.z, p.rx, p.ry, p.rz, seed + i * 23));
      branchTubes.push(buildSweptTube(
        [new THREE.Vector3(0, 0.12 + i * 0.12, 0), new THREE.Vector3(p.x * 0.85, p.y - 0.04, p.z * 0.85)],
        [0.055, 0.024], 5, 1.2
      ));
    }
  } else {
    // 白桦与阔叶乔木：清晰优美的分叉主枝骨架 + 5 团错落有致的圆润树冠团（不遮挡下部银白主干）
    const isColumn = archetype === 'broadleaf_column';
    const isDome = archetype === 'broadleaf_dome' || archetype === 'broadleaf_vase';
    const sx = isColumn ? 0.72 : (isDome ? 1.02 : 0.86);

    const puffs = [
      { x: 0.00, y: 0.44, z: 0.00, r: 0.76 * sx },
      { x: 0.34 * sx, y: 0.56, z: 0.20 * sx, r: 0.60 * sx },
      { x: -0.32 * sx, y: 0.52, z: -0.22 * sx, r: 0.58 * sx },
      { x: -0.20 * sx, y: 0.66, z: 0.28 * sx, r: 0.54 * sx },
      { x: 0.04 * sx, y: 0.78, z: -0.04 * sx, r: 0.58 * sx },
    ];
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const dx = p.x + (rand() - 0.5) * 0.08;
      const dz = p.z + (rand() - 0.5) * 0.08;
      const rx = p.r * (0.94 + rand() * 0.12);
      const ry = Math.min(0.26, (rx / Y_ASPECT) * 1.45);
      crownParts.push(buildOrganicPuffGeo(dx, p.y, dz, rx, ry, rx * 0.95, seed + i * 31));
      if (i > 0) {
        const p0 = new THREE.Vector3(0, 0.04 + i * 0.06, 0);
        const pMid = new THREE.Vector3(dx * 0.55, p.y * 0.55, dz * 0.55);
        const pTip = new THREE.Vector3(dx * 0.88, p.y - 0.03, dz * 0.88);
        branchTubes.push(buildSweptTube([p0, pMid, pTip], [0.062, 0.040, 0.020], 6, 1.5));
      }
    }
  }

  return {
    branchGeo: branchTubes.length ? mergeBufferGeometries(branchTubes) : new THREE.BufferGeometry(),
    foliageGeo: mergeBufferGeometries(crownParts),
  };
}

/**
 * 模式 B（classic）：「经典极简几何（原版风格）」——简洁清爽的双层圆锥/椭球冠。
 */
function buildClassicCrownVariant(archetype, seed) {
  const isConifer = archetype.startsWith('conifer');
  const parts = [];
  if (isConifer) {
    parts.push(buildPagodaTierGeo(0.95, 0.18, 0.04, 0.64, 8, 0.0, seed));
    parts.push(buildPagodaTierGeo(0.64, 0.01, 0.46, 1.00, 8, 0.0, seed + 7));
  } else {
    parts.push(buildOrganicPuffGeo(0, 0.42, 0, 0.88, 0.25, 0.84, seed));
    parts.push(buildOrganicPuffGeo(0.22, 0.72, 0.14, 0.62, 0.19, 0.60, seed + 11));
  }
  const stub = buildSweptTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.35, 0)], [0.03, 0.015], 4, 1);
  return {
    branchGeo: stub,
    foliageGeo: mergeBufferGeometries(parts),
  };
}

/**
 * 模式 C（detailed）：「针阔叶簇细节（近景观察）」——已修正 Y 轴纵横比拉伸（ry = rx / 5.8），
 * 消除纵向拉长绿刺，适合林内近距离观察枝条与叶片镂空。
 */
function buildArchetypeCrownVariant(archetype, seed) {
  const rand = mulberry32(seed);
  const branchTubes = [];
  const clusters = [];
  const Y_SCALE_FIX = 5.8; // 抵消 cLen / crownR 的纵向放大倍率，防止叶卡被拉成竖条

  const isConifer = archetype.startsWith('conifer');
  const isSpire = archetype === 'conifer_spire';
  const isUmbrella = archetype === 'conifer_umbrella';

  if (isConifer) {
    const whorls = isSpire ? 8 : (isUmbrella ? 6 : 7);
    for (let w = 0; w < whorls; w++) {
      const f = w / (whorls - 1);
      const yBase = isUmbrella ? 0.22 + f * 0.70 : 0.08 + f * 0.84;
      let env = isSpire
        ? Math.pow(1 - f * 0.86, 0.85) * 0.88
        : isUmbrella
          ? (0.52 + 0.48 * Math.sin(f * Math.PI * 0.85))
          : Math.sin(Math.pow(f, 0.72) * Math.PI * 0.92) * 0.88 + (1 - f) * 0.22;
      env = Math.max(0.18, Math.min(0.98, env));

      const nBranches = w === whorls - 1 ? 3 : 4;
      for (let b = 0; b < nBranches; b++) {
        const ang = w * 2.39996 + (b / nBranches) * Math.PI * 2 + (rand() - 0.5) * 0.28;
        const reach = env * (0.76 + rand() * 0.24);
        const p0 = new THREE.Vector3(0, yBase, 0);
        const p1 = new THREE.Vector3(Math.cos(ang) * reach * 0.55, yBase - 0.015, Math.sin(ang) * reach * 0.55);
        const p2 = new THREE.Vector3(Math.cos(ang) * reach, yBase + 0.01, Math.sin(ang) * reach);
        branchTubes.push(buildSweptTube([p0, p1, p2], [0.032, 0.020, 0.010], 5, 1.5));

        for (let k = 0; k < 3; k++) {
          const t = 0.24 + (k / 2) * 0.72;
          const pos = new THREE.Vector3().lerpVectors(p0, p2, t);
          const sideAng = ang + (k % 2 === 0 ? 1 : -1) * 0.55;
          const size = 0.50 * (0.85 + 0.28 * (1 - f * 0.35));
          clusters.push({
            center: new THREE.Vector3(
              pos.x + Math.cos(sideAng) * reach * 0.14,
              Math.max(0.08, pos.y),
              pos.z + Math.sin(sideAng) * reach * 0.14
            ),
            rx: size,
            ry: size / Y_SCALE_FIX,
            tiltX: (rand() - 0.5) * 0.12,
            yaw: sideAng + rand() * 0.6,
            shade: 0.62 + 0.42 * f + 0.14 * t,
            dome: 0.08,
          });
        }
      }
    }
  } else {
    const mainForks = 6;
    for (let b = 0; b < mainForks; b++) {
      const f = b / mainForks;
      const ang = b * (Math.PI * 2 / mainForks) + (rand() - 0.5) * 0.32;
      const yStart = 0.08 + f * 0.46;
      const env = Math.sin(0.28 + f * 0.68 * Math.PI);
      const reach = (0.72 + 0.26 * env) * (0.85 + rand() * 0.20);
      const p0 = new THREE.Vector3(0, yStart, 0);
      const p1 = new THREE.Vector3(Math.cos(ang) * reach * 0.52, Math.min(0.88, yStart + 0.16), Math.sin(ang) * reach * 0.52);
      const p2 = new THREE.Vector3(Math.cos(ang) * reach * 0.92, Math.min(0.92, yStart + 0.30), Math.sin(ang) * reach * 0.92);
      branchTubes.push(buildSweptTube([p0, p1, p2], [0.048, 0.030, 0.015], 5, 1.6));

      for (let sub = 0; sub < 3; sub++) {
        const sf = (sub + 1) / 3;
        const anchor = new THREE.Vector3().lerpVectors(p0, p2, 0.25 + sf * 0.70);
        const subAng = ang + (sub % 2 === 0 ? 1 : -1) * 0.62;
        const tip = new THREE.Vector3(
          anchor.x + Math.cos(subAng) * reach * 0.36,
          Math.min(0.94, Math.max(0.14, anchor.y + (rand() - 0.35) * 0.08)),
          anchor.z + Math.sin(subAng) * reach * 0.36
        );
        branchTubes.push(buildSweptTube([anchor, tip], [0.024, 0.011], 4, 1.0));
        for (let k = 0; k < 3; k++) {
          const kt = 0.3 + (k / 2) * 0.7;
          const cp = new THREE.Vector3().lerpVectors(anchor, tip, kt);
          const sz = 0.52 * (0.88 + rand() * 0.24);
          clusters.push({
            center: cp,
            rx: sz,
            ry: sz / Y_SCALE_FIX,
            tiltX: (rand() - 0.5) * 0.14,
            yaw: subAng + rand() * Math.PI,
            shade: 0.64 + 0.40 * cp.y + 0.10 * kt,
            dome: 0.08,
          });
        }
      }
    }
    // 中心饱满叶团补充（防止树冠中轴稀疏）
    for (let c = 0; c < 10; c++) {
      const f = c / 9;
      const a = c * 2.39996;
      const r = 0.18 + 0.26 * Math.sin(f * Math.PI);
      const y = 0.22 + f * 0.70;
      const sz = 0.54;
      clusters.push({
        center: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        rx: sz,
        ry: sz / Y_SCALE_FIX,
        tiltX: 0,
        yaw: a,
        shade: 0.72 + 0.32 * y,
        dome: 0.08,
      });
    }
  }

  return {
    branchGeo: mergeBufferGeometries(branchTubes),
    foliageGeo: buildFoliageCloudGeometry(clusters),
  };
}

const _ARCHETYPE_VARIANTS = new Map();
const VARIANT_COUNT = 4;

/** 获取指定冠形构型、调查编号与展示风格对应的共享枝系+树冠几何变体。
 *  crownStyle: 'layered'（默认推荐·分层清晰单木分明）| 'classic'（经典极简）| 'detailed'（叶簇细节） */
function getArchetypeCrownGeos(archetype, seqNo = 1, crownStyle = 'layered') {
  const styleKey = `${crownStyle}_${archetype || 'conifer_tower'}`;
  if (!_ARCHETYPE_VARIANTS.has(styleKey)) {
    const arr = [];
    const builder = crownStyle === 'classic'
      ? buildClassicCrownVariant
      : (crownStyle === 'detailed' ? buildArchetypeCrownVariant : buildSculptedCrownVariant);
    for (let i = 0; i < VARIANT_COUNT; i++) {
      arr.push(builder(archetype || 'conifer_tower', (i + 1) * 9973 + styleKey.charCodeAt(0) * 313));
    }
    _ARCHETYPE_VARIANTS.set(styleKey, arr);
  }
  const variants = _ARCHETYPE_VARIANTS.get(styleKey);
  return variants[Math.abs(seqNo || 0) % variants.length];
}

// ============================================================ 单木弹窗高精度校准植物学模型（TreePortrait 专用）

/**
 * 为单木详情弹窗（TreePortrait）实时生成高精度校准 3D 树木模型：
 * - 树干（name='calibrated_trunk'）在世界坐标 y=1.3m 处包含精确 24 边形顶点环（r === dbh_cm/200），
 *   误差 0.0000m；
 * - 整树最高点精确等于 height_m（误差 0.000m）；
 * - 冠幅按实测南北冠幅（crown_ns_m）与东西冠幅（crown_ew_m）真实椭圆展布；
 * - 含根颈外扩、多级自然弯曲枝条（主枝+次级侧枝+细枝）与高密度植物学针叶簇/白桦叶簇。
 */
function buildDetailedPortraitTree(td, season = 'summer', barkMat, foliageMat, twigMat = null) {
  const style = resolveSpeciesProfile(td.species);
  const H = Math.max(td.height_m || 10, 1.8);
  const r13 = Math.max((td.dbh_cm || 12) / 200, 0.015);
  const cbRatio = style.cbRatio ?? (style.kind === 'conifer' ? 0.24 : 0.38);
  const cb = Math.min(Math.max(H * cbRatio, 0.6), H * 0.72);
  const cLen = Math.max(H - cb, 0.8);

  const rawRx = (td.crown_status === 'measured' && td.crown_ew_m > 0)
    ? Math.max(td.crown_ew_m / 2, 0.4)
    : Math.max(H * (style.fb || 0.2), 0.6);
  const rawRz = (td.crown_status === 'measured' && td.crown_ns_m > 0)
    ? Math.max(td.crown_ns_m / 2, 0.4)
    : rawRx;
  // 保障高瘦林木在单木检视窗中具有协调饱满的冠幅比例（同时保留实测椭圆长短轴比）
  const minVisualR = Math.max(0.9, H * (style.kind === 'conifer' ? 0.135 : 0.155));
  const avgRaw = (rawRx + rawRz) / 2;
  const boost = avgRaw < minVisualR ? (minVisualR / Math.max(avgRaw, 0.2)) : 1.0;
  const rxCrown = rawRx * boost;
  const rzCrown = rawRz * boost;

  const rand = mulberry32((td.seq_no || 1) * 1664525 + (style.kind === 'broadleaf' ? 2026 : 1365));
  const group = new THREE.Group();
  group.position.set(td.x || 0, 0, td.y || 0);
  group.rotation.y = ((td.seq_no || 1) * 2.399963) % (Math.PI * 2);

  // 1) 精确校准树干（必须含 y=1.3m 截面环，且在 y=1.3m 处中心无偏移以保障几何实测 0 误差）
  const trunkTopY = style.kind === 'conifer' ? H * 0.96 : H * 0.84;
  const yStops = [0, 0.35, 0.8, 1.3];
  for (let s = 1; s <= 10; s++) {
    const y = 1.3 + (trunkTopY - 1.3) * (s / 10);
    if (y > 1.32) yStops.push(y);
  }
  const leanX = (rand() - 0.5) * H * 0.018;
  const leanZ = (rand() - 0.5) * H * 0.018;
  const trunkPts = [];
  const trunkRadii = [];
  for (const y of yStops) {
    let r;
    if (y <= 1.3) {
      const u = (1.3 - y) / 1.3;
      r = r13 * (1 + 0.42 * Math.pow(u, 1.65));
    } else {
      const u = (y - 1.3) / Math.max(trunkTopY - 1.3, 0.1);
      r = Math.max(r13 * Math.pow(1 - u, 0.82) + r13 * 0.08 * u, 0.008);
    }
    const bend = y > 1.5 ? Math.pow((y - 1.5) / Math.max(H - 1.5, 1), 1.4) : 0;
    trunkPts.push(new THREE.Vector3(leanX * bend, y, leanZ * bend));
    trunkRadii.push(r);
  }
  const trunkGeo = buildSweptTube(trunkPts, trunkRadii, 20, Math.max(4, Math.round(H / 2.2)));
  const trunkMesh = new THREE.Mesh(trunkGeo, barkMat);
  trunkMesh.name = 'calibrated_trunk';
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  // 2) 多级自然分枝 + 叶簇生成
  const branchGeos = [];
  const clusters = [];
  const trunkAtY = (y) => {
    const bend = y > 1.5 ? Math.pow((y - 1.5) / Math.max(H - 1.5, 1), 1.4) : 0;
    return new THREE.Vector3(leanX * bend, y, leanZ * bend);
  };

  if (style.kind === 'conifer') {
    const isSpire = style.archetype === 'conifer_spire';
    const isUmbrella = style.archetype === 'conifer_umbrella';
    const whorls = isSpire ? 13 : (isUmbrella ? 9 : 12);

    for (let w = 0; w < whorls; w++) {
      const f = w / (whorls - 1);
      const y0 = cb + cLen * (isUmbrella ? 0.15 + f * 0.78 : 0.02 + f * 0.91);
      const origin = trunkAtY(y0);
      let env = isSpire
        ? Math.pow(1 - f * 0.86, 0.85)
        : isUmbrella
          ? (0.52 + 0.55 * Math.sin(f * Math.PI * 0.88))
          : Math.sin(Math.pow(f, 0.70) * Math.PI * 0.92) * 0.92 + (1 - f) * 0.28;
      env = Math.max(0.16, Math.min(1.06, env));

      const nBr = w === whorls - 1 ? 4 : (5 + (w % 3));
      for (let b = 0; b < nBr; b++) {
        const ang = w * 2.39996 + (b / nBr) * Math.PI * 2 + (rand() - 0.5) * 0.28;
        const maxR = Math.hypot(Math.cos(ang) * rxCrown, Math.sin(ang) * rzCrown);
        const reach = maxR * env * (0.78 + rand() * 0.28);
        const droop = isSpire ? -0.18 * reach : (isUmbrella ? 0.10 * reach : -0.12 * (1 - f * 0.65) * reach);
        const lift = isSpire ? 0.04 * reach : 0.11 * reach;

        const p0 = origin.clone();
        const p1 = new THREE.Vector3(
          origin.x + Math.cos(ang) * reach * 0.52,
          origin.y + droop,
          origin.z + Math.sin(ang) * reach * 0.52
        );
        const p2 = new THREE.Vector3(
          origin.x + Math.cos(ang) * reach,
          Math.min(H - 0.15, origin.y + droop + lift),
          origin.z + Math.sin(ang) * reach
        );
        const brR = Math.max(0.010, r13 * 0.28 * (1 - f * 0.65));
        branchGeos.push(buildSweptTube([p0, p1, p2], [brR, brR * 0.58, brR * 0.18], 6, 2.0));

        // 次级侧枝与针叶簇
        const nSub = 3;
        for (let s = 0; s < nSub; s++) {
          const st = 0.34 + (s / (nSub - 1)) * 0.64;
          const anchor = new THREE.Vector3().lerpVectors(p0, p1, Math.min(st * 1.4, 1));
          if (st > 0.5) anchor.lerp(p2, (st - 0.5) * 2);
          const sAng = ang + (s % 2 === 0 ? 1 : -1) * (0.62 + rand() * 0.32);
          const sLen = reach * (0.26 + rand() * 0.14) * (1 - st * 0.25);
          const sTip = new THREE.Vector3(
            anchor.x + Math.cos(sAng) * sLen,
            Math.min(H - 0.12, anchor.y - 0.05 * sLen + (rand() - 0.4) * 0.08),
            anchor.z + Math.sin(sAng) * sLen
          );
          branchGeos.push(buildSweptTube([anchor, sTip], [brR * 0.45, brR * 0.14], 4, 1.0));

          for (let q = 0; q < 2; q++) {
            const qt = 0.35 + q * 0.60;
            const cp = new THREE.Vector3().lerpVectors(anchor, sTip, qt);
            const sz = Math.max(0.46, Math.min(1.15, (rxCrown + rzCrown) * 0.22 * (0.80 + 0.30 * (1 - f * 0.4))));
            clusters.push({
              center: cp,
              rx: sz * 1.15,
              ry: sz * 0.78,
              tiltX: (rand() - 0.5) * 0.42,
              yaw: sAng + rand() * 0.9,
              shade: 0.68 + 0.34 * f + 0.12 * st,
              dome: 0.20,
            });
          }
        }
      }
    }
  } else {
    // 阔叶树（白桦 / 蒙古栎 / 山杨 / 水曲柳 / 胡桃楸 / 榆树 / 色木槭）：
    // 主枝自然斜上舒展（水平延伸与上升成协调角度，杜绝垂直贴干成细杆）
    const nMain = 10;
    for (let b = 0; b < nMain; b++) {
      const f = b / (nMain - 1);
      const y0 = cb + cLen * (0.04 + f * 0.64);
      const origin = trunkAtY(y0);
      const ang = b * 2.39996 + (rand() - 0.5) * 0.28;
      const maxR = Math.hypot(Math.cos(ang) * rxCrown, Math.sin(ang) * rzCrown);
      const env = Math.sin(0.22 + f * 0.72 * Math.PI);
      const reach = maxR * (0.78 + rand() * 0.24) * (0.55 + 0.50 * env);
      const rise1 = Math.min(cLen * 0.22, reach * 0.52);
      const rise2 = Math.min(cLen * 0.36, reach * 0.85);
      const p1 = new THREE.Vector3(
        origin.x + Math.cos(ang) * reach * 0.54,
        Math.min(H - 0.35, origin.y + rise1),
        origin.z + Math.sin(ang) * reach * 0.54
      );
      const p2 = new THREE.Vector3(
        origin.x + Math.cos(ang) * reach * 0.95,
        Math.min(H - 0.24, origin.y + rise2),
        origin.z + Math.sin(ang) * reach * 0.95
      );
      const brR = Math.max(0.014, r13 * 0.42 * (1 - f * 0.40));
      branchGeos.push(buildSweptTube([origin, p1, p2], [brR, brR * 0.62, brR * 0.24], 6, 2.2));

      for (let s = 0; s < 4; s++) {
        const sf = (s + 1) / 4;
        const anchor = new THREE.Vector3().lerpVectors(origin, p2, 0.28 + sf * 0.68);
        const sAng = ang + (s % 2 === 0 ? 1 : -1) * (0.58 + rand() * 0.38);
        const sLen = reach * (0.36 + rand() * 0.20);
        const droop = style.archetype === 'broadleaf_ovoid' ? -0.04 * sLen : 0.05 * sLen;
        const sTip = new THREE.Vector3(
          anchor.x + Math.cos(sAng) * sLen,
          Math.min(H - 0.22, Math.max(cb + 0.2, anchor.y + droop + (rand() - 0.35) * 0.45)),
          anchor.z + Math.sin(sAng) * sLen
        );
        branchGeos.push(buildSweptTube([anchor, sTip], [brR * 0.45, brR * 0.14], 4, 1.2));

        for (let k = 0; k < 4; k++) {
          const kt = 0.25 + (k / 3) * 0.75;
          const cp = new THREE.Vector3().lerpVectors(anchor, sTip, kt);
          const sz = Math.max(0.55, Math.min(1.25, (rxCrown + rzCrown) * 0.26 * (0.85 + rand() * 0.28)));
          clusters.push({
            center: cp,
            rx: sz,
            ry: sz * 0.88,
            tiltX: (rand() - 0.5) * 0.55,
            yaw: sAng + rand() * Math.PI,
            shade: 0.66 + 0.36 * Math.max(0, Math.min(1, (cp.y - cb) / cLen)) + 0.10 * kt,
            dome: 0.22,
          });
        }
      }
    }
    // 冠心饱满内衬叶簇（让白桦/阔叶树冠整体圆润充实、不露空洞）
    for (let c = 0; c < 14; c++) {
      const f = c / 13;
      const y = cb + cLen * (0.18 + f * 0.74);
      const centerOrigin = trunkAtY(y);
      const a = c * 2.39996;
      const r = (rxCrown + rzCrown) * 0.18 * Math.sin(f * Math.PI);
      const sz = Math.max(0.62, Math.min(1.30, (rxCrown + rzCrown) * 0.28));
      clusters.push({
        center: new THREE.Vector3(centerOrigin.x + Math.cos(a) * r, y, centerOrigin.z + Math.sin(a) * r),
        rx: sz,
        ry: sz * 0.86,
        tiltX: (rand() - 0.5) * 0.4,
        yaw: a,
        shade: 0.70 + 0.34 * f,
        dome: 0.22,
      });
    }
  }

  // 顶梢精确封顶叶簇（最高顶点严格落在 y = H，保证 measure() 树高误差 === 0.000m）
  const topOrigin = trunkAtY(trunkTopY);
  const topR = 0.22;
  clusters.push({
    center: new THREE.Vector3(topOrigin.x, H - topR, topOrigin.z),
    rx: topR,
    ry: topR,
    tiltX: 0,
    yaw: 0,
    shade: 1.12,
    dome: 0.0,
  });

  if (branchGeos.length) {
    const branchMesh = new THREE.Mesh(mergeBufferGeometries(branchGeos), twigMat || barkMat);
    branchMesh.name = 'tree_branches';
    branchMesh.castShadow = true;
    group.add(branchMesh);
  }

  const foliageGeo = buildFoliageCloudGeometry(clusters);
  // 钳制叶簇顶点 y <= H 且至少一个顶梢顶点 y === H，确保实测树高 0 误差
  const fPos = foliageGeo.getAttribute('position');
  let maxIdx = 0, maxY = -1e9;
  for (let i = 0; i < fPos.count; i++) {
    const y = fPos.getY(i);
    if (y > H) fPos.setY(i, H);
    if (fPos.getY(i) > maxY) { maxY = fPos.getY(i); maxIdx = i; }
  }
  fPos.setY(maxIdx, H);
  fPos.needsUpdate = true;

  const foliageMesh = new THREE.Mesh(foliageGeo, foliageMat);
  foliageMesh.name = 'tree_foliage';
  foliageMesh.castShadow = true;
  foliageMesh.receiveShadow = true;
  group.add(foliageMesh);

  return group;
}

// ============================================================ GPU 微风摇曳着色器系统（零 CPU 顶点循环开销）

const WIND_UNIFORMS = {
  uWindTime: { value: 0.0 },
  uWindStrength: { value: 1.0 },
};

/** 推进全局微风相位（由主渲染循环每帧轻量更新单一 float uniform）。 */
function updateGlobalWind(nowMs, enabled = true) {
  WIND_UNIFORMS.uWindStrength.value = enabled ? 1.0 : 0.0;
  if (enabled) {
    WIND_UNIFORMS.uWindTime.value = (nowMs || performance.now()) * 0.001;
  }
}

/**
 * 为 MeshStandardMaterial 注入 GPU 顶点微风动画：
 * - 'crown_unit'：样方树叶簇云（随离干轴距离摆动 + 叶片高频微颤，主干连接处零位移）
 * - 'branch_unit'：样方树枝条骨架（与叶簇同相位主摆动，枝叶同步不脱节）
 * - 'crown_meter'：弹窗单木高模叶簇与细枝（米制局部空间微风轻拂）
 * - 'herb'：林下薹草/蕨类/灌草（根部 y=0 锚定地面不动，叶尖随林间阵风柔顺起伏）
 */
function attachWindShader(material, mode = 'crown_unit') {
  if (!material || material._windMode === mode) return material;
  material._windMode = mode;
  material.customProgramCacheKey = () => `lyzj_wind_${mode}_v1`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND_UNIFORMS.uWindTime;
    shader.uniforms.uWindStrength = WIND_UNIFORMS.uWindStrength;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'uniform float uWindTime;',
        'uniform float uWindStrength;',
      ].join('\n')
    );

    let windBody = '';
    if (mode === 'herb') {
      windBody = [
        'float hNorm = clamp(position.y, 0.0, 1.4);',
        'float bend = hNorm * hNorm;',
        'float gust = sin(uWindTime * 1.75 + wOrigin.x * 0.26 + wOrigin.z * 0.19)',
        '           + 0.45 * sin(uWindTime * 3.20 + wOrigin.x * 0.62 - wOrigin.z * 0.44 + position.x * 2.8);',
        'transformed.x += gust * 0.075 * bend * uWindStrength;',
        'transformed.z += gust * 0.050 * bend * uWindStrength;',
        'transformed.y -= abs(gust) * 0.015 * bend * uWindStrength;',
      ].join('\n');
    } else if (mode === 'branch_unit') {
      windBody = [
        'float radial = clamp(length(position.xz), 0.0, 1.25);',
        'float hWeight = clamp(0.35 + position.y * 0.65, 0.0, 1.2);',
        'float sway = sin(uWindTime * 1.25 + wOrigin.x * 0.19 + wOrigin.z * 0.15)',
        '           + 0.35 * sin(uWindTime * 2.35 + wOrigin.x * 0.37 - wOrigin.z * 0.29);',
        'float amp = radial * hWeight * uWindStrength;',
        'transformed.x += sway * 0.018 * amp;',
        'transformed.z += sway * 0.013 * amp;',
      ].join('\n');
    } else if (mode === 'crown_meter') {
      windBody = [
        'float radial = clamp(length(position.xz) * 0.32, 0.0, 1.2);',
        'float sway = sin(uWindTime * 1.35 + wOrigin.x * 0.2 + wOrigin.z * 0.15);',
        'float flutter = sin(uWindTime * 4.1 + position.x * 4.5 + position.y * 3.8 + position.z * 4.2);',
        'transformed.x += (sway * 0.028 + flutter * 0.008) * radial * uWindStrength;',
        'transformed.z += (sway * 0.020 + flutter * 0.007) * radial * uWindStrength;',
        'transformed.y += flutter * 0.004 * radial * uWindStrength;',
      ].join('\n');
    } else {
      // crown_unit
      windBody = [
        'float radial = clamp(length(position.xz), 0.0, 1.25);',
        'float hWeight = clamp(0.35 + position.y * 0.65, 0.0, 1.2);',
        'float sway = sin(uWindTime * 1.25 + wOrigin.x * 0.19 + wOrigin.z * 0.15)',
        '           + 0.35 * sin(uWindTime * 2.35 + wOrigin.x * 0.37 - wOrigin.z * 0.29);',
        'float flutter = sin(uWindTime * 4.20 + position.x * 8.5 + position.y * 9.5 + wOrigin.x * 1.3);',
        'float amp = radial * hWeight * uWindStrength;',
        'transformed.x += (sway * 0.018 + flutter * 0.0065) * amp;',
        'transformed.z += (sway * 0.013 + flutter * 0.0055) * amp;',
        'transformed.y += flutter * 0.0035 * amp;',
      ].join('\n');
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        'if (uWindStrength > 0.001) {',
        '  #ifdef USE_INSTANCING',
        '    vec4 wOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  #else',
        '    vec4 wOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  #endif',
        windBody,
        '}',
      ].join('\n')
    );
  };
  return material;
}

// ============================================================ 林下草本、蕨类、杜鹃越橘灌草与苔石生态示意层

/** 512×512 林下薹草/拂子茅柔弯草丛贴图（支持夏绿/秋金双季）。 */
function getWoodlandGrassTexture(season = 'summer') {
  const key = `under_grass_${season}`;
  if (_TEX_CACHE.has(key)) return _TEX_CACHE.get(key);
  if (typeof document === 'undefined') return null;

  const S = 384;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(season === 'autumn' ? 0x998877 : 0x447733);

  const palettes = season === 'autumn'
    ? [
        [156, 124, 44], [184, 146, 54], [122, 118, 48], [198, 162, 68], [98, 112, 46],
      ]
    : [
        [68, 108, 42], [86, 128, 50], [108, 146, 58], [56, 92, 38], [124, 154, 64],
      ];

  for (let i = 0; i < 44; i++) {
    const baseX = S * (0.20 + 0.60 * rand());
    const hBlade = S * (0.42 + 0.52 * rand());
    const lean = (rand() - 0.5) * S * 0.58;
    const [r, g, b] = palettes[i % palettes.length];
    const shade = 0.80 + 0.35 * rand();

    const grad = ctx.createLinearGradient(baseX, S, baseX + lean, S - hBlade);
    grad.addColorStop(0.0, rgbStr(r * 0.42, g * 0.44, b * 0.40, 0.96));
    grad.addColorStop(0.45, rgbStr(r * shade, g * shade, b * shade, 0.98));
    grad.addColorStop(1.0, rgbStr(r * shade * 1.22, g * shade * 1.18, b * shade * 1.08, 0.92));

    const w0 = 5.5 + rand() * 3.5;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX - w0, S);
    ctx.quadraticCurveTo(baseX + lean * 0.36 - w0 * 0.4, S - hBlade * 0.55, baseX + lean, S - hBlade);
    ctx.quadraticCurveTo(baseX + lean * 0.36 + w0 * 0.4, S - hBlade * 0.55, baseX + w0, S);
    ctx.closePath();
    ctx.fill();
  }

  // 少量纤细草穗茎秆细节
  for (let i = 0; i < 7; i++) {
    const bx = S * (0.28 + 0.44 * rand());
    const tx = bx + (rand() - 0.5) * S * 0.42;
    const ty = S * (0.06 + 0.16 * rand());
    ctx.strokeStyle = season === 'autumn' ? 'rgba(208,176,92,0.88)' : 'rgba(154,172,88,0.82)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(bx, S);
    ctx.quadraticCurveTo((bx + tx) * 0.5, S * 0.45, tx, ty);
    ctx.stroke();
    // 穗粒
    for (let p = 0; p < 6; p++) {
      const f = p / 5;
      const sx = tx - (tx - bx) * f * 0.16 + (p % 2 ? 4 : -4);
      const sy = ty + f * 28;
      ctx.fillStyle = season === 'autumn' ? 'rgba(218,186,102,0.9)' : 'rgba(176,192,98,0.88)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 3.2, 5.5, (p % 2 ? 0.4 : -0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _TEX_CACHE.set(key, tex);
  return tex;
}

/** 384×384 林下羽状蕨叶（粗茎鳞毛蕨/猴腿蹄盖蕨）单片羽叶贴图。 */
function getWoodlandFernTexture(season = 'summer') {
  const key = `under_fern_${season}`;
  if (_TEX_CACHE.has(key)) return _TEX_CACHE.get(key);
  if (typeof document === 'undefined') return null;

  const S = 384;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const [br, bg, bb] = season === 'autumn' ? [168, 108, 42] : [58, 112, 44];
  const [tr, tg, tb] = season === 'autumn' ? [214, 152, 62] : [112, 162, 68];

  // 中央叶轴（自底部中点向上至叶尖）
  ctx.strokeStyle = season === 'autumn' ? 'rgba(112,74,34,0.92)' : 'rgba(64,96,42,0.92)';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(S * 0.5, S * 0.98);
  ctx.lineTo(S * 0.5, S * 0.05);
  ctx.stroke();

  // 左右对称 18 对羽状小裂片
  const pairs = 18;
  for (let i = 0; i < pairs; i++) {
    const f = i / (pairs - 1); // 0(底部) -> 1(叶尖)
    const y = S * (0.88 - f * 0.80);
    const span = S * 0.40 * Math.sin(Math.pow(f, 0.68) * Math.PI * 0.94);
    if (span < 6) continue;
    const r = br + (tr - br) * f;
    const g = bg + (tg - bg) * f;
    const b = bb + (tb - bb) * f;

    for (const dir of [-1, 1]) {
      ctx.fillStyle = rgbStr(r, g, b, 0.96);
      const pinnae = 7;
      ctx.beginPath();
      ctx.moveTo(S * 0.5, y + 6);
      for (let k = 0; k <= pinnae; k++) {
        const u = k / pinnae;
        const px = S * 0.5 + dir * span * u;
        const py = y - u * 16 - (k % 2 === 0 ? 5 : 0);
        ctx.lineTo(px, py);
      }
      for (let k = pinnae; k >= 0; k--) {
        const u = k / pinnae;
        const px = S * 0.5 + dir * span * u;
        const py = y - u * 16 + 7 + (k % 2 === 0 ? 3 : 0);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _TEX_CACHE.set(key, tex);
  return tex;
}

/** 384×384 兴安杜鹃/越橘灌草与林下野花小丛贴图。 */
function getWoodlandShrubTexture(season = 'summer') {
  const key = `under_shrub_${season}`;
  if (_TEX_CACHE.has(key)) return _TEX_CACHE.get(key);
  if (typeof document === 'undefined') return null;

  const S = 384;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(season === 'autumn' ? 0x552211 : 0x225533);

  // 木质分枝小灌丛茎
  const stems = [
    [192, 376, 108, 110], [192, 376, 196, 78], [192, 376, 286, 118],
    [152, 260, 74, 175], [232, 260, 314, 180],
  ];
  ctx.strokeStyle = 'rgba(84, 62, 44, 0.9)';
  ctx.lineWidth = 4.0;
  ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1] of stems) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) * 0.5, (y0 + y1) * 0.55, x1, y1);
    ctx.stroke();
  }

  // 革质椭圆形小叶片簇
  const leafPalette = season === 'autumn'
    ? [[164, 58, 42], [188, 92, 38], [126, 88, 42], [148, 48, 46]]
    : [[52, 98, 44], [72, 122, 54], [88, 138, 62], [46, 86, 40]];
  for (let i = 0; i < 65; i++) {
    const cx = S * (0.16 + 0.68 * rand());
    const cy = S * (0.16 + 0.70 * rand());
    const [r, g, b] = leafPalette[i % leafPalette.length];
    const s = 0.82 + 0.34 * rand();
    ctx.fillStyle = rgbStr(r * s, g * s, b * s, 0.96);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 15 + rand() * 8, 9 + rand() * 5, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 点缀少量林下花朵（夏季粉紫兴安杜鹃/白色林花；秋季深红越橘浆果）
  for (let i = 0; i < 12; i++) {
    const fx = S * (0.22 + 0.56 * rand());
    const fy = S * (0.14 + 0.48 * rand());
    ctx.fillStyle = season === 'autumn'
      ? 'rgba(196, 38, 42, 0.95)'
      : (i % 3 === 0 ? 'rgba(244, 240, 224, 0.95)' : 'rgba(218, 128, 176, 0.92)');
    ctx.beginPath();
    ctx.arc(fx, fy, season === 'autumn' ? 5.2 : 7.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _TEX_CACHE.set(key, tex);
  return tex;
}

let _UNDERGROWTH_GEOS = null;
function ensureUndergrowthGeos() {
  if (_UNDERGROWTH_GEOS) return _UNDERGROWTH_GEOS;

  // 1) 三叶交叉草丛几何（y ∈ [0, 1]，自地面向上生长，微向外倾）
  const grassPlanes = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.95, 0.85, 1, 2);
    g.translate(0, 0.425, 0);
    g.rotateX(0.14);
    g.rotateY((k / 3) * Math.PI);
    grassPlanes.push(g);
  }
  const grassGeo = mergeBufferGeometries(grassPlanes);

  // 2) 5 羽叶放射拱曲蕨类玫瑰丛几何（模拟真实林下蕨类向外披垂形态）
  const fernFronds = [];
  for (let k = 0; k < 5; k++) {
    const g = new THREE.PlaneGeometry(0.56, 0.92, 1, 3);
    g.translate(0, 0.46, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i); // 0..0.92
      const t = y / 0.92;
      // 向外弧形展开并先端微垂
      const outZ = 0.58 * Math.pow(t, 1.15);
      const archY = y * (0.82 - 0.24 * t * t);
      p.setXYZ(i, p.getX(i), archY, p.getZ(i) + outZ);
    }
    g.computeVertexNormals();
    g.rotateY((k / 5) * Math.PI * 2 + 0.25);
    fernFronds.push(g);
  }
  const fernGeo = mergeBufferGeometries(fernFronds);

  // 3) 灌草丛几何
  const shrubPlanes = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.88, 0.78, 1, 2);
    g.translate(0, 0.39, 0);
    g.rotateX(0.18 * (k % 2 ? 1 : -1));
    g.rotateY((k / 3) * Math.PI + 0.4);
    shrubPlanes.push(g);
  }
  const shrubGeo = mergeBufferGeometries(shrubPlanes);

  // 4) 扁平自然苔石几何
  const rockGeo = new THREE.IcosahedronGeometry(0.38, 1);
  const rp = rockGeo.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const n = 0.84 + 0.22 * Math.sin(x * 7.1 + z * 5.3) * Math.cos(y * 6.2);
    rp.setXYZ(i, x * n * 1.25, Math.max(-0.08, y * n * 0.58), z * n * 1.1);
  }
  rockGeo.computeVertexNormals();

  _UNDERGROWTH_GEOS = { grassGeo, fernGeo, shrubGeo, rockGeo };
  return _UNDERGROWTH_GEOS;
}

const _UNDER_MAT_CACHE = new Map();
function getUndergrowthMaterials(season = 'summer') {
  if (_UNDER_MAT_CACHE.has(season)) return _UNDER_MAT_CACHE.get(season);
  const mkHerbMat = (tex, alpha = 0.36) => {
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: alpha,
      side: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0.0,
    });
    return attachWindShader(m, 'herb');
  };
  const mats = {
    grass: mkHerbMat(getWoodlandGrassTexture(season), 0.34),
    fern: mkHerbMat(getWoodlandFernTexture(season), 0.36),
    shrub: mkHerbMat(getWoodlandShrubTexture(season), 0.36),
    rock: new THREE.MeshStandardMaterial({
      color: season === 'autumn' ? 0x6e6c5e : 0x646e5a,
      roughness: 0.96,
      metalness: 0.02,
    }),
  };
  _UNDER_MAT_CACHE.set(season, mats);
  return mats;
}

/**
 * 构建样地林下草本与苔石生态示意层（仅 4 个 InstancedMesh Draw Calls）：
 * - 自动避让每棵实测样方树的根颈（保证选中高亮环清晰可见、不穿模）；
 * - 蕨类与灌草优先分布于树冠林荫斑块下，薹草自然铺满林隙与边缘缓冲带；
 * - 严格标记 noPick: true，绝不干扰科研单木点击拾取与株数统计。
 */
function buildUndergrowthGroup(trees, extent = 30, season = 'summer') {
  const group = new THREE.Group();
  group.name = 'undergrowth_layer';
  group.userData = { noPick: true, shared: false };

  const { grassGeo, fernGeo, shrubGeo, rockGeo } = ensureUndergrowthGeos();
  const mats = getUndergrowthMaterials(season);
  const rand = mulberry32(20261106 + Math.round(extent));

  // 快速树基避让检测（防止草丛穿过树干中心或遮盖定位环）
  const treeCoords = (trees || []).map((t) => [t.x ?? -99, t.y ?? -99, Math.max((t.dbh_cm || 12) / 200 + 0.36, 0.42)]);
  const clearOfTrunks = (x, z) => {
    for (let i = 0; i < treeCoords.length; i++) {
      const dx = x - treeCoords[i][0], dz = z - treeCoords[i][1];
      const lim = treeCoords[i][2];
      if (dx * dx + dz * dz < lim * lim) return false;
    }
    return true;
  };

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const margin = 6.0;
  const areaScale = Math.min(2.2, Math.max(0.8, (extent * extent) / 900));

  // 1) 林下薹草与禾草丛（~480 丛）
  const grassMax = Math.round(480 * areaScale);
  const grassMesh = new THREE.InstancedMesh(grassGeo, mats.grass, grassMax);
  grassMesh.userData = { noPick: true, kind: 'grass' };
  let gIdx = 0;
  for (let tries = 0; tries < grassMax * 2 && gIdx < grassMax; tries++) {
    const x = -margin + rand() * (extent + margin * 2);
    const z = -margin + rand() * (extent + margin * 2);
    if (!clearOfTrunks(x, z)) continue;
    // 自然斑块团聚密度调制
    const patch = Math.sin(x * 0.28 + 1.2) * Math.cos(z * 0.31 - 0.7);
    if (patch < -0.45 && rand() < 0.65) continue;
    const sc = 0.42 + rand() * 0.52 + Math.max(0, patch) * 0.18;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(sc * (0.9 + rand() * 0.25), sc * (0.75 + rand() * 0.45), sc * (0.9 + rand() * 0.25));
    dummy.updateMatrix();
    grassMesh.setMatrixAt(gIdx, dummy.matrix);
    const bright = 0.82 + rand() * 0.34;
    col.setRGB(bright, bright * (0.96 + rand() * 0.08), bright * 0.92);
    grassMesh.setColorAt(gIdx, col);
    gIdx++;
  }
  grassMesh.count = gIdx;
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  group.add(grassMesh);

  // 2) 林冠下喜阴蕨类玫瑰丛（~135 丛，优先围绕大树冠下散生）
  const fernMax = Math.round(135 * areaScale);
  const fernMesh = new THREE.InstancedMesh(fernGeo, mats.fern, fernMax);
  fernMesh.userData = { noPick: true, kind: 'fern' };
  let fIdx = 0;
  for (let tries = 0; tries < fernMax * 3 && fIdx < fernMax; tries++) {
    let x, z;
    if (treeCoords.length && rand() < 0.78) {
      const tc = treeCoords[Math.floor(rand() * treeCoords.length)];
      const a = rand() * Math.PI * 2;
      const dist = 0.75 + rand() * 2.2;
      x = tc[0] + Math.cos(a) * dist;
      z = tc[1] + Math.sin(a) * dist;
    } else {
      x = -2 + rand() * (extent + 4);
      z = -2 + rand() * (extent + 4);
    }
    if (!clearOfTrunks(x, z)) continue;
    const sc = 0.55 + rand() * 0.55;
    dummy.position.set(x, 0.01, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(sc, sc * (0.85 + rand() * 0.3), sc);
    dummy.updateMatrix();
    fernMesh.setMatrixAt(fIdx, dummy.matrix);
    const bright = 0.84 + rand() * 0.30;
    col.setRGB(bright, bright, bright);
    fernMesh.setColorAt(fIdx, col);
    fIdx++;
  }
  fernMesh.count = fIdx;
  fernMesh.instanceMatrix.needsUpdate = true;
  if (fernMesh.instanceColor) fernMesh.instanceColor.needsUpdate = true;
  group.add(fernMesh);

  // 3) 兴安杜鹃/越橘灌草小丛（~85 丛）
  const shrubMax = Math.round(85 * areaScale);
  const shrubMesh = new THREE.InstancedMesh(shrubGeo, mats.shrub, shrubMax);
  shrubMesh.userData = { noPick: true, kind: 'shrub' };
  let sIdx = 0;
  for (let tries = 0; tries < shrubMax * 3 && sIdx < shrubMax; tries++) {
    const x = -3 + rand() * (extent + 6);
    const z = -3 + rand() * (extent + 6);
    if (!clearOfTrunks(x, z)) continue;
    const sc = 0.48 + rand() * 0.46;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(sc, sc * (0.85 + rand() * 0.35), sc);
    dummy.updateMatrix();
    shrubMesh.setMatrixAt(sIdx, dummy.matrix);
    const bright = 0.85 + rand() * 0.30;
    col.setRGB(bright, bright, bright);
    shrubMesh.setColorAt(sIdx, col);
    sIdx++;
  }
  shrubMesh.count = sIdx;
  shrubMesh.instanceMatrix.needsUpdate = true;
  if (shrubMesh.instanceColor) shrubMesh.instanceColor.needsUpdate = true;
  group.add(shrubMesh);

  // 4) 林地自然苔石（~36 块）
  const rockMax = Math.round(36 * areaScale);
  const rockMesh = new THREE.InstancedMesh(rockGeo, mats.rock, rockMax);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  rockMesh.userData = { noPick: true, kind: 'rock' };
  let rIdx = 0;
  for (let tries = 0; tries < rockMax * 3 && rIdx < rockMax; tries++) {
    const x = -4 + rand() * (extent + 8);
    const z = -4 + rand() * (extent + 8);
    if (!clearOfTrunks(x, z)) continue;
    const sc = 0.45 + rand() * 0.85;
    dummy.position.set(x, 0.02, z);
    dummy.rotation.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25);
    dummy.scale.set(sc * (0.8 + rand() * 0.5), sc * (0.55 + rand() * 0.4), sc * (0.8 + rand() * 0.5));
    dummy.updateMatrix();
    rockMesh.setMatrixAt(rIdx, dummy.matrix);
    const shade = 0.78 + rand() * 0.36;
    col.setRGB(shade, shade * 1.02, shade * 0.95);
    rockMesh.setColorAt(rIdx, col);
    rIdx++;
  }
  rockMesh.count = rIdx;
  rockMesh.instanceMatrix.needsUpdate = true;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
  group.add(rockMesh);

  return group;
}

/** 切换季节时同步刷新林下草本与蕨类材质引用（无需重建实例矩阵）。 */
function applyUndergrowthSeason(undergrowthGroup, season = 'summer') {
  if (!undergrowthGroup) return;
  const mats = getUndergrowthMaterials(season);
  undergrowthGroup.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const k = o.userData?.kind;
    if (k && mats[k]) o.material = mats[k];
  });
}

// ============================================================ 八、我的世界风格林调员小人模型（支持自定义身高 + 1.3m 胸高基准线 + 行走摆臂动画）

/**
 * 构建可自定义身高的林调员三维角色（Minecraft 方块/低多边形风格，带遮阳林调帽、反光背心、背包、手持测树卡尺与 1.30m 胸高激光环）。
 * 角色身体基准高度归一化为 1.0m（脚底 y=0，帽顶 y=1.0），通过 setHeight(H) 精确缩放到任意真实身高（如 1.72m），
 * 同时保持 1.30m 胸高测量基准环恒定处于世界坐标 y=1.30m。
 */
function buildSurveyorAvatar(initialHeightM = 1.72) {
  const root = new THREE.Group();
  root.name = 'surveyor_avatar';
  root.userData = { noPick: true, shared: false };

  const bodyScaleGroup = new THREE.Group();
  root.add(bodyScaleGroup);

  const matSkin = new THREE.MeshStandardMaterial({ color: 0xeac096, roughness: 0.75 });
  const matJacket = new THREE.MeshStandardMaterial({ color: 0x2d5e3e, roughness: 0.8 });
  const matVest = new THREE.MeshStandardMaterial({ color: 0xe5a524, roughness: 0.55, metalness: 0.1 });
  const matStripe = new THREE.MeshStandardMaterial({ color: 0xecf2ee, roughness: 0.35, metalness: 0.25, emissive: 0x223322 });
  const matPants = new THREE.MeshStandardMaterial({ color: 0x39463a, roughness: 0.85 });
  const matBoot = new THREE.MeshStandardMaterial({ color: 0x261d16, roughness: 0.9 });
  const matPack = new THREE.MeshStandardMaterial({ color: 0x6b4e32, roughness: 0.82 });
  const matHat = new THREE.MeshStandardMaterial({ color: 0x3b6e48, roughness: 0.75 });
  const matEye = new THREE.MeshBasicMaterial({ color: 0x1a1e1b });
  const matCaliper = new THREE.MeshStandardMaterial({ color: 0xd94b36, roughness: 0.45 });

  // 1) 双腿（髋关节位于 y=0.45，腿长 0.45m）
  const makeLeg = (xOff) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOff, 0.45, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.36, 0.12), matPants);
    leg.position.set(0, -0.18, 0);
    leg.castShadow = true;
    pivot.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.10, 0.155), matBoot);
    boot.position.set(0, -0.40, -0.015);
    boot.castShadow = true;
    pivot.add(boot);
    bodyScaleGroup.add(pivot);
    return pivot;
  };
  const leftLeg = makeLeg(-0.068);
  const rightLeg = makeLeg(0.068);

  // 2) 躯干 + 林调反光背心 + 外业背包（y=0.45 .. 0.78）
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.33, 0.145), matJacket);
  torso.position.set(0, 0.615, 0);
  torso.castShadow = true;
  bodyScaleGroup.add(torso);

  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.258, 0.25, 0.152), matVest);
  vest.position.set(0, 0.625, 0);
  bodyScaleGroup.add(vest);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.262, 0.032, 0.156), matStripe);
  stripe.position.set(0, 0.58, 0);
  bodyScaleGroup.add(stripe);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.24, 0.095), matPack);
  backpack.position.set(0, 0.63, 0.115);
  backpack.castShadow = true;
  bodyScaleGroup.add(backpack);

  // 3) 双臂 + 右手测树卡尺（肩关节位于 y=0.75）
  const makeArm = (xOff, withTool) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOff, 0.75, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.31, 0.105), matJacket);
    arm.position.set(0, -0.14, 0);
    arm.castShadow = true;
    pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.075, 0.092), matSkin);
    hand.position.set(0, -0.31, 0);
    pivot.add(hand);
    if (withTool) {
      // 红色外业检尺卡尺/记录夹
      const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.34), matCaliper);
      ruler.position.set(0, -0.32, -0.12);
      pivot.add(ruler);
    }
    bodyScaleGroup.add(pivot);
    return pivot;
  };
  const leftArm = makeArm(-0.18, false);
  const rightArm = makeArm(0.18, true);

  // 4) 头部 + 五官 + 林调遮阳帽（颈部位于 y=0.78，帽顶精确在 y=1.00）
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.78, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.185, 0.19), matSkin);
  head.position.set(0, 0.095, 0);
  head.castShadow = true;
  headPivot.add(head);

  // 面朝 -Z 方向的双眼
  for (const ex of [-0.045, 0.045]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, 0.01), matEye);
    eye.position.set(ex, 0.10, -0.096);
    headPivot.add(eye);
  }
  // 宽檐林调帽（帽顶 y = 0.22 => 总高 0.78 + 0.22 = 1.00）
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.185, 0.018, 16), matHat);
  hatBrim.position.set(0, 0.175, 0);
  headPivot.add(hatBrim);
  const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.118, 0.052, 16), matHat);
  hatCrown.position.set(0, 0.198, 0);
  headPivot.add(hatCrown);
  bodyScaleGroup.add(headPivot);

  // 5) 恒定处于世界坐标 y=1.30m 的胸高测量激光参考环 + 脚下方向环
  const bhRingMat = new THREE.MeshBasicMaterial({ color: 0xffb531, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const bhRing = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.285, 32), bhRingMat);
  bhRing.rotation.x = -Math.PI / 2;
  bhRing.position.y = 1.30;
  root.add(bhRing);

  const footRingMat = new THREE.MeshBasicMaterial({ color: 0x52e085, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
  const footRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.38, 32), footRingMat);
  footRing.rotation.x = -Math.PI / 2;
  footRing.position.y = 0.03;
  root.add(footRing);

  root.traverse((o) => { o.userData.noPick = true; });

  let currentHeight = initialHeightM;
  let walkPhase = 0;

  const setHeight = (hM) => {
    currentHeight = Math.max(1.20, Math.min(2.25, Number(hM) || 1.72));
    const xzScale = currentHeight / 1.70;
    bodyScaleGroup.scale.set(xzScale, currentHeight, xzScale);
    bhRing.position.y = 1.30; // 1.3m 胸高基准线恒定为绝对 1.30m
    return currentHeight;
  };
  setHeight(initialHeightM);

  const setFirstPerson = (isFpp) => {
    bodyScaleGroup.visible = !isFpp;
    bhRing.visible = !isFpp;
    footRing.visible = !isFpp;
  };

  const updateAnim = (dtSec, speedMps, headPitch = 0) => {
    if (speedMps > 0.08) {
      walkPhase += dtSec * Math.min(14, 4.5 + speedMps * 1.45);
      const amp = Math.min(0.78, 0.25 + speedMps * 0.085);
      const s = Math.sin(walkPhase) * amp;
      leftLeg.rotation.x = s;
      rightLeg.rotation.x = -s;
      leftArm.rotation.x = -s * 0.85;
      rightArm.rotation.x = s * 0.85 - 0.25;
    } else {
      walkPhase += dtSec * 2.0;
      const idle = Math.sin(walkPhase) * 0.03;
      leftLeg.rotation.x *= 0.82;
      rightLeg.rotation.x *= 0.82;
      leftArm.rotation.x = idle;
      rightArm.rotation.x = -0.22 - idle;
    }
    headPivot.rotation.x = Math.max(-0.55, Math.min(0.55, headPitch * 0.65));
  };

  return {
    root,
    setHeight,
    getHeight: () => currentHeight,
    getEyeHeight: () => currentHeight * 0.93,
    setFirstPerson,
    updateAnim,
  };
}

// ============================================================ 九、异常实况三维形态生成器（采伐木年轮伐桩、倒木卧干、枯立木）

let _ANNUAL_RINGS_TEX = null;
/** 256×256 树桩年轮木质切面贴图（木心、深浅同心年轮、髓线与形成层木栓外圈）。 */
function getAnnualRingsTexture() {
  if (_ANNUAL_RINGS_TEX) return _ANNUAL_RINGS_TEX;
  if (typeof document === 'undefined') return null;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const cx = S / 2, cy = S / 2, maxR = S * 0.48;

  // 1) 浅暖褐心材底色
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, maxR);
  g.addColorStop(0, '#754b2a');
  g.addColorStop(0.35, '#8c5d35');
  g.addColorStop(0.85, '#a47244');
  g.addColorStop(1, '#5a3d24');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, maxR, 0, Math.PI * 2); ctx.fill();

  // 2) 24 条同心微曲生长年轮
  const rand = mulberry32(19260817);
  for (let r = 8; r < maxR - 4; r += 3.8 + rand() * 2.5) {
    ctx.strokeStyle = `rgba(58, 36, 20, ${0.45 + rand() * 0.35})`;
    ctx.lineWidth = 1.0 + rand() * 0.8;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.1) {
      const wobble = 1 + (rand() - 0.5) * 0.045;
      const px = cx + Math.cos(a) * r * wobble;
      const py = cy + Math.sin(a) * r * wobble;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 3) 径向微弱木射线与外圈粗糙树皮边缘
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + (rand() - 0.5) * 0.05;
    ctx.strokeStyle = 'rgba(74, 48, 28, 0.22)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
    ctx.lineTo(cx + Math.cos(a) * (maxR - 2), cy + Math.sin(a) * (maxR - 2));
    ctx.stroke();
  }
  ctx.strokeStyle = '#321f14';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(cx, cy, maxR - 2, 0, Math.PI * 2); ctx.stroke();

  _ANNUAL_RINGS_TEX = new THREE.CanvasTexture(c);
  _ANNUAL_RINGS_TEX.colorSpace = THREE.SRGBColorSpace;
  return _ANNUAL_RINGS_TEX;
}

/** 构建带清晰年轮切面的真实 3D 采伐树桩（高度 0.36m，顶部水平截断露出年轮木心）。 */
function buildTreeStumpMesh(rB, barkMat = null) {
  const g = new THREE.Group();
  g.name = 'tree_stump_group';

  const stumpH = 0.36;
  const geoSides = new THREE.CylinderGeometry(rB, rB * 1.25, stumpH, 20, 1, true);
  geoSides.translate(0, stumpH / 2, 0);
  const defBark = barkMat || new THREE.MeshStandardMaterial({ color: 0x483222, roughness: 0.92 });
  const meshSides = new THREE.Mesh(geoSides, defBark);
  meshSides.castShadow = true;
  meshSides.receiveShadow = true;
  g.add(meshSides);

  // 顶部年轮木质切面圆盘
  const ringsTex = getAnnualRingsTexture();
  const capMat = new THREE.MeshStandardMaterial({
    map: ringsTex,
    roughness: 0.85,
    color: 0xffffff,
  });
  const capGeo = new THREE.CircleGeometry(rB, 24);
  capGeo.rotateX(-Math.PI / 2);
  capGeo.translate(0, stumpH, 0);
  const capMesh = new THREE.Mesh(capGeo, capMat);
  capMesh.receiveShadow = true;
  g.add(capMesh);

  return g;
}

/** 构建风倒倒木三维实体（近地面短折根桩 + 卧倒在地的完整树干与枯折分枝）。 */
function buildFallenTrunkGroup(rB, totalLen, barkMat = null) {
  const g = new THREE.Group();
  g.name = 'fallen_trunk_group';
  const defBark = barkMat || new THREE.MeshStandardMaterial({ color: 0x443022, roughness: 0.95 });

  // 1) 地面断裂折根残桩
  const baseH = 0.28;
  const baseGeo = new THREE.CylinderGeometry(rB * 0.95, rB * 1.3, baseH, 16);
  baseGeo.translate(0, baseH / 2, 0);
  const baseMesh = new THREE.Mesh(baseGeo, defBark);
  g.add(baseMesh);

  // 2) 卧倒树干（横卧于 y = rB * 1.05 地面）
  const trunkLen = Math.max(3.0, totalLen * 0.82);
  const trunkGeo = new THREE.CylinderGeometry(rB * 0.25, rB * 0.92, trunkLen, 16);
  trunkGeo.rotateZ(Math.PI / 2);
  trunkGeo.translate(trunkLen / 2 + 0.15, rB * 1.05, 0);
  const trunkMesh = new THREE.Mesh(trunkGeo, defBark);
  trunkMesh.castShadow = true;
  g.add(trunkMesh);

  return g;
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    getBotanicalNeedleTexture,
    getBotanicalBroadleafTexture,
    getHighResBirchBarkTexture,
    buildFullHeightUnitTrunkGeo,
    getArchetypeCrownGeos,
    buildDetailedPortraitTree,
    WIND_UNIFORMS,
    updateGlobalWind,
    attachWindShader,
    getUndergrowthMaterials,
    buildUndergrowthGroup,
    applyUndergrowthSeason,
    buildSurveyorAvatar,
    getAnnualRingsTexture,
    buildTreeStumpMesh,
    buildFallenTrunkGroup,
  });
}
})();

