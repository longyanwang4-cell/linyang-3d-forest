/**
 * FM1 三维查看器（第四轮 · 弹窗渲染交互版）。
 *
 * 交互设计（用户确认的形态）：
 * - 打开页面 → 秒建 160 株轻量程序化森林（零 GLB，无方案/画质按钮）
 * - 点击/搜索某棵树 → 弹出「树木详情窗」：
 *     · 上半部分：这棵树自己的独立 3D 渲染（树种资产模板 + 实测参数实时生成，
 *       可拖转/滚轮缩放/自动旋转）
 *     · 下半部分：实测胸径/树高/冠幅/来源 + 两期对比表
 *     · 按钮：加入对比(多选)｜仅显示此树｜在样地中定位｜关闭
 * - 多选（对比）：多选模式下点击树加入/取消（再点一次即取消）；
 *   弹窗内「移除出对比」；选择列表 chip 点击查看渲染、✕ 移除
 * - 已选多棵时弹窗内 ‹ 2/5 › 翻看每棵树的渲染图
 * - 「仅显示此树 / 仅显示所选」在主视图隔离显示（轻量代理，保持流畅）
 * - 调查期：任意年份（注册表驱动）/ 双期（双期时弹窗内可切换渲染年份）
 */

(function () {
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
const THREE = window.THREE;
const OrbitControls = window.OrbitControls || THREE?.OrbitControls;
const GLTFLoader = window.GLTFLoader || class { load(_u, _ok, _p, err) { if (err) err(new Error('no GLTFLoader')); } };
const stemVolume = window.stemVolume;
const stemProfileSvg = window.stemProfileSvg;
const parseDeepLink = window.parseDeepLink;
const buildDeepLinkQuery = window.buildDeepLinkQuery;
const SPECIES_PROFILES = window.SPECIES_PROFILES;
const resolveSpeciesProfile = window.resolveSpeciesProfile;
const getSpeciesBarkTexture = window.getSpeciesBarkTexture;
const getBotanicalNeedleTexture = window.getBotanicalNeedleTexture;
const getBotanicalBroadleafTexture = window.getBotanicalBroadleafTexture;
const getHighResBirchBarkTexture = window.getHighResBirchBarkTexture;
const buildFullHeightUnitTrunkGeo = window.buildFullHeightUnitTrunkGeo;
const getArchetypeCrownGeos = window.getArchetypeCrownGeos;
const buildDetailedPortraitTree = window.buildDetailedPortraitTree;
const updateGlobalWind = window.updateGlobalWind;
const attachWindShader = window.attachWindShader;
const buildUndergrowthGroup = window.buildUndergrowthGroup;
const applyUndergrowthSeason = window.applyUndergrowthSeason;
const buildSurveyorAvatar = window.buildSurveyorAvatar;
const buildTreeStumpMesh = window.buildTreeStumpMesh;
const buildFallenTrunkGroup = window.buildFallenTrunkGroup;

// ============================================================ 工具

const $ = (sel) => document.querySelector(sel);
const MODEL_DIR = 'assets/models/fm1hd/';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _hintTimer = null;
function hint(msg) {
  const el = $('#search-msg');
  if (!el) return;
  el.textContent = msg || '';
  if (_hintTimer) clearTimeout(_hintTimer);
  if (msg) {
    _hintTimer = setTimeout(() => {
      if (el.textContent === msg) el.textContent = '';
    }, 3400);
  }
}

/** 单木现场实况自主标注持久化与状态读取（采伐伐桩/倒木/枯立/断梢/正常）。 */
function getPlotAnnotations() {
  try {
    const raw = localStorage.getItem('lzv21.tree_annotations.' + (state.plotId || 'fm1'));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function savePlotAnnotation(tag, status, note) {
  const all = getPlotAnnotations();
  all[tag] = { status, note, updated_at: new Date().toISOString().slice(0, 19) };
  try {
    localStorage.setItem('lzv21.tree_annotations.' + (state.plotId || 'fm1'), JSON.stringify(all));
  } catch { /* ignore */ }
  for (const sc of activeScenes()) {
    sc.applyTreeStatus(tag, status, note);
  }
}

function updateAnnotateBox(tag) {
  const ann = getPlotAnnotations()[tag] || { status: 'living', note: '' };
  const sel = $('#tc-status-sel');
  const noteInp = $('#tc-status-note');
  const badge = $('#tc-status-badge');
  if (sel) sel.value = ann.status || 'living';
  if (noteInp) noteInp.value = ann.note || '';
  if (badge) {
    const map = {
      living: ['活立木·正常', 'survey', '#d4e8d6', '#1d4d2b'],
      felled: ['🪓 采伐伐桩', 'warn', '#f5e3bb', '#8a6410'],
      fallen: ['🌪 风倒倒木', 'warn', '#faebd7', '#b05a10'],
      snag: ['🍂 枯立木', 'warn', '#e2e8f0', '#475569'],
      broken: ['⚡ 断梢折干', 'warn', '#dbeafe', '#1e40af'],
      suspect: ['❓ 异常待查', 'bad', '#f8d7d3', '#c0392b'],
    };
    const info = map[ann.status] || ['活立木·正常', 'survey', '#d4e8d6', '#1d4d2b'];
    badge.textContent = info[0];
    badge.className = 'badge ' + info[1];
    badge.style.background = info[2];
    badge.style.color = info[3];
  }
}

/** 顶栏及视角栏总底边（px）：优先读取 --subbar-top，确保树号标签与浮动窗绝不遮挡顶部两排控件。 */
function hudTopPx() {
  const cs = getComputedStyle(document.documentElement);
  const sub = parseFloat(cs.getPropertyValue('--subbar-top'));
  if (Number.isFinite(sub) && sub > 0) return sub;
  const v = parseFloat(cs.getPropertyValue('--hud-top'));
  return Number.isFinite(v) && v > 0 ? v : 96;
}

function loadGLB(file) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(MODEL_DIR + file, (g) => resolve(g.scene), undefined, reject);
  });
}

// 模块级模板缓存（LRU）：跨弹窗实例复用已解码的 GLB——重看/翻页零网络请求零解码。
// 上限内保留最近使用的模板；逐出时释放几何与材质（共享针叶纹理除外）。
const TEMPLATE_CACHE = new Map();       // key -> Promise<THREE.Object3D>
const TEMPLATE_CACHE_MAX = 8;
let SHARED_NEEDLE_TEX = null;

function sharedNeedleTex() {
  if (!SHARED_NEEDLE_TEX) SHARED_NEEDLE_TEX = makeNeedleTexture();
  return SHARED_NEEDLE_TEX;
}

function disposeTemplateRoot(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.map && m.map !== SHARED_NEEDLE_TEX) m.map.dispose();
      m.dispose();
    }
  });
}

function templateCacheGet(key, loader, protectedKeys) {
  const hit = TEMPLATE_CACHE.get(key);
  if (hit) {                              // LRU：命中移到队尾
    TEMPLATE_CACHE.delete(key);
    TEMPLATE_CACHE.set(key, hit);
    return hit;
  }
  const p = loader();
  TEMPLATE_CACHE.set(key, p);
  while (TEMPLATE_CACHE.size > TEMPLATE_CACHE_MAX) {
    const oldest = TEMPLATE_CACHE.keys().next().value;
    if (oldest === key) break;
    if (protectedKeys && protectedKeys.has(oldest)) break;
    const entry = TEMPLATE_CACHE.get(oldest);
    TEMPLATE_CACHE.delete(oldest);
    entry.then(disposeTemplateRoot).catch(() => {});
  }
  return p;
}

// ============================================================ 参数化工具（模块级，纯逻辑）

/** 按最近树高挑选树种模板候选；若当前年份无专属池（如 2018/2030/2033/2036），
 *  自动回退到该树种最新可用年份模板池，确保任意调查期均可 3D 参数化渲染。 */
function pickTemplate(pools, speciesKey, year, heightM) {
  const byYear = pools?.get(speciesKey);
  if (!byYear) return null;
  let pool = byYear.get(Number(year)) || byYear.get(String(year)) || [];
  if (!pool.length) {
    pool = byYear.get(2026) || byYear.get(2023) || [...byYear.values()].find((a) => a && a.length) || [];
  }
  if (!pool.length) return null;
  let best = pool[0];
  for (const c of pool) {
    if (Math.abs(c.height - heightM) < Math.abs(best.height - heightM)) best = c;
  }
  return best;
}

/** 干部锥度修正系数：r(y1)/r(y0)（几何局部坐标采样）。 */
function taperRatio(geo, y0, y1) {
  const pos = geo.getAttribute('position');
  if (!pos) return 1;
  const radiusAt = (yc) => {
    const rs = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - yc) < 0.1) rs.push(Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    if (rs.length < 3) return null;
    rs.sort((a, b) => a - b);
    return rs[Math.floor(rs.length / 2)];
  };
  const r0 = radiusAt(y0), r1 = radiusAt(y1);
  if (!r0 || !r1 || r0 <= 1e-6 || r1 <= 1e-6) return 1;
  return r1 / r0;
}

/**
 * 模板克隆 → 按该树实测参数缩放：
 * 树高=整体Y缩放；胸径=干部锥度修正保证世界y=1.3m处直径=实测DBH；
 * 落叶松针叶按实测冠宽微调。
 */
function parametrize(root, spec, td) {
  const sy = td.height_m / spec.height;            // 树高比
  const fD = td.dbh_cm / spec.dbh;                 // 胸径基准比（全树 XZ）
  root.scale.set(fD, sy, fD);

  const yLocal = 1.3 / sy;
  if (Math.abs(yLocal - 1.3) > 0.05) {
    root.traverse((o) => {
      if (o.isMesh && /trunk/i.test(o.name || '')) {
        const k = taperRatio(o.geometry, 1.3, yLocal);
        if (k && Math.abs(k - 1) > 0.004) o.scale.set(1 / k, 1, 1 / k);
      }
    });
  }
  const crownW = (td.crown_status === 'measured' && td.crown_ns_m > 0)
    ? td.crown_ns_m : spec.crown * sy;
  const extra = crownW / (spec.crown * fD);
  if (Math.abs(extra - 1) > 0.03) {
    root.traverse((o) => {
      if (o.isMesh && /needle|leaf|foliage/i.test(o.name || '')) {
        o.scale.x *= extra;
        o.scale.z *= extra;
      }
    });
  }
  root.position.set(td.x, 0, td.y);
  root.rotation.y = (td.seq_no * 2.399963) % (Math.PI * 2);
}

/** 共享程序化针叶纹理（放射笔触 + alpha 镂空）。 */
function makeNeedleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = '#4a7a38';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.07;
    const r0 = 4 + (i % 4), r1 = 22 + (i % 5) * 3;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * r0, 32 + Math.sin(a) * r0);
    ctx.lineTo(32 + Math.cos(a) * r1, 32 + Math.sin(a) * r1);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 资产材质修补：部分 GLB 未嵌入贴图（baseColorFactor 白色）。
 * needle 网格 → 程序化针叶纹理；其余无贴图材质 → 树种树皮色；有贴图不动。
 */
function patchMaterials(root, speciesKey, needleTex, speciesName = null, season = 'summer') {
  const spStyle = resolveSpeciesProfile(speciesName || (speciesKey === 'birch' ? '白桦' : '落叶松'));
  const barkHex = spStyle.trunk;
  const barkTex = getSpeciesBarkTexture(THREE, spStyle);
  const crownHex = season === 'autumn' ? (spStyle.crownAutumn || spStyle.crown) : spStyle.crown;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.name || '').toLowerCase();
    const isNeedle = /needle/.test(n);
    const isLeaf = /leaf|foliage/.test(n);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const patched = mats.map((m) => {
      if (isNeedle) {
        const nm = m.clone();
        nm.map = needleTex;
        nm.color.set(season === 'autumn' && !spStyle.evergreen ? crownHex : 0xffffff);
        nm.alphaTest = 0.35;
        nm.side = THREE.DoubleSide;
        nm.needsUpdate = true;
        return nm;
      }
      if (isLeaf) {
        const lm = m.clone();
        lm.color.set(crownHex);
        lm.alphaTest = 0.45;
        lm.side = THREE.DoubleSide;
        lm.needsUpdate = true;
        return lm;
      }
      const bm = m.clone();
      if (barkTex && !bm.map) {
        bm.map = barkTex;
        bm.color.set(0xffffff);
      } else if (!bm.map) {
        bm.color.set(barkHex);
      }
      bm.roughness = 0.92;
      bm.needsUpdate = true;
      return bm;
    });
    o.material = Array.isArray(o.material) ? patched : patched[0];
  });
}

// ============================================================ 轻量森林共享资产池（Three.js 树种专属构型升级）

/** 单位校准树干（LatheGeometry，y ∈ [-0.5, +0.5]）：
 *  含根颈自然外扩（r=1.28）、胸高基准段（r=1.00）与上部干形收尖（r=0.56），
 *  保持 trunk.scale.set(dim.rB, dim.cb, dim.rB) 契约不变。 */
function buildUnitTrunkGeo() {
  const pts = [
    new THREE.Vector2(1.28, -0.50),
    new THREE.Vector2(1.08, -0.36),
    new THREE.Vector2(1.00, -0.22),
    new THREE.Vector2(0.88,  0.00),
    new THREE.Vector2(0.74,  0.25),
    new THREE.Vector2(0.56,  0.50),
  ];
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.computeVertexNormals();
  return geo;
}

