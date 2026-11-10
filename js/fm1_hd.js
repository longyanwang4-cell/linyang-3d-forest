/**
 * FM1 高品质森林视觉样板（feature/fm1-visual-prototype）。
 *
 * - 10 棵英雄树：真实 2023 调查数据驱动的 GLB 资产（L0/L1/L2 LOD）
 * - 其余 150 棵：原版低成本模型（InstancedMesh，真实位置，身份不变）
 * - 环境：CC0 PBR 地表、林下示意层（可关闭）、样地科研层（界桩+网格，可关闭）
 * - 三档画质：基础/标准/电影
 * - 科研几何钩子：__fm1hd.measureHero(tag) 世界坐标实测 DBH/H
 *
 * 本页为视觉样板（forest_hd.html），不替换正式 index.html 场景。
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const $ = (sel) => document.querySelector(sel);

const TEX = 'assets/textures/';
const TV = '?v=r7';
const MODEL_DIR = 'assets/models/fm1hd/';
const ASSET_VERSION = 'r7';  // 资产版本号：重建后递增，避免陈旧缓存

const state = {
  heroes: new Map(),      // tag -> {group, lod, data}
  bgData: [],             // 背景树数据（含 instanced 引用）
  manager: null,
  tier: 'standard',
  showScience: true,
  showUndergrowth: true,
  selectedTag: null,
  loaded: false,
};

// ---------------------------------------------------------------- 材质

const _mkRepeat = (tex, rx, ry) => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  return tex;
};
const MATS = {
  larchBark: new THREE.MeshStandardMaterial({
    map: _mkRepeat(new THREE.TextureLoader().load(TEX + 'bark_larch_diff_1k.jpg' + TV), 3, 9),
    normalMap: _mkRepeat(new THREE.TextureLoader().load(TEX + 'bark_larch_nor_1k.png' + TV), 3, 9),
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.95, metalness: 0,
  }),
  birchBark: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'bark_birch_1k.jpg' + TV),
    roughness: 0.85, metalness: 0,
  }),
  needleGreen: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'spray_needle_green.png' + TV),
    alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }),
  needleAutumn: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'spray_needle_autumn.png' + TV),
    alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }),
  birchLeafGreen: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'leaf_birch_green.png' + TV),
    alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }),
  birchLeafAutumn: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'leaf_birch_autumn.png' + TV),
    alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }),
  ground: new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(TEX + 'forest_floor_diff_1k.jpg' + TV),
    normalMap: new THREE.TextureLoader().load(TEX + 'forest_floor_nor_1k.png' + TV),
    color: 0x7d8c5e,
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

// ---------------------------------------------------------------- 场景管理

class HDScene {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this._clock = new THREE.Clock();
    this.heroes = new Map();      // tag -> hero 节点
    this._bgIndex = new Map();
    this._bgCount = 0;
    this._frameTimes = [];
    this._initRenderer();
    this._initScene();
    this._bindEvents();
    this._resize();
    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 标准档默认
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa8c4de);
    this.scene.fog = new THREE.Fog(0xb8c4d2, 70, 280);

    this.camera = new THREE.PerspectiveCamera(
      50, this.container.clientWidth / this.container.clientHeight, 0.1, 1200
    );
    this.camera.position.set(62, 40, 62);

    // 暖色低角度主光（秋季斜阳）
    this.sun = new THREE.DirectionalLight(0xffd9a8, 2.4);
    this.sun.position.set(55, 42, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sun.target.position.set(15, 0, 15);

    const hemi = new THREE.HemisphereLight(0xbdd2e8, 0x4a4a38, 0.72);
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight(0x9fb8d8, 0.35);
    fill.position.set(-40, 30, -35);
    this.scene.add(fill);

    this._buildGround();
    this._buildDistantHills();

    this.heroGroup = new THREE.Group();
    this.scene.add(this.heroGroup);
    this.bgGroup = new THREE.Group();
    this.scene.add(this.bgGroup);
    this.scienceGroup = new THREE.Group();
    this.scene.add(this.scienceGroup);
    this.undergrowthGroup = new THREE.Group();
    this.scene.add(this.undergrowthGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(15, 5, 15);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 260;
  }

  _buildGround() {
    const SIZE = 130;
    const tex = MATS.ground.map;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    const nrm = MATS.ground.normalMap;
    nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
    nrm.repeat.set(16, 16);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      MATS.ground,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(15, 0, 15);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _buildDistantHills() {
    // 装饰性远山（固定种子；明确非 FM1 实测地形）
    const rand = mulberry32(20261101);
    const mat = new THREE.MeshStandardMaterial({ color: 0x40542f, roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const r = 30 + rand() * 55;
      const h = 10 + rand() * 34;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + (i % 3)), mat);
      const a = (i / 16) * Math.PI * 2;
      const d = 150 + rand() * 120;
      cone.position.set(15 + Math.cos(a) * d, h / 2 - 3, 15 + Math.sin(a) * d);
      this.scene.add(cone);
    }
  }

  // ---------------------------------------------------------- 树木装配

  async loadScene(manifest, scene2023) {
    this.manifest = manifest;
    this.sceneData = scene2023;
    const heroTags = new Set(manifest.trees.map((t) => t.tag));
    const bgTrees = scene2023.trees.filter((t) => !heroTags.has(t.tag));

    this._buildBackground(bgTrees);
    this._buildScienceLayer();
    this._buildUndergrowth();
    await this._loadHeroes(manifest);
    this.applyTier(state.tier);
  }

  _buildBackground(bgTrees) {
    // 低成本原版风格：干（圆柱）+ 两层锥（落叶松）/椭球（白桦），InstancedMesh
    const larch = bgTrees.filter((t) => t.species === '落叶松');
    const birch = bgTrees.filter((t) => t.species === '白桦');
    this._bgIndex = new Map(); // instanceKey -> tree data

    const mkLarch = () => {
      const trunkG = new THREE.CylinderGeometry(0.85, 1.1, 1, 6);
      trunkG.translate(0, 0.5, 0);
      const c1 = new THREE.ConeGeometry(1, 1, 7);
      const c2 = new THREE.ConeGeometry(1, 1, 7);
      return { trunk: trunkG, c1, c2 };
    };
    const gL = mkLarch();
    const trunkInstL = new THREE.InstancedMesh(gL.trunk, MATS.bgTrunkLarch, larch.length);
    const crown1L = new THREE.InstancedMesh(gL.c1, MATS.bgCrownLarchGreen, larch.length);
    const crown2L = new THREE.InstancedMesh(gL.c2, MATS.bgCrownLarchGold, larch.length);
    // 金绿混合：偶数实例用金色材质——InstancedMesh 单材质，改为按索引分配两个网格
    const goldIdx = [];
    const greenIdx = [];
    larch.forEach((t, i) => (i % 6 === 2 ? goldIdx : greenIdx).push(i));
    const split = (inst, idxs, geo, mat, list) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(idxs.length, 1));
      m.count = idxs.length;
      m.userData.idxs = idxs;
      inst.push(m);
      return m;
    };
    this.bgGroup.add(trunkInstL, crown1L, crown2L);

    const m4 = new THREE.Matrix4();
    const set = (inst, i, x, y, z, sx, sy, sz, ry) => {
      m4.makeRotationY(ry);
      m4.scale(new THREE.Vector3(sx, sy, sz));
      m4.setPosition(x, y, z);
      inst.setMatrixAt(i, m4);
    };
    larch.forEach((t, i) => {
      const dbh = Math.max(t.dbh_cm / 200, 0.05);
      const H = t.height_m;
      const cb = H * 0.25;
      const crownR = Math.max((t.crown_ns_m + t.crown_ew_m) / 4, 0.3);
      const ry = (t.seq_no * 2.399963) % (Math.PI * 2);
      const key = `L${i}`;
      this._bgIndex.set(key, t);
      set(trunkInstL, i, t.x, 0, t.y, dbh, cb, dbh, ry);
      set(crown1L, i, t.x, cb + (H - cb) * 0.32, t.y, crownR, (H - cb) * 0.62, crownR, ry);
      set(crown2L, i, t.x, cb + (H - cb) * 0.72, t.y, crownR * 0.62, (H - cb) * 0.5, crownR * 0.62, ry);
      this._bgIndex.set(`c1_${i}`, t); this._bgIndex.set(`c2_${i}`, t); this._bgIndex.set(`t_${i}`, t);
    });
    [trunkInstL, crown1L, crown2L].forEach((m) => { m.castShadow = true; m.receiveShadow = false; });
    trunkInstL.instanceMatrix.needsUpdate = true;
    crown1L.instanceMatrix.needsUpdate = true;
    crown2L.instanceMatrix.needsUpdate = true;

    // 白桦背景
    const trunkB = new THREE.CylinderGeometry(0.8, 1.0, 1, 6);
    trunkB.translate(0, 0.5, 0);
    const crownB = new THREE.IcosahedronGeometry(1, 1);
    const trunkInstB = new THREE.InstancedMesh(trunkB, MATS.bgTrunkBirch, birch.length);
    const crownInstB = new THREE.InstancedMesh(crownB, MATS.bgCrownBirch, birch.length);
    this.bgGroup.add(trunkInstB, crownInstB);
    birch.forEach((t, i) => {
      const dbh = Math.max(t.dbh_cm / 200, 0.045);
      const H = t.height_m;
      const cb = H * 0.45;
      const crownR = Math.max((t.crown_ns_m + t.crown_ew_m) / 4, 0.4);
      const ry = (t.seq_no * 1.7) % (Math.PI * 2);
      this._bgIndex.set(`B${i}`, t);
      set(trunkInstB, i, t.x, 0, t.y, dbh, cb, dbh, ry);
      m4.identity();
      m4.makeScale(crownR, H * 0.34, crownR * 0.9);
      m4.setPosition(t.x + crownR * 0.1, cb + H * 0.2, t.y);
      crownInstB.setMatrixAt(i, m4);
      this._bgIndex.set(`bt_${i}`, t); this._bgIndex.set(`bc_${i}`, t);
    });
    trunkInstB.castShadow = true;
    crownInstB.castShadow = true;
    trunkInstB.instanceMatrix.needsUpdate = true;
    crownInstB.instanceMatrix.needsUpdate = true;

    this._bgMeshes = [trunkInstL, crown1L, crown2L, trunkInstB, crownInstB];
    this._bgCount = bgTrees.length;
  }

  _buildScienceLayer() {
    // 界桩 + 尼龙绳（30×30 调查网格示意）+ 5m 小样方网格
    const postGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.1, 8);
    postGeo.translate(0, 0.55, 0);
    const bandGeo = new THREE.CylinderGeometry(0.062, 0.072, 0.22, 8);
    bandGeo.translate(0, 0.85, 0);
    const corners = [[0, 0], [30, 0], [30, 30], [0, 30]];
    for (const [x, z] of corners) {
      const post = new THREE.Mesh(postGeo, MATS.post);
      post.position.set(x, 0, z);
      post.castShadow = true;
      const band = new THREE.Mesh(bandGeo, MATS.postBand);
      band.position.set(x, 0, z);
      this.scienceGroup.add(post, band);
    }
    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0.95, 0, 30, 0.95, 0, 30, 0.95, 0, 30, 0.95, 30,
      30, 0.95, 30, 0, 0.95, 30, 0, 0.95, 30, 0, 0.95, 0,
    ], 3));
    this.scienceGroup.add(new THREE.LineSegments(
      ropeGeo, new THREE.LineBasicMaterial({ color: 0xf0ede4 })
    ));
    const gridPts = [];
    for (let i = 0; i <= 6; i++) {
      gridPts.push(i * 5, 0.02, 0, i * 5, 0.02, 30);
      gridPts.push(0, 0.02, i * 5, 30, 0.02, i * 5);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    this.scienceGroup.add(new THREE.LineSegments(
      gridGeo, new THREE.LineBasicMaterial({ color: 0x3a4a32, transparent: true, opacity: 0.45 })
    ));
  }

  _buildUndergrowth() {
    // 可关闭示意层：草簇 + 岩石（无实测依据，种子固定）
    const rand = mulberry32(777);
    const grassGeo = new THREE.PlaneGeometry(0.9, 0.9);
    grassGeo.translate(0, 0.45, 0);
    const N = 420;
    const grass = new THREE.InstancedMesh(grassGeo, MATS.grass, N);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < N; i++) {
      const x = rand() * 30, z = rand() * 30;
      m4.makeRotationY(rand() * Math.PI);
      const s = 0.5 + rand() * 0.7;
      m4.scale(new THREE.Vector3(s, s, s));
      m4.setPosition(x, 0, z);
      grass.setMatrixAt(i, m4);
    }
    grass.instanceMatrix.needsUpdate = true;
    this.undergrowthGroup.add(grass);
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 9; i++) {
      const rock = new THREE.Mesh(rockGeo, MATS.rock);
      const s = 0.25 + rand() * 0.5;
      rock.scale.set(s, s * 0.6, s);
      rock.position.set(rand() * 30, s * 0.25, rand() * 30);
      rock.rotation.y = rand() * Math.PI;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.undergrowthGroup.add(rock);
    }
  }

  async _loadHeroes(manifest) {
    const loader = new GLTFLoader();
    const jobs = manifest.trees.map((t) => new Promise((resolve) => {
      const lod = new THREE.LOD();
      const levels = [
        { file: t.files.L0, dist: 0 },
        { file: t.files.L1 ?? t.files.L0, dist: 55 },
        { file: t.files.L2 ?? t.files.L0, dist: 130 },
      ];
      let pending = levels.length;
      for (const lv of levels) {
        loader.load(MODEL_DIR + lv.file + '?v=' + ASSET_VERSION, (gltf) => {
          const obj = gltf.scene;
          obj.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.material = this._heroMaterial(t, o);
            }
          });
          lod.addLevel(obj, lv.dist);
          if (--pending === 0) resolve();
        }, undefined, () => {
          console.error('GLB 加载失败:', lv.file);
          if (--pending === 0) resolve();
        });
      }
      const group = new THREE.Group();
      group.position.set(t.x, 0, t.y);
      group.rotation.y = (t.row_index * 2.399963) % (Math.PI * 2);
      group.add(lod);
      group.userData = { tag: t.tag, data: t, kind: 'hero' };
      this.heroes.set(t.tag, { group, lod, data: t });
      this.heroGroup.add(group);
    }));
    await Promise.all(jobs);
  }

  _heroMaterial(tree, obj) {
    // 按部件名分配材质；秋季混合：约 55% 落叶松金黄（参考图秋季景观）。
    // 白桦保留 Innerscene 源资产自带 PBR 材质（叶片/树皮/细枝均含原始贴图），
    // 秋季个体仅对叶材质做色调染色（不改 UV-贴图对应关系）。
    const name = (obj.name || '').toLowerCase();
    const isAutumn = tree.tag.charCodeAt(0) % 5 < 3;
    if (name.includes('needle')) {
      return isAutumn ? MATS.needleAutumn : MATS.needleGreen;
    }
    if (name.includes('larch_trunk') || name.includes('larch_branch')) {
      return MATS.larchBark;
    }
    if (name.includes('birch') && (name.includes('foliage') || name.includes('leaf'))) {
      // 源材质 alphaMode=OPAQUE 但叶贴图带 alpha → 必须开 alphaTest 才能镂空
      const m = obj.material.clone();
      m.alphaTest = 0.5;
      m.side = THREE.DoubleSide;
      if (isAutumn) m.color = new THREE.Color(0xd8b84a);
      m.needsUpdate = true;
      return m;
    }
    return obj.material; // 白桦树皮/细枝等一律保留源材质
  }

  // ---------------------------------------------------------- 画质档位

  applyTier(tier) {
    state.tier = tier;
    const dpr = { basic: 1, standard: 1.5, cinema: 2 }[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dpr));
    this.renderer.shadowMap.enabled = tier !== 'basic';
    const shadowSize = { basic: 0, standard: 1024, cinema: 2048 }[tier];
    if (shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.sun.intensity = tier === 'cinema' ? 3.0 : 2.7;
    this.scene.fog.near = { basic: 140, standard: 120, cinema: 60 }[tier];
    this.scene.fog.far = { basic: 520, standard: 460, cinema: 300 }[tier];
    this.scene.fog.color.setHex(tier === 'cinema' ? 0xc4bfae : 0xb8c4d2);
    this.scene.background.setHex(tier === 'cinema' ? 0xb2c1d6 : 0xa8c4de);
    // 英雄树 LOD 上限：基础档用 L1
    for (const { lod } of this.heroes.values()) {
      lod.levels.forEach((lv, i) => {
        if (tier === 'basic' && i === 0) lv.distance = 25;
        else if (i === 0) lv.distance = 0;
      });
    }
    this._resize();
    document.querySelectorAll('.tier-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.tier === tier));
  }

  // ---------------------------------------------------------- 相机

  _tweenCamera(toPos, toTarget, duration = 900) {
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

  viewBird() { this._tweenCamera(new THREE.Vector3(62, 40, 62), new THREE.Vector3(15, 5, 15)); }
  viewTop() { this._tweenCamera(new THREE.Vector3(15, 95, 15.01), new THREE.Vector3(15, 0, 15)); }
  viewInside() { this._tweenCamera(new THREE.Vector3(3.5, 1.7, 3.5), new THREE.Vector3(22, 10, 20)); }
  viewReset() { this._tweenCamera(new THREE.Vector3(62, 40, 62), new THREE.Vector3(15, 5, 15)); }

  focusTree(tag, distance = 13) {
    const h = this.heroes.get(tag);
    if (!h) return false;
    const { x, y } = h.data;
    const H = h.data.height_m;
    const dir = new THREE.Vector3(1, 0.5, 1).normalize().multiplyScalar(distance);
    this._tweenCamera(
      new THREE.Vector3(x, 0, y).add(dir).add(new THREE.Vector3(0, H * 0.45, 0)),
      new THREE.Vector3(x, H * 0.5, y), 1100,
    );
    return true;
  }

  // ---------------------------------------------------------- 交互与拾取

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
      if (this.handlers.onSelect) this.handlers.onSelect(hit);
    };
    this._boundMove = (e) => {
      const hit = this._pick(e);
      dom.style.cursor = hit ? 'pointer' : '';
    };
    dom.addEventListener('pointerdown', this._boundDown);
    dom.addEventListener('pointerup', this._boundUp);
    dom.addEventListener('pointermove', this._boundMove);
  }

  _pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObjects([this.heroGroup, this.bgGroup], true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData?.tag) return o.userData;
        if (o.isInstancedMesh) {
          const key = o.userData.pickKeys?.[h.instanceId];
          if (key && this._bgIndex.has(key)) return { tag: this._bgIndex.get(key).tag, data: this._bgIndex.get(key), kind: 'bg' };
        }
        o = o.parent;
      }
    }
    return null;
  }

  // ---------------------------------------------------------- 科研几何实测

  /** 世界坐标实测英雄树：y=1.3m 干径与总高（真实 Three.js 顶点数据）。
   *  DBH 语义：垂直于树干轴线测量——胸高环取"环心"（环顶点中位中心），
   *  而非基轴（树干自然倾斜时基轴测量会引入 1–2cm 误差）。 */
  measureHero(tag) {
    const h = this.heroes.get(tag);
    if (!h) return null;
    h.group.updateMatrixWorld(true);
    let trunkMesh = null;
    h.group.traverse((o) => {
      if (!trunkMesh && o.isMesh && (o.name || '').toLowerCase().includes('trunk')) trunkMesh = o;
    });
    if (!trunkMesh) return { error: 'trunk mesh not found' };
    const pos = trunkMesh.geometry.getAttribute('position');
    const ring = [];
    const trunkVerts = [];
    let maxY = -1e9;
    h.group.traverse((o) => {
      if (!o.isMesh || o.isLOD) return;
      const pp = o.geometry.getAttribute('position');
      for (let i = 0; i < pp.count; i++) {
        const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i)).applyMatrix4(o.matrixWorld);
        if (v.y > maxY) maxY = v.y;
      }
    });
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(trunkMesh.matrixWorld);
      trunkVerts.push(v);
      if (Math.abs(v.y - 1.3) < 0.12) ring.push(v);
    }
    let method, measured, ringCenter;
    if (ring.length >= 4) {
      const cx = ring.reduce((a, v) => a + v.x, 0) / ring.length;
      const cz = ring.reduce((a, v) => a + v.z, 0) / ring.length;
      const radials = ring.map((v) => Math.hypot(v.x - cx, v.z - cz)).sort((a, b) => a - b);
      measured = radials[Math.floor(radials.length / 2)];
      method = 'vertex_ring';
      ringCenter = [cx, cz];
    } else {
      // 轮尺法：胸高处树干中心（近 1.3m 顶点中位中心）向 8 方位水平射线，
      // 与树干表面求交——即真实测树的围尺方式，直接检验 Three.js 场景。
      const near = trunkVerts
        .filter((v) => Math.abs(v.y - 1.3) < 0.8)
        .sort((a, b) => Math.abs(a.y - 1.3) - Math.abs(b.y - 1.3))
        .slice(0, 60);
      if (!near.length) return { error: 'no trunk verts near breast height' };
      const cx = near.reduce((a, v) => a + v.x, 0) / near.length;
      const cz = near.reduce((a, v) => a + v.z, 0) / near.length;
      const raycaster = new THREE.Raycaster();
      raycaster.far = 30;
      const hits = [];
      for (let k = 0; k < 8; k++) {
        const dir = new THREE.Vector3(Math.cos((Math.PI / 4) * k), 0, Math.sin((Math.PI / 4) * k));
        raycaster.set(new THREE.Vector3(cx, 1.3, cz).add(dir.clone().multiplyScalar(6)),
          dir.clone().negate());
        const hit = raycaster.intersectObject(trunkMesh, false)[0];
        if (hit) hits.push(Math.hypot(hit.point.x - cx, hit.point.z - cz));
      }
      if (hits.length < 4) return { error: 'caliper rays failed', hits: hits.length };
      hits.sort((a, b) => a - b);
      measured = hits[Math.floor(hits.length / 2)];
      method = 'caliper_rays';
      ringCenter = [cx, cz];
    }
    return {
      tag,
      method,
      target_dbh_m: h.data.dbh_cm / 200,
      measured_dbh_m: Math.round(measured * 10000) / 10000,
      dbh_error_m: Math.round(Math.abs(measured - h.data.dbh_cm / 200) * 10000) / 10000,
      ring_center_offset_m: Math.round(Math.hypot(ringCenter[0] - h.data.x, ringCenter[1] - h.data.y) * 1000) / 1000,
      target_height: h.data.height_m,
      measured_height: Math.round(maxY * 1000) / 1000,
      height_error_m: Math.round(Math.abs(maxY - h.data.height_m) * 1000) / 1000,
    };
  }

  /** 持续 FPS 采样（真实渲染循环帧时间分布）。 */
  collectFps(seconds) {
    return new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (now - start < seconds * 1000) requestAnimationFrame(tick);
        else {
          const arr = times.slice(2).sort((a, b) => a - b);
          const q = (p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
          resolve({
            samples: arr.length,
            avgFps: Math.round(1000 / (arr.reduce((a, b) => a + b, 0) / arr.length)),
            p95FrameMs: Math.round(q(0.95) * 10) / 10,
            medianFrameMs: Math.round(q(0.5) * 10) / 10,
            worstFrameMs: Math.round(arr[arr.length - 1] * 10) / 10,
          });
        }
      };
      const start = performance.now();
      requestAnimationFrame(tick);
    });
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this._rafId = requestAnimationFrame(this._animate);
    const dt = this._clock.getDelta();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._boundResize);
    const dom = this.renderer?.domElement;
    dom?.removeEventListener('pointerdown', this._boundDown);
    dom?.removeEventListener('pointerup', this._boundUp);
    dom?.removeEventListener('pointermove', this._boundMove);
    this.scene?.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.controls?.dispose();
    this.renderer?.dispose();
    dom?.remove();
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

