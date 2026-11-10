/**
 * FM1 三维森林场景管理器（Three.js）。
 *
 * 数据契约（由 tools/fm1_export_scene.py 生成）：
 *   trees[i] = { seq_no, tag, species, x, y, dbh_cm, dbh_status, height_m,
 *                height_status, crown_ns_m, crown_ew_m, crown_status,
 *                keep_flag, row_index, source_file, issues }
 *
 * 建模规则：
 *   - 位置 = 原始局部 X/Y（单位未核实，样地内相对展示）
 *   - 胸径 → 胸高(1.3m)处树干直径（cm→m）
 *   - 树高 → 模型总高（m）
 *   - 实测冠幅(NS/EW均值) → 树冠尺度；缺失/异常时按树高比例估算并标记"示意"
 *   - 本期 #N/A / 0 值树木借用另一期尺寸渲染，半透明灰色并标记"示意"
 *   - 不生成任何额外树木
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { buildTrunkProfile } from './trunk_geometry.js';

/** 活跃场景注册表：供生命周期回归测试观测（dispose 后移除）。 */
export const activeScenes = new Set();

const BREAST_HEIGHT = 1.3; // 胸高（m）

// 树种外观配置
const SPECIES_STYLE = {
  '落叶松': { // 针叶：锥形冠
    trunk: 0x6b4a35, crown: 0x2f6134, crownEmissive: 0x0d1f0e,
    kind: 'conifer', fallbackCrownRatio: 0.16,
  },
  '白桦': { // 阔叶：椭球冠、浅色树干
    trunk: 0xd6d0c4, crown: 0x6d9a4b, crownEmissive: 0x16240f,
    kind: 'broadleaf', fallbackCrownRatio: 0.20,
  },
};
const FALLBACK_STYLE = SPECIES_STYLE['落叶松'];

