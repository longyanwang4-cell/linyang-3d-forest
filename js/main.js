/**
 * FM1 三维森林主程序：数据加载、年份切换、双视图对比、搜索定位、信息面板。
 *
 * 所有数值均来自真实调查记录（fm1_scene_YYYY.json / fm1_compare.json），
 * 界面显式标注坐标未配准与枝叶形态示意；差值仅在两期均为实测值时计算。
 */
import { FM1SceneManager, activeScenes } from './fm1_scene.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  mode: 'single',           // 'single' | 'dual'
  year: 2026,
  scenes: {},               // year -> scene JSON
  compare: null,            // fm1_compare.json
  compareByTag: new Map(),
  single: null,             // FM1SceneManager
  left: null,               // 双视图 2023
  right: null,              // 双视图 2026
  selected: null,
};

const STATUS_TEXT = {
  measured: { label: '实测', cls: 'ok' },
  zero: { label: '0值·待核实', cls: 'warn' },
  missing: { label: '缺失·待核实', cls: 'warn' },
  error: { label: '#N/A·待核实', cls: 'bad' },
  suspect: { label: '异常·待核实', cls: 'bad' },
};

function statusChip(status) {
  const info = STATUS_TEXT[status] || { label: status, cls: 'warn' };
  return `<span class="chip ${info.cls}">${info.label}</span>`;
}

// ---------------------------------------------------------------- 初始化

async function init() {
  const [s23, s26, cmp] = await Promise.all([
    fetch('data/fm1_scene_2023.json').then((r) => r.json()),
    fetch('data/fm1_scene_2026.json').then((r) => r.json()),
    fetch('data/fm1_compare.json').then((r) => r.json()),
  ]);
  state.scenes = { 2023: s23, 2026: s26 };
  state.compare = cmp;
  for (const t of cmp.trees) state.compareByTag.set(t.tag, t);

  state.single = new FM1SceneManager($('#view-single'), {
    onSelect: (data) => { state.selected = data; renderInfoPanel(); },
    onHover: (data) => { $('#hover-tag').textContent = data ? `牌号 ${data.tag}` : ''; },
  });
  // 调试/性能观测钩子（不影响业务）
  window.__fm1App = {
    rendererInfo: () => state.single.renderer.info.render,
    managers: () => [state.single, state.left, state.right].filter(Boolean),
    sceneCount: () => activeScenes.size, // 生命周期回归观测
    renderFrame: (m) => {
      const mgr = m || state.single;
      mgr.renderer.render(mgr.scene, mgr.camera);
      return mgr.renderer.info.render;
    },
    snapshotPNG: (view) => {
      const mgr = state.single;
      if (view === 'top') { mgr.camera.position.set(15, 90, 15.01); mgr.controls.target.set(15, 0, 15); }
      else { mgr.camera.position.set(62, 40, 62); mgr.controls.target.set(15, 4, 15); }
      mgr.controls.update();
      mgr.renderer.render(mgr.scene, mgr.camera);
      return mgr.renderer.domElement.toDataURL('image/png');
    },
  };

  bindUI();
  switchYear(state.year);
  $('#loading').classList.add('hidden');
}

// ---------------------------------------------------------------- UI 绑定

function bindUI() {
  $('#btn-back-map').addEventListener('click', () => { window.location.href = 'map.html'; });
  document.querySelectorAll('.year-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchYear(Number(btn.dataset.year)));
  });
  $('#btn-single').addEventListener('click', () => setMode('single'));
  $('#btn-dual').addEventListener('click', () => setMode('dual'));
  $('#btn-top').addEventListener('click', () => activeManager()?.viewTop());
  $('#btn-side').addEventListener('click', () => activeManager()?.viewSide());
  $('#btn-reset').addEventListener('click', () => activeManager()?.viewReset());
  $('#btn-trends').addEventListener('click', openTrends);

  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  $('#btn-search').addEventListener('click', doSearch);

  $('#info-panel').addEventListener('click', (e) => {
    if (e.target.classList?.contains('panel-close')) closePanel();
  });

  $('#trends-close').addEventListener('click', () => $('#trends-modal').classList.remove('open'));
  $('#trends-modal').addEventListener('click', (e) => {
    if (e.target.id === 'trends-modal') $('#trends-modal').classList.remove('open');
  });
}

