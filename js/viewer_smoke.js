/**
 * 查看器最小冒烟测试套件（?smoke=1 时自动运行）。
 *
 * 覆盖：初始化加载 / 样地切换往返 / 年份切换 / 双期进出 / 单木选择与 Esc 退出 /
 * 多木选择与退出 / Ghost 策略 / URL 深链解析与无效回退 / localStorage 偏好读写 /
 * 全程无 JS 错误。结果写入 window.__smokeResults 并在页面左上角渲染面板，
 * 供人工验收与后续自动化驱动（任意驱动器只需读 __smokeResults）。
 *
 * 注意：运行会切换样地与模式（属破坏性交互），仅用于验收，不在常规入口注入。
 */
(function () {
const parseDeepLink = window.parseDeepLink;

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function rec(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console[pass ? 'info' : 'error'](`[smoke] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

function renderPanel() {
  document.querySelector('#smoke-report')?.remove();
  const el = document.createElement('div');
  el.id = 'smoke-report';
  const failed = results.filter((r) => !r.pass).length;
  el.innerHTML = `<b>冒烟测试 ${results.length - failed}/${results.length} 通过</b>`
    + `<div>${results.map((r) =>
      `<div style="color:${r.pass ? '#2d7a3d' : '#c0392b'}">${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}</div>`).join('')}</div>`;
  el.style.cssText = 'position:fixed;top:130px;left:12px;z-index:99;max-width:420px;'
    + 'background:rgba(251,252,248,0.97);border:1px solid #d8d2c4;border-radius:8px;'
    + 'padding:8px 12px;font:12px/1.6 "Microsoft YaHei",sans-serif;max-height:60vh;overflow:auto';
  document.body.appendChild(el);
}

let _running = null;

/** 重入保护：并发调用共享同一执行（页面状态是全局的，两次并发会互相干扰）。 */
function runSmoke() {
  if (_running) return _running;
  _running = _runSmoke().finally(() => { _running = null; });
  return _running;
}

async function _runSmoke() {
  const v = window.__viewer;
  if (!v) { rec('初始化句柄', false, 'window.__viewer 不存在'); return results; }

  // 1) 初始化加载
  const scene = v.__scene();
  rec('初始化加载（160 株）', !!scene && scene.heroNodes.size === 160,
    `trees=${scene?.heroNodes.size}`);

  // 2) 样地切换往返 + 模拟数据标注（R4-03：FM2 为模拟样地，界面必须显式标注）
  const sel = document.querySelector('#plot-select');
  sel.value = 'FM2';
  sel.dispatchEvent(new Event('change'));
  await wait(3500);
  const fm2Ok = v.getSelectionState().plot_id === 'FM2';
  const fm2StatsBar = document.querySelector('#stats').textContent;
  const fm2Legend = document.querySelector('#legend').textContent;
  rec('样地切换 FM2 + 模拟数据标注',
    fm2Ok && fm2StatsBar.includes('模拟数据') && fm2Legend.includes('模拟数据结构示意'),
    `stats="${fm2StatsBar.slice(0, 40)}…"`);
  sel.value = 'fm1';
  sel.dispatchEvent(new Event('change'));
  await wait(3500);
  rec('样地切回 FM1', v.getSelectionState().plot_id === 'fm1'
    && !document.querySelector('#stats').textContent.includes('模拟数据'));

  // 3) 年份切换
  v.setYear('2026');
  await wait(700);
  const y26 = v.__scene().year === 2026;
  v.setYear('2023');
  await wait(700);
  rec('年份切换 2026→2023', y26 && v.__scene().year === 2023);

  // 4) 双期进入/退出（滑块条随显隐）
  v.setYear('dual');
  await wait(1000);
  const dualOk = document.querySelectorAll('#dual-wrap canvas').length === 2
    && document.querySelector('#growth-bar').style.display === 'none';
  v.setYear('2023');
  await wait(1000);
  rec('双期进入/退出', dualOk
    && document.querySelector('#growth-bar').style.display === 'flex');

  // 5) 单木选择 + Esc（统一语义：关卡并退回完整样地）
  const tag = v.__scene().heroNodes.keys().next().value;
  v.isolate(tag);
  await wait(400);
  const cardOpen = document.querySelector('#tree-card').classList.contains('open');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(400);
  rec('单木选择 + Esc 退回完整样地',
    cardOpen && !document.querySelector('#tree-card').classList.contains('open')
    && v.getSelectionState().view_mode === 'full');

  // 6) 多木选择与退出（选择集在退出后保留）
  const keys = [...v.__scene().heroNodes.keys()].slice(0, 2);
  v.toggleCompare(keys[0]);
  v.toggleCompare(keys[1]);
  v.setMode('multi');
  await wait(400);
  const multiOk = v.getSelectionState().view_mode === 'multi'
    && v.getSelectionState().selected_tree_ids.length === 2;
  v.restoreFull();
  await wait(400);
  rec('多木选择与退出（选择保留）',
    multiOk && v.getSelectionState().selected_tree_ids.length === 2);

  // 6b) 统计面板口径（R4-01/R4-05）：身份可信配对行 + 面积来源行必须存在
  document.querySelector('#btn-stats').click();
  await wait(400);
  const spText = document.querySelector('#sp-body')?.innerText ?? '';
  rec('统计面板身份与面积口径',
    spText.includes('身份可信配对') && spText.includes('每公顷分母')
    && spText.includes('调查面积') && !spText.includes('undefined'),
    spText.split('\n').find((l) => l.includes('每公顷分母')) ?? '');
  document.querySelector('#btn-stats').click();   // 关闭，还原因果

  // 6c) 生长插值端点（R4-04）：t=0/t=1 必须精确等于对应期实测参数
  {
    const scene = v.__scene();
    const tag = [...scene.heroNodes.keys()].find((t) => {
      const n = scene.heroNodes.get(t);
      return n.dimsBy[2023] && n.dimsBy[2026];
    });
    const node = scene.heroNodes.get(tag);
    const range = document.querySelector('#growth-range');
    range.value = '0';
    range.dispatchEvent(new Event('input'));
    await wait(80);
    const r0 = node.group.children[0].scale.x;
    range.value = '100';
    range.dispatchEvent(new Event('input'));
    await wait(80);
    const r1 = node.group.children[0].scale.x;
    range.value = '50';
    range.dispatchEvent(new Event('input'));
    await wait(80);
    const rMid = node.group.children[0].scale.x;
    range.value = '0';
    range.dispatchEvent(new Event('input'));
    await wait(80);
    const eps = 1e-9;
    rec('生长插值端点=实测参数',
      Math.abs(r0 - node.dimsBy[2023].rB) < eps
      && Math.abs(r1 - node.dimsBy[2026].rB) < eps
      && Math.abs(rMid - r0) > 1e-6,
      `r0=${r0.toFixed(4)}, r1=${r1.toFixed(4)}, mid=${rMid.toFixed(4)}`);
  }

  // 6d) 返回按钮目的地（R4-08）：应为 map.html（导航中枢），不得进旧查看器
  rec('返回按钮目的地=map.html',
    document.querySelector('#btn-back')?.dataset.href === 'map.html');

  // 6e) 漫游进入/退出（第一人称：WASD + 鼠标视角；指针锁定环境自适应）
  {
    const s0 = v.__scene();
    const entered = s0.enterRoam();
    const roamOn = !!s0._roam && s0.controls.enabled === false;
    s0.exitRoam();
    rec('漫游进入/退出', entered && roamOn && !s0._roam
      && s0.controls.enabled === true);
  }

  // 6f) 三维截图（PNG dataURL + 元数据）
  {
    const shot = v.screenshot();
    rec('三维截图 PNG',
      typeof shot.dataUrl === 'string' && shot.dataUrl.startsWith('data:image/png')
      && shot.dataUrl.length > 10000
      && shot.meta.plot && shot.meta.note.includes('示意'),
      `len=${shot.dataUrl.length}`);
  }

  // 6g) 生长动画播放（插值示意，端点=实测参数；后台标签下 setTimeout 节流仍收敛）
  {
    const scene = v.__scene();
    const tag = [...scene.heroNodes.keys()].find((t) => {
      const n = scene.heroNodes.get(t);
      return n.dimsBy[2023] && n.dimsBy[2026];
    });
    const node = scene.heroNodes.get(tag);
    const r0 = node.group.children[0].scale.x;
    const anim = v.playGrowthAnim(400);
    // 轮询等待动画完成（_growthAnim 清空），后台节流下最多 ~5s
    let done = false;
    for (let i = 0; i < 25 && !done; i++) {
      await new Promise(r => setTimeout(r, 200));
      done = scene._growthAnim === null;
    }
    const r1 = node.group.children[0].scale.x;
    v.stopGrowthAnim();
    scene.applyGrowth(0);                        // 复位
    rec('生长动画（端点=实测）',
      anim && anim.from === 2023 && anim.to === 2026 && done
      && Math.abs(r1 - node.dimsBy[2026].rB) < 1e-9
      && Math.abs(r0 - node.dimsBy[2023].rB) < 1e-9,
      `done=${done}, r0=${r0.toFixed(4)}, r1=${r1.toFixed(4)}`);
  }

  // 7) Ghost 策略（light=仅半透明树干并隐藏冠层；transparent=整树半透明 0.16）
  v.isolate(tag);
  await wait(300);
  const other = [...v.__scene().heroNodes.values()].find((n) => n.data.tag !== tag);
  v.setStrategy('light');
  await wait(250);
  const lightOp = other.group.children[0].material.opacity;
  const crownHidden = other.group.children[1].visible === false;
  v.setStrategy('transparent');
  await wait(250);
  const ghostOp = other.group.children[0].material.opacity;
  v.restoreFull();
  await wait(250);
  rec('Ghost 策略 light/transparent',
    lightOp === 0.5 && crownHidden && ghostOp === 0.16,
    `light=${lightOp}, ghost=${ghostOp}`);

  // 8) URL 深链：无效参数安全回退 + 有效解析
  const bad = parseDeepLink('?plot=BAD&year=1999&mode=x&tree=###&sel=##',
    { plotIds: ['fm1', 'FM2'] });
  rec('URL 无效参数安全回退',
    bad.plot === null && bad.year === null && bad.mode === null
    && bad.tree === null && bad.sel.length === 0);
  const good = parseDeepLink('?plot=FM2&year=2026&mode=single&tree=1365&sel=1001,1002',
    { plotIds: ['fm1', 'FM2'] });
  rec('URL 有效解析',
    good.plot === 'FM2' && good.year === 2026 && good.mode === 'single'
    && good.tree === '1365' && good.sel.join(',') === '1001,1002');

  // 9) localStorage 偏好读写（仅界面偏好，不含调查数据）
  try {
    localStorage.setItem('lzv2.prefs.v1', JSON.stringify({ ghost: 'light' }));
    const p = JSON.parse(localStorage.getItem('lzv2.prefs.v1'));
    localStorage.removeItem('lzv2.prefs.v1');
    rec('localStorage 偏好读写', p.ghost === 'light');
  } catch (e) {
    rec('localStorage 偏好读写', false, String(e));
  }

  // 10) 全程无 JS 错误
  rec('全程无 JS 错误', window.__pageErrors.length === 0,
    window.__pageErrors.join(' | '));

  window.__smokeResults = results;
  renderPanel();
  console.table(results);
  return results;
}

if (typeof window !== 'undefined') window.runSmoke = runSmoke;
})();