// 示意（尺寸借用/冠幅估算）材质基调
const SKETCH_OPACITY = 0.55;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class FM1SceneManager {
  /**
   * @param {HTMLElement} container 画布容器
   * @param {{onSelect?: Function, onHover?: Function}} handlers
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.trees = [];          // 当前年份的树对象 {group, data, meshes}
    this.treeByTag = new Map();
    this.selectedTag = null;
    this.highlightedTag = null;
    this.sketchCount = 0;
    this._disposed = false;
    this._rafId = null;
    this._boundResize = this._resize.bind(this);
    activeScenes.add(this);
    this._initRenderer();
    this._initScene();
    this._initControls();
    this._bindEvents();
    this._resize(); // 相机就绪后按容器实际尺寸设置画布
    this._animate = this._animate.bind(this);
    this._animate();
  }

  // ---------------------------------------------------------------- 渲染基础

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    if (this.camera) this._resize(); // 相机在 _initScene 中创建
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9db8cd);
    this.scene.fog = new THREE.Fog(0x9db8cd, 90, 260);

    this.camera = new THREE.PerspectiveCamera(
      50, this.container.clientWidth / this.container.clientHeight, 0.1, 1000
    );
    this.camera.position.set(62, 40, 62);

    // 光照：半球环境光 + 主方向光（带阴影）+ 补光
    const hemi = new THREE.HemisphereLight(0xdfeaf2, 0x3a4a33, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(45, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd0e8, 0.35);
    fill.position.set(-30, 40, -45);
    this.scene.add(fill);

    this._buildGround();

    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);
  }

  _buildGround() {
    const SIZE = 30;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE + 8, SIZE + 8),
      new THREE.MeshStandardMaterial({ color: 0x4a5d3f, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(SIZE / 2, -0.02, SIZE / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 样地地面（略浅）
    const plot = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshStandardMaterial({ color: 0x59704b, roughness: 1 }),
    );
    plot.rotation.x = -Math.PI / 2;
    plot.position.set(SIZE / 2, 0, SIZE / 2);
    plot.receiveShadow = true;
    this.scene.add(plot);

    // 5m × 5m 小样方网格（对应样地号 0000–2525 编码模式）
    const gridPts = [];
    for (let i = 0; i <= 6; i++) {
      gridPts.push(i * 5, 0.01, 0, i * 5, 0.01, 30);
      gridPts.push(0, 0.01, i * 5, 30, 0.01, i * 5);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    const grid = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0x2e4028, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(grid);

    // 边界描线
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0.02, 0, 30, 0.02, 0, 30, 0.02, 0, 30, 0.02, 30,
      30, 0.02, 30, 0, 0.02, 30, 0, 0.02, 30, 0, 0.02, 0,
    ], 3));
    this.scene.add(new THREE.LineSegments(
      borderGeo, new THREE.LineBasicMaterial({ color: 0xe8e4d0 })
    ));

    // 周围低多边形远山剪影（纯装饰，与数据无关）
    this._addDistantHills();
  }

  _addDistantHills() {
    const hillMat = new THREE.MeshStandardMaterial({
      color: 0x3c5238, roughness: 1, flatShading: true,
    });
    const rand = mulberry32(20261031); // 固定种子：装饰与数据无关但稳定
    for (let i = 0; i < 14; i++) {
      const r = 26 + rand() * 40;
      const h = 8 + rand() * 26;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + (i % 3)), hillMat);
      const angle = (i / 14) * Math.PI * 2;
      const dist = 95 + rand() * 80;
      cone.position.set(15 + Math.cos(angle) * dist, h / 2 - 2, 15 + Math.sin(angle) * dist);
      cone.rotation.y = rand() * Math.PI;
      this.scene.add(cone);
    }
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(15, 4, 15);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 220;
    this.controls.update();
  }

  // ---------------------------------------------------------------- 树木建模

  /**
   * 加载某一年数据。fallbackData 用于本期 #N/A / 0 值树木借用尺寸。
   * @param {object} data scene_snapshot JSON
   * @param {object|null} fallbackData 另一期 scene_snapshot
   */
  loadYear(data, fallbackData = null) {
    this.currentData = data;
    this.fallbackByTag = new Map();
    if (fallbackData) {
      for (const t of fallbackData.trees) this.fallbackByTag.set(t.tag, t);
    }
    this._clearTrees();
    this.sketchCount = 0;
    for (const t of data.trees) this._addTree(t);
    return this;
  }

  _clearTrees() {
    for (const item of this.trees) {
      this.treeGroup.remove(item.group);
      item.group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    this.trees = [];
    this.treeByTag.clear();
    this.selectedTag = null;
    this.highlightedTag = null;
    if (this._selectionRing) {
      this.scene.remove(this._selectionRing);
      this._selectionRing = null;
    }
  }

  _addTree(t) {
    const style = SPECIES_STYLE[t.species] || FALLBACK_STYLE;
    // 本期缺失/异常 → 借用另一期尺寸，标记示意
    let dims = t;
    let sketch = false;
    const usable = (s) => s.height_status === 'measured' && s.dbh_status === 'measured';
    if (!usable(t)) {
      const fb = this.fallbackByTag.get(t.tag);
      if (fb && usable(fb)) {
        dims = fb;
        sketch = true;
      } else {
        return; // 两期均无可用尺寸：不渲染（避免凭空造树）
      }
    }
    const height = dims.height_m;
    const sketchReasons = [];
    const crownMeasured = t.crown_status === 'measured' && dims.crown_status === 'measured';
    const crownR = crownMeasured
      ? Math.max((dims.crown_ns_m + dims.crown_ew_m) / 4, 0.25)
      : height * style.fallbackCrownRatio;
    if (!crownMeasured) sketchReasons.push('树冠尺度按树高比例估算');
    if (sketch) sketchReasons.push('本期测量值缺失，尺寸借用另一期');

    const group = new THREE.Group();
    group.position.set(t.x, 0, t.y);
    group.userData = { tag: t.tag, seq_no: t.seq_no, data: t, sketch };

    const trunkMat = new THREE.MeshStandardMaterial({
      color: style.trunk, roughness: 0.95, flatShading: true,
      transparent: sketch, opacity: sketch ? SKETCH_OPACITY : 1,
    });
    const crownMat = new THREE.MeshStandardMaterial({
      color: style.crown, roughness: 0.9, flatShading: true,
      emissive: style.crownEmissive,
      transparent: sketch, opacity: sketch ? SKETCH_OPACITY : 1,
    });

    // ---- 树干：分段线性轮廓（LatheGeometry），精确保证 y=1.3m 处直径=实测DBH。
    // 轮廓原点在树基（group.position=(x,0,y)，无缩放），世界坐标尺寸一致。
    const crownBase = style.kind === 'conifer'
      ? Math.max(height * 0.22, 0.4)
      : Math.max(height * 0.42, 0.5);
    const { profile, measured: trunkMeasured } = buildTrunkProfile({
      dbhCm: dims.dbh_cm,
      heightM: dims.height_m,
      crownBaseM: crownBase,
      sketch: false,
    });
    const lathePoints = profile.map((p) => new THREE.Vector2(p.r, p.y));
    const trunk = new THREE.Mesh(
      new THREE.LatheGeometry(lathePoints, 8),
      trunkMat,
    );
    trunk.castShadow = true;
    group.add(trunk);
    if (!trunkMeasured) sketchReasons.push('树干为示意形状（无有效实测胸径）');
    if (sketch || sketchReasons.length) this.sketchCount++;

    // ---- 树冠
    const crownLen = height - crownBase;
    if (style.kind === 'conifer') {
      // 两层锥形冠
      const c1 = new THREE.Mesh(
        new THREE.ConeGeometry(crownR, crownLen * 0.72, 8),
        crownMat,
      );
      c1.position.y = crownBase + crownLen * 0.36;
      c1.castShadow = true;
      group.add(c1);
      const c2 = new THREE.Mesh(
        new THREE.ConeGeometry(crownR * 0.62, crownLen * 0.55, 8),
        crownMat,
      );
      c2.position.y = crownBase + crownLen * 0.72;
      c2.castShadow = true;
      group.add(c2);
    } else {
      // 阔叶：两个变形椭球
      const s1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), crownMat);
      s1.scale.set(crownR, crownLen * 0.42, crownR * 0.92);
      s1.position.y = crownBase + crownLen * 0.38;
      s1.castShadow = true;
      group.add(s1);
      const s2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), crownMat);
      s2.scale.set(crownR * 0.72, crownLen * 0.3, crownR * 0.7);
      s2.position.set(crownR * 0.28, crownBase + crownLen * 0.68, crownR * 0.15);
      s2.castShadow = true;
      group.add(s2);
    }

    group.rotation.y = (t.seq_no * 2.399963) % (Math.PI * 2); // 黄金角散布，避免同向
    this.treeGroup.add(group);
    const item = { group, data: t, sketch: sketch || sketchReasons.length > 0, sketchReasons, dims };
    this.trees.push(item);
    this.treeByTag.set(t.tag, item);
  }

  // ---------------------------------------------------------------- 交互

  _bindEvents() {
    window.addEventListener('resize', this._boundResize);
    const dom = this.renderer.domElement;
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._downPos = null;
    this._boundPointerDown = (e) => { this._downPos = [e.clientX, e.clientY]; };
    this._boundPointerUp = (e) => {
      if (!this._downPos) return;
      const moved = Math.hypot(e.clientX - this._downPos[0], e.clientY - this._downPos[1]);
      this._downPos = null;
      if (moved > 5) return; // 拖拽不算点击
      const hit = this._pick(e);
      this.select(hit ? hit.tag : null);
      if (hit && this.handlers.onSelect) this.handlers.onSelect(hit.data, hit.sketch);
      if (!hit && this.handlers.onSelect) this.handlers.onSelect(null, false);
    };
    this._boundPointerMove = (e) => {
      const hit = this._pick(e);
      dom.style.cursor = hit ? 'pointer' : '';
      if (this.handlers.onHover) this.handlers.onHover(hit ? hit.data : null);
    };
    dom.addEventListener('pointerdown', this._boundPointerDown);
    dom.addEventListener('pointerup', this._boundPointerUp);
    dom.addEventListener('pointermove', this._boundPointerMove);
  }

  _pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const targets = [];
    for (const item of this.trees) targets.push(item.group);
    const hits = this._raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.tag) obj = obj.parent;
    return obj ? { tag: obj.userData.tag, data: obj.userData.data, sketch: obj.userData.sketch } : null;
  }

  // ---------------------------------------------------------------- 选择/高亮

  select(tag) {
    this.selectedTag = tag;
    this._refreshMaterials();
    this._updateSelectionRing();
  }

  highlight(tag) {
    this.highlightedTag = tag;
    this._refreshMaterials();
  }

  _refreshMaterials() {
    for (const item of this.trees) {
      const isSel = item.group.userData.tag === this.selectedTag;
      const isHl = item.group.userData.tag === this.highlightedTag;
      item.group.traverse((obj) => {
        if (!obj.material || !obj.isMesh) return;
        if (!obj.userData._baseEmissive) {
          obj.userData._baseEmissive = obj.material.emissive
            ? obj.material.emissive.getHex() : 0x000000;
        }
        if (isSel || isHl) {
          obj.material.emissive.setHex(isSel ? 0x8a5a00 : 0x2a4d8a);
          obj.material.emissiveIntensity = 0.9;
        } else {
          obj.material.emissive.setHex(obj.userData._baseEmissive);
          obj.material.emissiveIntensity = 1;
        }
      });
    }
  }

  _updateSelectionRing() {
    if (this._selectionRing) {
      this.scene.remove(this._selectionRing);
      this._selectionRing.geometry.dispose();
      this._selectionRing = null;
    }
    if (!this.selectedTag) return;
    const item = this.treeByTag.get(this.selectedTag);
    if (!item) return;
    const { x, y } = item.data;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.85, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffb531, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, y);
    this.scene.add(ring);
    this._selectionRing = ring;
  }

  // ---------------------------------------------------------------- 相机预设

  _tweenCamera(toPos, toTarget, duration = 800) {
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const start = performance.now();
    if (this._tweenId) cancelAnimationFrame(this._tweenId);
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const k = easeInOutCubic(t);
      this.camera.position.lerpVectors(fromPos, toPos, k);
      this.controls.target.lerpVectors(fromTarget, toTarget, k);
      this.controls.update();
      if (t < 1) this._tweenId = requestAnimationFrame(step);
    };
    this._tweenId = requestAnimationFrame(step);
  }

  viewTop() { this._tweenCamera(new THREE.Vector3(15, 90, 15.01), new THREE.Vector3(15, 0, 15)); }
  viewSide() { this._tweenCamera(new THREE.Vector3(15, 7, 78), new THREE.Vector3(15, 6, 15)); }
  viewReset() { this._tweenCamera(new THREE.Vector3(62, 40, 62), new THREE.Vector3(15, 4, 15)); }

  /** 定位到某株树（搜索/点击联动） */
  focusTree(tag, distance = 14) {
    const item = this.treeByTag.get(tag);
    if (!item) return false;
    const { x, y } = item.data;
    const h = item.dims.height_m;
    const dir = new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(distance);
    this._tweenCamera(
      new THREE.Vector3(x, 0, y).add(dir).add(new THREE.Vector3(0, h * 0.5, 0)),
      new THREE.Vector3(x, h * 0.5, y),
    );
    return true;
  }

  // ---------------------------------------------------------------- 循环

  /** 双视图同步：每帧从主视图复制相机状态（本视图控制被禁用）。 */
  setSyncMaster(master) {
    this.syncMaster = master;
    if (this.controls) this.controls.enabled = !master;
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h || !this.camera) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    if (this._disposed) return; // 生命周期终止：不再排帧
    this._rafId = requestAnimationFrame(this._animate);
    if (this.syncMaster) {
      this.camera.position.copy(this.syncMaster.camera.position);
      this.controls.target.copy(this.syncMaster.controls.target);
    }
    this.controls.update();
    if (this._selectionRing) {
      const s = 1 + Math.sin(performance.now() * 0.004) * 0.08;
      this._selectionRing.scale.set(s, s, 1);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** 释放静态场地对象（地面/网格/远山）。 */
  _disposeStatics() {
    const statics = this.scene.children.filter(
      (o) => o !== this.treeGroup && (o.isMesh || o.isLineSegments || o.isLight === false)
    );
    for (const obj of statics) {
      this.scene.remove(obj);
      obj.traverse?.((n) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) {
          (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose());
        }
      });
    }
  }

  /**
   * 完整生命周期清理：停帧、解绑事件、释放几何/材质/控制器/渲染器。
   * dispose 后实例不可复用（重复进入由调用方重新构造实例）。
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    window.removeEventListener('resize', this._boundResize);
    const dom = this.renderer?.domElement;
    if (dom) {
      dom.removeEventListener('pointerdown', this._boundPointerDown);
      dom.removeEventListener('pointerup', this._boundPointerUp);
      dom.removeEventListener('pointermove', this._boundPointerMove);
    }
    this._clearTrees();
    this._disposeStatics();
    this.controls?.dispose();
    this.renderer?.dispose();
    if (dom && dom.parentElement) dom.parentElement.removeChild(dom);
    activeScenes.delete(this);
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