/** 针叶塔形轮生冠几何（落叶松/红松：16 扇面 + 轮生枝裙微起伏）。 */
function buildConiferCrownGeo() {
  const geo = new THREE.ConeGeometry(1, 1, 16, 4);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 1e-4) {
      const ang = Math.atan2(z, x);
      const wave = 1 + 0.08 * Math.cos(ang * 7) + 0.04 * Math.sin(ang * 5 + y * 6);
      const droop = y < -0.2 ? -0.04 * (r * wave) : 0;
      pos.setXYZ(i, x * wave, y + droop, z * wave);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** 云杉/冷杉窄尖塔下披冠几何（细长尖顶 + 密集轮生下垂裙边）。 */
function buildSpireCrownGeo() {
  const geo = new THREE.ConeGeometry(1, 1, 18, 5);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 1e-4) {
      const ang = Math.atan2(z, x);
      const t = 0.5 - y; // 0 at apex, 1 at base
      const pinch = Math.pow(t, 1.18) / Math.max(t, 1e-3);
      const wave = pinch * (1 + 0.11 * Math.cos(ang * 9) + 0.05 * Math.sin(y * 12));
      const droop = y < -0.15 ? -0.07 * r : 0;
      pos.setXYZ(i, x * wave, y + droop, z * wave);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** 樟子松伞形平顶冠几何（上部宽圆饱满、下部自然收拢）。 */
function buildUmbrellaCrownGeo() {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = y > 0 ? Math.pow(y, 0.72) * 0.65 : y * 0.48;
    const spread = y > -0.2 ? 1.12 + 0.07 * Math.cos(x * 4 + z * 4) : 0.78;
    pos.setXYZ(i, x * spread, ny, z * spread);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 阔叶树自然卵圆团簇冠几何（白桦/水曲柳/紫椴/黑桦）。 */
function buildBroadleafCrownGeo() {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.09 * Math.sin(x * 4.2 + y * 3.1) * Math.cos(z * 3.7 - x * 2.3);
    pos.setXYZ(i, x * k, y * (y > 0 ? k * 1.03 : k * 0.94), z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 蒙古栎/胡桃楸/榆树/色木槭宽阔扁球分瓣大冠几何。 */
function buildDomeCrownGeo() {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const lobe = 1.06 + 0.10 * Math.cos(ang * 5) + 0.06 * Math.sin(y * 4.5);
    const ny = y > 0 ? y * 0.86 : y * 0.68;
    pos.setXYZ(i, x * lobe, ny, z * lobe);
  }
  geo.computeVertexNormals();
  return geo;
}

// 单位几何与小型材质池跨场景/跨重建共享
const LW_GEO = {
  trunk: buildFullHeightUnitTrunkGeo(),                 // 全高通直微弯校准树干：y∈[0,1]，x/z=rB
  cone: buildConiferCrownGeo(),                         // 塔形轮生针叶冠
  spire: buildSpireCrownGeo(),                          // 窄尖塔针叶冠
  umbrella: buildUmbrellaCrownGeo(),                    // 伞形平顶针叶冠
  blob: buildBroadleafCrownGeo(),                       // 卵圆团簇阔叶冠
  dome: buildDomeCrownGeo(),                            // 广卵/扁球阔叶大冠
  ring: new THREE.TorusGeometry(0.42, 0.035, 8, 32),    // 选择/聚焦环
  hoverRing: new THREE.RingGeometry(0.46, 0.62, 32),    // 悬停高亮环
};

let _PBR_LARCH_BARK = null;
let _PBR_LARCH_NOR = null;
function ensurePbrBarkTextures() {
  // file:// 模式下外部图片进入 WebGL 会触发跨域画布污染，自动使用程序化高精度树皮 CanvasTexture
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { diff: null, nor: null };
  }
  if (!_PBR_LARCH_BARK && typeof document !== 'undefined') {
    try {
      const loader = new THREE.TextureLoader();
      _PBR_LARCH_BARK = loader.load('assets/textures/bark_larch_diff_1k.jpg');
      _PBR_LARCH_BARK.wrapS = _PBR_LARCH_BARK.wrapT = THREE.RepeatWrapping;
      _PBR_LARCH_BARK.repeat.set(2, 6);
      _PBR_LARCH_BARK.colorSpace = THREE.SRGBColorSpace;
      _PBR_LARCH_NOR = loader.load('assets/textures/bark_larch_nor_1k.png');
      _PBR_LARCH_NOR.wrapS = _PBR_LARCH_NOR.wrapT = THREE.RepeatWrapping;
      _PBR_LARCH_NOR.repeat.set(2, 6);
    } catch { /* fallback to procedural bark */ }
  }
  return { diff: _PBR_LARCH_BARK, nor: _PBR_LARCH_NOR };
}

function crownGeoFor(style) {
  switch (style.archetype) {
    case 'conifer_spire': return LW_GEO.spire;
    case 'conifer_umbrella': return LW_GEO.umbrella;
    case 'broadleaf_dome':
    case 'broadleaf_vase': return LW_GEO.dome;
    case 'conifer_tower':
    case 'conifer_lush_tower':
      return LW_GEO.cone;
    default:
      return style.kind === 'conifer' ? LW_GEO.cone : LW_GEO.blob;
  }
}
const LW_RING_MAT = new THREE.MeshBasicMaterial({ color: 0xffa02e });
const LW_HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0x52e5a0, transparent: true, opacity: 0.78, side: THREE.DoubleSide,
});
const LW_ROPE_MAT = new THREE.LineBasicMaterial({ color: 0xf0ede4 });
const LW_GRID_MAT = new THREE.LineBasicMaterial({ color: 0x3a4a32, transparent: true, opacity: 0.45 });
const LW_SUBGRID_MAT = new THREE.LineBasicMaterial({ color: 0xd9c89e, transparent: true, opacity: 0.32 });
const LW_STAKE_GEO = new THREE.CylinderGeometry(0.06, 0.07, 1.4, 10);
const LW_CAP_GEO = new THREE.SphereGeometry(0.11, 12, 10);
const LW_STAKE_MAT = new THREE.MeshStandardMaterial({ color: 0xd93a20, roughness: 0.55 });

function makeProceduralFloorTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#526444';
  ctx.fillRect(0, 0, S, S);
  const rand = mulberry32(0x20261107);
  // 林地腐殖土、苔藓斑块与落叶松枯针地被细节
  for (let i = 0; i < 380; i++) {
    const x = rand() * S, y = rand() * S, r = 6 + rand() * 22;
    ctx.fillStyle = i % 3 === 0
      ? 'rgba(72, 96, 54, 0.32)'
      : (i % 3 === 1 ? 'rgba(98, 78, 52, 0.26)' : 'rgba(62, 82, 48, 0.30)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 450; i++) {
    const x = rand() * S, y = rand() * S, a = rand() * Math.PI * 2;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(132, 102, 58, 0.38)' : 'rgba(84, 110, 62, 0.38)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _SHARED_FLOOR_MAT = null;
function sharedFloorMaterial() {
  if (_SHARED_FLOOR_MAT) return _SHARED_FLOOR_MAT;
  const mat = new THREE.MeshStandardMaterial({
    map: makeProceduralFloorTexture(),
    color: 0x8a9c78,
    roughness: 0.96,
    metalness: 0,
  });
  if (typeof location === 'undefined' || location.protocol !== 'file:') {
    try {
      const loader = new THREE.TextureLoader();
      loader.load('assets/textures/forest_floor_diff_1k.jpg', (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(16, 16);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
      });
      loader.load('assets/textures/forest_floor_nor_1k.png', (nor) => {
        nor.wrapS = nor.wrapT = THREE.RepeatWrapping;
        nor.repeat.set(16, 16);
        mat.normalMap = nor;
        mat.normalScale = new THREE.Vector2(0.55, 0.55);
        mat.needsUpdate = true;
      });
    } catch { /* 保持程序化林地纹理 */ }
  }
  _SHARED_FLOOR_MAT = mat;
  return mat;
}

const LW_SPECIES = SPECIES_PROFILES;

function lwSpecies(species) {
  return resolveSpeciesProfile(species);
}

/** 按树种植物学冠形构型（archetype）生成 3 层树冠布局（构建与生长插值共用同一比例）。
 *  确定性逐树抖动 ±8%（种子=编号），让林相自然且插值可复现。 */
function crownTiers(style, dim, seqNo) {
  const j = 1 + ((((seqNo + 1) * 2654435761) % 997) / 997 - 0.5) * 0.16;
  const R = Math.max(dim.crownR * j, 0.12);
  const L = dim.cLen;
  switch (style.archetype) {
    case 'conifer_spire': // 云杉 / 冷杉：窄尖塔浓密多层下披冠
      return [
        { s: [R * 0.94, Math.max(L * 0.48, 1e-3), R * 0.94], y: dim.cb + L * 0.24 },
        { s: [R * 0.72, Math.max(L * 0.46, 1e-3), R * 0.72], y: dim.cb + L * 0.52 },
        { s: [R * 0.44, Math.max(L * 0.42, 1e-3), R * 0.44], y: dim.cb + L * 0.79 },
      ];
    case 'conifer_umbrella': // 樟子松：高干平顶伞形冠 + 侧生松团
      return [
        { s: [R * 1.12, Math.max(L * 0.42, 1e-3), R * 1.08], y: dim.cb + L * 0.66 },
        { s: [R * 0.78, Math.max(L * 0.34, 1e-3), R * 0.76],
          x: R * 0.24, y: dim.cb + L * 0.44, z: -R * 0.15 },
        { s: [R * 0.74, Math.max(L * 0.30, 1e-3), R * 0.74],
          x: -R * 0.22, y: dim.cb + L * 0.80, z: R * 0.16 },
      ];
    case 'conifer_lush_tower': // 红松：阔圆锥苍劲饱满大冠
      return [
        { s: [R * 1.08, Math.max(L * 0.54, 1e-3), R * 1.08], y: dim.cb + L * 0.30 },
        { s: [R * 0.84, Math.max(L * 0.48, 1e-3), R * 0.84],
          x: R * 0.06, y: dim.cb + L * 0.58, z: -R * 0.05 },
        { s: [R * 0.54, Math.max(L * 0.38, 1e-3), R * 0.54], y: dim.cb + L * 0.82 },
      ];
    case 'broadleaf_column': // 山杨 / 杨树：高耸长卵聚拢冠
      return [
        { s: [R * 0.82, Math.max(L * 0.48, 1e-3), R * 0.80], y: dim.cb + L * 0.36 },
        { s: [R * 0.76, Math.max(L * 0.42, 1e-3), R * 0.74],
          x: R * 0.10, y: dim.cb + L * 0.64, z: R * 0.08 },
        { s: [R * 0.52, Math.max(L * 0.32, 1e-3), R * 0.52],
          x: -R * 0.08, y: dim.cb + L * 0.84, z: -R * 0.06 },
      ];
    case 'broadleaf_dome': // 蒙古栎 / 柞树 / 胡桃楸 / 黄檗：宽阔广卵/扁球分瓣大冠
    case 'broadleaf_vase': // 榆树 / 色木槭：倒卵伞状开展冠
      return [
        { s: [R * 1.08, Math.max(L * 0.44, 1e-3), R * 1.04], y: dim.cb + L * 0.44 },
        { s: [R * 0.78, Math.max(L * 0.36, 1e-3), R * 0.76],
          x: R * 0.30, y: dim.cb + L * 0.62, z: R * 0.18 },
        { s: [R * 0.72, Math.max(L * 0.34, 1e-3), R * 0.70],
          x: -R * 0.28, y: dim.cb + L * 0.56, z: -R * 0.20 },
      ];
    default:
      if (style.kind === 'conifer') {
        return [
          { s: [R * 1.02, Math.max(L * 0.52, 1e-3), R * 1.02], y: dim.cb + L * 0.28 },
          { s: [R * 0.76, Math.max(L * 0.48, 1e-3), R * 0.76], y: dim.cb + L * 0.56 },
          { s: [R * 0.46, Math.max(L * 0.38, 1e-3), R * 0.46], y: dim.cb + L * 0.82 },
        ];
      }
      return [
        { s: [R, Math.max(L * 0.44, 1e-3), R * 0.94], y: dim.cb + L * 0.38 },
        { s: [R * 0.70, Math.max(L * 0.34, 1e-3), R * 0.68],
          x: R * 0.24, y: dim.cb + L * 0.66, z: R * 0.14 },
        { s: [R * 0.58, Math.max(L * 0.28, 1e-3), R * 0.60],
          x: -R * 0.20, y: dim.cb + L * 0.56, z: -R * 0.16 },
      ];
  }
}

const LW_SHADES = 6;
const LW_MAT_CACHE = new Map();

function lwMaterial(opts) {
  return new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02, flatShading: false, ...opts });
}

/** 每树种×物候季一套高颜值植物学材质池：
 *  - 树干与主枝：白桦采用 512×1024 高清粉白皮孔+枝痕黑斑+基部粗裂靴纹理；
 *    落叶松/红松/云杉采用 1K 实拍 PBR 树皮漫反射+法线贴图；其余树种采用专属树皮纹理+法线凹凸；
 *  - 树冠叶簇：采用 512×512 高清植物学簇生针叶束 / 三角状卵形锯齿白桦叶簇 RGBA 贴图 + 顶点 AO。 */
function lwMats(species, season = state.season || 'summer', crownStyle = state.crownStyle || 'layered') {
  const style = lwSpecies(species);
  const key = `${style.name}_${season}_${crownStyle}_v28`;
  let pool = LW_MAT_CACHE.get(key);
  if (pool) return pool;

  const pbr = ensurePbrBarkTextures();
  let barkTex = null;
  let usePbrDiff = false;
  if (style.barkPattern === 'birch_white') {
    barkTex = getHighResBirchBarkTexture();
  } else if (style.barkPattern === 'fissured_scale' || style.barkPattern === 'pine_plate' || style.barkPattern === 'spruce_scale') {
    barkTex = pbr.diff || getSpeciesBarkTexture(THREE, style);
    usePbrDiff = !!pbr.diff;
  } else {
    barkTex = getSpeciesBarkTexture(THREE, style);
  }

  // 提升落叶松与白桦的色彩对比度：落叶松苍翠松绿，白桦明快鲜绿（秋色各自鲜明）
  let crownHex = season === 'autumn' ? (style.crownAutumn ?? style.crown) : style.crown;
  if (season !== 'autumn' && style.name === '白桦') crownHex = 0x76ba42;
  if (season === 'autumn' && style.name === '落叶松') crownHex = 0xe59e24;
  if (season === 'autumn' && style.name === '白桦') crownHex = 0xf0c230;
  const emHex = season === 'autumn'
    ? (style.evergreen ? (style.emAutumn ?? style.em) : 0x422605)
    : style.em;
  const tipTarget = season === 'autumn' && !style.evergreen ? 0xffe47a : 0xe8f29a;
  const tipColor = new THREE.Color(crownHex).lerp(new THREE.Color(tipTarget), 0.38).getHex();
  const foliageTex = style.kind === 'conifer'
    ? getBotanicalNeedleTexture(`${style.name}_${season}`, crownHex, tipColor)
    : getBotanicalBroadleafTexture(`${style.name}_${season}`, crownHex, tipColor);

  const useSpriteCards = crownStyle === 'detailed';

  const solidTrunk = () => {
    const arr = [];
    for (let i = 0; i < LW_SHADES; i++) {
      const v = 0.88 + (i / (LW_SHADES - 1)) * 0.22;
      const tint = usePbrDiff
        ? new THREE.Color(style.trunk).lerp(new THREE.Color(0xffffff), 0.65).multiplyScalar(v)
        : (barkTex ? new THREE.Color(0xffffff).multiplyScalar(v) : new THREE.Color(style.trunk).multiplyScalar(v));
      arr.push(lwMaterial({
        map: barkTex || null,
        normalMap: style.barkPattern === 'birch_white' ? null : (pbr.nor || null),
        normalScale: new THREE.Vector2(0.75, 0.75),
        color: tint,
        roughness: style.barkPattern === 'birch_white' ? 0.78 : 0.90,
      }));
    }
    return arr;
  };
  const solidCrown = () => {
    const arr = [];
    for (let i = 0; i < LW_SHADES; i++) {
      const v = 0.88 + (i / (LW_SHADES - 1)) * 0.26;
      const baseCol = useSpriteCards
        ? new THREE.Color(0xffffff).multiplyScalar(v)
        : new THREE.Color(crownHex).multiplyScalar(v);
      if (season === 'autumn' && !style.evergreen && i === 0) {
        baseCol.lerp(new THREE.Color(0x98b848), 0.25);
      }
      const crownMat = new THREE.MeshStandardMaterial({
        map: useSpriteCards ? (foliageTex || null) : null,
        alphaTest: useSpriteCards && foliageTex ? 0.34 : 0,
        side: useSpriteCards ? THREE.DoubleSide : THREE.FrontSide,
        vertexColors: true,
        color: baseCol,
        emissive: emHex ?? 0x000000,
        emissiveIntensity: 0.32,
        roughness: 0.86,
        metalness: 0.0,
      });
      arr.push(attachWindShader(crownMat, 'crown_unit'));
    }
    return arr;
  };
  const buildPortraitCrowns = () => {
    const arr = [];
    for (let i = 0; i < LW_SHADES; i++) {
      const v = 0.92 + (i / (LW_SHADES - 1)) * 0.18;
      const pm = new THREE.MeshStandardMaterial({
        map: foliageTex || null,
        alphaTest: foliageTex ? 0.32 : 0,
        side: THREE.DoubleSide,
        vertexColors: true,
        color: new THREE.Color(0xffffff).multiplyScalar(v),
        emissive: emHex ?? 0x000000,
        emissiveIntensity: 0.42,
        roughness: 0.84,
        metalness: 0.0,
      });
      arr.push(attachWindShader(pm, 'crown_meter'));
    }
    return arr;
  };
  const trunkArr = solidTrunk();
  const branchArr = trunkArr.map((m) => attachWindShader(m.clone(), 'branch_unit'));
  const crownArr = solidCrown();
  const portraitCrownArr = buildPortraitCrowns();
  const ghostPair = (op) => ({
    trunk: lwMaterial({ color: style.trunk, transparent: true, opacity: op, depthWrite: false }),
    crown: new THREE.MeshStandardMaterial({
      color: crownHex,
      emissive: emHex,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: op,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  });
  pool = {
    trunkSolid: trunkArr,
    branchSolid: branchArr,
    crownSolid: crownArr,
    portraitCrown: portraitCrownArr,
    ghostFull: ghostPair(0.45),    // 数据受限树在完整样地下的示意透明度
    ghostFocus: ghostPair(0.16),   // 单树/多木模式下非实体树的透明度
    lightTrunk: lwMaterial({ color: style.trunk, transparent: true, opacity: 0.5, depthWrite: false }),
  };
  LW_MAT_CACHE.set(key, pool);
  return pool;
}

/** 由单期调查记录推导该树的渲染参数：
 *  在样地群落视图中适度收拢冠径（0.58×，防 160 株密集树冠糊成一片）并抬升视觉枝下高，
 *  确保每棵树的树干、层理与单木间隙清晰可辨。 */
function treeDims(t, style) {
  const hOk = t.height_m != null && t.height_m > 0.5;
  const ghost = !hOk || t.height_status !== 'measured' || t.dbh_status !== 'measured';
  const hM = hOk ? t.height_m : 3.0;
  const dbhM = (t.dbh_cm != null && t.dbh_cm > 0) ? t.dbh_cm / 100 : 0.08;
  const minVisualR = Math.min(1.20, Math.max(0.50, hM * 0.095));
  const fallbackR = Math.min(1.50, Math.max(hM * (style.fb || 0.16) * 0.72, minVisualR));
  const hasCrown = t.crown_status === 'measured' && t.crown_ns_m != null && t.crown_ew_m != null;
  // 群落视图冠幅防交叠软约束（小冠保持协调饱满，超大冠上限 1.55m 留出树间透光林隙）
  const crownRx = hasCrown ? Math.min(1.55, Math.max((t.crown_ew_m / 2) * 0.72, minVisualR)) : fallbackR;
  const crownRz = hasCrown ? Math.min(1.55, Math.max((t.crown_ns_m / 2) * 0.72, minVisualR)) : fallbackR;
  const crownR = (crownRx + crownRz) / 2;
  const baseCbRatio = style.cbRatio ?? (style.kind === 'conifer' ? 0.24 : 0.40);
  const standCbRatio = style.kind === 'conifer' ? Math.max(baseCbRatio, 0.34) : Math.max(baseCbRatio, 0.42);
  const cb = Math.min(Math.max(hM * standCbRatio, 0.7), hM * 0.70);
  const trunkH = style.kind === 'conifer' ? hM * 0.90 : hM * 0.76;
  return { hM, trunkH, cb, rB: dbhM / 2, crownR, crownRx, crownRz, cLen: Math.max(hM - cb, 0.25), ghost };
}

/** 从树坐标推导样地边界：标准样地（树坐标 ≤30m）直接取 30m（与后端
 *  PLOT_EXTENT_M 同源）；更大样地按 5m 网格向上取整。科研层/视角/面积共用。 */
function deriveExtent(trees) {
  let maxXY = 0;
  for (const t of trees) maxXY = Math.max(maxXY, t.x ?? 0, t.y ?? 0);
  if (maxXY <= 30) return 30;
  return Math.min(120, Math.ceil(maxXY / 5) * 5);
}

// ============================================================ 主视图场景（轻量森林）

class ForestScene {
  constructor(container, year, handlers = {}) {
    this.container = container;
    this.year = year;
    this.handlers = handlers;
    this.extent = 30;                          // 样地边界（buildLightweight 按数据推导更新）
    this._pair = [year, year];                 // 样地调查期年份对（buildLightweight 更新）
    this._otherYear = year;
    this._growthT = 0;
    this.heroNodes = new Map();       // tag -> {group, data}
    this.selRings = new Map();        // tag -> 选择高亮环
    this.selected = new Set();
    this.ghostStrategy = 'transparent';   // transparent | hidden | light
    this.labelTags = new Set();
    this._labelEls = new Map();
    // 每场景独立标签层：双期模式下两画布各自投影，坐标即容器本地坐标
    this._labelLayer = document.createElement('div');
    this._labelLayer.className = 'label-layer';
    this.container.appendChild(this._labelLayer);
    this.focusRing = null;
    this._lv = new THREE.Vector3();
    this._initRenderer();
    this._initScene();
    this._initControls();
    this._bindEvents();
    this._resize();
    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  _initRenderer() {
    // preserveDrawingBuffer：截图 toDataURL 需要保留绘制缓冲（后台标签页也可靠）
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.10;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa6c1dc);
    this.scene.fog = new THREE.Fog(0xc6cbbd, 135, 560);

    // 自然大气天穹着色器（天顶蓝→地平线暖雾→地面散射 + 太阳方向柔光）
    const skyGeo = new THREE.SphereGeometry(720, 28, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x769ec8) },
        horizonColor: { value: new THREE.Color(0xdbe0cf) },
        groundColor: { value: new THREE.Color(0x7c8c70) },
        sunDir: { value: new THREE.Vector3(50, 46, 20).normalize() },
      },
      vertexShader: [
        'varying vec3 vWorldDir;',
        'void main() {',
        '  vWorldDir = normalize(position);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vWorldDir;',
        'uniform vec3 topColor;',
        'uniform vec3 horizonColor;',
        'uniform vec3 groundColor;',
        'uniform vec3 sunDir;',
        'void main() {',
        '  float h = vWorldDir.y;',
        '  vec3 col = h >= 0.0',
        '    ? mix(horizonColor, topColor, smoothstep(0.0, 0.52, h))',
        '    : mix(horizonColor, groundColor, smoothstep(0.0, 0.25, -h));',
        '  float sunAmt = max(dot(normalize(vWorldDir), sunDir), 0.0);',
        '  col += vec3(1.0, 0.94, 0.78) * pow(sunAmt, 24.0) * 0.22;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.userData = { shared: true, noPick: true };
    this.scene.add(skyMesh);

    this.camera = new THREE.PerspectiveCamera(
      50, this.container.clientWidth / this.container.clientHeight, 0.1, 1200);
    this.camera.position.set(62, 40, 62);

    const sun = new THREE.DirectionalLight(0xffe2b4, 2.65);
    sun.position.set(50, 46, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.025;
    sun.target.position.set(15, 0, 15);
    this.scene.add(sun, sun.target);
    this.sun = sun;
    // 林冠散射背光补光（凸显白桦银白树皮背阴面与落叶松轮生枝条立体感）
    const fillLight = new THREE.DirectionalLight(0xb8d4f0, 0.52);
    fillLight.position.set(-38, 28, -32);
    this.scene.add(fillLight);
    this.scene.add(new THREE.HemisphereLight(0xc8dcf0, 0x52583e, 1.0));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      sharedFloorMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(15, 0, 15);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    // 悬停高亮环（鼠标移动经过单木时显示）
    this.hoverRing = new THREE.Mesh(LW_GEO.hoverRing, LW_HOVER_MAT);
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.position.y = 0.04;
    this.hoverRing.visible = false;
    this.hoverRing.userData = { noPick: true, shared: true };
    this.scene.add(this.hoverRing);

    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);

    // 林下草本、蕨类、灌草与苔石示意层（InstancedMesh×4，noPick=true，可独立显隐）
    this.undergrowthGroup = new THREE.Group();
    this.scene.add(this.undergrowthGroup);

    // 科研层：样地边界 + 5m/10m 网格 + 界桩（随数据推导的边界重建）
    this.scienceGroup = new THREE.Group();
    this.scene.add(this.scienceGroup);
    this._buildScienceLayer();
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(this.extent / 2, 5, this.extent / 2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 280;
    this.controls.screenSpacePanning = false; // 原生水平地表平移：按住鼠标右键平移样地顺滑自如
    this.controls.enablePan = true;
    this.controls.panSpeed = 1.0;
  }

  _bindEvents() {
    this._boundResize = () => this._resize();
    window.addEventListener('resize', this._boundResize);
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._downPos = null;
    this._lastHoverCheck = 0;
    const dom = this.renderer.domElement;

    // 禁用默认右键菜单，完全释放给原生样地平移交互
    this._boundContext = (e) => e.preventDefault();
    dom.addEventListener('contextmenu', this._boundContext);

    this._boundDown = (e) => {
      this._activeTouches = (this._activeTouches || 0) + (e.pointerType === 'touch' ? 1 : 0);
      if (this._activeTouches > 1) {
        this._downPos = null;
        return;
      }
      this._downPos = [e.clientX, e.clientY];
    };
    this._boundUp = (e) => {
      if (e.pointerType === 'touch' && this._activeTouches > 0) {
        this._activeTouches = Math.max(0, this._activeTouches - 1);
      }
      if (!this._downPos) return;
      const moved = Math.hypot(e.clientX - this._downPos[0], e.clientY - this._downPos[1]);
      this._downPos = null;
      const maxMove = e.pointerType === 'touch' ? 14 : 6;
      if (moved > maxMove) return;                 // 拖拽相机或平移不算点击
      if (e.button === 0 || e.pointerType === 'touch') { // 鼠标左键或触屏轻点选树
        const hit = this._pick(e);
        if (this.handlers.onPick) this.handlers.onPick(hit);
      }
    };
    this._boundMove = (e) => {
      if (this._downPos || this._roam) return;
      const now = performance.now();
      if (now - this._lastHoverCheck < 45) return;
      this._lastHoverCheck = now;
      const hit = this._pick(e);
      const tip = document.getElementById('hover-tip');
      if (hit && hit.data) {
        dom.style.cursor = 'pointer';
        const d = hit.data;
        if (this.hoverRing) {
          this.hoverRing.position.set(d.x, 0.045, d.y);
          this.hoverRing.visible = true;
        }
        if (tip) {
          const dbhStr = d.dbh_status === 'measured' && d.dbh_cm != null ? `${d.dbh_cm}cm` : '待核实';
          const hStr = d.height_status === 'measured' && d.height_m != null ? `${d.height_m}m` : '待核实';
          tip.innerHTML = `<b>#${d.tag}</b> ${d.species || ''} · 编号 ${d.seq_no ?? '—'}<br><span style="opacity:0.85">胸径 ${dbhStr} ｜ 树高 ${hStr}</span>`;
          tip.style.display = 'block';
          tip.style.left = Math.min(window.innerWidth - 210, e.clientX + 14) + 'px';
          tip.style.top = Math.min(window.innerHeight - 60, e.clientY + 12) + 'px';
        }
      } else {
        dom.style.cursor = '';
        if (this.hoverRing) this.hoverRing.visible = false;
        if (tip) tip.style.display = 'none';
      }
    };
    this._boundLeave = () => {
      dom.style.cursor = '';
      if (this.hoverRing) this.hoverRing.visible = false;
      const tip = document.getElementById('hover-tip');
      if (tip) tip.style.display = 'none';
    };
    dom.addEventListener('pointerdown', this._boundDown);
    dom.addEventListener('pointerup', this._boundUp);
    dom.addEventListener('pointermove', this._boundMove);
    dom.addEventListener('pointerleave', this._boundLeave);
  }

  _pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObjects([this.treeGroup], true);
    for (const h of hits) {
      let o = h.object;
      while (o && o !== this.treeGroup) {
        if (o.userData?.noPick) break;             // 选择高亮环不参与拾取
        if (o.userData?.tag) return { tag: o.userData.tag, data: o.userData.data };
        o = o.parent;
      }
    }
    return null;
  }

  /** 轻量程序化森林：共享资产池 + 逐树参数缩放（秒开，零 GLB，重建零 GPU 分配）。
   *  otherTrees：另一期记录（同牌号），供生长插值取两期参数。 */
  buildLightweight(trees, otherTrees = null, yearsPair = null) {
    this.clearTrees();
    const rng = mulberry32(42 + this.year);
    this.extent = deriveExtent(trees);
    this._buildScienceLayer();

    // 样地调查期年份对（任意年份）及全期序列（支持 2 期 / 3 期 / N 期分段连续插值）
    this._pair = (Array.isArray(yearsPair) && yearsPair.length === 2)
      ? yearsPair.slice().sort((a, b) => a - b) : [this.year, this.year];
    this._allYears = (Array.isArray(state.years) && state.years.length >= 2)
      ? state.years.slice().sort((a, b) => a - b)
      : this._pair.slice();
    const otherYear = this._pair[0] === this.year ? this._pair[1] : this._pair[0];
    this._otherYear = otherYear;
    // 跨期配对仅取身份准入门后的可信集合（compare.trees 由后端 comparisons() 生成）：
    const trustedTags = new Set((state.compare?.trees ?? []).map((c) => c.tag));
    const otherByTag = new Map((otherTrees ?? [])
      .filter((t) => trustedTags.has(t.tag))
      .map((t) => [t.tag, t]));
    // 构建全期按年份索引表，供 3 期及以上样地连续演替插值
    const allYearByTag = new Map();
    for (const y of this._allYears) {
      const yTrees = state.scenes?.[y]?.trees || [];
      const m = new Map();
      for (const yt of yTrees) {
        if (trustedTags.has(yt.tag)) m.set(yt.tag, yt);
      }
      allYearByTag.set(y, m);
    }

    for (const t of trees) {
      const style = lwSpecies(t.species);
      const mats = lwMats(t.species);
      const dim = treeDims(t, style);
      const dimOther = otherByTag.has(t.tag)
        ? treeDims(otherByTag.get(t.tag), style) : null;

      const shade = Math.floor(rng() * LW_SHADES);      // 确定性自然色变（6 档）
      const tree = new THREE.Group();
      tree.position.set(t.x, 0, t.y);
      tree.rotation.y = (t.seq_no * 2.399963) % (Math.PI * 2);
      // 阔叶树确定性微倾（自然感；不改变树位）
      if (style.kind === 'broadleaf') {
        tree.rotation.z = (((t.seq_no * 40503) % 997) / 997 - 0.5) * 0.06;
      }
      tree.userData = { tag: t.tag, data: t };

      // 1) 全高通直微弯主干（children[0]：scale.x === dim.rB 严格保持科研胸径契约）
      const trunk = new THREE.Mesh(LW_GEO.trunk,
        dim.ghost ? mats.ghostFull.trunk : mats.trunkSolid[shade]);
      trunk.userData = { part: 'trunk', shared: true };
      trunk.scale.set(dim.rB, dim.trunkH, dim.rB);
      trunk.position.y = 0;
      trunk.castShadow = !dim.ghost;
      trunk.receiveShadow = !dim.ghost;
      tree.add(trunk);

      // 2) 3D 轮生/分叉枝条骨架（children[1]）+ 3) 立体曲率植物学叶簇云（children[2]）
      const crownOff = !(dim.cLen > 0.15);
      const j = 1 + ((((t.seq_no + 1) * 2654435761) % 997) / 997 - 0.5) * 0.12;
      const sx = Math.max((dim.crownRx ?? dim.crownR) * j, 0.15);
      const sz = Math.max((dim.crownRz ?? dim.crownR) * j, 0.15);
      const sy = Math.max(dim.cLen, 0.15);
      const variant = getArchetypeCrownGeos(style.archetype, t.seq_no, state.crownStyle || 'layered');

      const branchMesh = new THREE.Mesh(
        variant.branchGeo,
        dim.ghost ? mats.ghostFull.trunk : (mats.branchSolid || mats.trunkSolid)[shade]
      );
      branchMesh.userData = { part: 'branch', shared: true, crownOff };
      branchMesh.position.set(0, dim.cb, 0);
      branchMesh.scale.set(sx, sy, sz);
      branchMesh.visible = !crownOff;
      branchMesh.castShadow = !dim.ghost && !crownOff;
      tree.add(branchMesh);

      const foliageMesh = new THREE.Mesh(
        variant.foliageGeo,
        dim.ghost ? mats.ghostFull.crown : mats.crownSolid[shade]
      );
      foliageMesh.userData = { part: 'crown', shared: true, crownOff };
      foliageMesh.position.set(0, dim.cb, 0);
      foliageMesh.scale.set(sx, sy, sz);
      foliageMesh.visible = !crownOff;
      foliageMesh.castShadow = !dim.ghost && !crownOff;
      foliageMesh.receiveShadow = !dim.ghost && !crownOff;
      tree.add(foliageMesh);

      const dimsBy = { [this.year]: dim, [otherYear]: dimOther };
      for (const [y, mapY] of allYearByTag.entries()) {
        if (dimsBy[y]) continue;
        const ty = mapY.get(t.tag);
        if (ty) dimsBy[y] = treeDims(ty, style);
      }
      this.treeGroup.add(tree);
      this.heroNodes.set(t.tag, {
        group: tree, data: t, baseGhost: dim.ghost, shade, mats,
        currentH: dim.hM,
        dimsBy,
      });
    }
    this._growthT = this.year === this._pair[1] ? 1 : 0;
    this._rebuildUndergrowth(trees);

    // 载入用户自主标注的实况状态（采伐伐桩、倒木、枯立、断梢）并在三维场景中实时变形呈现
    const savedAnn = getPlotAnnotations();
    for (const [tg, ann] of Object.entries(savedAnn)) {
      if (this.heroNodes.has(tg)) {
        this.applyTreeStatus(tg, ann.status, ann.note);
      }
    }
    // 自动识别本期调查记录中胸径为0或采伐状态的记录并呈现伐桩
    for (const t of trees) {
      if (!savedAnn[t.tag] && (t.dbh_status === 'zero' || (t.tree_status && (t.tree_status.includes('伐') || t.tree_status.includes('桩'))))) {
        this.applyTreeStatus(t.tag, 'felled', '调查记录标记为0值/采伐，自动呈现伐桩与年轮');
      }
    }
  }

  _rebuildUndergrowth(trees) {
    if (!this.undergrowthGroup) return;
    this.undergrowthGroup.clear();
    const ug = buildUndergrowthGroup(trees, this.extent, state.season || 'summer');
    this.undergrowthGroup.add(ug);
    this.undergrowthGroup.visible = state.undergrowthOn !== false && !state.immersive;
  }

  clearTrees() {
    for (const [, ring] of this.selRings) { this.treeGroup.remove(ring); this._disposeObject(ring); }
    this.selRings.clear();
    // 几何/材质来自共享资产池（userData.shared），不随重建释放
    this.treeGroup.traverse((o) => { if (!o.userData?.shared) this._disposeObject(o); });
    this.scene.remove(this.treeGroup);
    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);
    this.heroNodes.clear();
    this.selected.clear();
    this.focusRing = null;
    this.labelTags.clear();
    for (const [, el] of this._labelEls) el.remove();
    this._labelEls.clear();
  }

  _disposeObject(root) {
    if (root.userData?.shared) return;
    root.traverse((o) => {
      if (o.userData?.shared) return;
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
  }

  /** 单树材质切换：在共享材质池中换引用（不逐树改材质，池化安全）。 */
  _setGhost(node, ghost) {
    node.group.traverse((o) => {
      if (!o.isMesh) return;
      o.visible = !o.userData.crownOff;    // 复位策略C隐藏的冠层，保留缺冠树
      o.castShadow = ghost ? false : (!node.baseGhost && !o.userData.crownOff);
      const part = o.userData.part;
      const matSlot = part === 'crown' ? 'crown' : 'trunk';
      if (ghost) o.material = node.mats.ghostFocus[matSlot];
      else if (node.baseGhost) o.material = node.mats.ghostFull[matSlot];
      else if (part === 'branch') {
        o.material = (node.mats.branchSolid || node.mats.trunkSolid)[node.shade];
      } else {
        o.material = (part === 'trunk'
          ? node.mats.trunkSolid : node.mats.crownSolid)[node.shade];
      }
    });
  }

  /** 策略C：非聚焦树仅保留半透明树干位置参照（低成本）。 */
  _setLight(node) {
    node.group.traverse((o) => {
      if (!o.isMesh) return;
      const isTrunk = o.userData.part === 'trunk';
      o.visible = isTrunk;
      o.castShadow = false;
      if (isTrunk) o.material = node.mats.lightTrunk;
    });
  }

  /** 把一组渲染参数写到单树网格（构建与生长插值共用同一比例）。 */
  _applyDims(node, dim, style) {
    void style;
    node.currentH = dim.hM;
    const g = node.group;
    const trunk = g.children[0];
    const trunkH = dim.trunkH ?? (dim.hM * 0.88);
    trunk.scale.set(dim.rB, trunkH, dim.rB);
    trunk.position.y = 0;
    const crownOff = !(dim.cLen > 0.15);
    const j = 1 + ((((node.data.seq_no + 1) * 2654435761) % 997) / 997 - 0.5) * 0.12;
    const sx = Math.max((dim.crownRx ?? dim.crownR) * j, 0.15);
    const sz = Math.max((dim.crownRz ?? dim.crownR) * j, 0.15);
    const sy = Math.max(dim.cLen, 0.15);
    for (let i = 1; i < g.children.length; i++) {
      const m = g.children[i];
      if (!m) continue;
      m.position.set(0, dim.cb, 0);
      m.scale.set(sx, sy, sz);
      m.userData.crownOff = crownOff;
    }
  }

  /**
   * 应用单木现场实况自主标注状态（采伐伐桩/风倒木/枯立木/断梢/正常），并在 3D 视角中实时重构三维实体与状态圆环。
   */
  applyTreeStatus(tag, status = 'living', note = '') {
    const node = this.heroNodes.get(tag);
    if (!node) return;
    node.data.custom_status = status;
    node.data.custom_note = note;

    if (node.specialMesh) {
      node.group.remove(node.specialMesh);
      node.specialMesh = null;
    }
    if (node.stumpRing) {
      node.group.remove(node.stumpRing);
      node.stumpRing = null;
    }
    if (node.statusBadge) {
      node.group.remove(node.statusBadge);
      node.statusBadge = null;
    }

    const g = node.group;
    const trunk = g.children[0];
    const branch = g.children[1];
    const crown = g.children[2];
    const rB = trunk ? trunk.scale.x : (node.data.dbh_cm ? node.data.dbh_cm / 200 : 0.12);
    const origH = node.data.height_m || 12;

    const makeRing = (colHex, radius, label) => {
      const ringGroup = new THREE.Group();
      ringGroup.name = 'status_ring_group';
      // 1) 主色圆环（加宽至 0.45m，高对比度双面可见）
      const ringMat = new THREE.MeshBasicMaterial({ color: colHex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
      const ringGeo = new THREE.RingGeometry(radius, radius + 0.42, 32);
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.translate(0, 0.05, 0);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ringGroup.add(ring);

      // 2) 外圈深色轮廓警戒环（增强林地背景辨识度）
      const outMat = new THREE.MeshBasicMaterial({ color: 0x1a2b1e, side: THREE.DoubleSide });
      const outGeo = new THREE.RingGeometry(radius + 0.42, radius + 0.48, 32);
      outGeo.rotateX(-Math.PI / 2);
      outGeo.translate(0, 0.052, 0);
      ringGroup.add(new THREE.Mesh(outGeo, outMat));

      ringGroup.userData = { noPick: true, isStumpRing: true, label };
      return ringGroup;
    };

    const makeFloatingBadge = (text, colHex, yPos) => {
      const c = document.createElement('canvas');
      c.width = 384; c.height = 96;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(20, 42, 28, 0.95)';
      ctx.strokeStyle = colHex;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(6, 6, 372, 84, 14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff6de';
      ctx.font = 'bold 28px "Microsoft YaHei"';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 192, 48);
      const tex = new THREE.CanvasTexture(c);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      spr.scale.set(4.2, 1.05, 1);
      spr.position.set(0, yPos, 0);
      spr.userData = { noPick: true };
      return spr;
    };

    if (status === 'felled') {
      // 1) 采伐木：隐藏高树干与枝叶，原位展现 0.36m 年轮木心伐桩与醒目树桩圆环及悬浮标签
      if (trunk) trunk.visible = false;
      if (branch) branch.visible = false;
      if (crown) crown.visible = false;
      const stump = buildTreeStumpMesh(rB, (node.mats.branchSolid || node.mats.trunkSolid)[node.shade]);
      stump.userData = { noPick: true };
      node.specialMesh = stump;
      g.add(stump);
      const ring = makeRing(0xffb531, rB + 0.12, `🪓 采伐伐桩 #${tag}`);
      node.stumpRing = ring;
      g.add(ring);
      const badge = makeFloatingBadge(`🪓 #${tag} 采伐木 (伐桩)`, '#ffb531', 1.05);
      node.statusBadge = badge;
      g.add(badge);
      node.currentH = 0.38;
    } else if (status === 'fallen') {
      // 2) 风倒/雪倒木：残桩 + 地面卧倒树干与橙色倒木圆环及悬浮标签
      if (trunk) trunk.visible = false;
      if (branch) branch.visible = false;
      if (crown) crown.visible = false;
      const fallen = buildFallenTrunkGroup(rB, origH, (node.mats.branchSolid || node.mats.trunkSolid)[node.shade]);
      fallen.userData = { noPick: true };
      node.specialMesh = fallen;
      g.add(fallen);
      const ring = makeRing(0xe67e22, rB + 0.16, `🌪 风倒倒木 #${tag}`);
      node.stumpRing = ring;
      g.add(ring);
      const badge = makeFloatingBadge(`🌪 #${tag} 风倒木 (卧干)`, '#e67e22', Math.max(1.2, rB * 2.5));
      node.statusBadge = badge;
      g.add(badge);
      node.currentH = rB * 2.2;
    } else if (status === 'snag') {
      // 3) 枯立木：光秃灰褐树干，枝叶脱落，灰白圆环
      if (trunk) { trunk.visible = true; trunk.material = node.mats.ghostFull.trunk; }
      if (branch) { branch.visible = true; branch.material = node.mats.ghostFull.trunk; }
      if (crown) crown.visible = false;
      const ring = makeRing(0x95a5a6, rB + 0.14, `🍂 枯立木 #${tag}`);
      node.stumpRing = ring;
      g.add(ring);
      const badge = makeFloatingBadge(`🍂 #${tag} 枯立木`, '#95a5a6', origH * 0.55);
      node.statusBadge = badge;
      g.add(badge);
      node.currentH = origH;
    } else if (status === 'broken') {
      // 4) 断梢木：截断在 3.8m
      if (trunk) { trunk.visible = true; trunk.scale.y = Math.min(3.8, origH * 0.4); }
      if (branch) { branch.visible = true; branch.scale.set(branch.scale.x * 0.5, 1.1, branch.scale.z * 0.5); branch.position.y = 2.4; }
      if (crown) { crown.visible = true; crown.scale.set(crown.scale.x * 0.5, 1.1, crown.scale.z * 0.5); crown.position.y = 2.4; }
      const ring = makeRing(0x3498db, rB + 0.14, `⚡ 断梢木 #${tag}`);
      node.stumpRing = ring;
      g.add(ring);
      const badge = makeFloatingBadge(`⚡ #${tag} 断梢折干`, '#3498db', 4.5);
      node.statusBadge = badge;
      g.add(badge);
      node.currentH = 3.8;
    } else {
      // 5) 活立木：恢复正常实测全树形态
      if (trunk) {
        trunk.visible = true;
        trunk.scale.y = node.dimsBy[this.year]?.trunkH || (origH * 0.88);
        trunk.material = node.baseGhost ? node.mats.ghostFull.trunk : node.mats.trunkSolid[node.shade];
      }
      if (branch) {
        branch.visible = !branch.userData.crownOff;
        branch.material = node.baseGhost ? node.mats.ghostFull.trunk : (node.mats.branchSolid || node.mats.trunkSolid)[node.shade];
      }
      if (crown) {
        crown.visible = !crown.userData.crownOff;
        crown.material = node.baseGhost ? node.mats.ghostFull.crown : node.mats.crownSolid[node.shade];
      }
      node.currentH = origH;
    }
    this.updateLabels();
  }

  /**
   * 生长插值（示意）：t=0 → 首期参数，t=1 → 末期参数，中间为
   * 两期实测参数的线性插值（非实测调查期）。ghost 按绝对年份取对应期
   * 准入状态（t<0.5→首期，t≥0.5→末期，与画布年份无关，R4-04）；
   * 仅身份可信配对参与插值，单期/未准入记录保持当年原样。
   */
  applyGrowth(t) {
    this._growthT = t;
    const ys = (this._allYears && this._allYears.length >= 2) ? this._allYears : this._pair;
    const segs = Math.max(1, ys.length - 1);
    const clamped = Math.max(0, Math.min(1, t));
    const scaled = clamped * segs;
    const idx = Math.min(segs - 1, Math.floor(scaled));
    const localT = (clamped >= 1) ? 1 : (scaled - idx);
    const y0 = ys[idx], y1 = ys[idx + 1] ?? ys[idx];
    const flagYear = localT < 0.5 ? y0 : y1;
    for (const [, node] of this.heroNodes) {
      const da = node.dimsBy[y0] || node.dimsBy[this._pair[0]];
      const db = node.dimsBy[y1] || node.dimsBy[this._pair[1]] || da;
      if (!da || !db) continue;
      const style = lwSpecies(node.data.species);
      const L = (k) => da[k] + (db[k] - da[k]) * localT;
      node.baseGhost = flagYear === y0 ? da.ghost : db.ghost;
      this._applyDims(node, {
        hM: L('hM'), trunkH: L('trunkH'), cb: L('cb'), rB: L('rB'),
        crownR: L('crownR'), crownRx: L('crownRx'), crownRz: L('crownRz'), cLen: L('cLen'),
      }, style);
    }
    this.applyDisplayMode(this._lastMode || 'full', this._lastFocus);
  }

  /**
   * 显示范围（含三策略）：full 全实体 / single 仅 focusTag 实体 /
   * multi 仅所选实体。非实体的呈现由 ghostStrategy 决定：
   * transparent=半透明整树（默认） / hidden=隐藏 / light=仅树干参照。
   * 未选树时等价全显。
   */
  applyDisplayMode(mode, focusTag = null) {
    this._lastMode = mode;             // 供 setGhostStrategy 等按当前状态重放
    this._lastFocus = focusTag;
    let keep = null;
    if (mode === 'single') keep = new Set([focusTag].filter(Boolean));
    else if (mode === 'multi') keep = new Set(this.selected);
    if (mode === 'multi' && keep.size === 0) mode = 'full';
    if (mode === 'single' && keep.size === 0) mode = 'full';
    for (const [tag, node] of this.heroNodes) {
      const solid = mode === 'full' || (keep && keep.has(tag));
      if (solid) {
        node.group.visible = true;
        this._setGhost(node, false);
      } else if (this.ghostStrategy === 'hidden') {
        node.group.visible = false;
      } else if (this.ghostStrategy === 'light') {
        node.group.visible = true;
        this._setLight(node);
      } else {
        node.group.visible = true;
        this._setGhost(node, true);
      }
    }
    for (const [, ring] of this.selRings) {
      ring.visible = true;
    }
    // 单树查看：聚焦树定位环
    if (mode === 'single' && focusTag && this.heroNodes.has(focusTag)) {
      if (!this.focusRing || !this.focusRing.parent) {
        this.focusRing = this._makeRing();
        this.treeGroup.add(this.focusRing);
      }
      const nd = this.heroNodes.get(focusTag);
      this.focusRing.position.set(nd.data.x, 0.06, nd.data.y);
      this.focusRing.visible = true;
    } else if (this.focusRing) {
      this.focusRing.visible = false;
    }
    // 树号标签
    this.labelTags = mode === 'single' && focusTag ? new Set([focusTag])
      : mode === 'multi' ? new Set([...keep].slice(0, 12))
      : new Set();
    this.updateLabels();   // 同步建/删标签DOM（rAF节流时集合也立即正确，位置由动画帧校正）
  }

  _makeRing() {
    const ring = new THREE.Mesh(LW_GEO.ring, LW_RING_MAT);
    ring.rotation.x = -Math.PI / 2;
    ring.userData = { noPick: true, shared: true };
    return ring;
  }

  /** 每帧把树号标签投影到屏幕（HTML覆盖层，不被树叶遮挡、无闪烁）。 */
  updateLabels() {
    if (!this._labelLayer) return;
    const rect = this.container.getBoundingClientRect();
    for (const [tag, el] of this._labelEls) {
      if (!this.labelTags.has(tag) || !this.heroNodes.has(tag)) {
        el.remove();
        this._labelEls.delete(tag);
      }
    }
    for (const tag of this.labelTags) {
      if (this._labelEls.has(tag)) continue;
      const el = document.createElement('div');
      el.className = 'tree-label';
      el.textContent = tag;
      this._labelLayer.appendChild(el);
      this._labelEls.set(tag, el);
    }
    for (const [tag, el] of this._labelEls) {
      const node = this.heroNodes.get(tag);
      if (!node) continue;
      // 使用当前实际渲染高度（含生长滑块/动画插值后的实时高度），避免标签悬空脱节
      const h = (node.currentH ?? node.data.height_m ?? 3) + 0.65;
      this._lv.set(node.data.x, h, node.data.y).project(this.camera);
      const v = this._lv;
      if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) {
        el.style.display = 'none';
        continue;
      }
      const topPx = (1 - v.y) / 2 * rect.height;
      const hudTop = hudTopPx();   // 避让顶栏（折行时随 --hud-top 增高）/底部提示条
      if (topPx < hudTop || topPx > rect.height - 80) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.left = ((v.x + 1) / 2 * rect.width) + 'px';
      el.style.top = topPx + 'px';
    }
  }

  toggleSelect(tag) {
    if (this.selected.has(tag)) {
      this.selected.delete(tag);
      const ring = this.selRings.get(tag);
      if (ring) { this.treeGroup.remove(ring); this._disposeObject(ring); this.selRings.delete(tag); }
    } else {
      this.selected.add(tag);
      const node = this.heroNodes.get(tag);
      if (node && !this.selRings.has(tag)) {
        const ring = this._makeRing();
        ring.position.set(node.data.x, 0.06, node.data.y);
        ring.userData.tag = tag;
        this.treeGroup.add(ring);
        this.selRings.set(tag, ring);
      }
    }
  }

  clearSelection() {
    for (const [, ring] of this.selRings) { this.treeGroup.remove(ring); this._disposeObject(ring); }
    this.selRings.clear();
    this.selected.clear();
  }

  focusOn(tags, distance = 14, lateralPx = 0) {
    const targets = [];
    for (const [tag, node] of this.heroNodes) {
      if (node.group.visible && (!tags || tags.includes(tag))) targets.push(node);
    }
    if (!targets.length) return;
    const box = new THREE.Box3();
    for (const n of targets) {
      n.group.updateMatrixWorld(true);
      box.expandByObject(n.group);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(distance, size.y * 2.0);   // 保证整棵树入画
    const toPos = center.clone().add(new THREE.Vector3(1, 0.55, 1).normalize().multiplyScalar(dist));
    const toTarget = center.clone();
    if (lateralPx > 0) {
      // 沿相机右方向平移视点，使聚焦树在画面中左移（给右侧详情卡让位）
      const dir = new THREE.Vector3().subVectors(toTarget, toPos).normalize();
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
        * this.camera.aspect);
      const visW = 2 * dist * Math.tan(hFov / 2);
      const shift = lateralPx * visW / (this.container.clientWidth || 1);
      toPos.addScaledVector(right, shift);
      toTarget.addScaledVector(right, shift);
    }
    this.tweenCamera(toPos, toTarget, 900);
  }

  tweenCamera(toPos, toTarget, duration = 900) {
    // 时间基 tween：由 _animate 每帧推进（rAF 节流恢复后按绝对时间立即到位）；
    // 页面不可见时直接跳到终点，保证定位始终生效。
    if (document.hidden) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      this.controls.update();
      return;
    }
    this._tween = {
      fp: this.camera.position.clone(),
      ft: this.controls.target.clone(),
      tp: toPos.clone(),
      tt: toTarget.clone(),
      start: performance.now(),
      dur: duration,
    };
  }

  // 视角预设随推导边界取中心（若处于漫游模式则自动退出漫游并丝滑飞向目标视角）
  viewBird() {
    if (this._roam) this.exitRoam();
    const c = this.extent / 2;
    this.tweenCamera(new THREE.Vector3(c + 47, 40, c + 47), new THREE.Vector3(c, 5, c));
  }
  viewTop() {
    if (this._roam) this.exitRoam();
    const c = this.extent / 2;
    this.tweenCamera(new THREE.Vector3(c, 95, c + 0.01), new THREE.Vector3(c, 0, c));
  }
  viewInside() {
    if (this._roam) this.exitRoam();
    const c = this.extent / 2;
    this.tweenCamera(new THREE.Vector3(3.5, 1.7, 3.5), new THREE.Vector3(c + 7, 10, c + 5));
  }
  viewReset()  { this.viewBird(); }

  // ------------------------------------------------ 漫游（以小人为中心的 360° 自由环绕观察 + 第一人称平视 + 自由升降飞行）

  /**
   * 进入漫游：不锁定鼠标指针（无准星束缚），鼠标全程自由可点选树木或顶栏按钮；
   * 按住鼠标左/右键拖拽即可围绕小人进行 360° 全方位球面环绕观察，滚轮自由缩放（拉到最近自动切入第一人称）。
   */
  enterRoam(opts = {}) {
    if (this._roam) {
      if (opts.x != null && opts.z != null) {
        this._roam.pos.set(opts.x, opts.y ?? 0, opts.z);
        if (opts.yaw != null) {
          this._roam.yaw = opts.yaw;
          this._roam.bodyYaw = opts.yaw;
        }
      }
      return false;
    }
    const dom = this.renderer.domElement;
    const hInit = state.roamHeightM || 1.72;
    if (!this._avatar && typeof buildSurveyorAvatar === 'function') {
      this._avatar = buildSurveyorAvatar(hInit);
    }
    if (this._avatar) {
      this._avatar.setHeight(hInit);
      this._avatar.root.visible = true;
      this.scene.add(this._avatar.root);
    }
    if (!this._roamMeasureLine) {
      const lGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const lMat = new THREE.LineBasicMaterial({ color: 0xffb531, linewidth: 2 });
      this._roamMeasureLine = new THREE.Line(lGeo, lMat);
      this._roamMeasureLine.userData = { noPick: true };
    }
    this.scene.add(this._roamMeasureLine);

    this._savedFov = this.camera.fov;
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();

    const c = this.extent / 2;
    let startX = this.camera.position.x;
    let startZ = this.camera.position.z;
    let startYaw = 0;
    if (opts.x != null && opts.z != null) {
      startX = opts.x;
      startZ = opts.z;
      startYaw = opts.yaw ?? 0;
    } else if (this._avatar?.root?.visible && this._avatar.root.position.lengthSq() > 0.1) {
      startX = this._avatar.root.position.x;
      startZ = this._avatar.root.position.z;
      startYaw = this._avatar.root.rotation.y || 0;
    } else if (this.camera.position.y > 10 || startX < -2 || startX > this.extent + 2 || startZ < -2 || startZ > this.extent + 2) {
      startX = c;
      startZ = Math.min(this.extent - 2.0, c + 8.5);
      startYaw = 0;
    } else {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      startYaw = Math.atan2(-dir.x, -dir.z);
    }

    this._roam = {
      pos: new THREE.Vector3(startX, opts.y ?? 0, startZ),
      vy: 0,
      yaw: startYaw,
      bodyYaw: startYaw,
      pitch: -0.22,
      flying: state.roamFlying !== false,
      lastSpaceDown: 0,
      viewMode: opts.viewMode || state.roamViewMode || 'tpp_orbit',
      tppDist: 4.5,
      keys: new Set(),
      pointers: new Map(),
      pinchDist: 0,
      dragging: false,
      lastMouseX: 0,
      lastMouseY: 0,
      nearestTag: null,
    };
    this.controls.enabled = false;
    this._syncRoamViewModeUI();
    this._syncRoamFlyUI();

    this._onRoamKeyDown = (e) => {
      if (!this._roam) return;
      if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        if (state.dialogTag) {
          closeTreeDialog();
        } else {
          this.exitRoam();
          hint('已退出小人漫游');
        }
        return;
      }
      if (e.code === 'KeyV' || e.code === 'F5') {
        e.preventDefault();
        this.cycleRoamViewMode();
        return;
      }
      if (e.code === 'F4') {
        e.preventDefault();
        this.toggleRoamFly();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        const now = performance.now();
        if (!e.repeat && now - this._roam.lastSpaceDown < 340) {
          this.toggleRoamFly();
          this._roam.lastSpaceDown = 0;
        } else if (!e.repeat) {
          this._roam.lastSpaceDown = now;
          if (!this._roam.flying && this._roam.pos.y <= 0.05) {
            this._roam.vy = 5.4;
          }
        }
        this._roam.keys.add('Space');
        return;
      }
      if (e.code === 'KeyF' && this._roam.nearestTag) {
        e.preventDefault();
        openTreeDialog(this._roam.nearestTag, this.year);
        return;
      }
      this._roam.keys.add(e.code);
    };
    this._onRoamKeyUp = (e) => this._roam?.keys.delete(e.code);

    this._onRoamPointerDown = (e) => {
      if (!this._roam) return;
      this._roam.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._roam.pointers.size === 2) {
        const pts = [...this._roam.pointers.values()];
        this._roam.pinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this._roam.lastMouseX = (pts[0].x + pts[1].x) * 0.5;
        this._roam.lastMouseY = (pts[0].y + pts[1].y) * 0.5;
        return;
      }
      this._roam.dragging = true;
      this._roam.isPan = (e.button === 2 || e.button === 1);
      this._roam.lastMouseX = e.clientX;
      this._roam.lastMouseY = e.clientY;
      if (this._roam.isPan) {
        dom.style.cursor = 'grabbing'; // 右键拖拽平移样地/小人
      }
    };
    this._onRoamPointerUp = (e) => {
      if (this._roam) {
        this._roam.pointers.delete(e.pointerId);
        if (this._roam.pointers.size < 2) this._roam.pinchDist = 0;
        if (this._roam.pointers.size === 1) {
          const rem = [...this._roam.pointers.values()][0];
          this._roam.lastMouseX = rem.x;
          this._roam.lastMouseY = rem.y;
        } else if (this._roam.pointers.size === 0) {
          this._roam.dragging = false;
          this._roam.isPan = false;
          dom.style.cursor = '';
        }
      }
    };
    this._onRoamPointerMove = (e) => {
      if (!this._roam || !this._roam.dragging) return;
      if (this._roam.pointers.has(e.pointerId)) {
        this._roam.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      // 手机端双指触控：双指捏合缩放视距 + 双指平移小人位置
      if (this._roam.pointers.size === 2) {
        const pts = [...this._roam.pointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const mx = (pts[0].x + pts[1].x) * 0.5;
        const my = (pts[0].y + pts[1].y) * 0.5;
        if (this._roam.pinchDist > 10) {
          const deltaD = (this._roam.pinchDist - dist) * 0.025;
          this._roam.tppDist = Math.max(0.6, Math.min(18.0, this._roam.tppDist + deltaD));
          this._roam.viewMode = this._roam.tppDist <= 0.85 ? 'fpp' : 'tpp_orbit';
          this._syncRoamViewModeUI();
        }
        this._roam.pinchDist = dist;
        const dx = mx - this._roam.lastMouseX;
        const dy = my - this._roam.lastMouseY;
        this._roam.lastMouseX = mx;
        this._roam.lastMouseY = my;
        const fwd = new THREE.Vector3(-Math.sin(this._roam.yaw), 0, -Math.cos(this._roam.yaw));
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const panFactor = Math.max(0.016, this._roam.tppDist * 0.0042);
        this._roam.pos.addScaledVector(right, -dx * panFactor);
        this._roam.pos.addScaledVector(fwd, dy * panFactor);
        const lim = this.extent + 14;
        this._roam.pos.x = Math.max(-lim, Math.min(lim, this._roam.pos.x));
        this._roam.pos.z = Math.max(-lim, Math.min(lim, this._roam.pos.z));
        return;
      }
      const dx = e.clientX - this._roam.lastMouseX;
      const dy = e.clientY - this._roam.lastMouseY;
      this._roam.lastMouseX = e.clientX;
      this._roam.lastMouseY = e.clientY;
      if (this._roam.isPan) {
        dom.style.cursor = 'grabbing';
        const fwd = new THREE.Vector3(-Math.sin(this._roam.yaw), 0, -Math.cos(this._roam.yaw));
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const panFactor = Math.max(0.016, this._roam.tppDist * 0.0042);
        this._roam.pos.addScaledVector(right, -dx * panFactor);
        this._roam.pos.addScaledVector(fwd, dy * panFactor);
        const lim = this.extent + 14;
        this._roam.pos.x = Math.max(-lim, Math.min(lim, this._roam.pos.x));
        this._roam.pos.z = Math.max(-lim, Math.min(lim, this._roam.pos.z));
      } else {
        this._roam.yaw -= dx * 0.0065;
        this._roam.pitch = Math.max(-1.42, Math.min(1.38, this._roam.pitch - dy * 0.0060));
      }
    };
    this._onRoamContext = (e) => {
      if (this._roam) e.preventDefault();
    };
    this._onRoamWheel = (e) => {
      if (!this._roam) return;
      if (this._roam.viewMode === 'fpp') {
        if (e.deltaY > 0) {
          this._roam.viewMode = 'tpp_orbit';
          this._roam.tppDist = 2.4;
          this._syncRoamViewModeUI();
        }
        return;
      }
      this._roam.tppDist = Math.max(0.6, Math.min(18.0, this._roam.tppDist + (e.deltaY > 0 ? 0.55 : -0.55)));
      if (this._roam.tppDist <= 0.85) {
        this._roam.viewMode = 'fpp';
        this._syncRoamViewModeUI();
      }
    };

    window.addEventListener('keydown', this._onRoamKeyDown);
    window.addEventListener('keyup', this._onRoamKeyUp);
    dom.addEventListener('pointerdown', this._onRoamPointerDown);
    window.addEventListener('pointerup', this._onRoamPointerUp);
    window.addEventListener('pointermove', this._onRoamPointerMove);
    dom.addEventListener('contextmenu', this._onRoamContext);
    dom.addEventListener('wheel', this._onRoamWheel, { passive: true });
    document.getElementById('roam-hud')?.classList.add('open');
    const gb = document.getElementById('growth-bar');
    if (gb) gb.style.display = 'none'; // 漫游开启时自动让位隐藏演替滑块，避免与漫游台重叠
    this._updateRoam(16);
    return true;
  }

  toggleRoamFly(forceVal = null) {
    if (!this._roam) return;
    this._roam.flying = forceVal !== null ? !!forceVal : !this._roam.flying;
    state.roamFlying = this._roam.flying;
    this._roam.vy = 0;
    this._syncRoamFlyUI();
    hint(this._roam.flying
      ? '🕊 已开启自由升降飞行：按住 Space/E 升空观察树冠，按住 C/Q 下降，松手悬停'
      : '🚶 已切换为地面重力步行（按 Space 跳跃，双击 Space 重新开启自由升降）');
  }

  _syncRoamFlyUI() {
    const fb = document.getElementById('roam-fly-btn');
    if (!fb || !this._roam) return;
    fb.classList.toggle('active', this._roam.flying);
    fb.textContent = this._roam.flying ? '🕊 自由升降: 开' : '🚶 地面步行';
  }

  cycleRoamViewMode() {
    if (!this._roam) return;
    this._roam.viewMode = this._roam.viewMode === 'fpp' ? 'tpp_orbit' : 'fpp';
    if (this._roam.viewMode === 'tpp_orbit' && this._roam.tppDist < 2.0) {
      this._roam.tppDist = 4.2;
    }
    state.roamViewMode = this._roam.viewMode;
    this._syncRoamViewModeUI();
  }

  _syncRoamViewModeUI() {
    if (!this._roam) return;
    const isFpp = this._roam.viewMode === 'fpp';
    this._avatar?.setFirstPerson(isFpp);
    const vb = document.getElementById('roam-view-btn');
    if (vb) {
      vb.textContent = isFpp ? '👁 第一人称平视 (V)' : '🧍 第三人称 360° 环绕 (V)';
    }
  }

  setRoamAvatarHeight(hMeters) {
    const h = Math.max(1.20, Math.min(2.20, Number(hMeters) || 1.72));
    state.roamHeightM = h;
    if (this._avatar) this._avatar.setHeight(h);
    const eye = (h * 0.93).toFixed(2);
    const alt = (this._roam?.pos?.y || 0).toFixed(1);
    const lbl = document.getElementById('roam-eye-label');
    if (lbl) lbl.textContent = `眼高 ${eye}m · 离地 ${alt}m`;
    const inp = document.getElementById('roam-height-input');
    if (inp && Number(inp.value) !== h) inp.value = h.toFixed(2);
    const rng = document.getElementById('roam-height-range');
    if (rng) rng.value = String(Math.round(h * 100));
  }

  /** 退出漫游：恢复常规 OrbitControls 轨道视角；若勾选「保留小人参照」则小人留在原地充当身高比例尺。 */
  exitRoam() {
    if (!this._roam) return false;
    const r = this._roam;
    this._roam = null;
    const dom = this.renderer.domElement;
    window.removeEventListener('keydown', this._onRoamKeyDown);
    window.removeEventListener('keyup', this._onRoamKeyUp);
    dom.removeEventListener('pointerdown', this._onRoamPointerDown);
    window.removeEventListener('pointerup', this._onRoamPointerUp);
    window.removeEventListener('pointermove', this._onRoamPointerMove);
    dom.removeEventListener('contextmenu', this._onRoamContext);
    dom.removeEventListener('wheel', this._onRoamWheel);
    if (this._roamMeasureLine) this._roamMeasureLine.visible = false;
    document.getElementById('roam-hud')?.classList.remove('open');
    syncGrowth(); // 退出漫游后按当前模式自动恢复演替滑块显隐

    const keepAvatar = document.getElementById('roam-keep-avatar')?.checked !== false;
    if (this._avatar?.root) {
      this._avatar.setFirstPerson(false);
      this._avatar.root.visible = keepAvatar;
      if (keepAvatar) {
        this._avatar.root.position.set(r.pos.x, 0, r.pos.z);
        this._avatar.updateAnim(0.016, 0, 0);
      }
    }

    if (this._savedFov) {
      this.camera.fov = this._savedFov;
      this.camera.updateProjectionMatrix();
    }

    const avatarH = this._avatar?.getHeight() || 1.72;
    const targetCenter = new THREE.Vector3(r.pos.x, r.pos.y + avatarH * 0.65, r.pos.z);
    if (r.viewMode === 'fpp') {
      const fwd = new THREE.Vector3(
        -Math.sin(r.yaw) * Math.cos(r.pitch),
        Math.sin(r.pitch),
        -Math.cos(r.yaw) * Math.cos(r.pitch));
      this.controls.target.copy(targetCenter.clone().addScaledVector(fwd, 8));
    } else {
      this.controls.target.copy(targetCenter);
    }
    this.controls.enabled = true;
    this.controls.update();
    this.handlers?.onRoamEnd?.();
    return true;
  }

  _updateRoam(dtMs) {
    const r = this._roam;
    if (!r) return;
    const dt = Math.min(0.05, dtMs / 1000);
    const k = r.keys;
    const sprinting = k.has('ShiftLeft') || k.has('ShiftRight');
    const baseSpeed = sprinting ? 8.5 : 4.2;

    // 水平朝向向量（以鼠标准星 yaw 为基准，与枪战游戏完全一致）
    const fwd = new THREE.Vector3(-Math.sin(r.yaw), 0, -Math.cos(r.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(fwd);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);

    let horizontalSpeed = 0;
    if (move.lengthSq() > 0) {
      move.normalize();
      horizontalSpeed = baseSpeed;
      r.pos.addScaledVector(move, baseSpeed * dt);
      // 角色身体平滑转向实际移动方向（按 S 后退时小人面向镜头后退，按 A/D 时侧向奔跑，全身动作完整可见）
      const targetBodyYaw = Math.atan2(-move.x, -move.z);
      let diff = targetBodyYaw - r.bodyYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      r.bodyYaw += diff * Math.min(1, dt * 12);
    } else {
      // 静止时身体平滑对齐准星方向
      let diff = r.yaw - r.bodyYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      r.bodyYaw += diff * Math.min(1, dt * 8);
    }

    // 垂直升空飞行（Space / E 升空，C / Q / Ctrl 下降）与重力模式
    const flyUp = k.has('Space') || k.has('KeyE') || k.has('PageUp');
    const flyDown = k.has('KeyC') || k.has('KeyQ') || k.has('ControlLeft') || k.has('ControlRight') || k.has('PageDown');
    const vertSpeed = sprinting ? 7.5 : 4.2;

    if (r.flying) {
      if (flyUp) r.pos.y += vertSpeed * dt;
      if (flyDown) r.pos.y = Math.max(0, r.pos.y - vertSpeed * dt);
      r.vy = 0;
    } else {
      if (k.has('KeyE')) {
        r.flying = true;
        this._syncRoamFlyUI();
        r.pos.y += vertSpeed * dt;
      } else if (r.pos.y > 0 || r.vy !== 0) {
        r.pos.y += r.vy * dt;
        r.vy -= 14.5 * dt;
        if (r.pos.y <= 0) { r.pos.y = 0; r.vy = 0; }
      }
    }
    r.pos.y = Math.max(0, Math.min(68, r.pos.y));

    const lim = this.extent + 14;
    r.pos.x = Math.max(-lim, Math.min(lim, r.pos.x));
    r.pos.z = Math.max(-lim, Math.min(lim, r.pos.z));

    // 树干物理防穿模碰撞 + 最近单木实时检尺雷达
    let nearestNode = null;
    let nearestDist = Infinity;
    for (const [, node] of this.heroNodes) {
      if (!node.group.visible) continue;
      const tx = node.data.x, tz = node.data.y;
      const dx = r.pos.x - tx, dz = r.pos.z - tz;
      const d = Math.hypot(dx, dz);
      const trunkR = (node.group.children[0]?.scale.x || 0.12) + 0.25;
      if (d < trunkR && d > 1e-4 && r.pos.y < (node.currentH || 10)) {
        r.pos.x = tx + (dx / d) * trunkR;
        r.pos.z = tz + (dz / d) * trunkR;
      }
      if (d < nearestDist) {
        nearestDist = d;
        nearestNode = node;
      }
    }

    const avatarH = this._avatar ? this._avatar.getHeight() : (state.roamHeightM || 1.72);
    const eyeH = this._avatar ? this._avatar.getEyeHeight() : avatarH * 0.93;
    if (this._avatar) {
      this._avatar.root.position.copy(r.pos);
      this._avatar.root.rotation.y = r.bodyYaw;
      this._avatar.updateAnim(dt, horizontalSpeed || (Math.abs(flyUp - flyDown) * 2.2), r.pitch);
    }

    const eyeLbl = document.getElementById('roam-eye-label');
    if (eyeLbl) {
      eyeLbl.textContent = `眼高 ${(eyeH + r.pos.y).toFixed(2)}m · 离地 ${r.pos.y.toFixed(1)}m`;
    }

    // 相机视角计算：
    // 1) 第一人称 (fpp)：位于小人眼高，拖拽鼠标环视四周
    // 2) 第三人称 360° 球面环绕 (tpp_orbit)：始终以小人胸肩高度为中心，鼠标拖拽可 360° 任意角度观察小人全身与周围林木
    const aimDir = new THREE.Vector3(
      -Math.sin(r.yaw) * Math.cos(r.pitch),
      Math.sin(r.pitch),
      -Math.cos(r.yaw) * Math.cos(r.pitch)
    ).normalize();

    if (r.viewMode === 'fpp') {
      const headPos = new THREE.Vector3(r.pos.x, r.pos.y + eyeH, r.pos.z);
      this.camera.position.copy(headPos);
      this.camera.lookAt(headPos.clone().addScaledVector(aimDir, 20));
    } else {
      const pivot = new THREE.Vector3(r.pos.x, r.pos.y + avatarH * 0.62, r.pos.z);
      const camPos = pivot.clone().addScaledVector(aimDir, -r.tppDist);
      if (camPos.y < 0.22) camPos.y = 0.22; // 防止穿入地面以下
      this.camera.position.copy(camPos);
      this.camera.lookAt(pivot);
    }

    // 身边最近单木实时测树雷达（鼠标保持自由，可随时直接点选画面中的任意树木）
    const radarTxt = document.getElementById('roam-radar-text');
    const inspectBtn = document.getElementById('roam-inspect-btn');
    if (nearestNode && nearestDist <= 4.8) {
      const td = nearestNode.data;
      r.nearestTag = td.tag;
      if (this._roamMeasureLine) {
        this._roamMeasureLine.visible = true;
        const posAttr = this._roamMeasureLine.geometry.attributes.position;
        posAttr.setXYZ(0, r.pos.x, r.pos.y + 0.10, r.pos.z);
        posAttr.setXYZ(1, td.x, Math.min(r.pos.y + 0.10, nearestNode.currentH || 10), td.y);
        posAttr.needsUpdate = true;
      }
      if (radarTxt) {
        const treeH = nearestNode.currentH || td.height_m || 0;
        const ratio = treeH > 0 ? `（树高约为你身高的 ${(treeH / avatarH).toFixed(1)} 倍）` : '';
        radarTxt.innerHTML = `🌲 <b>身边单木 #${td.tag} ${td.species}</b>（距离 <b>${nearestDist.toFixed(2)}m</b>）｜ 胸径 <b>${td.dbh_cm ?? '—'}cm</b> · 树高 <b>${treeH ? treeH.toFixed(1) : '—'}m</b> ${ratio} ｜ 鼠标直接点击任意树木可调出详情`;
      }
      if (inspectBtn) inspectBtn.style.display = 'inline-block';
    } else {
      r.nearestTag = null;
      if (this._roamMeasureLine) this._roamMeasureLine.visible = false;
      if (radarTxt) {
        radarTxt.textContent = `🧍 位置 (${r.pos.x.toFixed(1)}m, ${r.pos.z.toFixed(1)}m, 离地 ${r.pos.y.toFixed(1)}m) ｜ 按住左/右键 360° 环绕小人 · 滚轮缩放 · WASD移动 · Space/E升空 · C/Q下降 · 右键拖拽平移样地`;
      }
      if (inspectBtn) inspectBtn.style.display = 'none';
    }
  }

  setScienceLayer(on) { this.scienceGroup.visible = on; }

  /** 科研层按推导边界重建：界绳 + 5m 网格 + 四角界桩。
   *  界桩/顶帽为共享资产；界绳与网格几何随边界逐版释放。 */
  _buildScienceLayer() {
    const e = this.extent;
    for (const c of this.scienceGroup.children) {
      if (c.geometry && !c.userData?.shared) c.geometry.dispose();
    }
    this.scienceGroup.clear();
    const c2 = e / 2;
    if (this.ground) this.ground.position.set(c2, 0, c2);

    const rope = new THREE.BufferGeometry();
    rope.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0.95, 0, e, 0.95, 0,  e, 0.95, 0, e, 0.95, e,
      e, 0.95, e, 0, 0.95, e,  0, 0.95, e, 0, 0.95, 0], 3));
    this.scienceGroup.add(new THREE.LineSegments(rope, LW_ROPE_MAT));

    const n = Math.round(e / 5);
    const gridPts = [];
    const majorPts = [];
    for (let i = 0; i <= n; i++) {
      const p = i * 5;
      if (i % 2 === 0 && i > 0 && i < n) {
        majorPts.push(p, 0.025, 0, p, 0.025, e,  0, 0.025, p, e, 0.025, p);
      } else {
        gridPts.push(p, 0.02, 0, p, 0.02, e,  0, 0.02, p, e, 0.02, p);
      }
    }
    const grid = new THREE.BufferGeometry();
    grid.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    this.scienceGroup.add(new THREE.LineSegments(grid, LW_GRID_MAT));
    if (majorPts.length) {
      const majorGrid = new THREE.BufferGeometry();
      majorGrid.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
      this.scienceGroup.add(new THREE.LineSegments(majorGrid, LW_SUBGRID_MAT));
    }

    for (const [sx, sz] of [[0, 0], [e, 0], [e, e], [0, e]]) {
      const stake = new THREE.Mesh(LW_STAKE_GEO, LW_STAKE_MAT);
      stake.position.set(sx, 0.7, sz);
      stake.castShadow = true;
      stake.userData = { shared: true };
      this.scienceGroup.add(stake);
      const cap = new THREE.Mesh(LW_CAP_GEO, LW_STAKE_MAT);
      cap.position.set(sx, 1.46, sz);
      cap.userData = { shared: true };
      this.scienceGroup.add(cap);
    }

    // 东西南北四至贴地罗盘铭牌（平铺于样地边界外侧林地表面 y=0.032m，随真实透视贴地延伸，绝不遮挡任何树干）
    const az = (state.plotAzimuthDeg || 0) % 360;
    const getCardName = (baseDeg) => {
      const netDeg = (baseDeg + az) % 360;
      if (netDeg >= 337.5 || netDeg < 22.5) return '▲ 北 N';
      if (netDeg >= 22.5 && netDeg < 67.5) return '东北 NE';
      if (netDeg >= 67.5 && netDeg < 112.5) return '▶ 东 E';
      if (netDeg >= 112.5 && netDeg < 157.5) return '东南 SE';
      if (netDeg >= 157.5 && netDeg < 202.5) return '▼ 南 S';
      if (netDeg >= 202.5 && netDeg < 247.5) return '西南 SW';
      if (netDeg >= 247.5 && netDeg < 292.5) return '◀ 西 W';
      return '西北 NW';
    };

    const makeGroundPlaque = (text, x, z, rotZ = 0, colHex = '#ffb531') => {
      const cvs = document.createElement('canvas');
      cvs.width = 256; cvs.height = 72;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = 'rgba(18, 38, 25, 0.88)';
      ctx.strokeStyle = colHex;
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.roundRect(6, 6, 244, 60, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff8e6';
      ctx.font = 'bold 28px "Microsoft YaHei"';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 36);
      const tex = new THREE.CanvasTexture(cvs);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(3.4, 0.96);
      const plaque = new THREE.Mesh(geo, mat);
      plaque.rotation.x = -Math.PI / 2;
      plaque.rotation.z = rotZ;
      plaque.position.set(x, 0.032, z);
      plaque.userData = { shared: false, noPick: true };
      this.scienceGroup.add(plaque);
    };

    makeGroundPlaque(getCardName(0), c2, e + 1.25, 0, '#e74c3c');             // 上边界外侧 (+Z)
    makeGroundPlaque(getCardName(90), e + 1.25, c2, -Math.PI / 2, '#ffb531'); // 右边界外侧 (+X)
    makeGroundPlaque(getCardName(180), c2, -1.25, 0, '#5dade2');              // 下边界外侧 (-Z)
    makeGroundPlaque(getCardName(270), -1.25, c2, Math.PI / 2, '#58d68d');    // 左边界外侧 (-X)
  }

  setGhostStrategy(strategy) {
    this.ghostStrategy = strategy;
    this.applyDisplayMode(this._lastMode || 'full', this._lastFocus);
  }

  /** 切换季节物候材质池（summer 苍翠 / autumn 秋色：常绿树种保持深绿，落叶树种与林下草本转秋色）。 */
  setSeason(season) {
    for (const [, node] of this.heroNodes) {
      node.mats = lwMats(node.data.species, season);
    }
    applyUndergrowthSeason(this.undergrowthGroup, season);
    this.applyDisplayMode(this._lastMode || 'full', this._lastFocus);
  }

  setUndergrowth(on) {
    if (this.undergrowthGroup) this.undergrowthGroup.visible = !!on;
  }

  renderN(n) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.renderer.render(this.scene, this.camera);
    const total = performance.now() - t0;
    return { frames: n, totalMs: Math.round(total), msPerFrame: Math.round(total / n * 100) / 100 };
  }

  /** 截图：渲染一帧并导出 PNG dataURL（含科研标注水印信息）。 */
  screenshot() {
    this.renderer.render(this.scene, this.camera);   // 保证最新一帧
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    return {
      dataUrl,
      meta: {
        plot: state.plotId, year: this.year, mode: state.mode,
        dataNature: dataNature(),
        note: '参数化三维结构示意·局部坐标未配准',
        takenAt: new Date().toISOString().slice(0, 19),
      },
    };
  }

  /** 生长过渡动画（插值示意）：t 从 0→1 时间基推进，完成后停在终点期。
   *  用 setTimeout 而非 rAF 驱动：后台标签页 rAF 暂停会导致动画永不完成；
   *  setTimeout 前后台都触发，t 按真实时间计算，端点始终精确收敛。 */
  playGrowthAnimation(durationMs = 4000, onDone = null) {
    this.stopGrowthAnimation();
    const [y0, y1] = this._pair;
    const start = performance.now();
    const step = () => {
      if (!this._growthAnim) return;                 // 已被停止
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOutQuad
      this.applyGrowth(eased);
      const lbl = document.querySelector('#growth-label');
      if (lbl) lbl.textContent = growthLabel(eased);
      const range = document.querySelector('#growth-range');
      if (range) range.value = String(Math.round(eased * 100));
      if (t < 1) {
        this._growthAnim.timer = setTimeout(step, 16);
      } else {
        this._growthAnim = null;
        this.applyGrowth(1);   // 端点精确落在实测参数
        if (onDone) onDone();
      }
    };
    this._growthAnim = { timer: 0 };
    this.applyGrowth(0);
    this._growthAnim.timer = setTimeout(step, 16);
    return { from: y0, to: y1, durationMs };
  }

  stopGrowthAnimation() {
    if (this._growthAnim) {
      clearTimeout(this._growthAnim.timer);
      this._growthAnim = null;
    }
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this._rafId = requestAnimationFrame(this._animate);
    const now = performance.now();
    updateGlobalWind(now, state.windOn !== false);

    // 动态同步顶栏方位罗盘红针角度（始终指向用户设定的北向方位）
    const needle = document.getElementById('compass-needle');
    if (needle && this.camera) {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const camYawDeg = -Math.round(THREE.MathUtils.radToDeg(Math.atan2(-dir.x, -dir.z)));
      const az = state.plotAzimuthDeg || 0;
      needle.style.transform = `rotate(${camYawDeg - az}deg)`;
    }

    if (this._roam) {
      this._updateRoam(16.7);                            // 漫游：固定步长近似
      this.updateLabels();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this._tween) {
      const t = Math.min((now - this._tween.start) / this._tween.dur, 1);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(this._tween.fp, this._tween.tp, k);
      this.controls.target.lerpVectors(this._tween.ft, this._tween.tt, k);
      if (t >= 1) this._tween = null;
    }
    if (this.controls) this.controls.update();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._rafId);
    this._tween = null;
    this.stopGrowthAnimation();                          // 停止生长动画定时器
    this.exitRoam();                                     // 释放漫游监听与指针锁定
    window.removeEventListener('resize', this._boundResize);
    this.clearTrees();
    this._labelLayer?.remove();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
  }
}