function activeManager() {
  if (state.mode === 'dual') return state.left;
  return state.single;
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  $('#btn-single').classList.toggle('active', mode === 'single');
  $('#btn-dual').classList.toggle('active', mode === 'dual');
  document.querySelectorAll('.year-btn').forEach((b) => {
    b.disabled = mode === 'dual';
    b.style.opacity = mode === 'dual' ? 0.45 : 1;
  });

  closePanel();
  if (mode === 'dual') {
    $('#view-dual').style.display = 'flex';
    // 每次进入双视图都新建实例；退出时完整 dispose（资源生命周期闭环）
    state.left = new FM1SceneManager($('#view-left'), {
      onSelect: (data) => { state.selected = data; renderInfoPanel(); },
    });
    state.right = new FM1SceneManager($('#view-right'), {
      onSelect: (data) => { state.selected = data; renderInfoPanel(); },
    });
    state.right.setSyncMaster(state.left);
    state.left.loadYear(state.scenes[2023], state.scenes[2026]);
    state.right.loadYear(state.scenes[2026], state.scenes[2023]);
    $('#view-single').style.display = 'none';
    // 让左右视图重排尺寸
    requestAnimationFrame(() => {
      state.left._resize(); state.right._resize();
      state.left.viewReset();
    });
  } else {
    // 退出双视图：完整销毁两个场景（停帧/解绑事件/释放几何材质控制器渲染器）
    for (const key of ['left', 'right']) {
      if (state[key]) { state[key].dispose(); state[key] = null; }
    }
    $('#view-dual').style.display = 'none';
    $('#view-single').style.display = 'block';
    requestAnimationFrame(() => { state.single._resize(); });
  }
  if ($('#search-input').value) doSearch();
}

function switchYear(year) {
  if (state.mode === 'dual') return;
  state.year = year;
  document.querySelectorAll('.year-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.year) === year);
  });
  const other = year === 2023 ? 2026 : 2023;
  state.single.loadYear(state.scenes[year], state.scenes[other]);
  closePanel();
  renderStats();
  if ($('#search-input').value) doSearch();
}

function closePanel() {
  $('#info-panel').classList.remove('open');
  state.selected = null;
  for (const m of [state.single, state.left, state.right]) m?.select(null);
}

// ---------------------------------------------------------------- 搜索

function doSearch() {
  const raw = $('#search-input').value.trim();
  if (!raw) return;
  const scene = state.mode === 'dual' ? state.scenes[2026] : state.scenes[state.year];
  let tag = null;
  if (scene.trees.some((t) => t.tag === raw)) tag = raw;
  else {
    const seq = Number(raw);
    const bySeq = scene.trees.find((t) => t.seq_no === seq);
    if (bySeq) tag = bySeq.tag;
  }
  const msg = $('#search-msg');
  if (!tag) {
    msg.textContent = `未找到牌号/编号「${raw}」`;
    return;
  }
  msg.textContent = '';
  if (state.mode === 'dual') {
    state.left.highlight(tag); state.left.select(tag);
    state.right.highlight(tag); state.right.select(tag);
    state.left.focusTree(tag);
  } else {
    state.single.highlight(tag);
    state.single.select(tag);
    state.single.focusTree(tag);
  }
  state.selected = scene.trees.find((t) => t.tag === tag);
  renderInfoPanel();
}

// ---------------------------------------------------------------- 统计

