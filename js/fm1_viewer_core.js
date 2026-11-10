/**
 * FM1 三维森林统一查看器（第四轮）。
 *
 * 架构分层（阶段D/G）：
 *   科研数据(fm1_scene_YYYY.json / fm1_compare.json / manifest)
 *     → 单木身份与质量状态（复用 P1 准入结果）
 *     → 资产解析(asset_manifest.json: 树种→asset_id→文件路径)
 *     → 几何校准(逐树参数化 / 全局径向增益，已由管线完成并自检)
 *     → 渲染与交互(本文件 HDViewer)
 *
 * 显示模式：full(完整样地) / single(单木) / multi(自选多木)
 * 调查期：2023 / 2026 / dual(左右同步对比)
 * 资产版本：asset_manifest.assignment 可切换 r3/r4（对照）
 *
 * 选择状态接口（科研联动契约）：
 *   __viewer.getSelectionState() →
 *   { plot_id, survey_periods, selected_tree_ids, view_mode, quality_status }
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const $ = (sel) => document.querySelector(sel);
const TEX = 'assets/textures/';
const TV = '?v=r8';
const MODEL_DIR = 'assets/models/fm1hd/';
const AV = '?v=r8';

const SPECIES_PREFIX = { 落叶松: 'larch', 白桦: 'birch' };

// ---------------------------------------------------------------- 材质

function mkRepeat(tex, rx, ry) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  return tex;
}

const MATS = {
  larchBark: new THREE.MeshStandardMaterial({
    map: mkRepeat(new THREE.TextureLoader().load(TEX + 'bark_larch_diff_1k.jpg' + TV), 3, 9),
    normalMap: mkRepeat(new THREE.TextureLoader().load(TEX + 'bark_larch_nor_1k.png' + TV), 3, 9),
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.95, metalness: 0,
  }),
  needleGreen: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'spray_needle_green.png' + TV),
    alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }),
  needleAutumn: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'spray_needle_autumn.png' + TV),
    alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }),
  ground: new THREE.MeshStandardMaterial({
    map: mkRepeat(new THREE.TextureLoader().load(TEX + 'forest_floor_diff_1k.jpg' + TV), 12, 12),
    color: 0x4a5d3f,
    roughness: 1, metalness: 0,
  }),
  bgTrunkLarch: new THREE.MeshStandardMaterial({ color: 0x4a3a2b, roughness: 1 }),
  bgCrownLarchGreen: new THREE.MeshStandardMaterial({ color: 0x245026, roughness: 1, flatShading: true }),
  bgCrownLarchGold: new THREE.MeshStandardMaterial({ color: 0x74601f, roughness: 1, flatShading: true }),
  bgTrunkBirch: new THREE.MeshStandardMaterial({ color: 0xd6d0c4, roughness: 1 }),
  bgCrownBirch: new THREE.MeshStandardMaterial({ color: 0x5c6b2e, roughness: 1, flatShading: true }),
  grass: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'grass_tuft.png' + TV),
    alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1,
  }),
  rock: new THREE.MeshStandardMaterial({ color: 0x6a6f62, roughness: 1, flatShading: true }),
  post: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.8 }),
  postBand: new THREE.MeshStandardMaterial({ color: 0xc23b22, roughness: 0.8 }),
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 树木装配（数据→资产→校准→节点）

/**
 * 资产解析：按资产清单把 (树种, 年份, 牌号, LOD) 解析为 GLB 路径。
 * 阶段D接口——更换资产/版本只改 asset_manifest，不改渲染代码。
 */
class AssetResolver {
  constructor(assetManifest, heroManifest) {
    this.assets = assetManifest;
    this.hero = heroManifest;
  }

  heroFile(tag, year, lod = 0) {
    const tree = this.hero.trees.find((t) => t.tag === tag);
    if (!tree) return null;
    const speciesKey = tree.species_key;
    const assetId = this.assets.assignment[tree.species];
    const version = assetId.split('_').pop();
    // r4：逐期文件 species_tag_year_L{n}.glb；r3：species_tag_L{n}.glb（仅2023几何）
    if (version === 'r4') {
      const f = MODEL_DIR + `${speciesKey}_${tag}_${year}_L${lod}.glb`;
      return { file: f, year: String(year), calibration: 'per_year' };
    }
    return {
      file: MODEL_DIR + `${speciesKey}_${tag}_L${lod}.glb`,
      year: '2023', calibration: 'per_tree_2023_only',
      restricted: year !== 2023,
      restrictedNote: 'r3对照资产仅按2023参数构建，不反映2026实测',
    };
  }