// ============================================================ 弹窗内单树 3D 渲染

class TreePortrait {
  constructor(container) {
    this.container = container;
    this._currentTemplateKey = null;  // 当前显示模板的缓存键（防 LRU 逐出）
    this._disposed = false;
    this._showToken = 0;
    this.root = null;
    this.treeData = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const w = container.clientWidth || 428, h = container.clientHeight || 300;
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 800);

    this.modelGroup = new THREE.Group();     // 拖转只旋转模型组
    this.scene.add(this.modelGroup);

    // 地面
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshStandardMaterial({ color: 0x4a5d3f, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    // 光照
    this.hemi = new THREE.HemisphereLight(0xcfe0f0, 0x54603f, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe8cc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.sun, this.sun.target);

    // 交互：拖转 + 滚轮
    this.theta = Math.PI * 0.3;
    this.phi = Math.PI * 0.40;
    this._bindPointer();

    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  _bindPointer() {
    const dom = this.renderer.domElement;
    this._dragging = false;
    this._lastInteract = 0;
    dom.addEventListener('pointerdown', (e) => {
      this._dragging = true; this._px = e.clientX; this._py = e.clientY;
      this._lastInteract = performance.now();
      try { dom.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      this.theta -= (e.clientX - this._px) * 0.008;
      this.phi = Math.min(1.45, Math.max(0.15, this.phi - (e.clientY - this._py) * 0.006));
      this._px = e.clientX; this._py = e.clientY;
      this._lastInteract = performance.now();
    });
    const end = () => { this._dragging = false; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this._rRange) return;
      const [lo, hi] = this._rRange;
      this._radius = Math.min(hi, Math.max(lo, this._radius * (e.deltaY > 0 ? 1.09 : 0.92)));
      this._lastInteract = performance.now();
    }, { passive: false });
  }

  _updateCamera() {
    const sp = new THREE.Spherical(this._radius || 10, this.phi, this.theta);
    this.camera.position.setFromSpherical(sp).add(this._target || new THREE.Vector3());
    this.camera.lookAt(this._target || new THREE.Vector3());
  }

  _frame(root) {
    // 分位数截尾 bbox：对资产中的离群顶点（如散落针叶卡）免疫
    root.updateMatrixWorld(true);
    const xs = [], ys = [], zs = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const pp = o.geometry.getAttribute('position');
      if (!pp) return;
      const e = o.matrixWorld.elements;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
        xs.push(x * e[0] + y * e[4] + z * e[8] + e[12]);
        ys.push(x * e[1] + y * e[5] + z * e[9] + e[13]);
        zs.push(x * e[2] + y * e[6] + z * e[10] + e[14]);
      }
    });
    if (!xs.length) return;
    const q = (arr, p) => {
      const a = [...arr].sort((m, n) => m - n);
      return a[Math.min(a.length - 1, Math.floor(a.length * p))];
    };
    const box = new THREE.Box3(
      new THREE.Vector3(q(xs, 0.005), q(ys, 0.002), q(zs, 0.005)),
      new THREE.Vector3(q(xs, 0.995), q(ys, 0.998), q(zs, 0.995)));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this._target = center;
    this._radius = Math.max(size.y * 1.42, size.length() * 0.85);
    this._rRange = [Math.max(size.y * 0.45, 0.8), Math.max(size.y * 6, 30)];
    // 地面与阴影随树尺寸适配
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.CircleGeometry(Math.max(size.x, size.z) * 0.9 + 1.2, 48);
    this.ground.position.set(center.x, 0, center.z);
    this.sun.position.set(center.x + size.y * 0.9, size.y * 1.4, center.z + size.y * 0.6);
    this.sun.target.position.copy(center);
    const s = Math.max(size.y * 0.9, 3);
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, far: size.y * 5 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this._updateCamera();
  }

  /** 渲染某棵树（使用高精度多级分枝植物学校准模型实时生成，y=1.3m 处胸径与树高零误差，
   *  支持一键切换对照扫描样板 GLB）。 */
  async show(tag, year) {
    this.resume();
    const token = ++this._showToken;
    this._clearModel();
    this.year = year;
    const td = findTreeData(tag, year);
    if (!td) { this._notice('未找到该树数据'); return; }
    this.treeData = td;

    const ann = getPlotAnnotations()[tag];
    const status = ann?.status || (td.dbh_status === 'zero' ? 'felled' : 'living');
    const season = state.season || 'summer';
    const mats = lwMats(td.species, season);
    const shadeIdx = Math.abs(td.seq_no || 0) % LW_SHADES;
    const rB = Math.max((td.dbh_cm || 12) / 200, 0.04);

    // 若该树被自主标注为采伐木或倒木，弹窗 3D 窗口同样精细呈现 3D 伐桩/倒木实体与年轮
    if (status === 'felled') {
      this._loading(false);
      const stump = buildTreeStumpMesh(rB, (mats.branchSolid || mats.trunkSolid)[shadeIdx]);
      stump.userData = { ownGeo: true };
      this.modelGroup.add(stump);
      this.root = stump;
      this._frame(stump);
      return;
    }
    if (status === 'fallen') {
      this._loading(false);
      const fallen = buildFallenTrunkGroup(rB, td.height_m || 8, (mats.branchSolid || mats.trunkSolid)[shadeIdx]);
      fallen.userData = { ownGeo: true };
      this.modelGroup.add(fallen);
      this.root = fallen;
      this._frame(fallen);
      return;
    }

    const measurable = td.dbh_status === 'measured' && td.height_status === 'measured'
      && td.dbh_cm > 0 && td.height_m > 0.5;
    if (!measurable && status === 'living') {
      this._notice(`本期测量值受限（${td.height_status === 'error' ? '#N/A' : td.height_status}），`
        + '可在下方「单木现场实况自主标注」中标记为采伐伐桩或倒木，并在三维中查看。');
      return;
    }

    this._loading(true);
    try {
      const root = buildDetailedPortraitTree(
        td,
        season,
        mats.trunkSolid[shadeIdx],
        (mats.portraitCrown || mats.crownSolid)[shadeIdx],
        mats.trunkSolid[0]
      );
      root.userData = { ownGeo: true };
      if (this._disposed || token !== this._showToken) return;
      this._buildRulerOverlay(root, td);
      this.modelGroup.add(root);
      this.root = root;
      this._loading(false);
      this._frame(root);
    } catch (e) {
      if (!this._disposed && token === this._showToken) {
        console.warn('弹窗渲染失败:', tag, e);
        this._loading(false);
        this._notice('渲染加载失败，请重试');
      }
    }
  }

  /** 构建 1.3m 胸高测量环与树高参考标尺（noMeasure=true，不计入顶点测量）。 */
  _buildRulerOverlay(root, td) {
    if (this.rulerGroup) {
      this.modelGroup.remove(this.rulerGroup);
      this.rulerGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.rulerGroup = null;
    }
    const rB = Math.max((td.dbh_cm || 10) / 200, 0.025);
    const hM = Math.max(td.height_m || 5, 1.5);
    const rg = new THREE.Group();
    rg.position.set(td.x, 0, td.y);
    rg.visible = this._rulerVisible === true;
    rg.userData = { noMeasure: true };

    // 1.3m 胸高红金卡尺环
    const ringGeo = new THREE.TorusGeometry(rB * 1.18 + 0.015, 0.012, 8, 36);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe64833 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.3;
    ring.userData = { noMeasure: true };
    rg.add(ring);

    // 树高侧边标尺线（0m → H）
    const offX = Math.max(rB * 4.5, 1.1);
    const pts = [
      offX, 0, 0, offX, hM, 0,
      offX - 0.14, 0, 0, offX + 0.14, 0, 0,
      offX - 0.16, 1.3, 0, offX + 0.16, 1.3, 0,
      offX - 0.18, hM, 0, offX + 0.18, hM, 0,
    ];
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x2d5a3d, transparent: true, opacity: 0.72 });
    const rulerLines = new THREE.LineSegments(lineGeo, lineMat);
    rulerLines.userData = { noMeasure: true };
    rg.add(rulerLines);

    this.rulerGroup = rg;
    this.modelGroup.add(rg);
  }

  setRulerVisible(on) {
    this._rulerVisible = on;
    if (this.rulerGroup) this.rulerGroup.visible = on;
  }

  _protectedKeys() {
    return this._currentTemplateKey ? new Set([this._currentTemplateKey]) : null;
  }

  _clearModel() {
    if (this.rulerGroup) {
      this.modelGroup.remove(this.rulerGroup);
      this.rulerGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.rulerGroup = null;
    }
    if (this.root) {
      this.modelGroup.remove(this.root);
      if (this.root.userData?.ownGeo) {
        this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      }
      this.root = null;
    }
  }

  _notice(text) {
    this._clearModel();
    this.container.querySelector('.td-notice')?.remove();
    const el = document.createElement('div');
    el.className = 'td-notice';
    el.textContent = text;
    this.container.appendChild(el);
  }

  _loading(on) {
    this.container.querySelector('.td-loading')?.remove();
    this.container.querySelector('.td-notice')?.remove();
    if (on) {
      const el = document.createElement('div');
      el.className = 'td-loading';
      el.innerHTML = '<span class="spinner" style="width:22px;height:22px;border-width:2px"></span> 正在按实测参数渲染…';
      this.container.appendChild(el);
    }
  }

  /** 胸高环/树顶几何实测（验证渲染与调查记录一致）。 */
  measure() {
    if (!this.root || !this.treeData) return { error: 'not rendered' };
    this.root.updateMatrixWorld(true);
    let trunkMesh = null;
    this.root.traverse((o) => {
      if (!trunkMesh && o.isMesh && !o.userData?.noMeasure && /trunk/i.test(o.name || '')) trunkMesh = o;
    });
    if (!trunkMesh) return { error: 'trunk mesh not found' };
    let maxY = -1e9;
    this.root.traverse((o) => {
      if (!o.isMesh || o.userData?.noMeasure) return;
      const pp = o.geometry.getAttribute('position');
      if (!pp) return;
      for (let i = 0; i < pp.count; i++) {
        const y = pp.getY(i) * o.matrixWorld.elements[5] + o.matrixWorld.elements[13];
        if (y > maxY) maxY = y;
      }
    });
    const pos = trunkMesh.geometry.getAttribute('position');
    let bestDy = Infinity, bestY = null;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) * trunkMesh.matrixWorld.elements[5] + trunkMesh.matrixWorld.elements[13];
      const dy = Math.abs(y - 1.3);
      if (dy < bestDy - 1e-6) { bestDy = dy; bestY = y; }
    }
    const ring = [];
    if (bestY !== null && bestDy < 0.3) {
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
          .applyMatrix4(trunkMesh.matrixWorld);
        if (Math.abs(v.y - bestY) < 0.02) ring.push(v);
      }
    }
    if (ring.length < 4) return { error: 'no breast ring' };
    const cx = ring.reduce((a, v) => a + v.x, 0) / ring.length;
    const cz = ring.reduce((a, v) => a + v.z, 0) / ring.length;
    const radials = ring.map((v) => Math.hypot(v.x - cx, v.z - cz)).sort((a, b) => a - b);
    const measured = radials[Math.floor(radials.length / 2)];
    const targetDbh = (this.treeData.dbh_cm ?? 0) / 200;
    return {
      tag: this.treeData.tag, year: this.year,
      target_dbh_m: targetDbh,
      measured_dbh_m: Math.round(measured * 10000) / 10000,
      dbh_error_m: Math.round(Math.abs(measured - targetDbh) * 10000) / 10000,
      target_height: this.treeData.height_m,
      measured_height: Math.round(maxY * 1000) / 1000,
      height_error_m: Math.round(Math.abs(maxY - this.treeData.height_m) * 1000) / 1000,
    };
  }

  _animate() {
    if (this._disposed) return;
    this._rafId = requestAnimationFrame(this._animate);
    const now = performance.now();
    updateGlobalWind(now, state.windOn !== false);
    if (!this._dragging && now - this._lastInteract > 1600) {
      this.theta += 0.0035;                        // 空闲自动缓转
    }
    this._updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /** 卡片关闭时暂停渲染循环（保留实例与画布，重开零成本）。 */
  pause() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  resume() {
    if (!this._rafId && !this._disposed) {
      this._rafId = requestAnimationFrame(this._animate);
    }
  }

  _resize() {
    if (this._disposed || !this.container || !this.renderer) return;
    const w = this.container.clientWidth || 205;
    const h = this.container.clientHeight || 225;
    if (w > 0 && h > 0) {
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._clearModel();
    // 模块级模板缓存与共享纹理跨实例存活，不在此释放
    this.renderer.dispose();
    this.renderer.domElement?.remove();
  }
}

// ============================================================ 主程序

// ------------------------------------------------ 界面偏好（localStorage）

// 仅保存非敏感界面偏好（ghost 策略/科研图层/面板折叠）；调查数据与测量值一律不入 localStorage。
const PREFS_KEY = 'lzv2.prefs.v1';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; }
  catch { return {}; }
}
function savePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch { /* 隐私模式等场景静默降级 */ }
}
const _prefs = loadPrefs();
const _ghostValid = ['transparent', 'light', 'hidden'].includes(_prefs.ghost);