function renderStats() {
  const scene = state.scenes[state.year];
  const larch = scene.trees.filter((t) => t.species === '落叶松').length;
  const birch = scene.trees.filter((t) => t.species === '白桦').length;
  const na = scene.trees.filter((t) => t.dbh_status === 'error' || t.height_status === 'error').length;
  const zero = scene.trees.filter((t) => t.dbh_status === 'zero' || t.height_status === 'zero').length;
  const sketch = state.single.sketchCount;
  $('#stats').innerHTML =
    `<b>${scene.tree_count}</b> 株 ｜ 落叶松 <b>${larch}</b> · 白桦 <b>${birch}</b>` +
    ` ｜ <span class="chip bad">#N/A ${na}</span> <span class="chip warn">0值 ${zero}</span>` +
    ` <span class="chip sketch">示意 ${sketch}</span>`;
}

// ---------------------------------------------------------------- 信息面板

function fmtVal(v, unit) {
  if (v === null || v === undefined) return '—';
  return `${v}${unit ? ' ' + unit : ''}`;
}

/** 双横条 SVG：两期数值对比。 */
function svgBars(a, b, unit) {
  const max = Math.max(a?.value ?? 0, b?.value ?? 0, 0.0001);
  const W = 240, H = 34;
  const bar = (v, y, color, label) => {
    if (v?.value === null || v?.value === undefined) {
      return `<text x="0" y="${y + 11}" font-size="10" fill="#6b6b6b">${label} 无有效值</text>`;
    }
    const w = Math.max((v.value / max) * (W - 46), 2);
    return `<text x="0" y="${y + 11}" font-size="10" fill="#2b2b2b">${label}</text>` +
      `<rect x="30" y="${y}" width="${w}" height="12" rx="2" fill="${color}"></rect>` +
      `<text x="${34 + w}" y="${y + 10}" font-size="10" fill="#2b2b2b">${v.value}${unit}</text>`;
  };
  return `<svg width="${W}" height="${H}" role="img">` +
    bar(a, 2, '#9db8a4', `'23`) + bar(b, 19, '#2d5a3d', `'26`) + `</svg>`;
}

function deltaText(cmp, key, unit) {
  const d = cmp?.[key]?.delta;
  if (d === null || d === undefined) return `<span class="dim">Δ 无（存在非实测值）</span>`;
  const sign = d > 0 ? '+' : '';
  const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '—';
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  return `<span class="${cls}">${arrow} Δ ${sign}${d} ${unit}</span>`;
}

