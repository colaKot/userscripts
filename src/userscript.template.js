// ==UserScript==
// @name         M-Team 女优身高标注 + 列表大图
// @namespace    mteam
// @version      1.3.0
// @description  在种子列表/详情页的标题与副标题中，女优名字后面追加身高（如「三上悠亜 159cm」）；同时放大列表缩略图（240/360/480 可切换）、种子名完整显示不被省略号截断；并支持收藏当前页面。身高数据内嵌，无需联网。
// @author       Cola.Kot
// @license      MIT
// @match        https://*.m-team.cc/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

// 身高标注部分：数据来自 DMM/FANZA 公开演员库，已内嵌进脚本。
// 列表大图部分：移植自 XMXM 的「m-team 列表大图」(SleazyFork #495505, MIT License)。
// @downloadURL / @updateURL 发布到 GreasyFork 后由平台自动生成，不要手写

(function () {
'use strict';

/* ============================================================
 * 配置区
 * ============================================================ */
const OPTIONS = {
    // 名字最短长度（小于该长度不参与匹配，避免误伤）
    minNameLength: 2,
    // true = 名字必须处于「词边界」才认（中日文名至少一侧不是文字字符；
    //        拉丁名两侧都不能是字母/数字），可避免 "Ray" 命中 "BluRay"
    requireBoundary: true,
    // 身高显示模板：{h} 会被替换为数字
    suffixTemplate: ' {h}cm',
    // 除默认锚点外，额外需要扫描的容器选择器
    extraSelectors: [],
    // 是否显示右下角的开关面板
    enablePanel: true,
};

// 列表标题锚点：新版界面 /detail/，旧版界面 details.php
// 同时覆盖副标题与详情页标题
const TARGET_SELECTORS = [
    // 列表页标题链接（新版 /detail/，旧版 details.php）
    'a[href*="/detail/"]',
    'a[href*="details.php"]',
    // 列表页副标题（新版：标题链接后紧跟 br+div，副标题文本在该 div 内）
    'a[href*="/detail/"] + br + div',
    // 详情页标题（旧版 NexusPHP：h1#top）
    '#top',
];

// 是否启用身高标注（可在面板中切换）
const ENABLED_KEY = 'mt_height_enabled';

// ---- 列表大图：缩略图尺寸（短边像素） ----
const THUMB_SIZES = [240, 360, 480];
const THUMB_SIZE_KEY = 'mt_big_thumb_size';

// ---- 收藏：保存的页面列表 ----
const FAV_KEY = 'mt_fav_list';

/* ============================================================
 * 内嵌数据集：{ 女优名: 身高(cm) }
 * 由 tools/build-userscript.mjs 自动注入
 * ============================================================ */
const ACTRESS_HEIGHT = /* @__DATA__ */ {};

/* ============================================================
 * 核心匹配逻辑（Aho-Corasick 多模式串匹配）
 * 由 tools/build-userscript.mjs 从 src/core.mjs 内联
 * ============================================================ */
/* @__CORE__ */

// 构建归一化后的身高表与模式串。
// 数据集中部分名字使用全角英数（如「ＡＩＫＡ」），而 M-Team 标题中可能用半角（AIKA），
// 反之亦然。对模式和待扫描文本统一做全角→半角归一化后，两侧字符集一致才能命中。
// 归一化保持字符串长度不变（1:1 字符映射），因此匹配偏移量可直接用于原始 DOM 锚点。
const NORMALIZED_HEIGHT = Object.create(null);
const _patterns = [];
for (const _name in ACTRESS_HEIGHT) {
    const _norm = normalizeStr(_name);
    if (_norm.length < OPTIONS.minNameLength) continue;
    if (!(_norm in NORMALIZED_HEIGHT)) {
        NORMALIZED_HEIGHT[_norm] = ACTRESS_HEIGHT[_name];
        _patterns.push(_norm);
    }
}
const AC = buildAutomaton(_patterns);

/* ============================================================
 * 身高标签渲染
 * ============================================================ */
function makeBadge(name, height) {
    const span = document.createElement('span');
    span.className = 'mt-height-badge';
    span.textContent = OPTIONS.suffixTemplate.replace('{h}', String(height));
    span.title = `${name} · ${height}cm`;
    span.setAttribute('data-mt-height', String(height));
    return span;
}

function injectStyle() {
    if (document.getElementById('mt-height-style')) return;
    const style = document.createElement('style');
    style.id = 'mt-height-style';
    style.textContent = `
        .mt-height-badge {
            display: inline-block;
            margin: 0 2px;
            padding: 0 4px;
            border-radius: 4px;
            font-size: 0.78em;
            font-weight: 600;
            line-height: 1.5;
            vertical-align: 1px;
            color: #0b7a75;
            background: rgba(11, 122, 117, 0.12);
            border: 1px solid rgba(11, 122, 117, 0.35);
            white-space: nowrap;
            cursor: help;
        }
        html.mt-dark .mt-height-badge {
            color: #4dd0c8;
            background: rgba(77, 208, 200, 0.14);
            border-color: rgba(77, 208, 200, 0.38);
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

/* ============================================================
 * 文本节点 & 偏移映射（支持跨节点插入）
 * ============================================================ */
function textNodesOf(el) {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (n.parentElement && n.parentElement.closest('.mt-height-badge')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
}

function processElement(el) {
    if (!el || el.nodeType !== 1) return;
    const nodes = textNodesOf(el);
    if (!nodes.length) return;

    let text = '';
    const anchors = []; // 每个字符 -> {node, off}
    for (const n of nodes) {
        const v = n.nodeValue;
        for (let i = 0; i < v.length; i++) anchors.push({ node: n, off: i });
        text += v;
    }
    if (!text) return;

    // 文本未变化则跳过（避免 MutationObserver 自触发死循环）
    if (el.getAttribute('data-mt-height-sig') === hash(text)) return;

    // 文本已变化（SPA 复用节点等场景）：先清理旧标签，再重新插入
    el.querySelectorAll('.mt-height-badge').forEach((b) => b.remove());

    // 归一化后扫描：全角英数/空格/括号 → 半角，长度不变，anchors 偏移仍有效
    const normText = normalizeStr(text);
    const matches = pickMatches(AC, normText, OPTIONS);
    if (!matches.length) {
        el.setAttribute('data-mt-height-sig', hash(text));
        return;
    }

    // 从后往前插入，保证前面锚点偏移仍有效
    matches.sort((a, b) => b.end - a.end);
    for (const m of matches) {
        const anchor = anchors[m.end - 1];
        if (!anchor || !anchor.node.isConnected) continue;
        const name = AC.patterns[m.p];
        const height = NORMALIZED_HEIGHT[name];
        if (!height) continue;
        const badge = makeBadge(name, height);
        try {
            const range = document.createRange();
            range.setStart(anchor.node, anchor.off + 1);
            range.collapse(true);
            range.insertNode(badge);
        } catch (e) {
            /* 忽略异常节点 */
        }
    }
    el.setAttribute('data-mt-height-sig', hash(text));
}

// 轻量字符串哈希（仅用于变更检测）
function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return String(h);
}

/* ============================================================
 * 列表大图（一）：缩略图按短边等比缩放
 * ============================================================ */
function readThumbSize() {
    try {
        const v = parseInt(localStorage.getItem(THUMB_SIZE_KEY), 10);
        return THUMB_SIZES.indexOf(v) >= 0 ? v : 240;
    } catch (e) {
        return 240;
    }
}

let thumbSize = readThumbSize(); // 当前生效的短边像素

function writeThumbSize(v) {
    try {
        localStorage.setItem(THUMB_SIZE_KEY, String(v));
    } catch (e) {
        /* ignore */
    }
}

// 列表图按短边 thumbSize 等比缩放：横图压高度、竖图压宽度
function applyListThumbSize() {
    const size = thumbSize;
    document.querySelectorAll('.torrent-list__thumbnail').forEach((img) => {
        const src = img.currentSrc || img.src || '';
        if (img.dataset.mtFitSize === String(size) && img.dataset.mtFitSrc === src) return;

        const fit = () => {
            const s = thumbSize; // 取实时值，避免切换尺寸后个别图被旧回调改回去
            const w = img.naturalWidth, h = img.naturalHeight;
            if (!w || !h) return;
            if (w >= h) {
                img.style.setProperty('height', s + 'px', 'important');
                img.style.setProperty('width', 'auto', 'important');
            } else {
                img.style.setProperty('width', s + 'px', 'important');
                img.style.setProperty('height', 'auto', 'important');
            }
            img.dataset.mtFitSize = String(s);
            img.dataset.mtFitSrc = img.currentSrc || img.src || '';
        };

        if (img.complete && img.naturalWidth) {
            fit();
        } else {
            img.addEventListener('load', fit, { once: true });
        }
    });
}

/* ============================================================
 * 列表大图（二）：种子名完整显示（去掉省略号 / line-clamp 截断，允许换行）
 * ============================================================ */
const FULL_TITLE_CLASS = 'mt-full-title';
const FULL_TITLE_STYLE_ID = 'mt-full-title-style';

// 新版界面：a[href*="/detail/"]（标题在 <strong> 里）；旧版界面：a[href*="details.php"]
const TITLE_LINK_SELECTOR = 'a[href*="/detail/"], a[href*="details.php"]';

// 只处理「种子列表里的一行」，避免影响详情页 / 演员页等其它链接
function inTorrentListRow(link) {
    if (link.closest('tr')) return true;
    return !!link.closest('[class*="torrent-list" i]');
}

function injectFullTitleStyle() {
    if (document.getElementById(FULL_TITLE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FULL_TITLE_STYLE_ID;
    style.textContent = `
        /* 新版界面已知结构：直接放开标题，避免首屏渲染时的闪烁 */
        .app-content__inner table.w-full tbody a[href*="/detail/"],
        .app-content__inner table.w-full tbody a[href*="/detail/"] strong {
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
            -webkit-line-clamp: unset !important;
            line-clamp: unset !important;
            max-height: none !important;
            word-break: break-word !important;
            overflow-wrap: anywhere !important;
        }
        /* 运行时检测到被截断的元素（含外层包裹容器），统一放开 */
        .${FULL_TITLE_CLASS},
        .${FULL_TITLE_CLASS} * {
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
            -webkit-line-clamp: unset !important;
            line-clamp: unset !important;
            max-height: none !important;
            -webkit-mask-image: none !important;
            mask-image: none !important;
            word-break: break-word !important;
            overflow-wrap: anywhere !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

// 用计算样式判断某个元素是否真的在被截断（Tailwind truncate / line-clamp / 手动 nowrap）
function isClippedElement(el) {
    let st;
    try {
        st = getComputedStyle(el);
    } catch (e) {
        return false;
    }
    if (!st) return false;
    const clamp = st.getPropertyValue('-webkit-line-clamp') || st.webkitLineClamp || '';
    return (
        st.textOverflow === 'ellipsis' ||
        (clamp && clamp !== 'none') ||
        (st.whiteSpace === 'nowrap' && st.overflow === 'hidden') ||
        (st.getPropertyValue('-webkit-mask-image') || st.maskImage || 'none') !== 'none'
    );
}

// 找到列表行里被截断的标题元素及其外层容器，打上标记类放开显示
function applyFullTitles() {
    injectFullTitleStyle();

    const mark = (el) => {
        if (!el || !el.classList) return;
        // 身高标签本身不参与截断放开
        if (el.closest && el.closest('.mt-height-badge')) return;
        if (!el.classList.contains(FULL_TITLE_CLASS) && isClippedElement(el)) {
            el.classList.add(FULL_TITLE_CLASS);
        }
    };

    document.querySelectorAll(TITLE_LINK_SELECTOR).forEach((link) => {
        if (!inTorrentListRow(link)) return;

        mark(link);
        link.querySelectorAll('*').forEach(mark);

        // 标题链接向上 1~4 层：覆盖「外层 div 负责裁切」的情况
        let p = link.parentElement;
        for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
            mark(p);
        }
    });
}

/* ============================================================
 * 列表大图（三）：旧版界面补充处理（表格宽度 + DMM 小图）
 * ============================================================ */
function injectOldSiteStyles() {
    if (document.getElementById('mt-oldsite-style')) return;
    const s = document.createElement('style');
    s.id = 'mt-oldsite-style';
    s.textContent = `
        .mx-auto table thead tr th:nth-of-type(2) { width: auto !important; }
        .ant-image .torrent-list__thumbnail { height: auto !important; }
        .mx-auto table colgroup col:nth-of-type(2) { width: auto !important; }
    `;
    (document.head || document.documentElement).appendChild(s);
}

// 旧版界面：把 DMM 缩略图大图换成更小的 jp 版本，并去掉 grid 布局
function fixOldSiteThumbs() {
    const rightBox = document.querySelector('.duration-300');
    if (!rightBox) return;

    const probe = rightBox.querySelector('img[src^="https://pics.dmm.co.jp/digital/video/"]');
    if (probe && probe.parentElement && probe.parentElement.parentElement && probe.parentElement.parentElement.parentElement) {
        probe.parentElement.parentElement.parentElement.classList.remove('grid');
    }

    const pattern = /https:\/\/pics\.dmm\.co\.jp\/digital\/video\/(\w+)\/(\w+)-(\d+)\.jpg/;
    document.querySelectorAll('img[src^="https://pics.dmm.co.jp/digital/video/"]').forEach((item) => {
        // 幂等保护：URL 已被替换过就跳过，避免反复追加 "jp"
        if (item.dataset.mtDmmFixed === '1') return;
        const next = item.src.replace(pattern, 'https://pics.dmm.co.jp/digital/video/$1/$2jp-$3.jpg');
        if (next !== item.src) {
            item.src = next;
            item.dataset.mtDmmFixed = '1';
        }
    });
}

/* ============================================================
 * 扫描调度
 * ============================================================ */
function selectorAll() {
    const list = TARGET_SELECTORS.concat(OPTIONS.extraSelectors).join(',');
    return document.querySelectorAll(list);
}

/**
 * 动态查找无法用纯 CSS 选择器表达的扫描目标：
 * - 新版详情页标题（h2 内含 span.align-middle）
 * - 详情页副标题（Ant Design / NexusPHP 表格中标签为「副標題」「副标题」等的单元格）
 */
function findDynamicTargets() {
    const results = [];

    // 新版详情页标题 h2（含 span.align-middle）
    document.querySelectorAll('h2 span.align-middle').forEach((span) => {
        const h2 = span.parentElement;
        if (h2 && h2.tagName === 'H2' && !results.includes(h2)) results.push(h2);
    });

    // 详情页副标题：XPath 查找标签单元格旁的内容单元格
    // 覆盖新版 Ant Design（td/th 标签）与旧版 NexusPHP（td 标签）
    try {
        const labels = ['副標題', '副标题', 'Small Description', '小标题', '副題'];
        for (const label of labels) {
            const it = document.evaluate(
                `//td[normalize-space()="${label}"]/following-sibling::td[1]` +
                ` | //th[normalize-space()="${label}"]/following-sibling::td[1]`,
                document, null, XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null,
            );
            let node;
            while ((node = it.iterateNext())) {
                if (node.textContent.trim() && !results.includes(node)) results.push(node);
            }
        }
    } catch (e) {
        /* XPath 不可用时忽略 */
    }

    return results;
}

function scanAll() {
    // 列表大图 / 种子名完整显示 / 旧版处理：始终生效，与身高开关无关
    applyListThumbSize();
    applyFullTitles();
    if (!IS_NEXT_SITE) fixOldSiteThumbs();
    syncFavStar(); // SPA 切页后同步星星的亮/灭

    // 身高标注：受开关控制
    if (!isEnabled()) return;
    selectorAll().forEach(processElement);
    findDynamicTargets().forEach(processElement);
}

let timer = null;
function scheduleScan() {
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        scanAll();
    }, 250);
}

function startObserver() {
    const mo = new MutationObserver((records) => {
        for (const r of records) {
            // 忽略由本脚本插入的节点引起的变更
            if (r.target && r.target.nodeType === 1 &&
                r.target.closest && r.target.closest('.mt-height-badge')) continue;
            scheduleScan();
            return;
        }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/* ============================================================
 * 身高开关
 * ============================================================ */
function isEnabled() {
    try {
        const v = localStorage.getItem(ENABLED_KEY);
        return v === null ? true : v === '1';
    } catch (e) {
        return true;
    }
}

function setEnabled(on) {
    try {
        localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    document.querySelectorAll('.mt-height-badge').forEach((b) => {
        b.style.display = on ? '' : 'none';
    });
    if (on) scanAll();
}

/* ============================================================
 * 右下角统一面板：身高开关 + 大图尺寸
 * ============================================================ */
function injectPanelStyle() {
    if (document.getElementById('mt-helper-style')) return;
    const style = document.createElement('style');
    style.id = 'mt-helper-style';
    style.textContent = `
        #mt-height-panel {
            position: fixed;
            right: 14px;
            bottom: 14px;
            z-index: 99999;
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            max-width: 260px;
            padding: 6px 10px;
            border-radius: 8px;
            font-size: 12px;
            line-height: 1;
            background: rgba(0, 0, 0, 0.72);
            color: #fff;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            user-select: none;
            font-family: system-ui, -apple-system, sans-serif;
        }
        #mt-height-panel label {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
        }
        #mt-height-panel .mt-panel-label {
            opacity: 0.75;
        }
        #mt-height-panel .mt-panel-sep {
            width: 1px;
            height: 14px;
            background: rgba(255, 255, 255, 0.3);
        }
        #mt-height-panel .mt-close {
            cursor: pointer;
            color: #bbb;
            padding: 0 2px;
        }
        .mt-big-size-btn {
            appearance: none;
            border: 1px solid rgba(255, 255, 255, 0.35) !important;
            background: transparent !important;
            color: #fff !important;
            padding: 2px 8px;
            border-radius: 999px;
            cursor: pointer;
            font-size: 12px;
            line-height: 1.4;
            transition: all 0.2s ease;
        }
        .mt-big-size-btn:hover {
            border-color: #177ddc !important;
            color: #177ddc !important;
        }
        .mt-big-size-btn.mt-active {
            background: #177ddc !important;
            border-color: #177ddc !important;
            color: #fff !important;
        }
        #mt-height-panel .mt-fav-star {
            appearance: none;
            border: none !important;
            background: transparent !important;
            color: #8a8a8a !important;
            font-size: 15px;
            line-height: 1;
            padding: 0 2px;
            cursor: pointer;
        }
        #mt-height-panel .mt-fav-star:hover {
            color: #f5c518 !important;
        }
        #mt-height-panel .mt-fav-star.mt-fav-on {
            color: #f5c518 !important;
            text-shadow: 0 0 6px rgba(245, 197, 24, 0.75);
        }
        #mt-height-panel .mt-fav-list-btn {
            appearance: none;
            border: 1px solid rgba(255, 255, 255, 0.35) !important;
            background: transparent !important;
            color: #fff !important;
            padding: 2px 8px;
            border-radius: 999px;
            cursor: pointer;
            font-size: 12px;
            line-height: 1.4;
        }
        #mt-height-panel .mt-fav-list-btn:hover {
            border-color: #f5c518 !important;
            color: #f5c518 !important;
        }
        #mt-fav-panel {
            position: fixed;
            right: 14px;
            bottom: 56px;
            z-index: 99999;
            width: 300px;
            max-height: 60vh;
            overflow: auto;
            padding: 8px 10px;
            border-radius: 8px;
            font-size: 12px;
            line-height: 1.5;
            background: rgba(0, 0, 0, 0.86);
            color: #fff;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
            font-family: system-ui, -apple-system, sans-serif;
        }
        #mt-fav-panel .mt-fav-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-weight: 600;
            margin-bottom: 4px;
        }
        #mt-fav-panel .mt-close {
            cursor: pointer;
            color: #bbb;
            padding: 0 2px;
        }
        #mt-fav-panel .mt-fav-empty {
            opacity: 0.6;
            padding: 6px 0;
        }
        #mt-fav-panel .mt-fav-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 0;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
        }
        #mt-fav-panel .mt-fav-link {
            flex: 1;
            color: #9fd0ff;
            text-decoration: none;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #mt-fav-panel .mt-fav-link:hover {
            text-decoration: underline;
        }
        #mt-fav-panel .mt-fav-del {
            appearance: none;
            border: none !important;
            background: transparent !important;
            color: #bbb !important;
            font-size: 14px;
            line-height: 1;
            cursor: pointer;
            padding: 0 2px;
        }
        #mt-fav-panel .mt-fav-del:hover {
            color: #ff6b6b !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function renderSizePanel() {
    const panel = document.getElementById('mt-height-panel');
    if (!panel) return;
    panel.querySelectorAll('.mt-big-size-btn').forEach((btn) => {
        btn.classList.toggle('mt-active', btn.dataset.size === String(thumbSize));
    });
}

function buildPanel() {
    if (!OPTIONS.enablePanel || document.getElementById('mt-height-panel')) return;
    injectPanelStyle();

    const wrap = document.createElement('div');
    wrap.id = 'mt-height-panel';

    // 身高开关
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isEnabled();
    cb.addEventListener('change', () => setEnabled(cb.checked));
    label.appendChild(cb);
    label.appendChild(document.createTextNode('女优身高'));
    wrap.appendChild(label);

    const sep = document.createElement('span');
    sep.className = 'mt-panel-sep';
    wrap.appendChild(sep);

    // 收藏：星星切换当前页，旁边的按钮打开收藏列表
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'mt-fav-star';
    star.textContent = '☆';
    star.addEventListener('click', toggleFav);
    wrap.appendChild(star);

    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = 'mt-fav-list-btn';
    favBtn.textContent = '收藏列表';
    favBtn.addEventListener('click', toggleFavList);
    wrap.appendChild(favBtn);

    const sep2 = document.createElement('span');
    sep2.className = 'mt-panel-sep';
    wrap.appendChild(sep2);

    // 大图尺寸
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'mt-panel-label';
    sizeLabel.textContent = '大图';
    wrap.appendChild(sizeLabel);

    THUMB_SIZES.forEach((s) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mt-big-size-btn';
        btn.dataset.size = String(s);
        btn.textContent = String(s);
        btn.addEventListener('click', () => {
            if (thumbSize === s) return;
            thumbSize = s;
            writeThumbSize(s);
            renderSizePanel();
            applyListThumbSize(); // 立即按新尺寸重绘，不需要刷新页面
        });
        wrap.appendChild(btn);
    });

    const close = document.createElement('span');
    close.className = 'mt-close';
    close.textContent = '×';
    close.addEventListener('click', () => wrap.remove());
    wrap.appendChild(close);

    (document.body || document.documentElement).appendChild(wrap);
    renderSizePanel();
    renderFavUI();
}

/* ============================================================
 * 收藏：把当前页面存下来，面板上的星星可切换、收藏列表可查看
 * ============================================================ */
// GM_* 能跨 m-team 各子域共享；没有 GM_*（或调用失败）时退回 localStorage
function favRead() {
    let raw = null;
    try {
        if (typeof GM_getValue === 'function') raw = GM_getValue(FAV_KEY, null);
        else raw = localStorage.getItem(FAV_KEY);
    } catch (e) {
        raw = null;
    }
    if (!raw) return [];
    try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function favWrite(list) {
    const raw = JSON.stringify(list);
    try {
        if (typeof GM_setValue === 'function') GM_setValue(FAV_KEY, raw);
        else localStorage.setItem(FAV_KEY, raw);
    } catch (e) {
        /* ignore */
    }
}

let favs = favRead();

function favIndex(url) {
    return favs.findIndex((f) => f && f.url === url);
}

// 当前页面的地址与名称，拿不到就返回空，避免在异常环境里抛错
function currentPage() {
    let url = '';
    let name = '';
    try {
        url = window.location.href;
    } catch (e) {
        /* ignore */
    }
    try {
        name = (document.title || '').trim();
    } catch (e) {
        /* ignore */
    }
    // 去掉站名尾巴，如「SSIS-001 xxx - M-Team - 分享率...」
    name = name.split(/\s*[-–|]\s*M-Team\b/i)[0].trim();
    if (!name && url) {
        try {
            name = window.location.pathname;
        } catch (e) {
            /* ignore */
        }
    }
    return { url, name };
}

function isCurrentFavored() {
    const { url } = currentPage();
    return !!url && favIndex(url) >= 0;
}

// 收藏 / 取消收藏当前页
function toggleFav() {
    const { url, name } = currentPage();
    if (!url) return;
    const i = favIndex(url);
    if (i >= 0) favs.splice(i, 1);
    else favs.push({ url, name, ts: Date.now() });
    favWrite(favs);
    renderFavUI();
}

function renderFavList() {
    const box = document.getElementById('mt-fav-panel');
    if (!box) return;
    const list = box.querySelector('.mt-fav-items');
    if (!list) return;
    list.textContent = '';

    if (!favs.length) {
        const empty = document.createElement('div');
        empty.className = 'mt-fav-empty';
        empty.textContent = '还没有收藏';
        list.appendChild(empty);
        return;
    }

    favs.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach((f) => {
        const item = document.createElement('div');
        item.className = 'mt-fav-item';

        const link = document.createElement('a');
        link.className = 'mt-fav-link';
        link.href = f.url;
        link.textContent = f.name || f.url;
        link.title = f.name || f.url;

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mt-fav-del';
        del.textContent = '×';
        del.title = '删除';
        del.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const i = favIndex(f.url);
            if (i >= 0) favs.splice(i, 1);
            favWrite(favs);
            renderFavUI();
        });

        item.appendChild(link);
        item.appendChild(del);
        list.appendChild(item);
    });
}

// 开关收藏列表面板
function toggleFavList() {
    const exist = document.getElementById('mt-fav-panel');
    if (exist) {
        exist.remove();
        return;
    }
    const box = document.createElement('div');
    box.id = 'mt-fav-panel';

    const head = document.createElement('div');
    head.className = 'mt-fav-head';
    const title = document.createElement('span');
    title.textContent = '我的收藏';
    const close = document.createElement('span');
    close.className = 'mt-close';
    close.textContent = '×';
    close.addEventListener('click', () => box.remove());
    head.appendChild(title);
    head.appendChild(close);

    const list = document.createElement('div');
    list.className = 'mt-fav-items';

    box.appendChild(head);
    box.appendChild(list);
    (document.body || document.documentElement).appendChild(box);
    renderFavList();
}

// 同步星星状态、列表按钮上的数量，以及（若已展开）列表内容
function renderFavUI() {
    const star = document.querySelector('#mt-height-panel .mt-fav-star');
    if (star) {
        const on = isCurrentFavored();
        star.dataset.mtFavOn = on ? '1' : '0';
        star.textContent = on ? '★' : '☆';
        star.classList.toggle('mt-fav-on', on);
        star.title = on ? '取消收藏当前页' : '收藏当前页';
    }
    const btn = document.querySelector('#mt-height-panel .mt-fav-list-btn');
    if (btn) btn.textContent = `收藏列表 (${favs.length})`;
    renderFavList();
}

// 扫描时只做「状态真的变了才写」的轻量同步，否则频繁改 DOM 会自己触发扫描
function syncFavStar() {
    const star = document.querySelector('#mt-height-panel .mt-fav-star');
    if (!star) return;
    const on = isCurrentFavored();
    if (star.dataset.mtFavOn === (on ? '1' : '0')) return;
    star.dataset.mtFavOn = on ? '1' : '0';
    star.textContent = on ? '★' : '☆';
    star.classList.toggle('mt-fav-on', on);
    star.title = on ? '取消收藏当前页' : '收藏当前页';
}

/* ============================================================
 * 站点判定 & 启动
 * ============================================================ */
let _host = '';
try {
    _host = (window.location && window.location.hostname) || '';
} catch (e) {
    /* ignore */
}
// 新版界面（Ant Design）固定显示面板；其余视为旧版 NexusPHP
const IS_NEXT_SITE = _host === 'next.m-team.cc' || _host === 'kp.m-team.cc';

function boot() {
    injectStyle();
    if (!IS_NEXT_SITE) injectOldSiteStyles();
    startObserver();
    scanAll();
    buildPanel();
    // 兜底：部分 SPA 场景 MutationObserver 可能漏掉，做几次延迟扫描
    [800, 2000, 5000].forEach((t) => setTimeout(scanAll, t));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

})();