  bgVariantFile(species, seqNo, year, sceneYear) {
    const variants = this.hero.bg_variants[species === '落叶松' ? 'larch' : 'birch'];
    // 就近匹配该年树高（2026缺测回退2023高，界面标注受限）
    const t = (sceneYear.trees || []).find((x) => x.tag === String(seqNo));
    const H = t && t.height_m ? t.height_m : null;
    let best = variants[0];
    if (H !== null) {
      best = variants.reduce((a, b) =>
        Math.abs(b.h - H) < Math.abs(a.h - H) ? b : a);
    }
    return { file: MODEL_DIR + best.file, scaleH: H ? H / best.h : 1 };
  }
}

// ---------------------------------------------------------------- 单侧场景

class TreeScene {
  constructor(container, year, handlers = {}) {
    this.container = container;
    this.year = year;
    this.handlers = handlers;
    this.heroNodes = new Map();   // tag -> {group, lod}
    this.bgIndex = new Map();     // instanceKey -> tree data
    this.selection = new Set();   // 多选树牌号
    this.displayMode = 'full';
    this._clock = new THREE.Clock();
    this._initRenderer();
    this._initScene();
    this._bindEvents();
    this._resize();
    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1); // 默认基础档，切档时更新
    this.renderer.shadowMap.enabled = false; // 默认关，切档开启
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    // 自然天空：中性偏暖渐变背景（大球内面），替代第三轮巨大三角面山体
    const skyGeo = new THREE.SphereGeometry(700, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x9db8d8) },
        horizon: { value: new THREE.Color(0xd8d2b8) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 horizon; void main(){ float h = clamp(vP.y/700.0, -0.1, 1.0); gl_FragColor = vec4(mix(horizon, top, smoothstep(0.0, 0.45, h)), 1.0); }',
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    this.scene.fog = new THREE.Fog(0xc4c8bc, 130, 560);

    this.camera = new THREE.PerspectiveCamera(
      50, this.container.clientWidth / this.container.clientHeight, 0.1, 1200);
    this.camera.position.set(62, 40, 62);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.sun.position.set(50, 46, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, far: 240 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);
    this.sun.target.position.set(15, 0, 15);
    this.scene.add(new THREE.HemisphereLight(0xbdd2e8, 0x3a4a33, 0.85));

    this._buildGround();
    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);
    this.scienceGroup = new THREE.Group();
    this.scene.add(this.scienceGroup);
    this._buildScienceLayer();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(15, 5, 15);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 280;
  }

  _buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), MATS.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(15, 0, 15);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _buildScienceLayer() {
    const corners = [[0, 0], [30, 0], [30, 30], [0, 30]];
    const postGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.1, 8);
    postGeo.translate(0, 0.55, 0);
    const bandGeo = new THREE.CylinderGeometry(0.062, 0.072, 0.22, 8);
    bandGeo.translate(0, 0.85, 0);
    for (const [x, z] of corners) {
      const post = new THREE.Mesh(postGeo, MATS.post);
      post.position.set(x, 0, z);
      const band = new THREE.Mesh(bandGeo, MATS.postBand);
      band.position.set(x, 0, z);
      this.scienceGroup.add(post, band);
    }
    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0.95, 0, 30, 0.95, 0, 30, 0.95, 0, 30, 0.95, 30,
      30, 0.95, 30, 0, 0.95, 30, 0, 0.95, 30, 0, 0.95, 0,
    ], 3));
    this.scienceGroup.add(new THREE.LineSegments(ropeGeo, new THREE.LineBasicMaterial({ color: 0xf0ede4 })));
    const gridPts = [];
    for (let i = 0; i <= 6; i++) {
      gridPts.push(i * 5, 0.02, 0, i * 5, 0.02, 30, 0, 0.02, i * 5, 30, 0.02, i * 5);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    this.scienceGroup.add(new THREE.LineSegments(
      gridGeo, new THREE.LineBasicMaterial({ color: 0x3a4a32, transparent: true, opacity: 0.45 })));
  }

  /** 装载某期全部树木（英雄树逐期 GLB + 背景自然变体代理）。 */
  async loadYear(sceneYear, resolver, treeMeta) {
    this.yearData = sceneYear;
    this.treeMeta = treeMeta;         // tag -> manifest tree (hero) or null
    this.clearTrees();
    const loader = new GLTFLoader();
    const jobs = [];

    for (const t of sceneYear.trees) {
      const meta = treeMeta.get(t.tag);
      const isHero = !!meta;
      if (isHero) {
        // 英雄树：逐期 GLB，三级 LOD
        const lod = new THREE.LOD();
        const lv = [
          { file: `${SPECIES_PREFIX[t.species]}_${t.tag}_${this.year}_L0.glb`, d: 0 },
          { file: `${SPECIES_PREFIX[t.species]}_${t.tag}_${this.year}_L1.glb`, d: 60 },
          { file: `${SPECIES_PREFIX[t.species]}_${t.tag}_${this.year}_L2.glb`, d: 140 },
        ];
        let pending = lv.length;
        for (const l of lv) {
          loader.load(MODEL_DIR + l.file + AV, (gltf) => {
            const obj = gltf.scene;
            obj.traverse((o) => {
              if (o.isMesh) {
                o.castShadow = true;
                this._applyHeroMaterial(t, o);
              }
            });
            lod.addLevel(obj, l.d);
            if (--pending === 0) this._afterHeroLoad(t);
          }, undefined, () => {
            console.error('GLB加载失败:', l.file);
            if (--pending === 0) this._afterHeroLoad(t);
          });
        }
        const group = new THREE.Group();
        group.position.set(t.x, 0, t.y);
        group.rotation.y = (t.seq_no * 2.399963) % (Math.PI * 2);
        group.add(lod);
        group.userData = { tag: t.tag, data: t, isHero: true, restricted: t.height_status !== 'measured' };
        this.heroNodes.set(t.tag, { group, lod, data: t });
        this.treeGroup.add(group);
      } else {
        // 背景树：自然变体代理（按H就近，缩放到该期H；缺测用2023高并标记受限）
        const vr = resolver.bgVariantFile(t.species, t.seq_no, this.year, sceneYear);
        jobs.push(new Promise((resolve) => {
          loader.load(vr.file + AV, (gltf) => {
            const clone = gltf.scene.clone(true);
            const s = vr.scaleH;
            clone.scale.set(s, s, s);
            clone.rotation.y = (t.seq_no * 2.399963) % (Math.PI * 2);
            clone.position.set(t.x, 0, t.y);
            clone.traverse((o) => {
              if (o.isMesh) { o.castShadow = true; this._applyHeroMaterial(t, o, true); }
            });
            clone.userData = { tag: t.tag, data: t, isHero: false };
            this.treeGroup.add(clone);
            this.heroNodes.set(t.tag, { group: clone, data: t });
            resolve();
          }, undefined, () => resolve());
        }));
      }
    }
    await Promise.all(jobs);
    this.applyTier(this.tier || 'standard');
  }

  _applyHeroMaterial(t, o, isBg = false) {
    const name = (o.name || '').toLowerCase();
    if (name.includes('needle')) {
      // 秋季混合：每树固定金/绿（参考图01金绿混交）
      o.material = (t.tag.charCodeAt(0) % 5 < 3) ? MATS.needleAutumn : MATS.needleGreen;
    } else if (name.includes('larch_trunk') || name.includes('larch_branch') || name.includes('twig')) {
      if (name.includes('birch')) return; // 白桦细枝保留源材质
      o.material = MATS.larchBark;
    } else if (name.includes('foliage') || name.includes('leaf')) {
      if (name.includes('extra')) {
        o.material = (t.tag.charCodeAt(0) % 5 < 3) ? MATS.needleAutumn : MATS.needleGreen;
        return;
      }
      if (t.species === '白桦') {
        const m = o.material.clone();
        m.alphaTest = 0.5;
        m.side = THREE.DoubleSide;
        if (t.tag.charCodeAt(0) % 5 < 3) m.color = new THREE.Color(0xd8b84a);
        m.needsUpdate = true;
        o.material = m;
      }
    }
  }

  _afterHeroLoad() { /* 钩子预留 */ }

  clearTrees() {
    for (const { group } of this.heroNodes.values()) {
      this.scene.remove(group);
    }
    this.heroNodes.clear();
    this.bgIndex.clear();
  }

  // ---------------------------------------------------------- 显示模式（阶段E）

  /** full=完整样地 single=仅一棵 multi=仅选中集合 */
  applyDisplayMode(mode, focusTag = null) {
    this.displayMode = mode;
    if (mode === 'full') {
      for (const [tag, node] of this.heroNodes) node.group.visible = true;
      return;
    }
    const keep = mode === 'single'
      ? new Set([focusTag])
      : new Set(this.selection);
    for (const [tag, node] of this.heroNodes) {
      node.group.visible = keep.has(tag);
    }
  }

  /** 多选：点击切换选中状态。返回是否已选中。 */
  toggleSelect(tag) {
    if (this.selection.has(tag)) this.selection.delete(tag);
    else this.selection.add(tag);
    this._updateSelectionMarks();
    return this.selection.has(tag);
  }

  clearSelection() {
    this.selection.clear();
    this._updateSelectionMarks();
  }

  _updateSelectionMarks() {
    if (this._selMarks) {
      this.scene.remove(this._selMarks);
      this._selMarks.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this._selMarks = null;
    }
    if (!this.selection.size) return;
    this._selMarks = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.5, 0.72, 32);
    for (const tag of this.selection) {
      const node = this.heroNodes.get(tag);
      if (!node) continue;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffb531, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(node.data.x, 0.06, node.data.y);
      this._selMarks.add(ring);
    }
    this.scene.add(this._selMarks);
  }

  /** 单树/多木聚焦：公共包围盒（不改变真实相对位置）。 */
  focusOn(tags = null, distance = 14) {
    const list = tags ?? (this.selection.size ? [...this.selection] : null);
    const targets = [];
    for (const [tag, node] of this.heroNodes) {
      if (!list || list.includes(tag)) {
        if (node.group.visible) targets.push(node);
      }
    }
    if (!targets.length) return false;
    const box = new THREE.Box3();
    for (const n of targets) {
      n.group.updateMatrixWorld(true);
      box.expandByObject(n.group);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(distance, size.y * 1.5, size.x * 1.2);
    const dir = new THREE.Vector3(1, 0.55, 1).normalize();
    this.tweenCamera(
      center.clone().add(dir.multiplyScalar(dist)),
      center.clone().add(new THREE.Vector3(0, size.y * 0.05, 0)), 900);
    return true;
  }

  tweenCamera(toPos, toTarget, duration = 900) {
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const start = performance.now();
    if (this._tweenId) cancelAnimationFrame(this._tweenId);
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(fromPos, toPos, k);
      this.controls.target.lerpVectors(fromTarget, toTarget, k);
      this.controls.update();
      if (t < 1) this._tweenId = requestAnimationFrame(step);
    };
    this._tweenId = requestAnimationFrame(step);
  }

  viewBird() { this.tweenCamera(new THREE.Vector3(62, 40, 62), new THREE.Vector3(15, 5, 15)); }
  viewTop() { this.tweenCamera(new THREE.Vector3(15, 95, 15.01), new THREE.Vector3(15, 0, 15)); }
  viewInside() { this.tweenCamera(new THREE.Vector3(3.5, 1.7, 3.5), new THREE.Vector3(22, 10, 20)); }
  viewReset() { this.viewBird(); }

  // ---------------------------------------------------------- 画质/科研层

  applyTier(tier) {
    this.tier = tier;
    const dpr = { basic: 1, standard: 1.25, cinema: 1.5 }[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dpr));
    this.renderer.shadowMap.enabled = tier !== 'basic';
    const ss = { basic: 0, standard: 1024, cinema: 2048 }[tier];
    if (ss) {
      this.sun.shadow.mapSize.set(ss, ss);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.scene.fog.near = { basic: 150, standard: 130, cinema: 60 }[tier];
    this.scene.fog.far = { basic: 560, standard: 480, cinema: 300 }[tier];
    this._resize();
  }

  setScienceLayer(on) { this.scienceGroup.visible = on; }

  // ---------------------------------------------------------- 拾取/实测/性能

  _pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObjects([this.treeGroup], true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData?.tag) return { tag: o.userData.tag, data: o.userData.data, isHero: o.userData.isHero };
        o = o.parent;
      }
    }
    return null;
  }

  _bindEvents() {
    this._boundResize = () => this._resize();
    window.addEventListener('resize', this._boundResize);
    const dom = this.renderer.domElement;
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._downPos = null;
    this._boundDown = (e) => { this._downPos = [e.clientX, e.clientY]; };
    this._boundUp = (e) => {
      if (!this._downPos) return;
      const moved = Math.hypot(e.clientX - this._downPos[0], e.clientY - this._downPos[1]);
      this._downPos = null;
      if (moved > 5) return;
      const hit = this._pick(e);
      if (this.handlers.onPick) this.handlers.onPick(hit);
    };
    dom.addEventListener('pointerdown', this._boundDown);
    dom.addEventListener('pointerup', this._boundUp);
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
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** 科研几何实测：顶点环心法（环稀疏时轮尺射线法）。 */
  measureHero(tag) {
    const node = this.heroNodes.get(tag);
    if (!node) return { error: 'not loaded' };
    node.group.updateMatrixWorld(true);
    let trunkMesh = null;
    node.group.traverse((o) => {
      if (!trunkMesh && o.isMesh && (o.name || '').toLowerCase().includes('trunk')) trunkMesh = o;
    });
    if (!trunkMesh) return { error: 'trunk mesh not found' };
    let maxY = -1e9;
    node.group.traverse((o) => {
      if (!o.isMesh) return;
      const pp = o.geometry.getAttribute('position');
      if (!pp) return;
      for (let i = 0; i < pp.count; i++) {
        const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i)).applyMatrix4(o.matrixWorld);
        if (v.y > maxY) maxY = v.y;
      }
    });
    const pos = trunkMesh.geometry.getAttribute('position');
    const ring = [];
    const trunkVerts = [];
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(trunkMesh.matrixWorld);
      trunkVerts.push(v);
      if (Math.abs(v.y - 1.3) < 0.12) ring.push(v);
    }
    let method, measured, center;
    if (ring.length >= 4) {
      center = [ring.reduce((a, v) => a + v.x, 0) / ring.length,
                ring.reduce((a, v) => a + v.z, 0) / ring.length];
      const radials = ring.map((v) => Math.hypot(v.x - center[0], v.z - center[1])).sort((a, b) => a - b);
      measured = radials[Math.floor(radials.length / 2)];
      method = 'vertex_ring';
    } else {
      const near = trunkVerts
        .filter((v) => Math.abs(v.y - 1.3) < 0.8)
        .sort((a, b) => Math.abs(a.y - 1.3) - Math.abs(b.y - 1.3)).slice(0, 60);
      if (!near.length) return { error: 'no verts near breast height' };
      center = [near.reduce((a, v) => a + v.x, 0) / near.length,
                near.reduce((a, v) => a + v.z, 0) / near.length];
      const rc = new THREE.Raycaster();
      rc.far = 30;
      const hits = [];
      for (let k = 0; k < 8; k++) {
        const dir = new THREE.Vector3(Math.cos(Math.PI / 2 * k / 2), 0, Math.sin(Math.PI / 2 * k / 2));
        rc.set(new THREE.Vector3(center[0], 1.3, center[1]).add(dir.clone().multiplyScalar(6)),
          dir.clone().negate());
        const hit = rc.intersectObject(trunkMesh, false)[0];
        if (hit) hits.push(Math.hypot(hit.point.x - center[0], hit.point.z - center[1]));
      }
      if (hits.length < 4) return { error: 'caliper failed' };
      hits.sort((a, b) => a - b);
      measured = hits[Math.floor(hits.length / 2)];
      method = 'caliper_rays';
    }
    const target = (node.data.dbh_cm ?? 0) / 200;
    return {
      tag, year: this.year, method,
      target_dbh_m: target,
      measured_dbh_m: Math.round(measured * 10000) / 10000,
      dbh_error_m: Math.round(Math.abs(measured - target) * 10000) / 10000,
      target_height: node.data.height_m,
      measured_height: Math.round(maxY * 1000) / 1000,
      height_error_m: Math.round(Math.abs(maxY - node.data.height_m) * 1000) / 1000,
    };
  }

  renderN(n) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.renderer.render(this.scene, this.camera);
    const total = performance.now() - t0;
    return { frames: n, totalMs: Math.round(total), msPerFrame: Math.round(total / n * 100) / 100 };
  }

  dispose() {
    cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._boundResize);
    this.clearTrees();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
  }
}

export { TreeScene, AssetResolver, MATS, mulberry32 };
