/**
 * 树干几何轮廓构建（纯函数，米制）。
 *
 * 胸径（DBH）定义为离地 1.3 m 处的树干直径。本模块构造分段线性半径轮廓，
 * 保证当树木高于胸高测量下限时，轮廓在 y = BREAST_HEIGHT 处的半径严格等于
 * 实测 DBH 的一半。轮廓用于 THREE.LatheGeometry 生成旋转面树干；
 * 树干网格原点位于树基（地面），不做任何缩放变换，因此世界坐标尺寸
 * 与轮廓一致。
 *
 * 无实测 DBH / 树高时返回 sketch 轮廓（按树高比例的示意形状），
 * 明确标记 measured=false，不伪造实测几何。
 */

export const BREAST_HEIGHT = 1.3; // 胸高（m）
export const GEOM_EPS = 1e-9; // 数值容差（m）

/** 树木矮于该值时，1.3m 处不具备实测意义（树高不足以立胸径杆）。 */
export const MIN_HEIGHT_FOR_DBH = BREAST_HEIGHT + 0.3;

/**
 * 构造树干半径轮廓。
 *
 * @param {object} p
 * @param {number} p.dbhCm   实测胸径（cm）
 * @param {number} p.heightM 实测树高（m），树干只建到 crownBase
 * @param {number} p.crownBaseM 枝下高（m）
 * @param {boolean} [p.sketch] 显式要求示意树干
 * @returns {{profile: Array<{r:number, y:number}>, measured: boolean, reason?: string}}
 *          profile 控制点自下而上；measured=false 时为示意形状。
 */
export function buildTrunkProfile({ dbhCm, heightM, crownBaseM, sketch = false }) {
  const crownBase = Math.max(crownBaseM, 0.4);

  // 无实测胸径 / 无有效树高 / 树太矮 / 显式示意 → 示意树干
  if (sketch || !(dbhCm > 0) || !(heightM > 0)) {
    const r = Math.max((heightM || 0) * 0.012, 0.02);
    return {
      profile: [
        { r: r * 1.6, y: 0 },
        { r: r * 0.55, y: crownBase },
      ],
      measured: false,
      reason: sketch ? "示意树干" : "无实测胸径",
    };
  }
  if (heightM <= MIN_HEIGHT_FOR_DBH) {
    const r = Math.max(heightM * 0.02, 0.015);
    return {
      profile: [
        { r: r * 1.5, y: 0 },
        { r: r * 0.55, y: Math.max(crownBase * 0.6, heightM * 0.5) },
      ],
      measured: false,
      reason: `树高 ${heightM}m 不足胸高测量下限（${MIN_HEIGHT_FOR_DBH}m）`,
    };
  }

  const rBreast = dbhCm / 100 / 2; // 实测胸径 → 米制半径（精确控制点）
  const rTop = rBreast * 0.6;
  // 根部扩张：从 1.3m 控制点向外推，保证基部外扩不改变胸高半径
  const rBase = rBreast * (1 + 0.35 * (BREAST_HEIGHT / crownBase));

  return {
    profile: [
      { r: rBase, y: 0 },
      { r: rBreast, y: BREAST_HEIGHT }, // 精确胸径控制点
      { r: rTop, y: crownBase },
    ],
    measured: true,
  };
}

/**
 * 分段线性求轮廓在高度 y 处的半径（与 LatheGeometry 的线性母线一致）。
 */
export function profileRadiusAt(profile, y) {
  if (y <= profile[0].y) return profile[0].r;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if (y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return a.r + (b.r - a.r) * t;
    }
  }
  return profile[profile.length - 1].r;
}
