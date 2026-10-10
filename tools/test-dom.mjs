#!/usr/bin/env node
/**
 * test-dom.mjs — 在最小 DOM 环境里真实执行构建产物，验证「名字后面插入身高标签」。
 *
 * 没有 jsdom 依赖，这里实现了一个够用的迷你 DOM（TextNode / Element / TreeWalker /
 * Range.insertNode / querySelectorAll 子集），用来跑 dist 里的最终脚本。
 *
 * 用法：node tools/test-dom.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'm-team-actress-height.user.js');

let DOC = null;

/* ============================ 迷你 DOM ============================ */
class Node {
    constructor(nodeType) {
        this.nodeType = nodeType;
        this.childNodes = [];
        this.parentNode = null;
    }
    remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
    }
    get parentElement() {
        return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    get isConnected() {
        let n = this;
        while (n.parentNode) n = n.parentNode;
        return n === DOC;
    }
    get textContent() {
        if (this.nodeType === 3) return this.nodeValue;
        return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v) {
        if (this.nodeType === 3) {
            this.nodeValue = String(v);
            return;
        }
        this.childNodes.forEach((c) => (c.parentNode = null));
        this.childNodes = [];
        if (v !== '' && v != null) this.appendChild(new TextNode(String(v)));
    }
    appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }
    insertBefore(child, ref) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        if (ref == null) {
            this.childNodes.push(child);
            return child;
        }
        const i = this.childNodes.indexOf(ref);
        if (i < 0) throw new Error('insertBefore: 参考节点不是子节点');
        this.childNodes.splice(i, 0, child);
        return child;
    }
    removeChild(child) {
        const i = this.childNodes.indexOf(child);
        if (i >= 0) {
            this.childNodes.splice(i, 1);
            child.parentNode = null;
        }
        return child;
    }
    get prevSibling() {
        if (!this.parentNode) return null;
        const i = this.parentNode.childNodes.indexOf(this);
        return i > 0 ? this.parentNode.childNodes[i - 1] : null;
    }
    get nextSibling() {
        if (!this.parentNode) return null;
        const i = this.parentNode.childNodes.indexOf(this);
        return i >= 0 && i + 1 < this.parentNode.childNodes.length
            ? this.parentNode.childNodes[i + 1]
            : null;
    }
}

class TextNode extends Node {
    constructor(value) {
        super(3);
        this.nodeValue = value;
    }
    splitText(offset) {
        const tail = new TextNode(this.nodeValue.slice(offset));
        this.nodeValue = this.nodeValue.slice(0, offset);
        const i = this.parentNode.childNodes.indexOf(this);
        this.parentNode.childNodes.splice(i + 1, 0, tail);
        tail.parentNode = this.parentNode;
        return tail;
    }
}