// ---------------------------------------------------------------- UI 逻辑

async function init() {
  try {
    await initInner();
  } catch (e) {
    console.error('三维样板初始化失败:', e);
    const el = document.querySelector('#loading');
    if (el) {
      el.classList.remove('hidden');
      const msg = el.querySelector('div:last-child');
      if (msg) msg.textContent = '加载失败：' + (e?.stack || e?.message || e).slice(0, 400);
    }
  }
}

async function initInner() {
  const [manifest, scene2023] = await Promise.all([
    fetch('data/fm1hd_manifest.json').then((r) => r.json()),
    fetch('data/fm1_scene_2023.json').then((r) => r.json()),
  ]);
  // manifest 复制到 data/ 由工具完成；此处直接读模型目录清单
  const mgr = new HDScene($('#canvas-container'), {
    onSelect: (hit) => {
      if (hit) { state.selectedTag = hit.tag; renderInfo(hit.data, hit.kind); }
      else closePanel();
    },
  });
  state.manager = mgr;
  state.manifest = manifest;
  // manifest 数据放到 data/ 以便相对路径（工具已复制）
  await mgr.loadScene(manifest, scene2023);
  bindUI();
  $('#stats').innerHTML =
    `<b>${manifest.trees.length}</b> 棵高品质样板（真实DBH/H） ｜ 背景树 <b>${mgr._bgCount}</b>（真实位置·原版模型）`;
  $('#fps').textContent = 'FPS --';
  // FPS 持续刷新
  const fpsEl = $('#fps');
  setInterval(async () => {
    if (window.__fm1hd) {
      const s = await window.__fm1hd.collectFps(1.5);
      fpsEl.textContent = `FPS ${s.avgFps} ｜ 帧 ${s.medianFrameMs}/${s.p95FrameMs}ms`;
    }
  }, 2500);
  $('#loading').classList.add('hidden');
  // 电影感入场：鸟瞰缓降
  mgr.camera.position.set(120, 90, 120);
  mgr.viewBird();

  window.__fm1hd = {
    measureHero: (tag) => mgr.measureHero(tag),
    collectFps: (s) => mgr.collectFps(s),
    setTier: (t) => mgr.applyTier(t),
    setView: (v) => mgr[`view${v[0].toUpperCase()}${v.slice(1)}`]?.(),
    heroCount: () => mgr.heroes.size,
    bgCount: () => mgr._bgCount,
    toggleScience: (on) => { mgr.scienceGroup.visible = on; },
    toggleUndergrowth: (on) => { mgr.undergrowthGroup.visible = on; },
    probeMaterials: (tag) => {
      const h = mgr.heroes.get(tag);
      if (!h) return { err: 'no hero' };
      const out = [];
      h.group.traverse((o) => {
        if (o.isMesh) {
          const m = o.material;
          out.push({
            node: o.name,
            matName: m?.name,
            hasMap: !!m?.map,
            mapLoaded: m?.map?.image ? (m.map.image.width + 'x' + m.map.image.height) : (m?.map ? 'pending' : null),
            uv: !!o.geometry.getAttribute('uv'),
          });
        }
      });
      return out.filter((x) => x.node.includes('trunk') || x.node.includes('needle')).slice(0, 4);
    },
    probe: (tag) => {
      const h = mgr.heroes.get(tag);
      if (!h) return { err: 'no hero' };
      const names = [];
      h.group.traverse((o) => { if (o.isMesh) names.push(o.name + ' | lod=' + (o.parent === h.lod ? 'L' : 'sub')); });
      return { names: names.slice(0, 12), lodLevels: h.lod.levels.map((l) => l.distance) };
    },
    /** rAF 节流环境下的渲染成本测量（手动连续渲染 n 帧） */
    renderN: (n) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) mgr.renderer.render(mgr.scene, mgr.camera);
      const total = performance.now() - t0;
      return {
        frames: n,
        totalMs: Math.round(total),
        msPerFrame: Math.round((total / n) * 100) / 100,
        estFps: Math.round(1000 / (total / n)),
      };
    },
    /** 固定机位快照（手动渲染一帧后读回画布） */
    snapshot: (view, tag, opts) => {
      const solo = opts?.solo !== false;
      const bgVis = mgr.bgGroup.visible, ugVis = mgr.undergrowthGroup.visible;
      if (solo) { mgr.bgGroup.visible = false; mgr.undergrowthGroup.visible = false; }
      const restore = () => { mgr.bgGroup.visible = bgVis; mgr.undergrowthGroup.visible = ugVis; };
      if (view === 'top') { mgr.camera.position.set(15, 95, 15.01); mgr.controls.target.set(15, 0, 15); }
      else if (view === 'inside') { mgr.camera.position.set(3.5, 1.7, 3.5); mgr.controls.target.set(22, 10, 20); }
      else if (view === 'larch') {
        const t = state.manifest.trees.find((x) => x.tag === (tag || '0322'));
        mgr.camera.position.set(t.x + 11, t.height_m * 0.5, t.y + 11);
        mgr.controls.target.set(t.x, t.height_m * 0.45, t.y);
      } else if (view === 'birch') {
        const t = state.manifest.trees.find((x) => x.species === '白桦');
        mgr.camera.position.set(t.x + 8, t.height_m * 0.45, t.y + 8);
        mgr.controls.target.set(t.x, t.height_m * 0.45, t.y);
      } else { mgr.camera.position.set(62, 40, 62); mgr.controls.target.set(15, 5, 15); }
      mgr.controls.update();
      mgr.renderer.render(mgr.scene, mgr.camera);
      return mgr.renderer.domElement.toDataURL('image/png');
    },
  };
}