const state = {
  plotId: 'fm1',           // 当前样地标识（plots.json 注册表中的 id）
  plotName: 'FM1 样地',
  plots: [],               // 样地注册表
  mode: 'full',            // full | single | multi
  yearMode: '2023',        // 当前调查期（任意年份）| 'dual'
  years: [2023, 2026],     // 当前样地的调查期年份（切换样地时更新）
  immersive: false,        // 沉浸模式（切样地重建场景后保持）
  scienceOn: _prefs.scienceOn !== false,   // 科研图层按钮状态（独立于沉浸）
  undergrowthOn: _prefs.undergrowthOn !== false, // 林下草本/蕨类/苔石示意层开关
  windOn: _prefs.windOn !== false,         // 树冠与林下草本微风摇曳开关
  crownStyle: ['layered', 'classic', 'detailed'].includes(_prefs.crownStyle) ? _prefs.crownStyle : 'layered',
  season: _prefs.season === 'autumn' ? 'autumn' : 'summer', // 季节物候（summer|autumn）
  savedGhost: _ghostValid ? _prefs.ghost : 'transparent', // ghost 偏好（低性能自动降级不改写偏好）
  focusTag: null,
  manifest: null,          // 当前样地的样板树清单（仅 FM1 有；null = 无样板树）
  templateManifest: null,  // FM1 样板树清单：仅用作树种模板池来源
  scenes: {},              // 2023 / 2026 场景 JSON
  compare: null,
  single: null,
  scenesLR: {},
  heroFiles: new Map(),    // tag -> {base, 2023, 2026}
  templatePools: new Map(),// speciesKey -> year -> [候选]
  dialogTag: null,
  dialogYear: null,
  portrait: null,
  _switching: false,       // 样地切换重入保护
  _booted: false,          // 首载完成后才允许写深链
  _preImmersiveStats: false, // 沉浸前的统计面板开启态（退出时对称恢复）
  _preDualStats: null,     // 进双期前的统计面板状态（open|collapsed|closed）
};

