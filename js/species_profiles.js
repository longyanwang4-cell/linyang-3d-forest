/**
 * 东北森林样地树种植物学档案、三维冠形构型与程序化树皮/叶簇纹理库。
 *
 * 设计原则（严守科研红线）：
 * 1. 单木胸径（1.3m 处直径）、树高、实测冠幅与树位坐标严格由真实调查表记录驱动；
 * 2. 树种三维冠形构型（塔形轮生冠/尖塔下披冠/高干伞形松冠/疏朗卵圆冠/高耸柱状冠/广卵团簇冠）、
 *    树皮纹理（白桦横生皮孔、樟子松上黄下褐双色皮、山杨菱形皮孔、柞树深纵裂等）与季相叶色
 *    用于提升多树种辨识度与林学教学/科研展示表现力，界面明确标注为「参数化结构示意」。
 */

(function () {
const SPECIES_PROFILES = {
  '落叶松': {
    name: '落叶松',
    fullName: '兴安落叶松',
    latin: 'Larix gmelinii',
    family: '松科 · 落叶松属 (Pinaceae)',
    kind: 'conifer',
    archetype: 'conifer_tower',
    leafHabit: '落叶针叶乔木',
    evergreen: false,
    cbRatio: 0.24,
    fb: 0.17,
    trunk: 0x6b4a35,
    trunkTop: 0x7e5840,
    crown: 0x2f6134,
    crownAutumn: 0xd89624,
    em: 0x0d1f0e,
    emAutumn: 0x2b1904,
    barkPattern: 'fissured_scale',
    barkDesc: '灰褐至暗褐色，纵裂成鳞片状剥落，内皮红褐色',
    crownDesc: '圆锥形塔状冠，大枝平展微垂、枝端上翘，轮生层理清晰',
    foliageDesc: '针叶柔薄线形，长1.5–3cm，短枝簇生15–30枚；秋季全冠转金黄色后落叶',
    ecology: '强阳性、极耐严寒与永冻层，大兴安岭寒温带针叶林核心建群种',
  },
  '白桦': {
    name: '白桦',
    fullName: '东北白桦',
    latin: 'Betula platyphylla',
    family: '桦木科 · 桦木属 (Betulaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_ovoid',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.40,
    fb: 0.22,
    trunk: 0xdcd7cb,
    trunkTop: 0xeae6dc,
    crown: 0x6d9a4b,
    crownAutumn: 0xe0b232,
    em: 0x16240f,
    emAutumn: 0x2a1f05,
    barkPattern: 'birch_white',
    barkDesc: '树皮洁白光滑，纸质分层剥落，具深色横生皮孔，树基具黑褐色粗裂靴斑',
    crownDesc: '卵圆形至阔卵形疏朗树冠，细枝柔韧微下垂，通透感强',
    foliageDesc: '单叶互生，三角状卵形具重锯齿；秋季叶片呈亮金黄色',
    ecology: '强阳性先锋树种，耐严寒，常在采伐/火烧迹地形成纯林或落叶松-白桦混交林',
  },
  '樟子松': {
    name: '樟子松',
    fullName: '樟子松',
    latin: 'Pinus sylvestris var. mongolica',
    family: '松科 · 松属 (Pinaceae)',
    kind: 'conifer',
    archetype: 'conifer_umbrella',
    leafHabit: '常绿针叶乔木',
    evergreen: true,
    cbRatio: 0.44,
    fb: 0.20,
    trunk: 0x9c6234,
    trunkTop: 0xc9823e,
    crown: 0x3a6b35,
    crownAutumn: 0x33602f,
    em: 0x0d1f0e,
    emAutumn: 0x0b1a0c,
    barkPattern: 'pine_bicolor',
    barkDesc: '特征性上下双色：树干上部橙黄至杏红色薄片剥落，中下部灰褐色深龟裂',
    crownDesc: '自然整枝高，中老龄呈伞形或扁圆形平顶冠，团簇分布于主干中上部',
    foliageDesc: '针叶2针一束，粗硬微扭曲，长4–9cm，四季苍翠深绿',
    ecology: '强阳性、深根性，极耐干旱瘠薄沙地与山地石质阳坡，东北重要防风固沙与用材树种',
  },
  '云杉': {
    name: '云杉',
    fullName: '红皮云杉 / 鱼鳞云杉',
    latin: 'Picea koraiensis / P. jezoensis',
    family: '松科 · 云杉属 (Pinaceae)',
    kind: 'conifer',
    archetype: 'conifer_spire',
    leafHabit: '常绿针叶乔木',
    evergreen: true,
    cbRatio: 0.17,
    fb: 0.15,
    trunk: 0x5c3f2e,
    trunkTop: 0x6e4b37,
    crown: 0x1f4f2c,
    crownAutumn: 0x1b4627,
    em: 0x09170b,
    emAutumn: 0x09170b,
    barkPattern: 'spruce_scale',
    barkDesc: '红褐色或暗灰褐色，裂成不规则鱼鳞状薄块片固着于干表',
    crownDesc: '窄尖塔形浓密长冠，枝下高很低，多层轮生侧枝平展下披呈裙状',
    foliageDesc: '叶四棱状条形，先端尖，着生于明显叶枕上，深黛青绿色，四季常青',
    ecology: '耐阴、喜冷凉湿润，常与冷杉、红松、落叶松混生于阴坡或谷地',
  },
  '红松': {
    name: '红松',
    fullName: '红松（东北果松）',
    latin: 'Pinus koraiensis',
    family: '松科 · 松属 (Pinaceae)',
    kind: 'conifer',
    archetype: 'conifer_lush_tower',
    leafHabit: '常绿针叶乔木',
    evergreen: true,
    cbRatio: 0.28,
    fb: 0.21,
    trunk: 0x6a4630,
    trunkTop: 0x7d5339,
    crown: 0x2b5c2a,
    crownAutumn: 0x255224,
    em: 0x0c1e0d,
    emAutumn: 0x0c1e0d,
    barkPattern: 'pine_plate',
    barkDesc: '灰褐色至棕褐色，纵裂成不规则长方形厚鳞片状剥落，内皮赤褐色',
    crownDesc: '阔圆锥形至苍劲大塔冠，主枝粗壮平展，晚年树冠顶部常呈宽圆状',
    foliageDesc: '针叶5针一束，粗长（7–12cm）苍翠，叶背具白色气孔线，四季常绿',
    ecology: '东北温带地带性顶极群落「阔叶红松林」核心建群种，幼龄耐阴、成龄喜光，国家珍贵树种',
  },
  '杨树': {
    name: '杨树',
    fullName: '山杨 / 香杨',
    latin: 'Populus davidiana / P. koreana',
    family: '杨柳科 · 杨属 (Salicaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_column',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.38,
    fb: 0.19,
    trunk: 0xb6b5a2,
    trunkTop: 0xc8c7b6,
    crown: 0x7fae52,
    crownAutumn: 0xe3b838,
    em: 0x16240f,
    emAutumn: 0x2b2005,
    barkPattern: 'poplar_lenticel',
    barkDesc: '幼中龄树皮平滑呈灰绿或青白色，布满暗色菱形皮孔；老树基部暗灰纵裂',
    crownDesc: '高耸长卵形至圆柱状树冠，分枝角较小、侧枝斜上聚拢，干形通直',
    foliageDesc: '叶近圆形或三角状卵形，叶柄扁长微风即颤；秋季转明黄色',
    ecology: '喜光、耐寒、萌蘖力极强，次生林常见优势阔叶树种',
  },
  '榆树': {
    name: '榆树',
    fullName: '春榆 / 白榆',
    latin: 'Ulmus davidiana var. japonica / U. pumila',
    family: '榆科 · 榆属 (Ulmaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_vase',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.34,
    fb: 0.25,
    trunk: 0x765d45,
    trunkTop: 0x856a50,
    crown: 0x6a9646,
    crownAutumn: 0xcca036,
    em: 0x141e12,
    emAutumn: 0x261b06,
    barkPattern: 'elm_interlace',
    barkDesc: '暗灰褐色，具深浅交错的纵裂沟槽，粗糙坚韧',
    crownDesc: '倒卵形至广伞形开展树冠，几条粗壮主枝斜上分叉呈漏斗状，细枝密生',
    foliageDesc: '叶椭圆状卵形，基部偏斜具重锯齿；翅果扁平钱状；秋叶金黄至褐黄',
    ecology: '喜光、耐旱耐寒，根系发达，常见于河谷阶地及山地混交林',
  },
  '蒙古栎': {
    name: '蒙古栎',
    fullName: '蒙古栎（柞树）',
    latin: 'Quercus mongolica',
    family: '壳斗科 · 栎属 (Fagaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_dome',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.30,
    fb: 0.26,
    trunk: 0x614934,
    trunkTop: 0x70563e,
    crown: 0x5f8838,
    crownAutumn: 0xb85a26,
    em: 0x131d10,
    emAutumn: 0x281105,
    barkPattern: 'oak_deep_ridge',
    barkDesc: '深灰褐色，具厚木栓质宽深纵裂脊，质地坚硬苍劲',
    crownDesc: '宽阔扁球形至广卵形团簇大冠，主枝粗壮扭曲平展，树冠厚重饱满',
    foliageDesc: '叶倒卵形集生于枝端，叶缘具波状钝齿，革质；秋叶呈赭红至古铜棕色',
    ecology: '强阳性、耐干旱瘠薄与森林火烧，东北次生林与针阔混交林重要建群种',
  },
  '柞树': {
    name: '柞树',
    fullName: '柞树（蒙古栎）',
    latin: 'Quercus mongolica',
    family: '壳斗科 · 栎属 (Fagaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_dome',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.30,
    fb: 0.26,
    trunk: 0x614934,
    trunkTop: 0x70563e,
    crown: 0x5f8838,
    crownAutumn: 0xb85a26,
    em: 0x131d10,
    emAutumn: 0x281105,
    barkPattern: 'oak_deep_ridge',
    barkDesc: '深灰褐色，具厚木栓质宽深纵裂脊，质地坚硬苍劲',
    crownDesc: '宽阔扁球形至广卵形团簇大冠，主枝粗壮扭曲平展，树冠厚重饱满',
    foliageDesc: '叶倒卵形集生于枝端，叶缘具波状钝齿，革质；秋叶呈赭红至古铜棕色',
    ecology: '东北林区习惯将蒙古栎称为柞树，耐瘠薄阳坡，萌生能力强',
  },
  '水曲柳': {
    name: '水曲柳',
    fullName: '水曲柳',
    latin: 'Fraxinus mandshurica',
    family: '木犀科 · 梣属 (Oleaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_ovoid',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.42,
    fb: 0.23,
    trunk: 0x988b76,
    trunkTop: 0xa89a84,
    crown: 0x74a04c,
    crownAutumn: 0xdcb43c,
    em: 0x141f12,
    emAutumn: 0x281e06,
    barkPattern: 'ash_diamond',
    barkDesc: '灰白色至浅灰褐色，具规整的浅纵裂及菱形网状裂纹，干形通直圆满',
    crownDesc: '端正阔卵形高大树冠，对生分枝规整，枝下高较高',
    foliageDesc: '奇数羽状复叶对生，小叶7–11枚长圆形；秋季转清亮柠檬黄色',
    ecology: '「东北三大硬阔」之首，喜湿润肥沃缓坡谷地，国家二级重点保护珍贵用材树种',
  },
  '胡桃楸': {
    name: '胡桃楸',
    fullName: '胡桃楸（山核桃）',
    latin: 'Juglans mandshurica',
    family: '胡桃科 · 胡桃属 (Juglandaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_dome',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.38,
    fb: 0.26,
    trunk: 0x6f5e4c,
    trunkTop: 0x806d58,
    crown: 0x6a9348,
    crownAutumn: 0xcfa032,
    em: 0x141d11,
    emAutumn: 0x261c05,
    barkPattern: 'walnut_furrow',
    barkDesc: '灰黑色至暗灰色，具纵浅裂长条状平坦脊纹，纵沟明显',
    crownDesc: '宽平广伞形至扁球形疏朗大冠，顶部开展，枝条粗壮稀疏',
    foliageDesc: '大型奇数羽状复叶长达40–80cm，小叶9–17枚；秋叶变黄较早脱落',
    ecology: '「东北三大硬阔」之一，喜光喜湿润肥沃土壤，珍贵用材与坚果经济树种',
  },
  '紫椴': {
    name: '紫椴',
    fullName: '紫椴 / 糠椴',
    latin: 'Tilia amurensis',
    family: '锦葵科(原椴树科) · 椴树属 (Malvaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_ovoid',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.34,
    fb: 0.24,
    trunk: 0x746554,
    trunkTop: 0x847462,
    crown: 0x5c8e42,
    crownAutumn: 0xd6a634,
    em: 0x121d10,
    emAutumn: 0x261b05,
    barkPattern: 'elm_interlace',
    barkDesc: '暗灰色，纵裂成片状或浅沟状，内皮纤维发达',
    crownDesc: '饱满圆卵形至钟形规整树冠，枝叶密集匀称',
    foliageDesc: '叶阔卵形至心形，基部心形，具舌状苞片聚伞花序；秋叶金黄',
    ecology: '阔叶红松林重要伴生阔叶树种，优质蜜源与细木工用材树种',
  },
  '色木槭': {
    name: '色木槭',
    fullName: '色木槭（五角枫）',
    latin: 'Acer mono',
    family: '无患子科(原槭树科) · 槭属 (Sapindaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_vase',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.32,
    fb: 0.25,
    trunk: 0x7c7265,
    trunkTop: 0x8c8274,
    crown: 0x659445,
    crownAutumn: 0xc94028,
    em: 0x131d10,
    emAutumn: 0x2c0905,
    barkPattern: 'ash_diamond',
    barkDesc: '灰色或浅灰褐色，表面较平滑或具细浅纵裂条纹',
    crownDesc: '伞形至圆球形舒展树冠，枝条纤细密集，层次分明',
    foliageDesc: '叶掌状5–7裂，基部心形，双翅果展开；秋季叶片呈绚丽绯红至橙红色',
    ecology: '耐阴性较强，常居于针阔混交林第二亚层，秋季林相色彩标志树种',
  },
  '黄檗': {
    name: '黄檗',
    fullName: '黄檗（黄波罗）',
    latin: 'Phellodendron amurense',
    family: '芸香科 · 黄檗属 (Rutaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_dome',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.36,
    fb: 0.25,
    trunk: 0x88765c,
    trunkTop: 0x998568,
    crown: 0x689648,
    crownAutumn: 0xd4a832,
    em: 0x131d10,
    emAutumn: 0x261c05,
    barkPattern: 'oak_deep_ridge',
    barkDesc: '外皮灰褐色具极厚弹性软木栓层，深纵沟裂，内皮鲜黄色',
    crownDesc: '宽阔伞形至扁球形大冠，主枝粗壮平展',
    foliageDesc: '奇数羽状复叶对生，小叶5–13枚，浆果状核果紫黑色',
    ecology: '「东北三大硬阔」之一，国家重点保护珍贵药用与用材树种',
  },
  '黑桦': {
    name: '黑桦',
    fullName: '黑桦（兴安桦）',
    latin: 'Betula dahurica',
    family: '桦木科 · 桦木属 (Betulaceae)',
    kind: 'broadleaf',
    archetype: 'broadleaf_ovoid',
    leafHabit: '落叶阔叶乔木',
    evergreen: false,
    cbRatio: 0.36,
    fb: 0.22,
    trunk: 0x54453a,
    trunkTop: 0x665447,
    crown: 0x628e42,
    crownAutumn: 0xd6a430,
    em: 0x131d10,
    emAutumn: 0x261b05,
    barkPattern: 'fissured_scale',
    barkDesc: '黑褐色或暗紫褐色，不规则纵裂并呈卷曲粗片状翻起剥落',
    crownDesc: '广卵形疏朗树冠，主枝斜上开展',
    foliageDesc: '叶卵形或菱状卵形，秋季转金黄至橙黄色',
    ecology: '耐寒耐旱，常与蒙古栎、白桦、落叶松混生于山地阳坡及脊部',
  },
  '冷杉': {
    name: '冷杉',
    fullName: '臭冷杉（东北冷杉）',
    latin: 'Abies nephrolepis',
    family: '松科 · 冷杉属 (Pinaceae)',
    kind: 'conifer',
    archetype: 'conifer_spire',
    leafHabit: '常绿针叶乔木',
    evergreen: true,
    cbRatio: 0.20,
    fb: 0.14,
    trunk: 0x827d74,
    trunkTop: 0x948f86,
    crown: 0x225432,
    crownAutumn: 0x1f4c2d,
    em: 0x0a190d,
    emAutumn: 0x0a190d,
    barkPattern: 'poplar_lenticel',
    barkDesc: '灰白色至浅灰色，表面较平滑，具明显树脂疱，老时浅裂',
    crownDesc: '规整窄圆锥形尖塔冠，轮生枝平展密生',
    foliageDesc: '条形叶扁平，先端微凹，叶背具两条白粉气孔带，球果直立',
    ecology: '极耐阴湿寒冷，暗针叶林及云冷杉林代表树种',
  },
};

/** 常见别名映射：调查表中填写的简称/地方名自动归一到标准档案。 */
const SPECIES_ALIASES = {
  '兴安落叶松': '落叶松',
  '长白落叶松': '落叶松',
  '华北落叶松': '落叶松',
  '东北白桦': '白桦',
  '桦树': '白桦',
  '红皮云杉': '云杉',
  '鱼鳞云杉': '云杉',
  '果松': '红松',
  '山杨': '杨树',
  '小叶杨': '杨树',
  '香杨': '杨树',
  '青杨': '杨树',
  '白榆': '榆树',
  '春榆': '榆树',
  '黄榆': '榆树',
  '蒙古栎': '蒙古栎',
  '柞树': '柞树',
  '五角枫': '色木槭',
  '槭树': '色木槭',
  '椴树': '紫椴',
  '糠椴': '紫椴',
  '黄波罗': '黄檗',
  '山核桃': '胡桃楸',
  '核桃楸': '胡桃楸',
  '兴安桦': '黑桦',
  '臭冷杉': '冷杉',
};

const FALLBACK_SPECIES_PROFILE = {
  name: '未登记树种',
  fullName: '未登记树种（通用参数化示意）',
  latin: 'Species indeterminate',
  family: '待核实科属',
  kind: 'conifer',
  archetype: 'conifer_tower',
  leafHabit: '乔木（待核实）',
  evergreen: false,
  cbRatio: 0.28,
  fb: 0.20,
  trunk: 0x8a8a80,
  trunkTop: 0x98988e,
  crown: 0x6f7d6a,
  crownAutumn: 0x9a8c56,
  em: 0x141814,
  emAutumn: 0x1c180c,
  barkPattern: 'fissured_scale',
  barkDesc: '树种未在图鉴库登记，以中性灰褐树皮示意渲染',
  crownDesc: '按调查表实测胸径、树高、冠幅以通用锥冠参数化示意',
  foliageDesc: '可在 species_profiles.js 中补充该树种植物学档案',
  ecology: '调查记录保持原样，可拾取、可对比、可统计',
};

/** 解析任意树种名为植物学档案（含别名归一与兜底）。 */
function resolveSpeciesProfile(rawName) {
  if (!rawName) return FALLBACK_SPECIES_PROFILE;
  const s = String(rawName).trim();
  if (SPECIES_PROFILES[s]) return SPECIES_PROFILES[s];
  const canon = SPECIES_ALIASES[s];
  if (canon && SPECIES_PROFILES[canon]) return SPECIES_PROFILES[canon];
  for (const [k, v] of Object.entries(SPECIES_PROFILES)) {
    if (s.includes(k)) return v;
  }
  return { ...FALLBACK_SPECIES_PROFILE, name: s, fullName: `${s}（通用示意）` };
}

// ============================================================ 程序化树皮与叶簇纹理生成

const _BARK_TEX_CACHE = new Map();

function _hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function _rgbCss(r, g, b, a = 1) {
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return a < 1 ? `rgba(${cl(r)},${cl(g)},${cl(b)},${a})` : `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

function _rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 为指定树种构型生成程序化树皮 CanvasTexture（128×256，零外部网络请求，带缓存）：
 * - birch_white：洁白桦皮 + 横向黑色皮孔 + 树基深色粗裂靴斑
 * - pine_bicolor：樟子松特征性「上黄橙薄片 + 下灰褐深裂」双色渐变树皮
 * - poplar_lenticel：山杨/冷杉青灰平滑皮 + 菱形暗色皮孔
 * - oak_deep_ridge / elm_interlace / walnut_furrow / ash_diamond / fissured_scale / spruce_scale / pine_plate：
 *   各树种特征性纵裂沟槽、鱼鳞片或菱形网纹
 */
function getSpeciesBarkTexture(THREE, profile) {
  const key = `${profile.barkPattern}_${profile.trunk.toString(16)}`;
  if (_BARK_TEX_CACHE.has(key)) return _BARK_TEX_CACHE.get(key);
  if (typeof document === 'undefined') return null;

  const w = 128, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const [r0, g0, b0] = _hexToRgb(profile.trunk);
  const [r1, g1, b1] = _hexToRgb(profile.trunkTop || profile.trunk);
  const rand = _rng(profile.trunk ^ 0x9e3779b9);

  // 1) 基底纵向渐变（Canvas y=0 对应树干上部，y=h 对应树基）
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (profile.barkPattern === 'pine_bicolor') {
    // 樟子松：上部杏黄/橙红薄片，下部深灰褐纵裂
    grad.addColorStop(0.0, _rgbCss(208, 134, 66));
    grad.addColorStop(0.48, _rgbCss(182, 112, 54));
    grad.addColorStop(0.68, _rgbCss(118, 78, 52));
    grad.addColorStop(1.0, _rgbCss(84, 56, 40));
  } else if (profile.barkPattern === 'birch_white') {
    grad.addColorStop(0.0, _rgbCss(240, 236, 226));
    grad.addColorStop(0.76, _rgbCss(224, 218, 206));
    grad.addColorStop(0.90, _rgbCss(120, 112, 102));
    grad.addColorStop(1.0, _rgbCss(68, 62, 56));
  } else {
    grad.addColorStop(0.0, _rgbCss(r1, g1, b1));
    grad.addColorStop(0.75, _rgbCss(r0, g0, b0));
    grad.addColorStop(1.0, _rgbCss(r0 * 0.76, g0 * 0.76, b0 * 0.76));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 2) 树种特征纹理细节
  if (profile.barkPattern === 'birch_white') {
    // 白桦：浅灰环纹 + 黑色横生皮孔 + 基部深纵裂
    for (let i = 0; i < 95; i++) {
      const y = rand() * h * 0.84;
      const x = rand() * w;
      const len = 6 + rand() * 22;
      const thick = 1 + rand() * 2.2;
      ctx.fillStyle = rand() < 0.65 ? 'rgba(42,38,34,0.78)' : 'rgba(130,120,105,0.45)';
      ctx.fillRect(x, y, len, thick);
      if (x + len > w) ctx.fillRect(0, y, (x + len) - w, thick);
    }
    // 基部粗裂纹
    ctx.strokeStyle = 'rgba(38,34,30,0.85)';
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * w + (rand() - 0.5) * 4;
      ctx.lineWidth = 1.5 + rand() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + (rand() - 0.5) * 8, h * (0.78 + rand() * 0.14));
      ctx.stroke();
    }
  } else if (profile.barkPattern === 'poplar_lenticel') {
    // 山杨/冷杉：微细横纹 + 菱形皮孔
    for (let i = 0; i < 75; i++) {
      const x = rand() * w, y = rand() * h * 0.88;
      const rw = 3 + rand() * 5, rh = 1.6 + rand() * 2.5;
      ctx.fillStyle = 'rgba(55,52,44,0.58)';
      ctx.beginPath();
      ctx.moveTo(x, y - rh);
      ctx.lineTo(x + rw, y);
      ctx.lineTo(x, y + rh);
      ctx.lineTo(x - rw, y);
      ctx.closePath();
      ctx.fill();
    }
  } else if (profile.barkPattern === 'spruce_scale' || profile.barkPattern === 'pine_plate' || profile.barkPattern === 'pine_bicolor') {
    // 鳞片/块状裂皮（云杉/红松/樟子松）
    for (let i = 0; i < 110; i++) {
      const x = rand() * w, y = rand() * h;
      const pw = 8 + rand() * 14, ph = 10 + rand() * 22;
      ctx.strokeStyle = 'rgba(35,24,16,0.45)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x, y, pw, ph);
    }
  } else {
    // 纵裂脊纹（落叶松/蒙古栎/水曲柳/胡桃楸/榆树）
    const ridges = profile.barkPattern === 'oak_deep_ridge' ? 22 : 30;
    for (let i = 0; i < ridges; i++) {
      const x0 = (i / ridges) * w;
      ctx.strokeStyle = i % 2 === 0
        ? _rgbCss(r0 * 0.52, g0 * 0.52, b0 * 0.52, 0.72)
        : _rgbCss(r1 * 1.15, g1 * 1.15, b1 * 1.15, 0.38);
      ctx.lineWidth = profile.barkPattern === 'oak_deep_ridge' ? 2.4 : 1.6;
      ctx.beginPath();
      let cx = x0;
      ctx.moveTo(cx, 0);
      for (let seg = 1; seg <= 8; seg++) {
        cx += (rand() - 0.5) * 5.5;
        ctx.lineTo(cx, (seg / 8) * h);
      }
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _BARK_TEX_CACHE.set(key, tex);
  return tex;
}

/** 生成用于图鉴/卡片展示的树皮小样 SVG dataURI 或内联 SVG。 */
function speciesBadgeHtml(rawName) {
  const p = resolveSpeciesProfile(rawName);
  const cHex = '#' + p.crown.toString(16).padStart(6, '0');
  const tHex = '#' + p.trunk.toString(16).padStart(6, '0');
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:10px;background:#eef3ea;border:1px solid #cdd8c5;font-size:11.5px;color:#1e3d28">
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cHex};border:1.5px solid ${tHex}"></span>
    <b>${p.name}</b> <i style="color:#5a6658;font-size:10.5px">${p.latin}</i>
  </span>`;
}

if (typeof window !== 'undefined') {
  window.SPECIES_PROFILES = SPECIES_PROFILES;
  window.resolveSpeciesProfile = resolveSpeciesProfile;
  window.getSpeciesBarkTexture = getSpeciesBarkTexture;
  window.speciesBadgeHtml = speciesBadgeHtml;
}
})();
