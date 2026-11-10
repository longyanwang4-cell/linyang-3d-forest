/**
 * URL 深链解析与序列化（纯函数，便于单元测试与冒烟测试）。
 *
 * 仅携带界面状态（样地标识 / 调查期 / 显示模式 / 有限的单木或选中列表），
 * 不携带任何调查测量值或数据包内容；本地深链不等于公网分享链接。
 * 解析端一律做白名单校验：非法值安全回退为 null，由调用方落到缺省状态。
 */

(function () {
const MODES = ['full', 'single', 'multi'];
const TAG_RE = /^[A-Za-z0-9_-]{1,32}$/;
const SEL_MAX = 12;

/**
 * @param {string} search location.search（含或不含 "?"）
 * @param {{plotIds?: string[], validYears?: number[]}} ctx 白名单上下文
 */
function parseDeepLink(search, { plotIds = [], validYears = [2023, 2026] } = {}) {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out = { plot: null, year: null, mode: null, tree: null, sel: [] };
  const plot = sp.get('plot');
  if (plot && plotIds.includes(plot)) out.plot = plot;
  const year = Number(sp.get('year'));
  if (validYears.includes(year)) out.year = year;
  const mode = sp.get('mode');
  if (MODES.includes(mode)) out.mode = mode;
  const tree = sp.get('tree');
  if (tree && TAG_RE.test(tree)) out.tree = tree;
  const sel = sp.get('sel');
  if (sel) {
    out.sel = sel.split(',').map((s) => s.trim())
      .filter((s) => TAG_RE.test(s)).slice(0, SEL_MAX);
  }
  return out;
}

/** 序列化为查询串；full 为缺省模式省略，选中仅单木身份或多木有限列表。 */
function buildDeepLinkQuery({ plot, year, mode, tree, sel } = {}) {
  const sp = new URLSearchParams();
  if (plot) sp.set('plot', plot);
  if (year) sp.set('year', String(year));
  if (mode && mode !== 'full') sp.set('mode', mode);
  if (mode === 'single' && tree) sp.set('tree', tree);
  if (mode === 'multi' && sel && sel.length) sp.set('sel', sel.slice(0, SEL_MAX).join(','));
  const q = sp.toString();
  return q ? `?${q}` : '';
}

if (typeof window !== 'undefined') {
  window.parseDeepLink = parseDeepLink;
  window.buildDeepLinkQuery = buildDeepLinkQuery;
}
})();