function findTreeData(tag, year) {
  return state.scenes[year]?.trees.find((t) => t.tag === tag)
    || state.compare?.trees?.find((t) => t.tag === tag) || null;
}

/** 任意期数样地的首尾对比年份对（兼容 1 期 / 2 期 / 3+ 期样地，与后端 compare.json 同口径）。 */
function comparePair(years = state.years) {
  if (!Array.isArray(years) || !years.length) return [2023, 2023];
  return [years[0], years[years.length - 1]];
}

// ------------------------------------------------ 样地注册与数据加载

async function fetchJson(url) {
  const cleanKey = String(url).replace(/^\.\//, '');
  if (typeof location !== 'undefined' && location.protocol === 'file:' && window.__INLINE_PLOT_DATA__?.[cleanKey]) {
    return JSON.parse(JSON.stringify(window.__INLINE_PLOT_DATA__[cleanKey]));
  }
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    if (window.__INLINE_PLOT_DATA__?.[cleanKey]) {
      return JSON.parse(JSON.stringify(window.__INLINE_PLOT_DATA__[cleanKey]));
    }
    throw err;
  }
}

/** 样地注册表：data/plots.json 缺失/损坏时仅保留 FM1 基线（fail soft）。 */
async function loadPlotRegistry() {
  try {
    const d = await fetchJson('data/plots.json');
    if (Array.isArray(d?.plots) && d.plots.length) return d.plots;
  } catch { /* 注册表缺失：仅 FM1 */ }
  return [{
    id: 'fm1', name: 'FM1 样地', years: [2023, 2026],
    base: '.', tree_count: 160, builtin: true,
  }];
}

/** 当前样地的数据 URL。年份来自注册表（任意调查期，不限定 2023/2026）。 */
function plotUrls(p) {
  const years = (Array.isArray(p.years) && p.years.length) ? p.years : [2023, 2026];
  if (p.builtin || p.base === '.' || p.base === './') {
    return {
      years,
      manifest: 'data/fm1hd_manifest.json',
      scenes: Object.fromEntries(years.map((y) => [y, `data/fm1_scene_${y}.json`])),
      compare: 'data/fm1_compare.json',
    };
  }
  const base = String(p.base || `data/plots/${p.id}`).replace(/\/+$/, '');
  return {
    years,
    manifest: null,
    scenes: Object.fromEntries(years.map((y) => [y, `${base}/scene_${y}.json`])),
    compare: `${base}/compare.json`,
  };
}

/** FM1 样板树清单：样板树身份只属于 FM1；对导入样地仅取其树种模板池。 */
let _fm1ManifestPromise = null;
function loadFm1Manifest() {
  if (!_fm1ManifestPromise) {
    _fm1ManifestPromise = fetchJson('data/fm1hd_manifest.json');
    _fm1ManifestPromise.catch(() => { _fm1ManifestPromise = null; }); // 失败可重试
  }
  return _fm1ManifestPromise;
}

function fillPlotSelect() {
  const sel = $('#plot-select');
  if (!sel) return;
  sel.innerHTML = state.plots.map((p) =>
    `<option value="${p.id}">${p.name}${p.builtin ? '（基线）' : ''}</option>`).join('');
  sel.value = state.plotId;
}

/** 切换样地：重新拉取该样地全部数据并整体重建场景。失败时回退到原样地。 */
async function switchPlot(plotId) {
  if (state._switching) return;
  const p = state.plots.find((x) => x.id === plotId);
  if (!p || p.id === state.plotId) { $('#plot-select').value = state.plotId; return; }
  const prevId = state.plotId;
  await activatePlot(p, { prevId });
}

async function activatePlot(p, { first = false, prevId = null } = {}) {
  if (state._switching) return;
  state._switching = true;
  setLoadingText(`正在加载 ${p.name}…`);
  if (!first) $('#loading').classList.remove('hidden');
  // 原子性快照（R4-06）：后半段失败时完整回滚到原样地状态，不留半切换
  const snapshot = {
    plotId: state.plotId, plotName: state.plotName,
    manifest: state.manifest, templateManifest: state.templateManifest,
    scenes: state.scenes, compare: state.compare,
    heroFiles: state.heroFiles, templatePools: state.templatePools,
  };
  try {
    const urls = plotUrls(p);
    const [manifest, templateManifest, cmp, ...sceneList] = await Promise.all([
      urls.manifest ? fetchJson(urls.manifest) : Promise.resolve(null),
      loadFm1Manifest(),
      fetchJson(urls.compare),
      ...urls.years.map((y) => fetchJson(urls.scenes[y])),
    ]);
    state.plotId = p.id;
    state.plotName = p.name || p.id;
    state.years = urls.years;
    // 切换样地后调查期口径必须一致：单期样地不保留双期；当前期不属于新样地 → 回到其首期
    if (state.yearMode === 'dual' && state.years.length < 2) {
      state.yearMode = String(state.years[0]);
    } else if (state.yearMode !== 'dual'
      && !state.years.includes(Number(state.yearMode))) {
      state.yearMode = String(state.years[0]);
    }
    state.manifest = manifest;
    state.templateManifest = templateManifest;
    state.scenes = {};
    // 兼容修复：历史导出的部分工作库样地 scene_*.json 中 x_trans=0.0 覆盖了真实 x/y，
    // 若单期全部树坐标落在 (0,0) 而 compare.trees 持有真实局部坐标，则自动回填真实局部坐标。
    const cmpCoordByTag = new Map(
      (cmp?.trees || []).filter((t) => (t.x || t.y)).map((t) => [String(t.tag), t])
    );
    urls.years.forEach((y, i) => {
      const sc = sceneList[i];
      if (sc?.trees?.length && cmpCoordByTag.size) {
        const allZero = sc.trees.every((t) => !t.x && !t.y);
        if (allZero) {
          for (const t of sc.trees) {
            const ct = cmpCoordByTag.get(String(t.tag));
            if (ct) { t.x = ct.x; t.y = ct.y; }
          }
        }
      }
      state.scenes[y] = sc;
    });
    state.compare = cmp;
    state.heroFiles = manifest ? buildHeroFiles(manifest) : new Map();
    state.templatePools = buildTemplatePools(templateManifest);
    state._perfProbed = false;

    rebuildAllScenes();
    renderSelectionList();
    updateStats();
    updatePlotChrome();
    syncGrowth();
    if ($('#stats-panel')?.style.display === 'block') renderStatsPanel();
    $('#plot-select').value = p.id;
    $('#loading').classList.add('hidden');
    if (first) window.__perf = { firstInteractiveMs: Math.round(performance.now()) };
    scheduleDeepLink();
  } catch (e) {
    console.error('样地加载失败:', p.id, e);
    if (first) throw e;                      // 首载失败交给 init 的错误展示
    // 回滚到快照状态并整体重建，保证下拉值、场景、统计、图例一致（R4-06）
    Object.assign(state, snapshot);
    try {
      rebuildAllScenes();
      renderSelectionList();
      updateStats();
      updatePlotChrome();
      syncGrowth();
    } catch (e2) {
      console.error('样地回滚失败:', e2);
      $('#loading').classList.remove('hidden');
      setLoadingText('样地切换失败且恢复异常，请刷新页面');
      state._switching = false;
      return;
    }
    hint('样地加载失败，已恢复原样地：' + (e?.message || e));
    $('#plot-select').value = state.plotId;
    $('#loading').classList.add('hidden');
  } finally {
    state._switching = false;
  }
}

function setLoadingText(text) {
  const el = $('#loading-text');
  if (el) el.textContent = text;
}

function updateStats() {
  const q = state.compare?.integrity_report || {};
  const sim = dataNature() === 'simulated';
  const src = sim ? '模拟数据·功能测试用途，非实测' : '实测调查数据';
  $('#stats').innerHTML =
    `<b>${state.scenes[state.years[0]].tree_count}</b> 株（${src}）｜ 点击树木弹出该树渲染窗 ｜ ` +
    `身份待核实 ${q.quarantined_seq_count ?? 0}`;
}

/** 顶栏副标题与图例随样地更新（FM1 有样板树分层；导入样地为全量模板渲染）。 */
function updatePlotChrome() {
  const p = state.plots.find((x) => x.id === state.plotId) || {};
  const name = p.name || state.plotId;
  const sim = dataNature() === 'simulated';
  $('#subtitle').textContent = `${name}${sim ? ' · 模拟数据' : ''} · 三维森林查看器`;
  // 调查期按钮随样地年份动态重建（支持 1 期 / 2 期 / 3+ 期多期对比）
  const yb = $('#year-btns');
  const hasMultiPeriod = state.years.length >= 2;
  const dualBtnLabel = state.years.length >= 3 ? `多期对比(${state.years.length}期)` : '双期/多期对比';
  yb.innerHTML = state.years.map((y) =>
    `<button class="year-btn" data-year="${y}">${y}</button>`).join('')
    + `<button class="year-btn" data-year="dual" ${hasMultiPeriod ? '' : 'disabled title="单期样地无多期对比"'}>${dualBtnLabel}</button>`;
  yb.querySelectorAll('.year-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.year === String(state.yearMode));
    b.addEventListener('click', () => {
      if (b.disabled) return;
      setYear(b.dataset.year);
    });
  });
  const animBtn = $('#btn-growth-anim');
  if (animBtn) animBtn.disabled = !hasMultiPeriod;
  document.title = `林样智记 V2.1 · ${name}${sim ? '（模拟数据）' : ''} 三维森林查看器`;
  const count = state.scenes[state.years[0]]?.tree_count ?? 0;
  // 统计当前样地树种组成并展示专属色块与构型说明（点击可高亮该树种）
  const curYear = state.yearMode === 'dual' ? state.years[0] : Number(state.yearMode);
  const treesNow = state.scenes[curYear]?.trees || state.scenes[state.years[0]]?.trees || [];
  const spCount = new Map();
  for (const t of treesNow) {
    const sp = t.species || '未知';
    spCount.set(sp, (spCount.get(sp) || 0) + 1);
  }
  const spRows = [...spCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sp, n]) => {
      const prof = lwSpecies(sp);
      const cHex = '#' + (state.season === 'autumn' ? (prof.crownAutumn ?? prof.crown) : prof.crown)
        .toString(16).padStart(6, '0');
      const bHex = '#' + prof.trunk.toString(16).padStart(6, '0');
      return `<div class="legend-sp-row" data-sp="${sp}" title="点击高亮本样地全部「${sp}」单木（${prof.crownDesc}）">`
        + `<span class="legend-swatch" style="background:${cHex};border:1.5px solid ${bHex}"></span>`
        + `<b>${sp}</b> ×${n} <span class="dim">(${prof.leafHabit.slice(0, 4)})</span></div>`;
    }).join('');
  const stake = '<div><span class="legend-swatch" style="background:#c23b22"></span>'
    + '样地界桩（推导的示意边界）</div>';
  const crown = sim
    ? `<div><span class="legend-swatch" style="background:#245026"></span>模拟数据结构示意 ×${count}（功能测试用途·非实测）</div>`
    : `<div><span class="legend-swatch" style="background:#245026"></span>参数化结构示意 ×${count}（实测参数·资产模板渲染）</div>`;
  const body = (state.manifest
    ? `<div><span class="legend-swatch" style="background:#c9a22e"></span>⭐ 高精度展示模型 ×${state.manifest.trees.length}（真实扫描·逐期）</div>`
      + `<div><span class="legend-swatch" style="background:#245026"></span>参数化结构示意 ×${Math.max(0, count - state.manifest.trees.length)}（实测参数·资产模板）</div>`
    : crown)
    + (spRows ? `<div style="margin:3px 0;padding-top:3px;border-top:1px dashed #d6d0c2">${spRows}</div>` : '')
    + stake;
  const lgBody = $('#legend .legend-body');
  if (lgBody) {
    lgBody.innerHTML = body;
    lgBody.querySelectorAll('.legend-sp-row').forEach((row) => {
      row.addEventListener('click', () => highlightSpeciesInPlot(row.dataset.sp));
    });
  }
  if ($('#species-modal')?.classList.contains('open')) renderSpeciesAtlasModal();
}

// ------------------------------------------------ 面板折叠与显隐（统一入口）

/** 统计面板开关（显隐 + 按钮态同步；内容按需渲染）。 */
function openStatsPanel(open) {
  const panel = $('#stats-panel');
  const btn = $('#btn-stats');
  if (!panel) return;
  panel.style.display = open ? 'block' : 'none';
  btn?.classList.toggle('active', open);
  if (open) renderStatsPanel();
}

/** 统计面板折叠（保留入口条）；persist=false 用于双期自动收起等程序性动作。 */
function setStatsCollapsed(collapsed, persist = true) {
  const panel = $('#stats-panel');
  if (!panel) return;
  panel.classList.toggle('sp-collapsed', collapsed);
  const btn = $('#sp-toggle');
  if (btn) btn.textContent = collapsed ? '▸' : '▾';
  if (persist) savePrefs({ statsCollapsed: collapsed });
}

/** 详情卡折叠（保留左侧渲染窗）；支持桌面端与手机端自适应尺寸。 */
function setCardCollapsed(collapsed, persist = true) {
  const card = $('#tree-card');
  if (!card) return;
  card.classList.toggle('card-collapsed', collapsed);
  const isMobile = window.innerWidth <= 820;
  if (isMobile) {
    card.style.width = '';
    card.style.gridTemplateColumns = '';
  } else if (collapsed) {
    card.style.width = '220px';
    card.style.gridTemplateColumns = '1fr';
  } else {
    card.style.width = '480px';
    card.style.gridTemplateColumns = '205px 1fr';
  }
  const btn = $('#tc-collapse');
  if (btn) btn.textContent = collapsed ? '⇥' : '⇤';
  const expBtn = $('#tc-expand-btn');
  if (expBtn) {
    expBtn.textContent = collapsed ? '📋 展开数据 ⇥' : '⇤ 收起数据';
    expBtn.classList.toggle('active', !collapsed);
  }
  const leftClose = $('#tc-left-close');
  if (leftClose) leftClose.style.display = collapsed ? 'block' : 'none';
  if (persist) savePrefs({ cardCollapsed: collapsed });
  requestAnimationFrame(() => state.portrait?._resize?.());
}

// ------------------------------------------------ URL 深链（界面状态，不含调查数据）

let _dlRaf = null;

/** 状态变更后节流写回 URL（replaceState，不产生历史记录）。 */
function scheduleDeepLink() {
  if (!state._booted) return;
  if (_dlRaf) cancelAnimationFrame(_dlRaf);
  _dlRaf = requestAnimationFrame(() => {
    _dlRaf = null;
    const selScene = state.yearMode === 'dual' ? state.scenesLR.left : state.single;
    const query = buildDeepLinkQuery({
      plot: state.plotId,
      year: state.yearMode === 'dual' ? state.years[0] : Number(state.yearMode),
      mode: state.mode,
      tree: state.mode === 'single' ? state.focusTag : null,
      sel: selScene ? [...selScene.selected] : [],
    });
    const url = location.pathname + query + location.hash;
    if (url !== location.pathname + location.search + location.hash) {
      try { history.replaceState(null, '', url); } catch { /* file:// 环境静默忽略 */ }
    }
  });
}

/** 首载时应用深链中的年份/模式/树/选中。 */
function applyDeepLinkState() {
  const y0 = state.years[0];
  const tags0 = new Set((state.scenes[y0]?.trees || []).map((t) => t.tag));
  const allTags = new Set(state.years.flatMap((y) =>
    (state.scenes[y]?.trees || []).map((t) => t.tag)));
  if (state._dlYear && state.years.includes(state._dlYear)
    && String(state._dlYear) !== String(state.yearMode)) {
    setYear(String(state._dlYear));
  }
  const tree = state._dlTree && allTags.has(state._dlTree) ? state._dlTree : null;
  if (state._dlMode === 'single' && tree) {
    setMode('single', tree);
  } else if (state._dlMode === 'multi') {
    const tags = (state._dlSel || []).filter((t) => tags0.has(t)).slice(0, 12);
    const sc = state.single;
    for (const t of tags) if (!sc.selected.has(t)) sc.toggleSelect(t);
    renderSelectionList();
    if (tags.length) setMode('multi');
  }
  state._dlMode = state._dlTree = state._dlSel = state._dlYear = null;
  scheduleDeepLink();
}

// ------------------------------------------------ 生长插值滑块

function growthLabel(t) {
  const ys = (state.years && state.years.length >= 2)
    ? state.years.slice().sort((a, b) => a - b)
    : comparePair();
  if (t <= 0) return `${ys[0]} 期`;
  if (t >= 1) return `${ys[ys.length - 1]} 期`;
  const segs = Math.max(1, ys.length - 1);
  const scaled = t * segs;
  const idx = Math.min(segs - 1, Math.floor(scaled));
  const localT = scaled - idx;
  if (Math.abs(localT) < 0.015) return `${ys[idx]} 期（实测节点）`;
  const yInterp = ys[idx] + (ys[idx + 1] - ys[idx]) * localT;
  return `${yInterp.toFixed(1)} 年（多期插值示意）`;
}

/** 生长滑块与当前视图同步：非双期+完整样地+至少两期时显示；支持多期节点一键跳转。 */
function syncGrowth() {
  const bar = $('#growth-bar');
  if (!bar) return;
  const ys = (state.years && state.years.length >= 2)
    ? state.years.slice().sort((a, b) => a - b)
    : comparePair();
  const s = state.yearMode === 'dual' ? null : state.single;
  const segs = Math.max(1, ys.length - 1);
  const yIdx = s ? Math.max(0, ys.indexOf(Number(s.year))) : 0;
  const t0 = s && ys.length >= 2 ? (yIdx / segs) : 0;
  const show = state.yearMode !== 'dual' && state.mode === 'full' && ys.length >= 2;
  bar.style.display = show ? 'flex' : 'none';
  const knotsEl = $('#growth-knots');
  if (knotsEl && ys.length >= 2) {
    knotsEl.innerHTML = ys.map((y, i) => {
      const pct = Math.round((i / segs) * 100);
      return `<button class="mini growth-knot" data-pct="${pct}" title="跳转到 ${y} 期实测状态">${y}</button>`;
    }).join('');
    knotsEl.querySelectorAll('.growth-knot').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pct = Number(btn.dataset.pct);
        const rng = $('#growth-range');
        if (rng) {
          rng.value = String(pct);
          rng.dispatchEvent(new Event('input'));
        }
      });
    });
  }
  const range = $('#growth-range');
  if (range) range.value = String(Math.round(t0 * 100));
  if (ys.length >= 2) s?.applyGrowth(t0);
  const lbl = $('#growth-label');
  if (lbl) lbl.textContent = growthLabel(t0);
}

// ------------------------------------------------ 样地统计面板（实测数据推导）

/** 当前样地数据性质：survey=实测调查数据 / simulated=模拟数据（功能测试用途）。 */
function dataNature() {
  return state.compare?.data_nature
    || state.plots.find((p) => p.id === state.plotId)?.data_nature
    || 'survey';
}

/** 单期干曲线蓄积估算：仅计入 DBH/H 均实测且在模型适用范围内的株。
 *  范围外/缺测株计入 excluded，不参与均值（R4-07 适用性门控）。 */
function standVolume(trees) {
  let v = 0, ff = 0, n = 0, excluded = 0;
  for (const t of trees) {
    if (t.dbh_status !== 'measured' || t.height_status !== 'measured'
      || !t.dbh_cm || !t.height_m || t.height_m <= 1.4) { excluded++; continue; }
    const s = stemVolume(t.height_m, t.dbh_cm);
    if (!s.valid) { excluded++; continue; }
    v += s.volume;
    ff += s.formFactor;
    n++;
  }
  return { v, ff: n ? ff / n : null, n, excluded };
}

/** 单期林分统计（绝对量）：N / 断面积合计 ba(m²) / Dg / 平均树高 / 2cm 径阶。
 *  每公顷换算由调用方依据"经确认的调查面积"决定，此处不做面积假设。 */
function standStats(trees) {
  const meas = trees.filter((t) => t.dbh_status === 'measured' && t.dbh_cm > 0);
  const ba = meas.reduce((s, t) => s + Math.PI * (t.dbh_cm / 200) ** 2, 0);   // m²
  const hs = trees.filter((t) => t.height_status === 'measured' && t.height_m > 0);
  const bins = new Map();
  for (const t of meas) {
    const b = Math.max(0, Math.floor(t.dbh_cm / 2) * 2);
    bins.set(b, (bins.get(b) || 0) + 1);
  }
  return {
    n: trees.length,
    ba,
    dg: meas.length
      ? Math.sqrt(meas.reduce((s, t) => s + t.dbh_cm ** 2, 0) / meas.length) : null,
    hm: hs.length ? hs.reduce((s, t) => s + t.height_m, 0) / hs.length : null,
    bins: [...bins.entries()].sort((a, b) => a[0] - b[0]),
    binMax: Math.max(1, ...bins.values()),
    unknown: [...new Set(trees.filter((t) => !LW_SPECIES[t.species]).map((t) => t.species))],
  };
}

function fmtDelta(v, unit) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (Math.round(v * 100) / 100) + unit;
}

function renderStatsPanel() {
  const el = $('#sp-body');
  const [y0, y1] = comparePair();
  const hasMulti = state.years.length >= 2 && y0 !== y1 && !!state.scenes[y1];
  if (!el || !state.scenes[y0]) return;
  const sim = dataNature() === 'simulated';
  const headNote = document.querySelector('.sp-head-row .sp-note');
  if (headNote) {
    headNote.textContent = sim ? '模拟数据（功能测试用途）' : '由实测调查表推导';
  }

  // —— 单期统计（支持 1 期 / 2 期 / 3+ 期全部调查期展示）——
  const statsByYear = new Map();
  const volsByYear = new Map();
  for (const y of state.years) {
    if (!state.scenes[y]) continue;
    statsByYear.set(y, standStats(state.scenes[y].trees));
    volsByYear.set(y, standVolume(state.scenes[y].trees));
  }
  const s23 = statsByYear.get(y0);
  const s26 = statsByYear.get(y1) || s23;
  const v23 = volsByYear.get(y0);
  const v26 = volsByYear.get(y1) || v23;

  // —— 跨期变化：仅使用通过 Fm1Dataset / PlotStore 身份准入门的可信配对。
  const pairs = state.compare?.trees ?? [];
  let dD = 0, dH = 0, pairsD = 0, pairsH = 0;
  if (hasMulti) {
    for (const c of pairs) {
      const d23 = c.dbh?.[String(y0)], d26 = c.dbh?.[String(y1)];
      if (d23?.status === 'measured' && d26?.status === 'measured') {
        dD += d26.value - d23.value; pairsD++;
      }
      const h23 = c.height?.[String(y0)], h26 = c.height?.[String(y1)];
      if (h23?.status === 'measured' && h26?.status === 'measured') {
        dH += h26.value - h23.value; pairsH++;
      }
    }
  }

  // —— 进界/缺失：来自后端身份审计的单侧记录（unmatched_summary，键=出现年份）
  const um = state.compare?.integrity_report?.unmatched_summary;
  let ingrow = 0, missing = 0;
  if (hasMulti) {
    if (um) {
      ingrow = um[`present_only_${y1}`] ?? 0;
      missing = um[`present_only_${y0}`] ?? 0;
    } else {
      const unmatched = (state.compare?.integrity_report?.issues ?? [])
        .filter((i) => i.code === 'UNMATCHED_SEQ');
      for (const i of unmatched) {
        if (i.evidence?.present_year === y1) ingrow++;
        else if (i.evidence?.present_year === y0) missing++;
      }
    }
  }
  const q = state.compare?.integrity_report || {};

  // —— 面积门控（R4-05）：仅"经确认的调查面积"可作为每公顷分母
  const plot = state.compare?.plot || {};
  const areaM2 = plot.survey_area_m2;
  const areaHa = (typeof areaM2 === 'number' && areaM2 > 0) ? areaM2 / 10000 : null;

  const f1 = (v, u = '') => v == null ? '—' : (Math.round(v * 10) / 10) + u;
  const perHa = (abs) => areaHa ? f1(abs / areaHa) : '—';
  const tableRows = state.years.map((y) => {
    const sy = statsByYear.get(y);
    const vy = volsByYear.get(y);
    if (!sy || !vy) return '';
    return `<tr><td>${y}</td><td>${sy.n}</td><td>${perHa(sy.ba)}</td><td>${f1(sy.dg)}</td><td>${f1(sy.hm)}</td><td>${perHa(vy.v)}</td></tr>`;
  }).join('');
  const binsHtml = s26.bins.map(([b, n]) =>
    `<div class="bin-row"><span class="bin-name">${b}–${b + 2}cm</span>`
    + `<span class="bin-bar" style="width:${Math.max(4, Math.round(n / s26.binMax * 100))}%"></span>`
    + `<span class="bin-n">${n}</span></div>`).join('');
  const unknownNote = s26.unknown.length
    ? `<div class="note">未登记树种：${s26.unknown.join('、')}（灰色示意渲染，请扩充树种资产）</div>` : '';
  const natureNote = sim
    ? `<div class="note" style="border-color:#dcb4ae;background:#f7e8e5;color:#8a2b20">`
      + `数据性质：模拟数据（功能测试用途，非实测调查）——本面板全部数字不作为调查结果使用。</div>`
    : '';
  const crossLine = hasMulti
    ? `<div class="sp-line">两期变化（${y0}→${y1}，仅身份可信配对，配对 n=${pairs.length}）：
        ΔD̄ ${pairsD ? fmtDelta(dD / pairsD, ' cm') : '—'}（实测对 ${pairsD}）
        · ΔH̄ ${pairsH ? fmtDelta(dH / pairsH, ' m') : '—'}（实测对 ${pairsH}）
        · 进界 +${ingrow} · 缺失 −${missing}
        <span class="dim">（单侧记录来自身份审计，待核实，不自动判死亡/新增）</span></div>`
    : `<div class="sp-line dim">单期样地（${y0}）：无跨期变化对比（身份可信配对 n=0）。</div>`;

  el.innerHTML = `
    <table class="info-table" style="margin-top:4px">
      <tr><th>调查期</th><th>株数 N</th><th>断面积 G</th><th>平均胸径 Dg</th><th>平均树高</th><th>蓄积 V</th></tr>
      ${tableRows}
    </table>
    ${crossLine}
    <div class="sp-line dim">绝对量（非每公顷）：G ${y0} ${f1(s23.ba, ' m²')}${hasMulti ? ` / ${y1} ${f1(s26.ba, ' m²')}` : ''}；
      V ${y0} ${f1(v23.v, ' m³')}${hasMulti ? ` / ${y1} ${f1(v26.v, ' m³')}` : ''}；
      蓄积剔除（缺测或超模型量程）${y0} ${v23.excluded} 株${hasMulti ? ` / ${y1} ${v26.excluded} 株` : ''}。</div>
    <div class="sp-line dim">每公顷分母：${areaHa
      ? `调查面积 ${areaM2} m²（${plot.survey_area_source ?? '来源未注明'}）`
      : '样地面积待核实，暂不可计算每公顷指标——树坐标范围仅用于视图，不作为面积'}</div>
    <div class="sp-line dim">蓄积为四段干曲线概念估算：未经树种材积表校准、适用性未独立验证，
      形数在合理区间不代表模型经树种验证。平均形数 ${y0} ${v23.ff?.toFixed(2) ?? '—'}${hasMulti ? ` / ${y1} ${v26.ff?.toFixed(2) ?? '—'}` : ''}。</div>
    <div class="sp-head" style="margin-top:8px">径阶分布（${y1}，2cm 级）</div>
    <div class="sp-bins">${binsHtml || '<span class="dim">无可测径阶</span>'}</div>
    ${unknownNote}${natureNote}
    <div class="note dim">身份口径：跨期变化仅用身份可信配对（隔离/重复/冲突已由后端准入门排除，
      待核实 ${q.quarantined_seq_count ?? 0} 株不参与）；单期统计用当年全部记录；
      三维与插值为参数化示意；坐标未配准。</div>`;
}

