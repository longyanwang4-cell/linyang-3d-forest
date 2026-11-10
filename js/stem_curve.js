/**
 * 四段干形曲线（变动指数方程）单木材积模型。
 *
 * 数学形式参考"四段干形曲线 3D 树体教学演示"：R² = R₀² + P·(x/H)^r，
 * x 为到树梢距离，R₀² 为分段截距；四段（基部膨大/下部干材/中部削度/
 * 梢部收尖）各自取参，段顶半径向下链式传递，根部含指数扩张项。
 *
 * 项目内的使用方向与演示相反：演示由树高正演出 DBH，本项目由每株
 * 实测的 DBH(cm) 与 H(m) 反演——按默认段参数生成形状模板后整体
 * 缩放，使胸高(1.3m)半径与实测胸径一致（R 与 √k 同比缩放，干形
 * 不变、材积按 k 缩放、形数不变）。
 *
 * 科研边界：该模型为通用干形近似（未按树种/区域材积表校准），
 * 材积/形数为示意估算，展示时须携带"估算"标注。
 */

(function () {
const SCALE = 0.035;
const SEGMENTS = [
  { weight: 5.0, p: 5.0, r: 0.80 },   // 第1段 基部膨大
  { weight: 4.0, p: 1.5, r: 1.15 },   // 第2段 下部干材
  { weight: 3.0, p: 2.0, r: 1.05 },   // 第3段 中部削度
  { weight: 5.0, p: 1.45, r: 1.2 },   // 第4段 梢部收尖
];

/** 由树高生成四段干形模板：段高按权重切分，半径自梢部向下逐段链式衔接。 */
function stemProfile(heightM) {
  const totalWeight = SEGMENTS.reduce((s, g) => s + g.weight, 0);
  let cursor = 0;
  const byHeight = SEGMENTS.map((g) => {
    const length = heightM * g.weight / totalWeight;
    const yStart = cursor;
    const yEnd = cursor + length;
    cursor = yEnd;
    return { yStart, yEnd, length, p: g.p, r: g.r, r0Square: 0 };
  });
  // 自梢向下链式传递：梢端半径 → 各段截距 R₀² → 段底半径
  let topRadius = Math.max(0.008, heightM * 0.00042);
  for (let i = byHeight.length - 1; i >= 0; i--) {
    const seg = byHeight[i];
    const xTop = Math.max(0, heightM - seg.yEnd);
    const xBottom = Math.max(0, heightM - seg.yStart);
    seg.r0Square = topRadius * topRadius
      - seg.p * SCALE * Math.pow(Math.max(0, xTop / heightM), seg.r);
    topRadius = Math.sqrt(Math.max(0,
      seg.r0Square + seg.p * SCALE * Math.pow(Math.max(0, xBottom / heightM), seg.r)));
  }
  return byHeight;
}

function segmentAtY(y, segs) {
  return segs.find((s) => y >= s.yStart - 1e-6 && y <= s.yEnd + 1e-6)
    || segs[segs.length - 1];
}

/** 距地面 y 处的实测半径（含根部扩张；k 为胸径匹配缩放系数）。 */
function stemRadiusAt(y, segs, heightM, k = 1) {
  const seg = segmentAtY(y, segs);
  const xCurrent = Math.max(0, heightM - y);
  const base = Math.sqrt(Math.max(0,
    seg.r0Square + seg.p * SCALE * Math.pow(Math.max(0, xCurrent / heightM), seg.r)));
  const flare = 1 + 0.28 * Math.exp(-Math.max(0, y) / 1.15);
  return base * flare * Math.sqrt(k);
}

/** 牛顿截顶公式数值积分（π(R0²+R0·R1+R1²)·Δy/3），每段 160 步。 */
function integrateVolume(segs, heightM, k) {
  let sum = 0;
  for (const seg of segs) {
    const steps = 160;
    for (let i = 0; i < steps; i++) {
      const y0 = seg.yStart + seg.length * i / steps;
      const y1 = seg.yStart + seg.length * (i + 1) / steps;
      const r0 = stemRadiusAt(y0, segs, heightM, k);
      const r1 = stemRadiusAt(y1, segs, heightM, k);
      sum += Math.PI * (r0 * r0 + r0 * r1 + r1 * r1) * (y1 - y0) / 3;
    }
  }
  return sum;
}

/**
 * 由实测 DBH(cm) 与树高 H(m) 估算单木：
 *   volume      全树材积 m³（胸径匹配缩放后）
 *   formFactor  形数 = V / (π·r₁.₃²·H)（缩放不变量，由模板直接求）
 *   valid       是否在模型适用范围内（R4-07：范围外禁算，不输出数字）
 *   invalidReason 超范围原因（valid=false 时给出）
 *   radiusAt(y) 胸径匹配后的干半径函数（m）
 *
 * 适用范围门（概念模型，未经树种材积表校准、未做独立精度验证）：
 * 树高 5–40m、胸径 1–120cm，且形数须落在干形合理区间（0.15–0.90）；
 * 超出范围一律 valid=false——例如 H=2m 的幼树会得到荒谬形数，必须拒绝输出。
 */
function stemVolume(heightM, dbhCm) {
  const segs = stemProfile(heightM);
  const r13 = stemRadiusAt(1.3, segs, heightM, 1);
  const k = r13 > 1e-9 ? ((dbhCm / 200) / r13) ** 2 : 0;
  const volume = integrateVolume(segs, heightM, k);
  const formFactor = (r13 > 1e-9 && heightM > 0)
    ? integrateVolume(segs, heightM, 1) / (Math.PI * r13 * r13 * heightM)
    : 0;
  let invalidReason = null;
  if (!(heightM >= 5 && heightM <= 40)) {
    invalidReason = `树高 ${heightM}m 超出干曲线模型适用区间 5–40m`;
  } else if (!(dbhCm >= 1 && dbhCm <= 120)) {
    invalidReason = `胸径 ${dbhCm}cm 超出干曲线模型适用区间 1–120cm`;
  } else if (!(formFactor >= 0.15 && formFactor <= 0.9)) {
    invalidReason = `形数 ${formFactor.toFixed(2)} 超出干形合理区间，估算不可信`;
  }
  return {
    volume, formFactor, invalidReason,
    valid: invalidReason === null,
    radiusAt: (y) => stemRadiusAt(y, segs, heightM, k),
  };
}

/**
 * 干形纵剖面 SVG（左右轮廓 + 胸高线）：详情卡内嵌展示。
 * 仅绘制，不做任何拟合。
 */
function stemProfileSvg(heightM, dbhCm, width = 640, height = 130) {
  const { radiusAt } = stemVolume(heightM, dbhCm);
  const padX = 34, padY = 12;
  const axisX = width * 0.42;
  const samples = [];
  let maxR = 1e-6;
  for (let i = 0; i <= 60; i++) {
    const y = heightM * i / 60;
    const r = radiusAt(y);
    maxR = Math.max(maxR, r);
    samples.push([y, r]);
  }
  const yPix = (y) => padY + (1 - y / heightM) * (height - 2 * padY);
  const rPix = (r) => (r / maxR) * (width - 2 * padX) / 2 * 0.82;
  const right = samples.map(([y, r]) => `${(axisX + rPix(r)).toFixed(1)},${yPix(y).toFixed(1)}`);
  const left = samples.slice().reverse()
    .map(([y, r]) => `${(axisX - rPix(r)).toFixed(1)},${yPix(y).toFixed(1)}`);
  const body = `M${right.join(' L')} L${left.join(' L')} Z`;
  // 数值保持为 number，仅在输出时格式化（字符串相加会拼接成非法 SVG 坐标）
  const bhY = yPix(Math.min(1.3, heightM));
  const bhR = rPix(radiusAt(1.3));
  const f = (v) => v.toFixed(1);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="干形纵剖面"
    style="width:100%;display:block;background:#fbf9f2;border:1px solid #e4dece;border-radius:6px">
    <line x1="${f(axisX)}" y1="${padY}" x2="${f(axisX)}" y2="${height - padY}" stroke="#8b8272" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="${padX - 18}" y1="${height - padY}" x2="${width - padX + 10}" y2="${height - padY}" stroke="#6b4a35" stroke-width="2"/>
    <path d="${body}" fill="rgba(139,90,43,0.32)" stroke="#6b4a35" stroke-width="1.6"/>
    <line x1="${f(axisX - bhR)}" y1="${f(bhY)}" x2="${f(axisX + bhR)}" y2="${f(bhY)}" stroke="#b0483a" stroke-width="2"/>
    <text x="${f(axisX + bhR + 6)}" y="${f(bhY + 4)}" fill="#b0483a" font-size="11">胸径 ${dbhCm}cm @1.3m</text>
    <text x="${width - padX + 2}" y="${height - padY - 4}" fill="#8b8272" font-size="10" text-anchor="end">H ${heightM}m</text>
  </svg>`;
}

if (typeof window !== 'undefined') {
  window.stemVolume = stemVolume;
  window.stemProfileSvg = stemProfileSvg;
}
})();