/** 极简选择器：支持 ".class" 与 "tag[attr*=value]"，可用 "," 组合 */
function matchesSelector(el, sel) {
    for (const part0 of sel.split(',')) {
        const part = part0.trim();
        if (!part) continue;
        const m = part.match(/^([a-zA-Z0-9]*)\[([\w-]+)\*=(["']?)(.*?)\3\]$/);
        if (m) {
            const [, tag, attr, , val] = m;
            if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) continue;
            const have = el.getAttribute(attr);
            if (have != null && have.includes(val)) return true;
            continue;
        }
        if (part.startsWith('.')) {
            if (el.classList.contains(part.slice(1))) return true;
            continue;
        }
        if (/^[a-zA-Z0-9]+$/.test(part)) {
            if (el.tagName.toLowerCase() === part.toLowerCase()) return true;
            continue;
        }
    }
    return false;
}

class Element extends Node {
    constructor(tagName) {
        super(1);
        this.tagName = tagName.toUpperCase();
        this.attributes = Object.create(null);
        this.classList = {
            _s: new Set(),
            add(c) {
                this._s.add(c);
            },
            contains(c) {
                return this._s.has(c);
            },
            remove(c) {
                this._s.delete(c);
            },
            toggle(c, force) {
                const want = force === undefined ? !this._s.has(c) : !!force;
                if (want) this._s.add(c);
                else this._s.delete(c);
                return want;
            },
            toString() {
                return [...this._s].join(' ');
            },
        };
        this.style = {
            _props: Object.create(null),
            setProperty(k, v) {
                this._props[k] = String(v);
            },
            getPropertyValue(k) {
                return this._props[k] || '';
            },
            removeProperty(k) {
                delete this._props[k];
            },
        };
        this.dataset = {};
        this.id = '';
    }
    setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
        if (k === 'id') this.id = String(v);
        if (k.indexOf('data-') === 0) {
            const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[camel] = String(v);
        }
    }
    getAttribute(k) {
        return k in this.attributes ? this.attributes[k] : null;
    }
    removeAttribute(k) {
        delete this.attributes[k];
    }
    get className() {
        return this.classList.toString();
    }
    set className(v) {
        this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    addEventListener() {}
    descendants() {
        const out = [];
        const walk = (n) => {
            for (const c of n.childNodes) {
                out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelectorAll(sel) {
        return this.descendants().filter((n) => n.nodeType === 1 && matchesSelector(n, sel));
    }
    querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
    }
    closest(sel) {
        let n = this;
        while (n && n.nodeType === 1) {
            if (matchesSelector(n, sel)) return n;
            n = n.parentNode;
        }
        return null;
    }
}

/* ---- 迷你 TreeWalker ---- */
class TreeWalker {
    constructor(root, whatToShow, filter) {
        this.filter = filter;
        this.nodes = root.descendants().filter((n) => n.nodeType === 3);
        this.i = -1;
        // 支持 REJECT：如果祖先链上有被 REJECT 的文本节点，则跳过（文本节点无子树，等价于 SKIP）
        if (filter && filter.acceptNode) {
            this.nodes = this.nodes.filter((n) => filter.acceptNode(n) !== 102); // REJECT = 102
        }
        this.currentNode = null;
    }
    nextNode() {
        this.i++;
        if (this.i >= this.nodes.length) return null;
        this.currentNode = this.nodes[this.i];
        return this.currentNode;
    }
}

/* ---- 迷你 Range ---- */
class Range {
    setStart(node, offset) {
        this.startContainer = node;
        this.startOffset = offset;
        return this;
    }
    collapse() {
        return this;
    }
    insertNode(newNode) {
        const container = this.startContainer;
        if (container.nodeType === 3) {
            const len = container.nodeValue.length;
            let ref;
            if (this.startOffset <= 0) {
                ref = container;
            } else if (this.startOffset < len) {
                ref = container.splitText(this.startOffset);
            } else {
                ref = container.nextSibling;
            }
            container.parentNode.insertBefore(newNode, ref);
        } else {
            container.insertBefore(newNode, container.childNodes[this.startOffset] || null);
        }
        return newNode;
    }
}

/* ============================ 构造文档 ============================ */
function buildDocument() {
    const doc = {
        nodeType: 9,
        childNodes: [],
        readyState: 'complete',
        addEventListener() {},
        createElement(tag) {
            const el = new Element(tag);
            return el;
        },
        createTextNode(v) {
            return new TextNode(v);
        },
        createRange() {
            return new Range();
        },
        createTreeWalker(root, whatToShow, filter) {
            return new TreeWalker(root, whatToShow, filter);
        },
        getElementById(id) {
            return doc.documentElement.queryAllById(id)[0] || null;
        },
        querySelectorAll(sel) {
            return doc.documentElement.querySelectorAll(sel);
        },
        querySelector(sel) {
            return doc.documentElement.querySelector(sel);
        },
    };

    const html = new Element('html');
    const head = new Element('head');
    const body = new Element('body');
    doc.documentElement = html;
    doc.head = head;
    doc.body = body;
    doc.appendChild = (c) => {
        c.parentNode = doc;
        doc.childNodes.push(c);
        return c;
    };
    doc.appendChild(html);
    html.appendChild(head);
    html.appendChild(body);
    html.queryAllById = (id) => html.descendants().filter((n) => n.nodeType === 1 && n.id === id);

    // 真实场景：列表页每个标题是一个指向 /detail/ 或 details.php 的 <a>
    const mk = (tag, attrs, text) => {
        const el = new Element(tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        if (text) el.appendChild(new TextNode(text));
        return el;
    };

    const a1 = mk('a', { href: '/detail/12345' }, 'SSIS-001 三上悠亜 激しい中出し 1080p');
    const a2 = mk('a', { href: 'details.php?id=6789' }, 'ABP-123 【葵つかさ】初共演スペシャル');
    const a3 = mk('a', { href: '/detail/99999' }, 'MIDV-999 橋本ありな 中文字幕');
    // 非目标元素：不应被标注
    const div = mk('div', {}, '三上悠亜 的个人资料页');
    // 无命中
    const a4 = mk('a', { href: '/detail/11111' }, 'HEYZO-0001 1080p BluRay x265 中文字幕');
    // 一条标题里出现两个女优名
    const a5 = mk('a', { href: '/detail/22222' }, 'SSIS-002 【三上悠亜】と葵つかさ 夢の共演');

    body.appendChild(a1);
    body.appendChild(a2);
    body.appendChild(a3);
    body.appendChild(div);
    body.appendChild(a4);
    body.appendChild(a5);

    // ---- 合并功能夹具：种子列表行（标题被截断，应放开）+ 缩略图（应按尺寸缩放）----
    const tr = new Element('tr');
    const tdTitle = new Element('td');
    const titleLink = mk('a', { href: '/detail/55555' }, 'SSIS-003 三上悠亜 中文字幕 完整标题');
    titleLink._computed = {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maskImage: 'none',
        getPropertyValue: () => 'none',
    };
    tdTitle.appendChild(titleLink);
    tr.appendChild(tdTitle);
    body.appendChild(tr);

    const thumb = new Element('img');
    thumb.setAttribute('class', 'torrent-list__thumbnail');
    thumb.setAttribute('src', 'https://example.com/thumb-a.jpg');
    thumb.complete = true;
    thumb.naturalWidth = 300;
    thumb.naturalHeight = 400;
    body.appendChild(thumb);

    DOC = doc;
    return { doc, a1, a2, a3, a4, a5, div, titleLink, thumb };
}

/* ============================ 执行脚本 ============================ */
function run() {
    if (!fs.existsSync(DIST)) {
        console.error(`缺少构建产物：${DIST}\n请先运行 node tools/build-userscript.mjs`);
        process.exit(1);
    }
    const { doc, a1, a2, a3, a4, a5, div, titleLink, thumb } = buildDocument();

    const store = new Map();
    const sandbox = {
        document: doc,
        window: {},
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
        },
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
        NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
        getComputedStyle: (el) =>
            (el && el._computed) || {
                whiteSpace: 'normal',
                overflow: 'visible',
                textOverflow: 'clip',
                maskImage: 'none',
                getPropertyValue: () => 'none',
            },
        setTimeout: () => 0,
        clearTimeout: () => {},
        console,
    };
    sandbox.document.documentElement = doc.documentElement;
    vm.createContext(sandbox);

    const code = fs.readFileSync(DIST, 'utf8');
    vm.runInContext(code, sandbox, { filename: 'm-team-actress-height.user.js' });

    return { a1, a2, a3, a4, a5, div, titleLink, thumb, doc };
}

/* ============================ 断言 ============================ */
let pass = 0, fail = 0;
function t(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ok  ${name}`);
    } catch (e) {
        fail++;
        console.error(`FAIL  ${name}\n      ${e.message}`);
    }
}

/** 把元素序列化成可读字符串，如 `SSIS-001 三上悠亜[159cm] 激しい...` */
function render(el) {
    return el.childNodes
        .map((c) => (c.nodeType === 3 ? c.nodeValue : `[${c.textContent}]`))
        .join('');
}

function badgeTexts(el) {
    return el.querySelectorAll('.mt-height-badge').map((b) => b.textContent);
}

console.log('--- DOM 集成测试（真实执行构建产物）---');
const { a1, a2, a3, a4, a5, div, titleLink, thumb, doc } = run();

t('标题 1：三上悠亜 后面插入 159cm', () => {
    console.log(`      ${render(a1)}`);
    assert.deepStrictEqual(badgeTexts(a1), [' 159cm']);
    assert.ok(render(a1).includes('三上悠亜'));
    assert.ok(render(a1).indexOf('[ 159cm]') > render(a1).indexOf('三上悠亜'));
});

t('标题 2：葵つかさ 后面插入 163cm（旧版 details.php 锚点）', () => {
    console.log(`      ${render(a2)}`);
    assert.deepStrictEqual(badgeTexts(a2), [' 163cm']);
});

t('标题 3：橋本ありな 后面插入 166cm', () => {
    console.log(`      ${render(a3)}`);
    assert.deepStrictEqual(badgeTexts(a3), [' 166cm']);
});

t('标签文本顺序正确（在原名字之后，不打断原文字）', () => {
    const text = a1.textContent;
    assert.strictEqual(text, 'SSIS-001 三上悠亜 159cm 激しい中出し 1080p');
});

t('非目标元素（div）不被标注', () => {
    assert.strictEqual(div.querySelectorAll('.mt-height-badge').length, 0);
});

t('无命中的标题不插入标签', () => {
    console.log(`      ${render(a4)}`);
    assert.strictEqual(a4.querySelectorAll('.mt-height-badge').length, 0);
});

t('一条标题内多个名字：逐个插入且互不干扰', () => {
    console.log(`      ${render(a5)}`);
    assert.deepStrictEqual(badgeTexts(a5), [' 159cm', ' 163cm']);
    assert.strictEqual(a5.textContent, 'SSIS-002 【三上悠亜 159cm】と葵つかさ 163cm 夢の共演');
});

/* ---------------- 合并进来的「列表大图」功能 ---------------- */
t('合并：被截断的列表标题被标记 .mt-full-title（放开省略号）', () => {
    assert.ok(titleLink.classList.contains('mt-full-title'));
});

t('合并：注入了放开截断的样式 <style id="mt-full-title-style">', () => {
    const styleEl = doc.getElementById('mt-full-title-style');
    assert.ok(styleEl, '未找到 mt-full-title-style');
    assert.ok(/-webkit-line-clamp:\s*unset/.test(styleEl.textContent));
    assert.ok(/white-space:\s*normal/.test(styleEl.textContent));
});

t('合并：缩略图按短边 240px 等比缩放（竖图取宽）', () => {
    assert.strictEqual(thumb.style.getPropertyValue('width'), '240px');
    assert.strictEqual(thumb.style.getPropertyValue('height'), 'auto');
    assert.strictEqual(thumb.dataset.mtFitSize, '240');
});

t('合并：右下角为统一面板（含身高开关 + 大图尺寸按钮）', () => {
    const panel = doc.getElementById('mt-height-panel');
    assert.ok(panel, '未找到统一面板');
    assert.ok(panel.textContent.includes('女优身高'), '缺少身高开关');
    assert.ok(panel.textContent.includes('大图'), '缺少大图尺寸标签');
    const btns = panel.querySelectorAll('.mt-big-size-btn');
    assert.strictEqual(btns.length, 3);
    assert.ok(btns.some((b) => b.classList.contains('mt-active')), '默认尺寸按钮未高亮');
});

t('合并：身高标签不会被误标记为 mt-full-title', () => {
    titleLink.querySelectorAll('.mt-height-badge').forEach((b) => {
        assert.ok(!b.classList.contains('mt-full-title'));
    });
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);