async function init() {
  try {
    state.plots = await loadPlotRegistry();
    fillPlotSelect();
    // 深链解析：白名单校验（汇总全部注册样地的调查期年份，支持任意年份深链如 2030/2033）
    const allValidYears = [...new Set([
      2023, 2026,
      ...state.plots.flatMap((p) => Array.isArray(p.years) ? p.years : []),
    ])];
    const dl = parseDeepLink(location.search, {
      plotIds: state.plots.map((p) => p.id),
      validYears: allValidYears,
    });
    const target = (dl.plot && state.plots.find((p) => p.id === dl.plot)) || state.plots[0];
    state._dlYear = dl.year;
    state._dlMode = dl.mode;
    state._dlTree = dl.tree;
    state._dlSel = dl.sel;
    // 界面偏好（localStorage：仅非敏感 UI 状态）
    if (!state.scienceOn) $('#btn-science')?.classList.remove('active');
    if (!state.undergrowthOn) $('#btn-undergrowth')?.classList.remove('active');
    if (!state.windOn) $('#btn-wind')?.classList.remove('active');
    if ($('#ghost-select')) $('#ghost-select').value = state.savedGhost;
    if ($('#crown-style-select')) $('#crown-style-select').value = state.crownStyle;
    setCardCollapsed(false, false); // 默认完整展开单木详情数据面板，防止历史偏好残留导致信息消失
    if (_prefs.statsCollapsed) setStatsCollapsed(true, false);
    bindUI();
    await activatePlot(target, { first: true });
    exposeViewerAPI();
    if (state._dlYear || state._dlMode || state._dlTree || (state._dlSel && state._dlSel.length)) {
      applyDeepLinkState();
    }
    state._booted = true;
    scheduleDeepLink();
    // 冒烟测试：?smoke=1 时自动运行（会切换样地/模式，仅验收用）
    if (new URLSearchParams(location.search).has('smoke')) {
      Promise.resolve().then(() => window.runSmoke?.())
        .catch((e) => console.error('smoke failed:', e));
    }
  } catch (e) {
    console.error('init failed:', e);
    const el = $('#loading');
    if (el) {
      const divs = el.querySelectorAll('div');
      (divs[divs.length - 1] || el).textContent = '加载失败：' + (e?.message || e);
    }
  }
}

function exposeViewerAPI() {
  window.__viewer = {
      getSelectionState,
      setMode,
      setYear,
      openTreeDialog: (t) => openTreeDialog(t),
      closeTreeDialog,
      toggleCompare: (t) => toggleTreeCompare(t),
      setStrategy: (name) => {
        for (const s of activeScenes()) s.setGhostStrategy(name);
      },
      benchmark: async (frames = 90) => {
        const s = activeScenes()[0];
        await new Promise((r) => requestAnimationFrame(r));
        const t0 = performance.now();
        const stamps = [];
        for (let i = 0; i < frames; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          stamps.push(performance.now());
        }
        const iv = [];
        let prev = t0;
        for (const t of stamps) { iv.push(t - prev); prev = t; }
        iv.sort((a, b) => a - b);
        const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
        return {
          fps: Math.round(1000 / avg),
          avgMs: Math.round(avg * 100) / 100,
          p95Ms: Math.round(iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] * 100) / 100,
          drawCalls: s.renderer.info.render.calls,
          triangles: s.renderer.info.render.triangles,
          geometries: s.renderer.info.memory.geometries,
          textures: s.renderer.info.memory.textures,
          jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        };
      },
      isolate: (tag) => setMode('single', tag),
      restoreFull: () => setMode('full'),
      renderN: (n) => activeScenes()[0].renderN(n),
      measureDialog: () => state.portrait?.measure(),
      screenshot: () => (state.yearMode === 'dual'
        ? state.scenesLR.left : state.single)?.screenshot(),
      playGrowthAnim: (ms) => (state.yearMode === 'dual'
        ? state.single : state.single)?.playGrowthAnimation(ms),
      stopGrowthAnim: () => state.single?.stopGrowthAnimation(),
      __scene: () => activeScenes()[0],
    };
}

function buildHeroFiles(manifest) {
  const heroFiles = new Map();
  for (const t of manifest.trees) heroFiles.set(t.tag, { base: t.files?.L0 || null });
  for (const p of manifest.per_year || []) {
    if (p.status !== 'ok') continue;
    const e = heroFiles.get(String(p.tag));
    if (e) e[p.year] = p.file;
  }
  return heroFiles;
}

function buildTemplatePools(manifest) {
  const speciesKeyByTag = new Map(manifest.trees.map((t) => [t.tag, t.species_key]));
  const templatePools = new Map();
  for (const p of manifest.per_year || []) {
    if (p.status !== 'ok') continue;
    const sk = speciesKeyByTag.get(String(p.tag));
    if (!sk) continue;
    if (!templatePools.has(sk)) templatePools.set(sk, new Map());
    const byYear = templatePools.get(sk);
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year).push(
      { tag: String(p.tag), file: p.file, dbh: p.dbh, height: p.height, crown: p.crown });
  }
  return templatePools;
}

// ------------------------------------------------ 显示范围（主视图轻量隔离）

function activeScenes() {
  return state.yearMode === 'dual'
    ? [state.scenesLR.left, state.scenesLR.mid, state.scenesLR.right].filter(Boolean)
    : [state.single].filter(Boolean);
}

/** 首次进入单树查看时探测渲染压力；>30ms/帧 自动切换轻量参照保持流畅。 */
function probePerf(scene) {
  if (!scene || state._perfProbed || scene.ghostStrategy !== 'transparent') return;
  state._perfProbed = true;
  setTimeout(() => {
    if (state.mode !== 'single' || scene.ghostStrategy !== 'transparent') return;
    const times = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      scene.renderer.render(scene.scene, scene.camera);
      times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    if (avg > 30) {
      for (const s of activeScenes()) s.setGhostStrategy('light');
      hint('检测到渲染压力较大，已自动切换为轻量参照显示');
    }
  }, 300);
}

/** 详情卡打开时，把聚焦树在画面中左移的像素量（给右侧卡片让位，随折叠自适应）。 */
function cardLateral() {
  if (!state.dialogTag || window.innerWidth <= 820) return 0;
  const s = activeScenes()[0];
  const vw = s?.container.clientWidth || 0;
  const collapsed = $('#tree-card')?.classList.contains('card-collapsed');
  const cardW = collapsed ? 320 : 560;
  return Math.max(0, Math.min(320, (vw - cardW - 40) / 2));
}

/** 显示模式复位为完整样地（仅更新状态与按钮态，不含渲染副作用）。
 *  用于年份/样地等上下文切换：避免"按钮显示单木、实际全实体渲染"的表里不一。 */
function resetModeToFull() {
  state.mode = 'full';
  state.focusTag = null;
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === 'full'));
}

function setMode(mode, focusTag = null) {
  state.mode = mode;
  if (focusTag) state.focusTag = focusTag;
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  const scenes = activeScenes();
  for (const s of scenes) s.applyDisplayMode(mode, state.focusTag);
  if (mode === 'single' && state.focusTag) {
    if (state.dialogTag !== state.focusTag) openTreeDialog(state.focusTag); // 先开卡再取偏移
    scenes[0]?.focusOn([state.focusTag], 12, cardLateral());
    probePerf(scenes[0]);
  } else if (mode === 'multi') {
    closeTreeDialog();                      // 多选模式需点击画布加选，卡片让位（chip可重开渲染）
    const sel = scenes[0]?.selected;
    if (sel && sel.size) scenes[0]?.focusOn([...sel], 16, cardLateral());
  }
  if (mode === 'full') closeTreeDialog();   // 恢复完整样地=退出查看，卡片一并关闭
  renderSelectionList();
  syncGrowth();
  scheduleDeepLink();
}

function setYear(yearMode) {
  if (state.yearMode === yearMode) {
    if (yearMode !== 'dual' || state.scenesLR.left) return;
  }
  state.yearMode = yearMode;
  document.querySelectorAll('.year-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.year === yearMode));
  $('#dual-wrap').style.display = yearMode === 'dual' ? 'flex' : 'none';
  $('#canvas-single').style.display = yearMode === 'dual' ? 'none' : 'block';
  closeTreeDialog();
  state.single?.exitRoam();                          // 切期退出漫游
  $('#btn-roam')?.classList.remove('active');
  if (state.mode !== 'full') resetModeToFull();   // 上下文切换：显示模式表里一致

  // 双期模式视野小：自动收起统计面板，退出时恢复进入前状态
  if (yearMode === 'dual') {
    const sp = $('#stats-panel');
    state._preDualStats = !sp || sp.style.display !== 'block' ? null
      : (sp.classList.contains('sp-collapsed') ? 'collapsed' : 'open');
    if (state._preDualStats) setStatsCollapsed(true, false);
  } else if (state._preDualStats) {
    // 恢复进入双期前的显隐与折叠态（'open'=展开开启 / 'collapsed'=折叠开启）
    setStatsCollapsed(state._preDualStats === 'collapsed', false);
    if (state._preDualStats !== 'closed') openStatsPanel(true);
    state._preDualStats = null;
  }

  if (yearMode === 'dual') enterDual();
  else enterSingle(yearMode);
  syncGrowth();
  scheduleDeepLink();
}

/** 新建/重建场景后应用界面偏好：ghost 策略 + 科研图层 + 林下草本层（沉浸时覆盖隐藏科研层）。 */
function applyScenePrefs(s) {
  s.ghostStrategy = state.savedGhost;
  s.setScienceLayer(state.scienceOn && !state.immersive);
  s.setUndergrowth(state.undergrowthOn);
}

function populateDualYearSelects(yLeft, yMid, yRight) {
  const opts = state.years.map((y) => `<option value="${y}">${y} 期</option>`).join('');
  const sL = $('#pane-year-left'), sM = $('#pane-year-mid'), sR = $('#pane-year-right');
  if (sL) { sL.innerHTML = opts; sL.value = String(yLeft); }
  if (sM) { sM.innerHTML = opts; sM.value = String(yMid); }
  if (sR) { sR.innerHTML = opts; sR.value = String(yRight); }
  const lblL = $('#pane-label-left'), lblM = $('#pane-label-mid'), lblR = $('#pane-label-right');
  if (lblL) lblL.textContent = `${yLeft} 年调查`;
  if (lblM) lblM.textContent = `${yMid} 年调查`;
  if (lblR) lblR.textContent = `${yRight} 年调查`;
}

function rebuildDualPaneScene(slot, newYear) {
  const y = Number(newYear);
  const sc = state.scenesLR[slot];
  if (!sc || !state.scenes[y]) return;
  const [y0, y1] = comparePair();
  const otherY = y === y0 ? y1 : y0;
  sc.year = y;
  sc.buildLightweight(
    state.scenes[y].trees,
    state.scenes[otherY]?.trees || null,
    [y, otherY]
  );
  applyScenePrefs(sc);
  sc.applyDisplayMode(state.mode, state.focusTag);
  const lbl = $(`#pane-label-${slot}`);
  if (lbl) lbl.textContent = `${y} 年调查`;
}

function enterDual() {
  if (state.years.length < 2) {
    enterSingle(String(state.years[0]));
    return;
  }
  const ys = state.years.slice();
  const yA = state.dualLeftYear && ys.includes(state.dualLeftYear) ? state.dualLeftYear : ys[0];
  const yB = state.dualRightYear && ys.includes(state.dualRightYear) ? state.dualRightYear : ys[ys.length - 1];
  const yM = state.dualMidYear && ys.includes(state.dualMidYear)
    ? state.dualMidYear
    : (ys.length >= 3 ? ys[Math.floor(ys.length / 2)] : ys[0]);
  state.dualLeftYear = yA;
  state.dualMidYear = yM;
  state.dualRightYear = yB;
  populateDualYearSelects(yA, yM, yB);

  // 手机竖屏进入双期/多期对比时，自动默认切换为上下叠放分屏，保障每窗视野开阔
  const wrap = $('#dual-wrap');
  const layoutBtn = $('#btn-dual-layout');
  if (wrap && window.innerWidth <= 820 && window.innerHeight > window.innerWidth && !state._dualLayoutUserSet) {
    wrap.classList.add('layout-vertical');
    if (layoutBtn) layoutBtn.textContent = '⬒ 上下分屏';
  }

  if (!state.scenesLR.left) {
    state.dualLeader = 'left';
    state.scenesLR.left = new ForestScene($('#view-left'), yA,
      { onPick: (hit) => onPick(hit, state.scenesLR.left?.year || yA),
        onRoamEnd: () => $('#btn-roam')?.classList.remove('active') });
    state.scenesLR.right = new ForestScene($('#view-right'), yB,
      { onPick: (hit) => onPick(hit, state.scenesLR.right?.year || yB),
        onRoamEnd: () => $('#btn-roam')?.classList.remove('active') });

    const bindLeader = (slot, el) => {
      if (!el) return;
      el.addEventListener('pointerdown', () => { state.dualLeader = slot; }, { passive: true });
      el.addEventListener('wheel', () => { state.dualLeader = slot; }, { passive: true });
    };
    bindLeader('left', $('#view-left'));
    bindLeader('right', $('#view-right'));

    // 双向自适应相机同步（支持任意一窗拖拽带动其余视窗，也可一键切换独立自由视角）
    const syncTick = () => {
      if (state.yearMode !== 'dual' || !state.scenesLR.left) return;
      if (state.dualSync !== false) {
        const leader = state.scenesLR[state.dualLeader || 'left'] || state.scenesLR.left;
        for (const [k, sc] of Object.entries(state.scenesLR)) {
          if (!sc || sc === leader) continue;
          sc.camera.position.copy(leader.camera.position);
          sc.controls.target.copy(leader.controls.target);
          sc.controls.update();
        }
      }
      requestAnimationFrame(syncTick);
    };
    requestAnimationFrame(syncTick);
  }

  rebuildDualPaneScene('left', yA);
  rebuildDualPaneScene('right', yB);
  if (state.dual3Pane && state.scenesLR.mid) {
    rebuildDualPaneScene('mid', yM);
  }

  requestAnimationFrame(() => {
    for (const sc of activeScenes()) sc._resize();
    state.scenesLR.left.viewBird();
  });
}

function enterSingle(yearMode) {
  if (state.scenesLR.left) {
    state.scenesLR.left.dispose();
    state.scenesLR.mid?.dispose();
    state.scenesLR.right.dispose();
    state.scenesLR = {};
  }
  const s = state.single;
  s._resize();
  const y = Number(yearMode);
  s.year = y;
  const [y0, y1] = comparePair();
  const other = state.years.length >= 2 ? (y === y0 ? y1 : y0) : null;
  s.buildLightweight(
    state.scenes[y]?.trees || [],
    other != null ? (state.scenes[other]?.trees || null) : null,
    state.years.length >= 2 ? [y0, y1] : [y, y]);
  applyScenePrefs(s);
  s.viewBird();
  s.applyDisplayMode(state.mode, state.focusTag);
}

/** 样地切换后整体重建：销毁全部场景实例，按当前显示模式用新数据重建。 */
function rebuildAllScenes() {
  closeTreeDialog();
  if (state.scenesLR.left) {
    state.scenesLR.left.dispose();
    state.scenesLR.mid?.dispose();
    state.scenesLR.right.dispose();
    state.scenesLR = {};
  }
  if (state.dual3Pane && state.years.length >= 2) {
    const midEl = $('#view-mid'), sp2 = $('#dual-splitter-2');
    if (midEl) midEl.style.display = 'none';
    if (sp2) sp2.style.display = 'none';
    state.dual3Pane = false;
    $('#btn-dual-3pane')?.classList.remove('active');
  }
  if (state.single) state.single.dispose();
  resetModeToFull();   // 样地上下文变更：显示模式复位，保持表里一致
  const y = state.yearMode === 'dual' ? state.years[0] : Number(state.yearMode);
  state.single = new ForestScene($('#canvas-single'), y,
    { onPick: (hit) => onPick(hit, state.single?.year ?? y),
      onRoamEnd: () => $('#btn-roam')?.classList.remove('active') });
  const [y0, y1] = comparePair();
  const other = state.years.length >= 2 ? (y === y0 ? y1 : y0) : null;
  state.single.buildLightweight(
    state.scenes[y]?.trees || [],
    other != null ? (state.scenes[other]?.trees || null) : null,
    state.years.length >= 2 ? [y0, y1] : [y, y]);
  if (state.yearMode === 'dual' && state.years.length >= 2) enterDual();
  else enterSingle(state.yearMode === 'dual' ? String(state.years[0]) : state.yearMode);
  for (const s of activeScenes()) applyScenePrefs(s);
  syncGrowth();
}

// ------------------------------------------------ 拾取与选择

function onPick(hit, paneYear = null) {
  const _t0 = performance.now();
  try {
    _onPick(hit, paneYear);
  } finally {
    window.__lastPickMs = Math.round((performance.now() - _t0) * 100) / 100;
  }
}

function _onPick(hit, paneYear = null) {
  if (!hit) {
    // 点击空地：关闭详情卡；单树查看中则退出回完整样地（全部实体）
    if (state.dialogTag) closeTreeDialog();
    if (state.mode === 'single') setMode('full');
    return;
  }
  const tag = hit.tag;
  if (state.mode === 'multi') {
    // 多选模式：点击加入/取消（再点一次即取消，实体⇄透明），同时出该树的渲染卡
    toggleTreeCompare(tag);
    openTreeDialog(tag, paneYear);
  } else {
    // 点击树 = 进入单树查看：聚焦树实体、其余透明、自动定位、出渲染卡。
    // 先开卡（保留点击面板的年份上下文），setMode 检测 dialogTag 一致则不重建。
    openTreeDialog(tag, paneYear);
    setMode('single', tag);
  }
}

/** 加入/移除对比（多选）。所有活动场景同步，高亮环即时反馈。 */
function toggleTreeCompare(tag) {
  for (const s of activeScenes()) s.toggleSelect(tag);
  for (const s of activeScenes()) s.applyDisplayMode(state.mode, state.focusTag); // 实体/透明联动
  renderSelectionList();
  if (state.dialogTag) updateDialogButtons(state.dialogTag);  // 按钮态+导航计数联动刷新
  scheduleDeepLink();
}

function renderSelectionList() {
  const el = $('#sel-wrap');
  if (!el) return;
  const selScene = state.yearMode === 'dual' ? state.scenesLR.left : state.single;
  const tags = selScene ? [...selScene.selected].sort((a, b) => Number(a) - Number(b)) : [];
  el.style.display = (state.mode === 'multi' || tags.length > 0) ? 'flex' : 'none';
  el.innerHTML = tags.length
    ? tags.map((t) => {
        const m = state.manifest?.trees?.find((x) => x.tag === t);
        return `<span class="sel-chip" data-tag="${t}" title="点击查看渲染图">`
          + `${t}${m ? ' ⭐' : ''} <b data-remove="${t}" title="移除出对比">✕</b></span>`;
      }).join('') +
      `<button id="btn-showsel" class="mini" title="主视图仅显示所选树">仅显示所选(${tags.length})</button>` +
      `<button id="btn-clearsel" class="mini">清空</button>` +
      `<span class="dim">点树名看渲染图</span>`
    : '<span class="dim">多选模式：点击树木加入对比（变实体），再点一次取消</span>';
  el.querySelectorAll('.sel-chip').forEach((chip) =>
    chip.addEventListener('click', (e) => {
      if (e.target.dataset.remove) return;
      openTreeDialog(chip.dataset.tag);
    }));
  el.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => toggleTreeCompare(b.dataset.remove)));
  const show = el.querySelector('#btn-showsel');
  if (show) show.addEventListener('click', () => setMode('multi'));
  const clr = el.querySelector('#btn-clearsel');
  if (clr) clr.addEventListener('click', () => {
    for (const s of activeScenes()) s.clearSelection();
    renderSelectionList();
    scheduleDeepLink();
  });
}

/** 科研契约：选择状态导出。 */
function getSelectionState() {
  const selScene = state.yearMode === 'dual' ? state.scenesLR.left : state.single;
  const quality = {};
  for (const tag of (selScene?.selected ?? [])) {
    const cmp = state.compare.trees.find((t) => t.tag === tag);
    quality[tag] = cmp
      ? { dbh: cmp.dbh, height: cmp.height, flags: cmp.flags }
      : { note: 'bg_tree' };
  }
  return {
    plot_id: state.plotId,
    survey_periods: state.yearMode === 'dual'
      ? [...state.years] : [Number(state.yearMode)],
    selected_tree_ids: [...(selScene?.selected ?? [])].sort((a, b) => Number(a) - Number(b)),
    view_mode: state.mode,
    quality_status: quality,
    note: '树牌号为准；数组下标/渲染顺序不构成身份',
  };
}

// ------------------------------------------------ 树木详情卡（左渲染图/右详情，停靠右侧）

function openTreeDialog(tag, yearHint = null) {
  state.dialogTag = tag;
  state.dialogYear = yearHint
    ?? (state.yearMode === 'dual' ? state.years[0] : Number(state.yearMode));
  $('#tree-card').classList.add('open');
  setCardCollapsed(false, false); // 确保打开单木卡时完整展开右侧信息，绝不折叠隐藏数据

  fillTreeDialogTitle(tag);
  fillTreeDialogInfo(tag, state.dialogYear);
  updateDialogButtons(tag);
  updateDialogNav(tag);
  updateAnnotateBox(tag);

  // 年份切换（多期样地均可直接切换该树各调查期的三维渲染与数据）
  const yrRow = $('#tc-year-row');
  if (state.years.length >= 2) {
    yrRow.style.display = 'flex';
    yrRow.innerHTML = '<span class="dim">年份</span>' + state.years.map((y) =>
      `<button class="mini td-yr ${Number(y) === state.dialogYear ? 'active' : ''}" data-y="${y}">${y}</button>`
    ).join('');
    yrRow.querySelectorAll('.td-yr').forEach((b) => {
      b.onclick = () => {
        state.dialogYear = Number(b.dataset.y);
        yrRow.querySelectorAll('.td-yr').forEach((x) =>
          x.classList.toggle('active', Number(x.dataset.y) === state.dialogYear));
        fillTreeDialogInfo(tag, state.dialogYear);
        state.portrait?.show(tag, state.dialogYear);
      };
    });
  } else {
    yrRow.style.display = 'none';
  }

  // 实例持久化：首次创建后复用（渲染器/画布不重建，翻页与重开零成本）
  if (!state.portrait || state.portrait._disposed) {
    state.portrait?.dispose();
    state.portrait = new TreePortrait($('#tc-view3d'));
    window.__portrait = state.portrait;   // 调试/验收句柄
  }
  state.portrait.show(tag, state.dialogYear);
}

function fillTreeDialogTitle(tag) {
  const meta = state.manifest?.trees?.find((x) => x.tag === tag);
  const cmp = state.compare.trees.find((x) => x.tag === tag);
  const td = findTreeData(tag, state.dialogYear) || cmp || {};
  const tier = `${meta ? '⭐ 高精度展示模型' : '参数化示意'}${dataNature() === 'simulated' ? ' · 模拟数据' : ''}`;
  $('#tc-title').innerHTML = `
    <span class="tag-badge">${tag}</span>
    <span class="species">${td.species ?? ''}</span>
    <span class="seq">${tier} · 编号 ${td.seq_no ?? '—'}</span>
  `;
}