function bindUI() {
  document.querySelectorAll('.tier-btn').forEach((b) =>
    b.addEventListener('click', () => state.manager.applyTier(b.dataset.tier)));
  $('#btn-bird').addEventListener('click', () => state.manager.viewBird());
  $('#btn-inside').addEventListener('click', () => state.manager.viewInside());
  $('#btn-top').addEventListener('click', () => state.manager.viewTop());
  $('#btn-reset').addEventListener('click', () => state.manager.viewReset());
  $('#btn-science').addEventListener('click', (e) => {
    state.showScience = !state.showScience;
    e.target.classList.toggle('active', state.showScience);
    state.manager.scienceGroup.visible = state.showScience;
  });
  $('#btn-undergrowth').addEventListener('click', (e) => {
    state.showUndergrowth = !state.showUndergrowth;
    e.target.classList.toggle('active', state.showUndergrowth);
    state.manager.undergrowthGroup.visible = state.showUndergrowth;
  });
  $('#btn-back').addEventListener('click', () => { window.location.href = 'map.html'; });
  $('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  $('#btn-search').addEventListener('click', doSearch);
  $('#info-panel').addEventListener('click', (e) => {
    if (e.target.classList?.contains('panel-close')) closePanel();
  });
}

function doSearch() {
  const raw = $('#search-input').value.trim();
  if (!raw) return;
  const tree = state.manifest.trees.find((t) => t.tag === raw || String(t.index + 1) === raw);
  const msg = $('#search-msg');
  if (!tree) {
    // 背景树搜索（数据来自场景 JSON）
    const bg = state.manager.sceneData.trees.find((t) => t.tag === raw);
    if (bg) {
      msg.textContent = '';
      renderInfo(bg, 'bg');
      state.manager.focusTree(bg.tag, 15);
      return;
    }
    msg.textContent = `未找到牌号「${raw}」（样板仅 10 棵英雄树+背景）`;
    return;
  }
  msg.textContent = '';
  state.selectedTag = tree.tag;
  renderInfo(tree, 'hero');
  state.manager.focusTree(tree.tag);
}

function closePanel() {
  $('#info-panel').classList.remove('open');
  state.selectedTag = null;
}

function renderInfo(t, kind) {
  const panel = $('#info-panel');
  const hero = kind === 'hero';
  panel.innerHTML = `
    <button class="panel-close" title="关闭">✕</button>
    <div class="panel-title">
      <span class="tag-badge">${t.tag}</span>
      <span class="species">${t.species}</span>
      <span class="seq">${hero ? '⭐ 高品质样板' : '背景树（原版模型）'} · 编号 ${t.seq_no}</span>
    </div>
    ${hero ? '<div class="note ok">本树为 CC0/程序化高品质资产，树干离地 1.3m 处直径与实测 DBH 一致、总高与实测 H 一致（世界坐标已验证）。</div>' : ''}
    <table class="info-table">
      <tr><td>胸径</td><td>${t.dbh_cm} cm（实测）</td></tr>
      <tr><td>树高</td><td>${t.height_m} m（实测）</td></tr>
      <tr><td>冠幅 NS/EW</td><td>${t.crown_ns_m ?? '—'} / ${t.crown_ew_m ?? '—'} m</td></tr>
      <tr><td>局部坐标</td><td>X ${t.x}，Y ${t.y} <span class="dim">(未配准)</span></td></tr>
      <tr><td>数据来源</td><td>${t.source_file ?? 'fm1_scene_2023.json'} · 第 ${t.row_index} 行 · ${t.survey_year ?? 2023} 年调查</td></tr>
    </table>
    ${hero ? `<div class="note dim">LOD: ${Object.values(t.files ?? {}).join(', ')}</div>` : ''}
    <div class="note dim">
      季节色调为示意（参考图秋季景观）；枝叶形态为风格化重construction，
      不代表真实树冠重建。坐标未配准。
    </div>
  `;
  panel.classList.add('open');
}

window.addEventListener('DOMContentLoaded', init);