function renderInfoPanel() {
  const panel = $('#info-panel');
  if (!state.selected) { panel.classList.remove('open'); return; }
  const t = state.selected;
  const cmp = state.compareByTag.get(t.tag);
  const c23 = cmp?.dbh?.['2023'], c26 = cmp?.dbh?.['2026'];
  const h23 = cmp?.height?.['2023'], h26 = cmp?.height?.['2026'];
  const k23 = cmp?.crown_ns?.['2023'], k26 = cmp?.crown_ns?.['2026'];

  const sketchNote = (state.mode === 'dual' ? state.right : state.single)
    ?.treeByTag.get(t.tag)?.sketch
    ? `<div class="note">⚠ 本期测量值 #N/A / 0，模型尺寸借用另一期数据示意，非本期实测。</div>`
    : '';

  const flagsNote = cmp?.flags?.length
    ? `<div class="note">待核实标记：${cmp.flags.map(flagLabel).join('；')}</div>`
    : '';

  const dual = state.mode === 'dual';
  const yearNow = dual ? 2026 : state.year;
  const yearOther = dual ? 2023 : (yearNow === 2023 ? 2026 : 2023);
  const colNow = yearNow === 2023 ? c23 : c26;
  const colOther = yearOther === 2023 ? c23 : c26;
  const hNow = yearNow === 2023 ? h23 : h26;
  const hOther = yearOther === 2023 ? h23 : h26;

  panel.innerHTML = `
    <button class="panel-close" title="关闭">✕</button>
    <div class="panel-title">
      <span class="tag-badge">${t.tag}</span>
      <span class="species">${t.species}</span>
      <span class="seq">编号 ${t.seq_no} ｜ 小样方 ${t.plot_code ?? '—'}</span>
    </div>
    ${sketchNote}
    <table class="info-table">
      <tr><th></th><th>${yearNow} <span class="dim">(本期)</span></th><th>${yearOther}</th></tr>
      <tr>
        <td>胸径</td>
        <td>${fmtVal(colNow?.value, 'cm')} ${statusChip(colNow?.status)}</td>
        <td>${fmtVal(colOther?.value, 'cm')}</td>
      </tr>
      <tr>
        <td>树高</td>
        <td>${fmtVal(hNow?.value, 'm')} ${statusChip(hNow?.status)}</td>
        <td>${fmtVal(hOther?.value, 'm')}</td>
      </tr>
      <tr>
        <td>留/伐标记</td>
        <td colspan="2">${t.keep_flag === 1 ? '1 · 留' : t.keep_flag === 0 ? '0 · 伐（经营计划标记）' : '—'}</td>
      </tr>
      <tr>
        <td>局部坐标</td>
        <td colspan="2">X ${t.x}，Y ${t.y} <span class="dim">(单位/方向未核实)</span></td>
      </tr>
      <tr>
        <td>数据来源</td>
        <td colspan="2">${t.source_file} · Excel 第 ${t.row_index} 行</td>
      </tr>
    </table>
    <div class="cmp-block">
      <div class="cmp-title">两期对比 ${dual ? '' : '（切到双视图可同屏对比）'}</div>
      <div class="cmp-row">
        <div class="cmp-label">胸径 ${deltaText(cmp, 'dbh', 'cm')}</div>
        ${svgBars(c23, c26, 'cm')}
      </div>
      <div class="cmp-row">
        <div class="cmp-label">树高 ${deltaText(cmp, 'height', 'm')}</div>
        ${svgBars(h23, h26, 'm')}
      </div>
      ${k23 && k26 && k23.status === 'measured' && k26.status === 'measured'
        ? `<div class="cmp-label dim">冠幅NS：${k23.value} m → ${k26.value} m</div>` : ''}
    </div>
    ${flagsNote}
    <div class="note dim">
      枝叶形态为程序化示意模型，非真实树冠重建；两期数值直接引自原始调查表，
      大量树高下降为原始记录事实，不自动解释。
    </div>
  `;
  panel.classList.add('open');
}

const FLAG_LABELS = {
  height_decrease: '2026 树高低于 2023（实测值，原因待核实）',
  dbh_decrease: '2026 胸径低于 2023（实测值，原因待核实）',
  dbh_2026_zero: '2026 胸径为 0（含义待核实）',
  height_2026_zero: '2026 树高为 0（含义待核实）',
  crown_ns_2026_zero: '2026 NS冠幅为 0（含义待核实）',
  crown_ew_2026_zero: '2026 EW冠幅为 0（含义待核实）',
  dbh_2026_error: '2026 胸径 #N/A',
  height_2026_error: '2026 树高 #N/A',
  crown_ns_2026_error: '2026 NS冠幅 #N/A',
  crown_ew_2026_error: '2026 EW冠幅 #N/A',
  crown_ns_2026_suspect: '2026 NS冠幅异常',
  crown_ew_2026_suspect: '2026 EW冠幅异常',
};
function flagLabel(f) { return FLAG_LABELS[f] || f; }

// ---------------------------------------------------------------- 变化总览（直方图，统计全部动态计算）

/** 按有效值口径汇总两期统计。有效可比 = 两期状态均为 measured。 */
function computeTrendStats(trees) {
  const valid = (s) => s === 'measured';
  const stat = (key) => {
    const deltas = trees.map((t) => t[key].delta).filter((d) => d !== null && d !== undefined);
    return {
      comparable: deltas.length,
      up: deltas.filter((d) => d > 0).length,
      down: deltas.filter((d) => d < 0).length,
      flat: deltas.filter((d) => d === 0).length,
      deltas,
    };
  };
  const statusCount = (key, year, st) =>
    trees.filter((t) => t[key][year]?.status === st).length;
  const total = trees.length;
  const bothMeasured = trees.filter(
    (t) => valid(t.height['2023']?.status) && valid(t.height['2026']?.status)
  ).length;
  return {
    total,
    bothMeasured,
    height: stat('height'),
    dbh: stat('dbh'),
    height_na_2026: statusCount('height', '2026', 'error'),
    height_zero_2026: statusCount('height', '2026', 'zero'),
    dbh_na_2026: statusCount('dbh', '2026', 'error'),
    dbh_zero_2026: statusCount('dbh', '2026', 'zero'),
  };
}