function fillTreeDialogInfo(tag, year) {
  const meta = state.manifest?.trees?.find((x) => x.tag === tag);
  const cmp = state.compare.trees.find((x) => x.tag === tag);
  const sceneT = state.scenes[year]?.trees.find((x) => x.tag === tag)
    || (cmp ? { tag, seq_no: cmp.seq_no, species: cmp.species, x: cmp.x, y: cmp.y,
                dbh_cm: cmp.dbh[year]?.value, dbh_status: cmp.dbh[year]?.status,
                height_m: cmp.height[year]?.value, height_status: cmp.height[year]?.status,
                source_file: '', row_index: null } : null);
  if (!sceneT) { $('#tc-info').innerHTML = ''; return; }

  let dualBlock = '';
  if (state.years.length >= 2) {
    const allY = state.years.slice().sort((a, b) => a - b);
    const getYrTree = (y) => state.scenes[y]?.trees.find((x) => x.tag === tag);
    const dVals = allY.map((y) => {
      const st = getYrTree(y);
      if (st && st.dbh_cm != null) return { y, val: st.dbh_cm, status: st.dbh_status || 'measured' };
      return { y, val: cmp?.dbh?.[String(y)]?.value ?? null, status: cmp?.dbh?.[String(y)]?.status ?? 'missing' };
    });
    const hVals = allY.map((y) => {
      const st = getYrTree(y);
      if (st && st.height_m != null) return { y, val: st.height_m, status: st.height_status || 'measured' };
      return { y, val: cmp?.height?.[String(y)]?.value ?? null, status: cmp?.height?.[String(y)]?.status ?? 'missing' };
    });
    const cVals = allY.map((y) => {
      const st = getYrTree(y);
      if (st && st.crown_ns_m != null) return st.crown_ns_m;
      return cmp?.crown_ns?.[String(y)]?.value ?? '—';
    });

    const calcDeltaCell = (arr, unit) => {
      const first = arr[0], last = arr[arr.length - 1];
      if (!first || !last || first.status !== 'measured' || last.status !== 'measured' || first.val == null || last.val == null) {
        return '<span class="dim">无（含非实测值）</span>';
      }
      const v = Math.round((last.val - first.val) * 100) / 100;
      const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
      return `<span class="${cls}">${v > 0 ? '+' : ''}${v} ${unit}</span>`;
    };

    const thCols = allY.map((y) => `<th>${y}</th>`).join('');
    const dCols = dVals.map((d) => `<td>${d.val ?? '—'} ${statusChip(d.status)}</td>`).join('');
    const hCols = hVals.map((h) => `<td>${h.val ?? '—'} ${statusChip(h.status)}</td>`).join('');
    const cCols = cVals.map((c) => `<td>${c}</td>`).join('');

    dualBlock = `
      <div class="cmp-title">${allY.length >= 3 ? `多期实测演替对比（共 ${allY.length} 期）` : '两期实测与差值'}</div>
      <table class="info-table">
        <tr><th></th>${thCols}<th>总 Δ</th></tr>
        <tr><td>胸径 cm</td>${dCols}<td>${calcDeltaCell(dVals, 'cm')}</td></tr>
        <tr><td>树高 m</td>${hCols}<td>${calcDeltaCell(hVals, 'm')}</td></tr>
        <tr><td>冠幅 m</td>${cCols}<td></td></tr>
      </table>
      ${(cmp?.flags || []).length ? `<div class="note">标记：${cmp.flags.join('、')}</div>` : ''}
      <div class="note dim">总 Δ = ${allY[allY.length - 1]} − ${allY[0]}；负树高差为原始记录事实，不自动认定生长倒退。</div>`;
  }

  const measured = sceneT.dbh_status === 'measured' && sceneT.height_status === 'measured';
  const svOk = measured && sceneT.dbh_cm > 0 && sceneT.height_m > 1.4;
  const sv = svOk ? stemVolume(sceneT.height_m, sceneT.dbh_cm) : null;
  const spProf = lwSpecies(sceneT.species);
  const spBlock = `
    <div class="species-box">
      <div class="sb-head">
        <span>🌿 ${spProf.fullName || spProf.name}</span>
        <span class="sb-latin">${spProf.latin}</span>
      </div>
      <div class="sb-grid">
        <span>科属分类</span><span>${spProf.family} · ${spProf.leafHabit}</span>
        <span>冠形构型</span><span>${spProf.crownDesc}（典型枝下高比 ~${Math.round((spProf.cbRatio || 0.3) * 100)}%）</span>
        <span>树皮特征</span><span>${spProf.barkDesc}</span>
        <span>叶部物候</span><span>${spProf.foliageDesc}</span>
        <span>林学特性</span><span>${spProf.ecology}</span>
      </div>
    </div>`;
  $('#tc-info').innerHTML = `
    <table class="info-table" style="margin-top:10px">
      <tr><td>胸径</td><td>${sceneT.dbh_cm ?? '—'} cm ${statusChip(sceneT.dbh_status)}</td></tr>
      <tr><td>树高</td><td>${sceneT.height_m ?? '—'} m ${statusChip(sceneT.height_status)}</td></tr>
      ${sv ? (sv.valid
        ? `<tr><td>材积</td><td>${sv.volume.toFixed(3)} m³ · 形数 ${sv.formFactor.toFixed(2)}
            <span class="dim">(四段干曲线概念估算·未经树种校准)</span></td></tr>`
        : `<tr><td>材积</td><td><span class="dim">不输出——${sv.invalidReason}；概念模型未经树种校准</span></td></tr>`)
        : ''}
      <tr><td>局部坐标</td><td>X ${sceneT.x}，Y ${sceneT.y} <span class="dim">(未配准)</span></td></tr>
      ${sceneT.source_file ? `<tr><td>数据来源</td><td>${sceneT.source_file} · 第 ${sceneT.row_index ?? '?'} 行</td></tr>` : ''}
    </table>
    ${spBlock}
    ${dualBlock}
    ${sv && sv.valid ? `<div class="sp-head" style="margin-top:9px">干形纵剖面（实测 DBH/H 反演）</div>
      ${stemProfileSvg(sceneT.height_m, sceneT.dbh_cm, 640, 130)}` : ''}
    ${measured ? `<div class="note dim">三维按该树实测参数实时渲染（树种资产模板 + 胸径锥度修正），胸高直径与树高与调查记录一致。</div>` : ''}
  `;
  void meta;
}

function statusChip(status) {
  const map = {
    measured: ['实测', 'ok'], zero: ['0值·待核实', 'warn'], missing: ['缺失·待核实', 'warn'],
    error: ['#N/A·待核实', 'bad'], suspect: ['异常·待核实', 'bad'],
  };
  const info = map[status] || [String(status ?? '—'), 'warn'];
  return `<span class="chip ${info[1]}">${info[0]}</span>`;
}

function updateDialogButtons(tag) {
  const selScene = state.yearMode === 'dual' ? state.scenesLR.left : state.single;
  const selected = selScene?.selected ?? new Set();
  const inSel = selected.has(tag);
  $('#tc-actions').innerHTML = `
    <button class="td-btn ${inSel ? 'warn' : 'primary'}" id="tc-toggle">
      ${inSel ? '移除出对比 ✓' : '加入对比'}
    </button>
    <button class="td-btn" id="tc-isolate">仅显示此树</button>
    <button class="td-btn" id="tc-focus">在样地中定位</button>
    <div class="td-nav" id="tc-nav" style="display:none">
      <button class="mini" id="tc-prev">‹</button>
      <span class="td-count" id="tc-count"></span>
      <button class="mini" id="tc-next">›</button>
    </div>
  `;
  $('#tc-toggle').onclick = () => toggleTreeCompare(tag);
  $('#tc-isolate').onclick = () => setMode('single', tag);   // 保持卡片打开，渲染与隔离视图并排
  $('#tc-focus').onclick = () => {
    closeTreeDialog();
    activeScenes()[0]?.focusOn([tag], 12);
  };
  updateDialogNav(tag);
}

/** 已选多棵时显示 ‹ i/N › 翻看每棵树的渲染图。 */
function updateDialogNav(tag) {
  const nav = $('#tc-nav');
  if (!nav) return;
  const selScene = state.yearMode === 'dual' ? state.scenesLR.left : state.single;
  const list = selScene ? [...selScene.selected].sort((a, b) => Number(a) - Number(b)) : [];
  const idx = list.indexOf(tag);
  if (list.length > 1 && idx >= 0) {
    nav.style.display = 'flex';
    $('#tc-count').textContent = `${idx + 1}/${list.length}`;
    const go = (t) => {
      openTreeDialog(t);
      activeScenes()[0]?.focusOn([t], 14, cardLateral());
    };
    $('#tc-prev').onclick = () => go(list[(idx - 1 + list.length) % list.length]);
    $('#tc-next').onclick = () => go(list[(idx + 1) % list.length]);
  } else {
    nav.style.display = 'none';
  }
}

function closeTreeDialog() {
  $('#tree-card').classList.remove('open');
  state.dialogTag = null;
  state.portrait?.pause();          // 停渲染循环但保留实例，重开零成本
}

// ------------------------------------------------ UI 绑定

function bindUI() {
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('.year-btn').forEach((b) =>
    b.addEventListener('click', () => setYear(b.dataset.year)));
  $('#plot-select').addEventListener('change', (e) => switchPlot(e.target.value));
  $('#btn-bird').addEventListener('click', () => activeScenes()[0]?.viewBird());
  $('#btn-inside').addEventListener('click', () => activeScenes()[0]?.viewInside());
  $('#btn-top').addEventListener('click', () => activeScenes()[0]?.viewTop());
  $('#btn-roam').addEventListener('click', (e) => {
    if (state.yearMode === 'dual') { hint('漫游仅单期视图可用（双期请先切回单期）'); return; }
    const s = state.single;
    if (!s) return;
    if (s._roam) { s.exitRoam(); e.target.classList.remove('active'); return; }
    closeTreeDialog();
    if (s.enterRoam()) {
      e.target.classList.add('active');
      hint('漫游：WASD 移动 · 鼠标转视角 · Shift 加速 · Q/E 升降 · Esc 退出');
    }
  });
  $('#btn-reset').addEventListener('click', () => activeScenes()[0]?.viewReset());
  // 三维截图：渲染帧导出 PNG 下载
  $('#btn-screenshot').addEventListener('click', () => {
    const s = state.yearMode === 'dual' ? state.scenesLR.left : state.single;
    if (!s) return;
    const shot = s.screenshot();
    const a = document.createElement('a');
    a.href = shot.dataUrl;
    a.download = `linyang_${shot.meta.plot}_${shot.meta.year}_${Date.now()}.png`;
    a.click();
    hint('三维截图已导出（参数化结构示意·未配准）');
  });
  // 生长动画：插值示意播放，端点=实测参数
  $('#btn-growth-anim').addEventListener('click', (e) => {
    if (state.yearMode === 'dual' || state.years.length < 2) {
      hint('生长动画需单期视图且样地至少包含两个调查期');
      return;
    }
    const [y0, y1] = comparePair();
    const s = state.single;
    if (!s) return;
    const btn = e.target;
    if (s._growthAnim) { s.stopGrowthAnimation(); btn.textContent = '▶ 生长动画'; return; }
    btn.textContent = '⏸ 停止';
    s.playGrowthAnimation(4000, () => {
      btn.textContent = '▶ 生长动画';
      hint(`生长动画完成（${y0}→${y1}，插值示意，端点=实测参数）`);
    });
  });
  $('#btn-restore').addEventListener('click', () => setMode('full'));
  $('#ghost-select')?.addEventListener('change', (e) => {
    const g = e.target.value;
    state.savedGhost = g;
    savePrefs({ ghost: g });
    for (const s of activeScenes()) s.setGhostStrategy(g);
  });
  $('#crown-style-select')?.addEventListener('change', (e) => {
    const cs = e.target.value;
    state.crownStyle = cs;
    savePrefs({ crownStyle: cs });
    rebuildAllScenes();
    const labelMap = {
      layered: '已切换为「分层清晰林相（推荐·单木分明）」',
      classic: '已切换为「经典极简几何（原版风格）」',
      detailed: '已切换为「枝叶簇细节（适合林内近景）」',
    };
    hint(labelMap[cs] || '');
  });
  $('#btn-manage')?.addEventListener('click', () => {
    const yr = state.yearMode === 'dual' ? state.years[0] : (Number(state.yearMode) || state.single?.year || state.years[0]);
    window.location.href = `manage.html?plot=${encodeURIComponent(state.plotId)}&year=${yr}`;
  });
  $('#tc-ruler-btn')?.addEventListener('click', (e) => {
    const on = e.currentTarget.classList.toggle('active');
    state.portrait?.setRulerVisible(on);
  });
  // 季节物候切换（夏季苍翠 ⇄ 秋季彩林）
  const seasonBtn = $('#btn-season');
  if (seasonBtn) {
    const syncSeasonBtn = () => {
      const aut = state.season === 'autumn';
      seasonBtn.classList.toggle('active', aut);
      seasonBtn.textContent = aut ? '🍂 秋季物候' : '🌿 夏季物候';
    };
    syncSeasonBtn();
    seasonBtn.addEventListener('click', () => {
      state.season = state.season === 'autumn' ? 'summer' : 'autumn';
      savePrefs({ season: state.season });
      syncSeasonBtn();
      for (const s of activeScenes()) s.setSeason(state.season);
      updatePlotChrome();
      if (state.dialogTag && state.portrait) {
        state.portrait.show(state.dialogTag, state.dialogYear);
      }
      hint(state.season === 'autumn'
        ? '已切换为秋季物候示意（落叶树种转秋叶色，常绿针叶保持苍翠）'
        : '已切换为夏季盛叶期物候示意');
    });
  }
  // 东北森林树种图鉴面板
  $('#btn-atlas')?.addEventListener('click', () => {
    const m = $('#species-modal');
    if (!m) return;
    const open = m.classList.toggle('open');
    $('#btn-atlas').classList.toggle('active', open);
    $('#env-drawer')?.classList.remove('open');
    $('#btn-toggle-env')?.classList.remove('active');
    if (open) renderSpeciesAtlasModal();
  });
  $('#sm-close')?.addEventListener('click', () => {
    $('#species-modal')?.classList.remove('open');
    $('#btn-atlas')?.classList.remove('active');
  });

  // 软件级「🎛 场景与图层」收纳面板 & 「🎥 视角工具坞」 & 「▴ 隐藏界面」控制
  const envDrawer = $('#env-drawer');
  const envBtn = $('#btn-toggle-env');
  envBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = envDrawer?.classList.toggle('open');
    envBtn.classList.toggle('active', !!open);
  });
  $('#env-drawer-close')?.addEventListener('click', () => {
    envDrawer?.classList.remove('open');
    envBtn?.classList.remove('active');
  });
  document.addEventListener('pointerdown', (e) => {
    if (envDrawer?.classList.contains('open')) {
      if (!envDrawer.contains(e.target) && e.target !== envBtn) {
        envDrawer.classList.remove('open');
        envBtn?.classList.remove('active');
      }
    }
  });

  const viewRow = $('#view-row');
  const viewBarBtn = $('#btn-toggle-viewbar');
  const setViewBarVisible = (vis) => {
    if (!viewRow) return;
    viewRow.classList.toggle('vr-hidden', !vis);
    viewBarBtn?.classList.toggle('active', vis);
    if (viewBarBtn) viewBarBtn.textContent = vis ? '🎥 视角工具 ▾' : '🎥 视角工具 ▸';
    window.dispatchEvent(new Event('resize'));
  };
  viewBarBtn?.addEventListener('click', () => {
    setViewBarVisible(viewRow?.classList.contains('vr-hidden'));
  });
  $('#btn-vr-collapse')?.addEventListener('click', () => setViewBarVisible(false));
  // 手机窄屏默认收起次级视角坞，保持画面清爽（点击顶栏『🎥 视角工具』即可展开）
  if (window.innerWidth <= 820) {
    setViewBarVisible(false);
  }

  $('#btn-hide-ui')?.addEventListener('click', () => {
    document.body.classList.add('ui-minimized');
    window.dispatchEvent(new Event('resize'));
    hint('已隐藏顶部控制栏（点击左上角『🌲 展开工具栏』可恢复）');
  });
  $('#ui-restore-pill')?.addEventListener('click', () => {
    document.body.classList.remove('ui-minimized');
    window.dispatchEvent(new Event('resize'));
  });
  // 浮动面板拖拽与右下角自由缩放支持（统计面板 + 树木详情卡 + 树种图鉴 + 指令台）
  makeDraggable($('#stats-panel'), $('#sp-drag-handle'));
  makeDraggable($('#tree-card'), $('#tc-drag-bar'));
  makeDraggable($('#tree-card'), $('#tc-title'));
  makeDraggable($('#species-modal'), $('#sm-drag-handle'));
  makeDraggable($('#cmd-modal'), $('#cmd-drag-handle'));
  makeResizable($('#stats-panel'), $('[data-resize="stats-panel"]'));
  makeResizable($('#tree-card'), $('[data-resize="tree-card"]'), () => state.portrait?._resize?.());
  makeResizable($('#species-modal'), $('[data-resize="species-modal"]'));
  bindDualWorkspaceControls();
  bindRoamControls();
  initCommandConsole();
  bindCompassAndAzimuthControls();
  bindAnnotationControls();
  // ← 返回：进入研究区地图（导航中枢）；旧 index.html 保留为兼容入口（带提示条），
  // 不再作为"返回"目的地（R4-08 / 架构评审）。
  const backBtn = $('#btn-back');
  backBtn.dataset.href = 'map.html';   // 供冒烟测试断言导航目的地
  backBtn.addEventListener('click', () => {
    window.location.href = `map.html?plot=${encodeURIComponent(state.plotId)}`;
  });
  $('#btn-search').addEventListener('click', doSearch);
  $('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  $('#btn-science').addEventListener('click', (e) => {
    state.scienceOn = e.target.classList.toggle('active');
    savePrefs({ scienceOn: state.scienceOn });
    if (!state.immersive) for (const s of activeScenes()) s.setScienceLayer(state.scienceOn);
  });
  $('#btn-undergrowth')?.addEventListener('click', (e) => {
    state.undergrowthOn = e.currentTarget.classList.toggle('active');
    savePrefs({ undergrowthOn: state.undergrowthOn });
    for (const s of activeScenes()) s.setUndergrowth(state.undergrowthOn);
    hint(state.undergrowthOn
      ? '已开启林下草本与苔石生态示意层（薹草/蕨类/灌草/苔石·不计入乔木统计）'
      : '已隐藏林下草本示意层');
  });
  $('#btn-wind')?.addEventListener('click', (e) => {
    state.windOn = e.currentTarget.classList.toggle('active');
    savePrefs({ windOn: state.windOn });
    updateGlobalWind(performance.now(), state.windOn);
    hint(state.windOn ? '已开启林冠与林下草本微风轻拂动画' : '已暂停微风摇曳（静态观测模式）');
  });
  $('#btn-stats').addEventListener('click', () => {
    const panel = $('#stats-panel');
    openStatsPanel(panel.style.display !== 'block');
  });
  $('#sp-toggle').addEventListener('click', () => {
    setStatsCollapsed(!$('#stats-panel').classList.contains('sp-collapsed'));
  });
  $('#sp-close').addEventListener('click', () => openStatsPanel(false));
  $('#legend-collapse').addEventListener('click', (e) => {
    const lg = $('#legend');
    const collapsed = lg.classList.toggle('legend-collapsed');
    e.target.textContent = collapsed ? '▸' : '▾';
  });
  $('#legend-close').addEventListener('click', () => {
    $('#legend').style.display = 'none';
  });
  const collapseCoord = (col) => {
    const box = $('#coord-warning');
    const pill = $('#coord-pill');
    if (box) box.style.display = col ? 'none' : 'flex';
    if (pill) pill.style.display = col ? 'block' : 'none';
    try { localStorage.setItem('lzv21.coord_collapsed', col ? '1' : '0'); } catch {}
  };
  $('#coord-collapse-btn')?.addEventListener('click', () => collapseCoord(true));
  $('#coord-close')?.addEventListener('click', () => collapseCoord(true));
  $('#coord-pill')?.addEventListener('click', () => collapseCoord(false));
  $('#coord-reopen')?.addEventListener('click', () => collapseCoord(false));
  if (localStorage.getItem('lzv21.coord_collapsed') === '1' || window.innerWidth <= 820) {
    collapseCoord(true);
  }
  if (window.innerWidth <= 820) {
    const lg = $('#legend');
    const lgBtn = $('#legend-collapse');
    if (lg && !lg.classList.contains('legend-collapsed')) {
      lg.classList.add('legend-collapsed');
      if (lgBtn) lgBtn.textContent = '▸';
    }
  }
  $('#tc-collapse')?.addEventListener('click', () => {
    setCardCollapsed(!$('#tree-card').classList.contains('card-collapsed'));
  });
  $('#tc-expand-btn')?.addEventListener('click', () => {
    setCardCollapsed(!$('#tree-card').classList.contains('card-collapsed'));
  });
  $('#tc-left-close')?.addEventListener('click', closeTreeDialog);
  $('#growth-range').addEventListener('input', (e) => {
    const t = Number(e.target.value) / 100;
    const s = state.yearMode === 'dual' ? null : state.single;
    s?.applyGrowth(t);
    const lbl = $('#growth-label');
    if (lbl) lbl.textContent = growthLabel(t);
  });
  $('#btn-immersive').addEventListener('click', (e) => {
    const on = state.immersive = e.target.classList.toggle('active');
    // 科研图层尊重科研模式按钮态：进入隐藏、退出恢复为按钮态（表里一致）
    for (const s of activeScenes()) s.setScienceLayer(!on && state.scienceOn);
    if (on) {
      // 记录并隐藏界面元素；退出时仅恢复沉浸自己隐藏的（不覆盖用户关闭选择）
      state._preImmersive = {};
      ['legend', 'sel-wrap', 'stats', 'growth-bar', 'coord-warning', 'coord-reopen']
        .forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            state._preImmersive[id] = el.style.display;
            el.style.display = 'none';
          }
        });
      const panel = $('#stats-panel');
      state._preImmersiveStats = panel.style.display === 'block';
      if (state._preImmersiveStats) openStatsPanel(false);   // 退出时对称恢复
    } else {
      Object.entries(state._preImmersive || {}).forEach(([id, disp]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = disp;
      });
      state._preImmersive = null;
      if (state._preImmersiveStats) openStatsPanel(true);
      state._preImmersiveStats = false;
      syncGrowth();      // 滑块条按当前模式恢复显隐
    }
  });
  // 详情卡：右上关闭按钮（点击空地关闭在 onPick 处理）
  $('#tc-close').addEventListener('click', closeTreeDialog);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 统一 Esc 语义：先关详情卡；若处于漫游状态则退出漫游；单木模式退回完整样地
    if (state.dialogTag) {
      closeTreeDialog();
      if (state.mode === 'single') setMode('full');
    } else if (state.single?._roam) {
      state.single.exitRoam();
      $('#btn-roam')?.classList.remove('active');
    } else if (state.mode !== 'full') {
      setMode('full');
    }
  });
}

/** 浮动面板右下角自由缩放（拖拽改变宽高并实时重排内部三维画布）。 */
function makeResizable(panel, handle, onResize = null) {
  if (!panel || !handle) return;
  let resizing = false, sx = 0, sy = 0, ow = 0, oh = 0;
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    resizing = true;
    const rect = panel.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY;
    ow = rect.width; oh = rect.height;
    try { handle.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  });
  handle.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const nw = Math.max(290, Math.min(window.innerWidth - 20, ow + (e.clientX - sx)));
    const nh = Math.max(210, Math.min(window.innerHeight - hudTopPx() - 20, oh + (e.clientY - sy)));
    panel.style.width = nw + 'px';
    panel.style.maxWidth = 'none';
    panel.style.height = nh + 'px';
    panel.style.maxHeight = 'none';
    if (panel.id === 'tree-card' && !panel.classList.contains('card-collapsed')) {
      const leftW = Math.max(210, Math.min(440, Math.round(nw * 0.44)));
      panel.style.gridTemplateColumns = `${leftW}px 1fr`;
      const v3d = $('#tc-view3d');
      if (v3d) v3d.style.height = Math.max(220, nh - 42) + 'px';
    }
    if (panel.id === 'stats-panel') {
      const body = $('#sp-body');
      if (body) body.style.maxHeight = Math.max(150, nh - 46) + 'px';
    }
    if (onResize) onResize();
  });
  const stop = () => { resizing = false; };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

/** 绑定双期/多期分屏工作台的尺寸拖拽分割条、视角同步/独立切换、每窗调查期下拉与衍生复测期。 */
function bindDualWorkspaceControls() {
  const wrap = $('#dual-wrap');
  if (!wrap) return;

  const resizeAllDual = () => {
    for (const sc of activeScenes()) sc._resize();
  };

  // 可拖拽分割条通用逻辑
  const bindSplitter = (splitter, paneA, paneB) => {
    if (!splitter || !paneA || !paneB) return;
    let dragging = false, startPos = 0, sizeA = 0, sizeB = 0;
    splitter.addEventListener('pointerdown', (e) => {
      dragging = true;
      splitter.classList.add('dragging');
      const vert = wrap.classList.contains('layout-vertical');
      startPos = vert ? e.clientY : e.clientX;
      const rA = paneA.getBoundingClientRect();
      const rB = paneB.getBoundingClientRect();
      sizeA = vert ? rA.height : rA.width;
      sizeB = vert ? rB.height : rB.width;
      try { splitter.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    });
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const vert = wrap.classList.contains('layout-vertical');
      const delta = (vert ? e.clientY : e.clientX) - startPos;
      const total = sizeA + sizeB;
      const newA = Math.max(150, Math.min(total - 150, sizeA + delta));
      const newB = Math.max(150, total - newA);
      paneA.style.flex = `${newA} 1 0px`;
      paneB.style.flex = `${newB} 1 0px`;
      resizeAllDual();
    });
    const stop = () => {
      dragging = false;
      splitter.classList.remove('dragging');
    };
    splitter.addEventListener('pointerup', stop);
    splitter.addEventListener('pointercancel', stop);
    splitter.addEventListener('dblclick', () => {
      paneA.style.flex = '1 1 50%';
      paneB.style.flex = '1 1 50%';
      resizeAllDual();
      hint('已恢复分屏视窗等比均分');
    });
  };

  bindSplitter($('#dual-splitter-1'), $('#view-left'), $('#view-right'));
  bindSplitter($('#dual-splitter-2'), $('#view-mid'), $('#view-right'));

  // 视角联动 / 独立自由视角切换
  $('#btn-dual-sync')?.addEventListener('click', (e) => {
    state.dualSync = state.dualSync === false;
    e.currentTarget.classList.toggle('active', state.dualSync);
    e.currentTarget.textContent = state.dualSync ? '🔗 视角联动' : '🔓 独立视角';
    hint(state.dualSync
      ? '已开启多视窗视角联动（拖动任意一个视窗，其余视窗实时同步）'
      : '已切换为独立自由视角（每个调查期视窗可独立旋转、缩放与观察）');
  });

  // 左右分屏 / 上下分屏切换
  $('#btn-dual-layout')?.addEventListener('click', (e) => {
    state._dualLayoutUserSet = true;
    const vert = wrap.classList.toggle('layout-vertical');
    e.currentTarget.textContent = vert ? '⬒ 上下分屏' : '◫ 左右分屏';
    requestAnimationFrame(resizeAllDual);
  });

  // 1:1 均分恢复
  $('#btn-dual-equal')?.addEventListener('click', () => {
    ['#view-left', '#view-mid', '#view-right'].forEach((sel) => {
      const el = $(sel);
      if (el) el.style.flex = '1 1 50%';
    });
    requestAnimationFrame(resizeAllDual);
    hint('已将所有打开的对比视窗恢复等比尺寸');
  });

  // 三窗同屏开关（支持三期并列对比）
  $('#btn-dual-3pane')?.addEventListener('click', (e) => {
    state.dual3Pane = !state.dual3Pane;
    e.currentTarget.classList.toggle('active', state.dual3Pane);
    const midEl = $('#view-mid'), sp2 = $('#dual-splitter-2');
    if (state.dual3Pane) {
      if (midEl) midEl.style.display = 'block';
      if (sp2) sp2.style.display = 'flex';
      const ys = state.years.slice();
      const yM = ys.length >= 3 ? ys[1] : ys[0];
      state.dualMidYear = yM;
      if (!state.scenesLR.mid && midEl) {
        state.scenesLR.mid = new ForestScene(midEl, yM, {
          onPick: (hit) => onPick(hit, state.scenesLR.mid?.year || yM),
          onRoamEnd: () => $('#btn-roam')?.classList.remove('active'),
        });
        midEl.addEventListener('pointerdown', () => { state.dualLeader = 'mid'; }, { passive: true });
        midEl.addEventListener('wheel', () => { state.dualLeader = 'mid'; }, { passive: true });
      }
      populateDualYearSelects(state.dualLeftYear || ys[0], yM, state.dualRightYear || ys[ys.length - 1]);
      rebuildDualPaneScene('mid', yM);
      hint('已开启三窗同屏对比（可自由选择每窗调查期并拖拽分割条调节各窗口宽度）');
    } else {
      if (midEl) midEl.style.display = 'none';
      if (sp2) sp2.style.display = 'none';
      hint('已切换回双视窗对比');
    }
    requestAnimationFrame(resizeAllDual);
  });

  // 衍生新复测期（让仅有 2 期的样地也可一键生成第 3/4 期体验多期演替对比）
  $('#btn-add-sim-period')?.addEventListener('click', () => {
    addDerivedSimPeriod();
  });

  // 各视窗顶部下拉自由切换调查期
  ['left', 'mid', 'right'].forEach((slot) => {
    const sel = $(`#pane-year-${slot}`);
    sel?.addEventListener('change', (e) => {
      const ny = Number(e.target.value);
      if (slot === 'left') state.dualLeftYear = ny;
      if (slot === 'mid') state.dualMidYear = ny;
      if (slot === 'right') state.dualRightYear = ny;
      rebuildDualPaneScene(slot, ny);
      hint(`已将${slot === 'left' ? '左' : slot === 'mid' ? '中' : '右'}视窗切换为 ${ny} 年调查期`);
    });
  });

  // 单窗最大化 / 还原按钮
  document.querySelectorAll('.pane-max-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.pane;
      const target = $(`#view-${slot}`);
      if (!target) return;
      const alreadyMax = target.dataset.maximized === '1';
      ['left', 'mid', 'right'].forEach((k) => {
        const el = $(`#view-${k}`);
        if (!el) return;
        if (alreadyMax) {
          el.style.flex = '1 1 50%';
          el.dataset.maximized = '0';
        } else {
          el.style.flex = k === slot ? '5 1 0px' : '1 1 0px';
          el.dataset.maximized = k === slot ? '1' : '0';
        }
      });
      requestAnimationFrame(resizeAllDual);
    });
  });
}

/** 基于当前样地最新期生长趋势衍生一个模拟复测期（标注为模拟推演期，不污染原始调查文件）。 */
function addDerivedSimPeriod() {
  const ys = state.years.slice().sort((a, b) => a - b);
  if (!ys.length) return;
  const lastY = ys[ys.length - 1];
  const step = ys.length >= 2 ? Math.max(2, lastY - ys[ys.length - 2]) : 3;
  const nextY = lastY + step;
  if (state.scenes[nextY]) {
    hint(`${nextY} 期已存在`);
    return;
  }
  const srcScene = state.scenes[lastY];
  if (!srcScene?.trees?.length) return;
  const newTrees = srcScene.trees.map((t, idx) => {
    const growD = t.dbh_status === 'measured' && t.dbh_cm > 0
      ? Math.round((t.dbh_cm + 0.65 + ((idx * 7) % 9) * 0.14) * 10) / 10
      : t.dbh_cm;
    const growH = t.height_status === 'measured' && t.height_m > 0
      ? Math.round((t.height_m + 0.45 + ((idx * 5) % 7) * 0.11) * 10) / 10
      : t.height_m;
    return {
      ...t,
      dbh_cm: growD,
      height_m: growH,
      crown_ns_m: t.crown_ns_m ? Math.round((t.crown_ns_m + 0.18) * 10) / 10 : t.crown_ns_m,
      crown_ew_m: t.crown_ew_m ? Math.round((t.crown_ew_m + 0.18) * 10) / 10 : t.crown_ew_m,
      source_file: `${state.plotId}-${nextY}(演替推演).sim`,
    };
  });
  state.scenes[nextY] = {
    ...srcScene,
    year: nextY,
    data_nature: 'simulated',
    trees: newTrees,
  };
  state.years.push(nextY);
  state.years.sort((a, b) => a - b);
  updatePlotChrome();
  rebuildAllScenes();
  if ($('#stats-panel')?.style.display === 'block') renderStatsPanel();
  hint(`已衍生 ${nextY} 年复测推演期（当前共 ${state.years.length} 期：${state.years.join(' / ')}，可开启三窗同屏或拖动多期演替轴）`);
}

/** 绑定林调员实景漫游 HUD 控件（一/三人称切换、自定义身高滑块与输入框、鼠标锁定、近身检视）。 */
function bindRoamControls() {
  state.roamHeightM = 1.72;
  state.roamViewMode = 'tpp_orbit';
  state.roamFlying = true;

  $('#roam-view-btn')?.addEventListener('click', () => {
    state.single?.cycleRoamViewMode();
  });
  $('#roam-fly-btn')?.addEventListener('click', () => {
    state.single?.toggleRoamFly();
  });
  const onHeightChange = (val) => {
    state.single?.setRoamAvatarHeight(val);
  };
  $('#roam-height-input')?.addEventListener('change', (e) => onHeightChange(Number(e.target.value)));
  $('#roam-height-range')?.addEventListener('input', (e) => onHeightChange(Number(e.target.value) / 100));
  $('#roam-lock-btn')?.addEventListener('click', () => {
    const dom = state.single?.renderer?.domElement;
    if (!dom) return;
    try { dom.requestPointerLock?.(); } catch { /* ignore */ }
  });
  $('#roam-exit-btn')?.addEventListener('click', () => {
    state.single?.exitRoam();
    $('#btn-roam')?.classList.remove('active');
  });
  $('#roam-inspect-btn')?.addEventListener('click', () => {
    const tag = state.single?._roam?.aimedTag || state.single?._roam?.nearestTag;
    if (tag) {
      if (document.pointerLockElement) document.exitPointerLock?.();
      openTreeDialog(tag, state.single.year);
    }
  });

  // 手机端触屏漫游虚拟摇杆（长按前进/后退/左右/升空/下降，松手即停）
  document.querySelectorAll('#roam-touch-pad [data-roam-key]').forEach((btn) => {
    const key = btn.dataset.roamKey;
    const press = (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      if (state.single?._roam) {
        if (key === 'Space' && !state.single._roam.flying && state.single._roam.pos.y <= 0.05) {
          state.single._roam.vy = 5.4;
        }
        state.single._roam.keys.add(key);
      }
    };
    const release = (e) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      state.single?._roam?.keys.delete(key);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });
}

function bindCompassAndAzimuthControls() {
  state.plotAzimuthDeg = Number(localStorage.getItem('lzv21.plot_azimuth.' + (state.plotId || 'fm1'))) || 0;
  const updateCompassLabel = () => {
    const btn = $('#btn-azimuth');
    if (btn) btn.textContent = `🧭 北向 ${state.plotAzimuthDeg}° ▾`;
    const cw = $('#cw-azimuth');
    if (cw) cw.textContent = `${state.plotAzimuthDeg}°`;
  };
  updateCompassLabel();

  $('#compass-rose')?.addEventListener('click', () => {
    const s = activeScenes()[0];
    if (!s) return;
    const c = s.extent / 2;
    const azRad = THREE.MathUtils.degToRad(state.plotAzimuthDeg || 0);
    const dist = 52;
    const camX = c + Math.sin(azRad) * dist;
    const camZ = c + Math.cos(azRad) * dist;
    s.tweenCamera(new THREE.Vector3(camX, 38, camZ), new THREE.Vector3(c, 4, c), 800);
    hint('已自动将视角校准对齐正北向');
  });

  $('#btn-azimuth')?.addEventListener('click', () => {
    const pop = $('#azimuth-popover');
    if (!pop) return;
    const show = pop.style.display !== 'block';
    pop.style.display = show ? 'block' : 'none';
    if (show) {
      const inp = $('#azimuth-input');
      if (inp) inp.value = String(state.plotAzimuthDeg || 0);
    }
  });

  $('#azimuth-close')?.addEventListener('click', () => {
    const pop = $('#azimuth-popover');
    if (pop) pop.style.display = 'none';
  });

  const applyAzimuth = (deg) => {
    const v = Math.round(Number(deg) || 0) % 360;
    state.plotAzimuthDeg = v;
    try { localStorage.setItem('lzv21.plot_azimuth.' + (state.plotId || 'fm1'), String(v)); } catch {}
    updateCompassLabel();
    const pop = $('#azimuth-popover');
    if (pop) pop.style.display = 'none';
    for (const sc of activeScenes()) sc._buildScienceLayer();
    hint(`已设定样地北向方位角为 ${v}°（东西南北四至向标已同步旋转）`);
  };

  $('#btn-save-azimuth')?.addEventListener('click', () => {
    const inp = $('#azimuth-input');
    if (inp) applyAzimuth(inp.value);
  });

  document.querySelectorAll('.az-preset').forEach((btn) => {
    btn.addEventListener('click', () => applyAzimuth(btn.dataset.deg));
  });
}

function bindAnnotationControls() {
  const onSave = () => {
    const tag = state.dialogTag;
    if (!tag) return;
    const sel = $('#tc-status-sel');
    const noteInp = $('#tc-status-note');
    const status = sel ? sel.value : 'living';
    const note = noteInp ? noteInp.value.trim() : '';
    savePlotAnnotation(tag, status, note);
    updateAnnotateBox(tag);
    if (state.portrait) state.portrait.show(tag, state.dialogYear);
    const labelMap = {
      living: '活立木·正常',
      felled: '采伐木·仅留伐桩',
      fallen: '倒木·地面卧倒',
      snag: '枯立木·自然枯死',
      broken: '断梢木·风折雷击',
      suspect: '生长异常·外业待查',
    };
    hint(`✓ 已将单木 #${tag} 标注为「${labelMap[status] || status}」，3D 场景与圆环已同步更新`);
  };

  $('#btn-save-status')?.addEventListener('click', onSave);
  $('#btn-apply-status')?.addEventListener('click', onSave);

  $('#tc-status-sel')?.addEventListener('change', () => {
    const sel = $('#tc-status-sel');
    const badge = $('#tc-status-badge');
    if (sel && badge) {
      const map = {
        living: ['活立木·正常', 'survey', '#d4e8d6', '#1d4d2b'],
        felled: ['🪓 采伐伐桩', 'warn', '#f5e3bb', '#8a6410'],
        fallen: ['🌪 风倒倒木', 'warn', '#faebd7', '#b05a10'],
        snag: ['🍂 枯立木', 'warn', '#e2e8f0', '#475569'],
        broken: ['⚡ 断梢折干', 'warn', '#dbeafe', '#1e40af'],
        suspect: ['❓ 异常待查', 'bad', '#f8d7d3', '#c0392b'],
      };
      const info = map[sel.value] || ['活立木·正常', 'survey', '#d4e8d6', '#1d4d2b'];
      badge.textContent = info[0];
      badge.className = 'badge ' + info[1];
      badge.style.background = info[2];
      badge.style.color = info[3];
    }
  });
}
function makeDraggable(panel, handle) {
  if (!panel || !handle) return;
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, select, input')) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY;
    ox = rect.left; oy = rect.top;
    panel.style.left = ox + 'px';
    panel.style.top = oy + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    try { handle.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nx = Math.max(6, Math.min(window.innerWidth - 120, ox + (e.clientX - sx)));
    const ny = Math.max(hudTopPx(), Math.min(window.innerHeight - 60, oy + (e.clientY - sy)));
    panel.style.left = nx + 'px';
    panel.style.top = ny + 'px';
  });
  const stop = () => { dragging = false; };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

/** 在当前样地中按树种名称一键高亮对比该树种（最多前 12 株进入多选高亮）。 */
function highlightSpeciesInPlot(speciesName) {
  const curYear = state.yearMode === 'dual' ? state.years[0] : Number(state.yearMode);
  const trees = state.scenes[curYear]?.trees || [];
  const matching = trees.filter((t) => t.species === speciesName).map((t) => t.tag);
  if (!matching.length) {
    hint(`当前样地（${state.plotName}）无「${speciesName}」记录`);
    return;
  }
  for (const s of activeScenes()) {
    s.clearSelection();
    for (const tag of matching) s.toggleSelect(tag);
  }
  renderSelectionList();
  setMode('multi');
  hint(`已高亮「${speciesName}」共 ${matching.length} 株（点击完整样地可恢复全部树种）`);
}

/** 渲染 16 树种三维构型与植物学图鉴面板（本样地包含的树种置顶展示）。 */
function renderSpeciesAtlasModal() {
  const grid = $('#sm-grid');
  if (!grid) return;
  const curYear = state.yearMode === 'dual' ? state.years[0] : Number(state.yearMode);
  const trees = state.scenes[curYear]?.trees || [];
  const counts = new Map();
  for (const t of trees) {
    const sp = t.species || '未知';
    counts.set(sp, (counts.get(sp) || 0) + 1);
  }
  const sub = $('#sm-subtitle');
  if (sub) {
    sub.textContent = `当前样地：${state.plotName}（${curYear}期 · 共 ${counts.size} 个树种 / ${trees.length} 株）`;
  }
  const list = Object.values(SPECIES_PROFILES).sort((a, b) => {
    const ca = counts.get(a.name) || 0;
    const cb = counts.get(b.name) || 0;
    return cb - ca;
  });
  grid.innerHTML = list.map((p) => {
    const n = counts.get(p.name) || 0;
    const hexS = '#' + p.crown.toString(16).padStart(6, '0');
    const hexA = '#' + (p.crownAutumn ?? p.crown).toString(16).padStart(6, '0');
    const hexB = '#' + p.trunk.toString(16).padStart(6, '0');
    return `<div class="sm-card ${n > 0 ? 'in-plot' : ''}">
      <div class="sm-card-top">
        <div>
          <b style="font-size:13px;color:#1e3d28">${p.fullName}</b>
          <div style="font-size:10.5px;color:#646a62;font-style:italic">${p.latin}</div>
        </div>
        <div class="sm-swatches" title="树皮色 / 夏叶色 / 秋叶色">
          <span class="sm-sw" style="background:${hexB}"></span>
          <span class="sm-sw" style="background:${hexS}"></span>
          <span class="sm-sw" style="background:${hexA}"></span>
        </div>
      </div>
      <div style="font-size:11px;color:#2d5a3d;font-weight:600">${p.family} · ${p.leafHabit}</div>
      <div><b>冠形构型：</b>${p.crownDesc}（枝下高比 ~${Math.round(p.cbRatio * 100)}%）</div>
      <div><b>树皮特征：</b>${p.barkDesc}</div>
      <div><b>叶部物候：</b>${p.foliageDesc}</div>
      <div class="dim">${p.ecology}</div>
      ${n > 0
        ? `<button class="mini active" data-hl-sp="${p.name}" style="margin-top:4px;align-self:flex-start">📍 本样地 ${n} 株 · 点击在三维中高亮</button>`
        : `<span class="dim" style="margin-top:2px">本样地未分布</span>`}
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-hl-sp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#species-modal')?.classList.remove('open');
      $('#btn-atlas')?.classList.remove('active');
      highlightSpeciesInPlot(btn.dataset.hlSp);
    });
  });
}

const CUSTOM_CMD_KEY = 'lzv21.custom_commands.v1';
const DEFAULT_CUSTOM_CMDS = [
  { name: '🌲 优势落叶松(D≥20)', expr: '落叶松 胸径>=20' },
  { name: '🌿 中大径白桦(D≥14)', expr: '白桦 胸径>=14' },
  { name: '🏆 树高前8名优势木', expr: '最高8棵' },
  { name: '📈 胸径增长最快(>0.8cm)', expr: 'Δ胸径>0.8' },
  { name: '⚠ 胸径或树高待核实', expr: '待核实' },
  { name: '🧍 小人走到样板树0322', expr: '走到 0322' },
  { name: '📏 设小人身高1.80m', expr: '身高 1.80' },
];

function loadSavedCommands() {
  try {
    const raw = localStorage.getItem(CUSTOM_CMD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_CUSTOM_CMDS.slice();
}

function saveCustomCommands(list) {
  try { localStorage.setItem(CUSTOM_CMD_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function renderCustomCommandChips() {
  const wrap = $('#cmd-chip-list');
  if (!wrap) return;
  const list = loadSavedCommands();
  wrap.innerHTML = list.map((c, idx) =>
    `<span class="cmd-chip" data-expr="${c.expr.replace(/"/g, '&quot;')}" title="指令内容：${c.expr}">
      <span>${c.name}</span>
      <b data-del-cmd="${idx}" title="删除此自定义指令">✕</b>
    </span>`
  ).join('');
  wrap.querySelectorAll('.cmd-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (e.target.dataset.delCmd !== undefined) {
        const i = Number(e.target.dataset.delCmd);
        const next = loadSavedCommands();
        next.splice(i, 1);
        saveCustomCommands(next);
        renderCustomCommandChips();
        return;
      }
      const expr = chip.dataset.expr;
      const inp = $('#search-input');
      if (inp) inp.value = expr;
      executeSurveyCommand(expr);
    });
  });
}

function initCommandConsole() {
  renderCustomCommandChips();
  $('#btn-cmd-open')?.addEventListener('click', () => {
    const m = $('#cmd-modal');
    if (!m) return;
    const open = m.classList.toggle('open');
    $('#btn-cmd-open')?.classList.toggle('active', open);
  });
  $('#cmd-close')?.addEventListener('click', () => {
    $('#cmd-modal')?.classList.remove('open');
    $('#btn-cmd-open')?.classList.remove('active');
  });
  $('#btn-cmd-save')?.addEventListener('click', () => {
    const name = ($('#cmd-custom-name')?.value || '').trim();
    const expr = ($('#cmd-custom-expr')?.value || '').trim();
    if (!expr) { hint('请输入自定义调查指令内容'); return; }
    const label = name || expr;
    const list = loadSavedCommands();
    list.push({ name: label, expr });
    saveCustomCommands(list);
    renderCustomCommandChips();
    if ($('#cmd-custom-name')) $('#cmd-custom-name').value = '';
    if ($('#cmd-custom-expr')) $('#cmd-custom-expr').value = '';
    executeSurveyCommand(expr);
  });
}

/**
 * 非模板化自由调查指令引擎：
 * 支持单木编号直达、漫游传送与身高设置、多期对比切换、以及任意多条件组合筛选与极值排序。
 */
function executeSurveyCommand(rawInput) {
  const raw = (rawInput || '').trim();
  if (!raw) return;
  const year = state.yearMode === 'dual' ? state.years[0] : Number(state.yearMode);
  const trees = state.scenes[year]?.trees || [];
  const resBox = $('#cmd-result-box');
  const setRes = (txt) => {
    if (resBox) resBox.innerHTML = txt;
    hint(txt.replace(/<[^>]+>/g, ''));
  };

  // 1) 精确匹配单木牌号或编号
  const exact = trees.find((t) => t.tag === raw || String(t.seq_no) === raw || t.tag === raw.padStart(4, '0'));
  if (exact) {
    hint('');
    state.focusTag = exact.tag;
    setMode('single', exact.tag);
    if (resBox) resBox.innerHTML = `✓ 已精准定位单木 <b>#${exact.tag}</b>（编号 ${exact.seq_no} · ${exact.species} · 胸径 ${exact.dbh_cm}cm · 树高 ${exact.height_m}m）`;
    return;
  }

  // 2) 动作类指令：走到/传送 某树
  const tpMatch = raw.match(/^(?:走到|去|传送|漫游|tp|walk)\s*#?(\d+)$/i);
  if (tpMatch) {
    const q = tpMatch[1];
    const target = trees.find((t) => t.tag === q || String(t.seq_no) === q || t.tag === q.padStart(4, '0'));
    if (!target) { setRes(`未找到目标单木「${q}」`); return; }
    if (state.yearMode === 'dual') setYear(String(state.years[0]));
    const s = state.single;
    if (s) {
      closeTreeDialog();
      const tx = target.x, tz = Math.min(s.extent + 4, target.y + 2.1);
      if (s._roam) {
        s._roam.pos.set(tx, 0, tz);
        s._roam.yaw = 0;
      } else {
        s.enterRoam({ x: tx, z: tz, yaw: 0 });
        $('#btn-roam')?.classList.add('active');
      }
      setRes(`🧍 小人已漫游至 <b>#${target.tag} ${target.species}</b> 前方 2.1m 处（按 F 键可调出该树检尺详情）`);
    }
    return;
  }

  // 3) 动作类指令：设定小人身高
  const hMatch = raw.match(/^(?:身高|小人身高|height)\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(?:m|米|cm|厘米)?$/i);
  if (hMatch) {
    let v = Number(hMatch[1]);
    if (v > 50) v /= 100; // 兼容输入 175 厘米
    if (!state.single?._roam && state.yearMode !== 'dual') {
      state.single?.enterRoam();
      $('#btn-roam')?.classList.add('active');
    }
    state.single?.setRoamAvatarHeight(v);
    setRes(`📏 已将林调员小人身高设为 <b>${v.toFixed(2)}m</b>（人眼平视高度 ${(v * 0.93).toFixed(2)}m，金色胸高线恒定 1.30m）`);
    return;
  }

  // 4) 动作类指令：第一/第三人称、衍生复测、多期对比
  if (/^(?:第一人称|fpp)$/i.test(raw)) {
    if (!state.single?._roam) { state.single?.enterRoam({ viewMode: 'fpp' }); $('#btn-roam')?.classList.add('active'); }
    else { state.single._roam.viewMode = 'fpp'; state.single._syncRoamViewModeUI(); }
    setRes('👁 已切换为第一人称人眼平视漫游');
    return;
  }
  if (/^(?:第三人称|tpp)$/i.test(raw)) {
    if (!state.single?._roam) { state.single?.enterRoam({ viewMode: 'tpp_orbit' }); $('#btn-roam')?.classList.add('active'); }
    else { state.single._roam.viewMode = 'tpp_orbit'; state.single._syncRoamViewModeUI(); }
    setRes('🧍 已切换为第三人称 360° 自由环绕漫游');
    return;
  }
  if (/^(?:衍生|新增复测|衍生复测期)$/.test(raw)) {
    addDerivedSimPeriod();
    return;
  }
  const cmpMatch = raw.match(/^(?:对比|双期|多期)\s*(\d{4})?\s*(\d{4})?$/);
  if (cmpMatch) {
    if (cmpMatch[1]) state.dualLeftYear = Number(cmpMatch[1]);
    if (cmpMatch[2]) state.dualRightYear = Number(cmpMatch[2]);
    setYear('dual');
    setRes(`已进入多期分屏对比（${state.dualLeftYear || state.years[0]} ⇄ ${state.dualRightYear || state.years[state.years.length - 1]}）`);
    return;
  }

  // 5) 自由组合条件筛选与极值排序语法解析
  const tokens = raw.split(/[\s,，;；]+/).filter(Boolean);
  let filtered = trees.slice();
  let topLimit = null;
  let sortFn = null;
  const cmpByTag = new Map((state.compare?.trees || []).map((c) => [c.tag, c]));

  for (const tk of tokens) {
    if (tk === '且' || tk === 'and' || tk === 'AND') continue;
    // 极值截取：最高N棵 / 最大N棵 / 胸径前N / 最矮N棵
    const topM = tk.match(/^(?:(最高|最大|胸径前|树高前|最矮|最小)|top)(\d+)?(?:棵|株|名)?$/i);
    if (topM) {
      const kind = topM[1] || '最大';
      topLimit = Number(topM[2]) || 10;
      if (kind.includes('高')) sortFn = (a, b) => (b.height_m || 0) - (a.height_m || 0);
      else if (kind.includes('矮')) sortFn = (a, b) => (a.height_m || 999) - (b.height_m || 999);
      else if (kind.includes('小')) sortFn = (a, b) => (a.dbh_cm || 999) - (b.dbh_cm || 999);
      else sortFn = (a, b) => (b.dbh_cm || 0) - (a.dbh_cm || 0);
      continue;
    }
    // 径级语义词
    if (tk === '大径木' || tk === '优势木') {
      filtered = filtered.filter((t) => (t.dbh_cm || 0) >= 22);
      continue;
    }
    if (tk === '中径木') {
      filtered = filtered.filter((t) => (t.dbh_cm || 0) >= 13 && (t.dbh_cm || 0) < 22);
      continue;
    }
    if (tk === '小径木') {
      filtered = filtered.filter((t) => (t.dbh_cm || 0) > 0 && (t.dbh_cm || 0) < 13);
      continue;
    }
    // 质量与跨期变化语义词
    if (['异常', '待核实', '缺测', '0值'].includes(tk)) {
      filtered = filtered.filter((t) => t.dbh_status !== 'measured' || t.height_status !== 'measured' || !t.identity_trusted);
      continue;
    }
    if (tk === '实测' || tk === '正常') {
      filtered = filtered.filter((t) => t.dbh_status === 'measured' && t.height_status === 'measured');
      continue;
    }
    if (tk === '胸径下降') {
      filtered = filtered.filter((t) => (cmpByTag.get(t.tag)?.dbh?.delta ?? 0) < 0);
      continue;
    }
    if (tk === '树高下降') {
      filtered = filtered.filter((t) => (cmpByTag.get(t.tag)?.height?.delta ?? 0) < 0);
      continue;
    }
    if (tk === '针叶' || tk === '针叶树') {
      filtered = filtered.filter((t) => lwSpecies(t.species).kind === 'conifer');
      continue;
    }
    if (tk === '阔叶' || tk === '阔叶树') {
      filtered = filtered.filter((t) => lwSpecies(t.species).kind === 'broadleaf');
      continue;
    }

    // 数值区间或比较表达式：如 胸径>15、树高12-20、冠幅>=3.5、Δ胸径>0.8、x>15
    const exprM = tk.match(/^(胸径|dbh|d|树高|height|h|冠幅|cw|Δ胸径|胸径变化|Δ树高|x|y)\s*(?:(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s*[-~至]\s*(-?\d+(?:\.\d+)?))$/i);
    if (exprM) {
      const fk = exprM[1].toLowerCase();
      const op = exprM[2];
      const v1 = exprM[3] !== undefined ? Number(exprM[3]) : Number(exprM[4]);
      const v2 = exprM[5] !== undefined ? Number(exprM[5]) : null;
      const getVal = (t) => {
        if (['胸径', 'dbh', 'd'].includes(fk)) return t.dbh_cm;
        if (['树高', 'height', 'h'].includes(fk)) return t.height_m;
        if (['冠幅', 'cw'].includes(fk)) return ((t.crown_ns_m || 0) + (t.crown_ew_m || 0)) / 2;
        if (['δ胸径', 'Δ胸径', '胸径变化'].includes(fk)) return cmpByTag.get(t.tag)?.dbh?.delta;
        if (['δ树高', 'Δ树高'].includes(fk)) return cmpByTag.get(t.tag)?.height?.delta;
        if (fk === 'x') return t.x;
        if (fk === 'y') return t.y;
        return null;
      };
      filtered = filtered.filter((t) => {
        const val = getVal(t);
        if (val == null || Number.isNaN(val)) return false;
        if (v2 !== null) return val >= Math.min(v1, v2) && val <= Math.max(v1, v2);
        if (op === '>') return val > v1;
        if (op === '>=') return val >= v1;
        if (op === '<') return val < v1;
        if (op === '<=') return val <= v1;
        return Math.abs(val - v1) < 0.05;
      });
      continue;
    }

    // 树种模糊或别名匹配
    const spClean = tk.replace(/^树种[=:：]/, '');
    const resolved = typeof resolveSpeciesProfile === 'function' ? resolveSpeciesProfile(spClean) : null;
    filtered = filtered.filter((t) =>
      (t.species && t.species.includes(spClean)) || (resolved && t.species === resolved.name)
    );
  }

  if (sortFn) filtered.sort(sortFn);
  if (topLimit) filtered = filtered.slice(0, topLimit);

  if (!filtered.length) {
    setRes(`未匹配到符合指令「${raw}」的单木`);
    return;
  }

  for (const s of activeScenes()) {
    s.clearSelection();
    for (const t of filtered) s.toggleSelect(t.tag);
  }
  renderSelectionList();
  setMode('multi');

  const meanD = filtered.reduce((acc, t) => acc + (t.dbh_cm || 0), 0) / filtered.length;
  const meanH = filtered.reduce((acc, t) => acc + (t.height_m || 0), 0) / filtered.length;
  setRes(`⚡ 指令「<b>${raw}</b>」命中 <b>${filtered.length}</b> 株（平均胸径 ${meanD.toFixed(1)}cm · 平均树高 ${meanH.toFixed(1)}m）`);
}

function doSearch() {
  const raw = $('#search-input').value.trim();
  if (!raw) return;
  executeSurveyCommand(raw);
}

// ------------------------------------------------ 启动

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();