function openTrends() {
  const trees = state.compare.trees;
  const s = computeTrendStats(trees);
  $('#trends-modal').classList.add('open');
  $('#trends-hist-height').innerHTML = histogramSVG(
    s.height.deltas,
    `树高变化 Δh (m) —— 两期均为实测值的有效可比 ${s.height.comparable} / ${s.total} 株`,
  );
  $('#trends-hist-dbh').innerHTML = histogramSVG(
    s.dbh.deltas,
    `胸径变化 Δdbh (cm) —— 两期均为实测值的有效可比 ${s.dbh.comparable} / ${s.total} 株`,
  );
  $('#trends-summary').innerHTML =
    `总株数 <b>${s.total}</b>（两期）｜ 树高有效可比 <b>${s.height.comparable}</b>：` +
    `下降 <b class="down">${s.height.down}</b> · 上升 <b class="up">${s.height.up}</b> · 持平 ${s.height.flat} ｜ ` +
    `胸径有效可比 <b>${s.dbh.comparable}</b>：下降 <b class="down">${s.dbh.down}</b> · 上升 <b class="up">${s.dbh.up}</b> · 持平 ${s.dbh.flat}<br>` +
    `未参与差值（待核实）：#N/A——树高 ${s.height_na_2026}、胸径 ${s.dbh_na_2026} 株；` +
    `0 值——树高 ${s.height_zero_2026}、胸径 ${s.dbh_zero_2026} 株 ｜ ` +
    `<span class="dim">有效值口径：仅两期状态均为"实测"的记录计算 Δ；缺失/错误/0 值不插补、不修饰。</span>`;
}

function histogramSVG(values, title) {
  if (!values.length) return `<div class="dim">无可比数据</div>`;
  const bins = new Map();
  for (const v of values) {
    const b = Math.round(v * 2) / 2; // 0.5m 分箱
    bins.set(b, (bins.get(b) || 0) + 1);
  }
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const maxC = Math.max(...bins.values());
  const W = 560, H = 150, pad = 30;
  const bw = (W - 2 * pad) / keys.length;
  const zeroIdx = keys.findIndex((k) => k === 0);
  let svg = `<svg width="${W}" height="${H + 34}" role="img">`;
  keys.forEach((k, i) => {
    const c = bins.get(k);
    const h = Math.max((c / maxC) * (H - 20), 2);
    const x = pad + i * bw;
    const color = k < 0 ? '#b8503f' : k > 0 ? '#3d7a4a' : '#8a8a8a';
    svg += `<rect x="${x + 1}" y="${H - h}" width="${bw - 2}" height="${h}" fill="${color}"></rect>`;
    if (c >= maxC * 0.85 || H - h < 12) {
      svg += `<text x="${x + bw / 2}" y="${H - h - 3}" font-size="9" text-anchor="middle" fill="#2b2b2b">${c}</text>`;
    }
    svg += `<text x="${x + bw / 2}" y="${H + 12}" font-size="9" text-anchor="middle" fill="#6b6b6b">${k > 0 ? '+' : ''}${k}</text>`;
  });
  if (zeroIdx >= 0) {
    svg += `<line x1="${pad + zeroIdx * bw}" y1="10" x2="${pad + zeroIdx * bw}" y2="${H}" stroke="#555" stroke-dasharray="3,3"/>`;
  }
  svg += `<line x1="${pad}" y1="${H}" x2="${W - pad}" y2="${H}" stroke="#999"/>`;
  svg += `<text x="${W / 2}" y="${H + 28}" font-size="11" text-anchor="middle" fill="#2b2b2b">${title}</text>`;
  svg += `</svg>`;
  return svg;
}

// ---------------------------------------------------------------- 启动

window.addEventListener('DOMContentLoaded', init);
