/**
 * core.mjs — 油猴脚本的核心匹配逻辑（可单独单元测试）
 *
 * 该文件以 ES Module 形式编写；tools/build-userscript.mjs 会去掉 `export`
 * 关键字后内联进最终油猴脚本，因此这里不要使用 import / export 之外的模块语法。
 */

/** 视为「名字的一部分」的字符：平假名 / 片假名 / 汉字 / 全角半角英数 */
export const NAME_CHAR_RE = /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9fA-Za-z0-9]/;

/** 中日文字符（平假名 / 片假名 / 汉字 / 半角片假名） */
export const CJK_CHAR_RE = /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;

/** 拉丁词内字符（用于拉丁名两侧的词边界判断） */
export const LATIN_WORD_RE = /[A-Za-z0-9]/;

/**
 * 将单个字符从全角英数/空格/括号归一化为半角。
 * 归一化保持长度不变（1:1 字符映射），因此文本偏移量在归一化前后完全一致。
 * 主要解决 M-Team 标题中「ＡＩＫＡ」(全角) 与数据集中「AIKA」(半角) 不匹配的问题。
 */
export function normalizeChar(c) {
    const code = c.charCodeAt(0);
    // 全角数字 ０-９ (U+FF10-U+FF19) → 0-9
    if (code >= 0xFF10 && code <= 0xFF19) return String.fromCharCode(code - 0xFF10 + 0x30);
    // 全角大写 Ａ-Ｚ (U+FF21-U+FF3A) → A-Z
    if (code >= 0xFF21 && code <= 0xFF3A) return String.fromCharCode(code - 0xFF21 + 0x41);
    // 全角小写 ａ-ｚ (U+FF41-U+FF5A) → a-z
    if (code >= 0xFF41 && code <= 0xFF5A) return String.fromCharCode(code - 0xFF41 + 0x61);
    // 全角空格 (U+3000) → 半角空格
    if (code === 0x3000) return ' ';
    // 全角括号 （）→ ()
    if (code === 0xFF08) return '(';
    if (code === 0xFF09) return ')';
    return c;
}

/** 对整串文本做全角→半角归一化（长度不变） */
export function normalizeStr(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) out += normalizeChar(s[i]);
    return out;
}

/** index 处是否为「非名字字符」边界（越界视为边界） */
export function isBoundary(text, index) {
    if (index < 0 || index >= text.length) return true;
    return !NAME_CHAR_RE.test(text[index]);
}

/** 是否为「拉丁名」：不含中日文字符，且至少含一个英文字母 */
export function isLatinName(name) {
    return !CJK_CHAR_RE.test(name) && /[A-Za-z]/.test(name);
}

/** index 处是否为拉丁词的词边界（非字母数字，越界视为边界） */
export function isLatinWordBoundary(text, index) {
    if (index < 0 || index >= text.length) return true;
    return !LATIN_WORD_RE.test(text[index]);
}

/**
 * 构建 Aho-Corasick 自动机
 * @param {string[]} patterns 模式串（女优名）
 * @returns {{patterns: string[], size: number, scan: (text: string) => Array<{start:number,end:number,p:number}>}}
 */
export function buildAutomaton(patterns) {
    const nodes = [{ ch: Object.create(null), out: null }];
    const fail = [0];

    for (let p = 0; p < patterns.length; p++) {
        const s = patterns[p];
        let cur = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            let nx = nodes[cur].ch[c];
            if (nx === undefined) {
                nx = nodes.length;
                nodes.push({ ch: Object.create(null), out: null });
                fail.push(0);
                nodes[cur].ch[c] = nx;
            }
            cur = nx;
        }
        if (!nodes[cur].out) nodes[cur].out = [];
        nodes[cur].out.push(p);
    }

    // BFS 构造 fail 指针并合并输出
    const queue = [];
    for (const c in nodes[0].ch) {
        const u = nodes[0].ch[c];
        fail[u] = 0;
        queue.push(u);
    }
    while (queue.length) {
        const r = queue.shift();
        for (const c in nodes[r].ch) {
            const u = nodes[r].ch[c];
            let f = fail[r];
            while (f && nodes[f].ch[c] === undefined) f = fail[f];
            const g = nodes[f].ch[c];
            fail[u] = (g !== undefined && g !== u) ? g : 0;
            const fo = nodes[fail[u]].out;
            if (fo && fo.length) {
                nodes[u].out = nodes[u].out ? nodes[u].out.concat(fo) : fo.slice();
            }
            queue.push(u);
        }
    }

    return {
        patterns,
        size: nodes.length,
        /** 返回所有命中 [{start, end, p}]，end 为开区间 */
        scan(text) {
            const res = [];
            let cur = 0;
            for (let i = 0; i < text.length; i++) {
                const c = text[i];
                while (cur && nodes[cur].ch[c] === undefined) cur = fail[cur];
                const nx = nodes[cur].ch[c];
                cur = nx !== undefined ? nx : 0;
                const out = nodes[cur].out;
                if (out) {
                    for (let k = 0; k < out.length; k++) {
                        const p = out[k];
                        const len = patterns[p].length;
                        res.push({ start: i - len + 1, end: i + 1, p });
                    }
                }
            }
            return res;
        },
    };
}

/**
 * 过滤（最小长度 / 边界）并去除重叠（长优先）
 * @param {ReturnType<typeof buildAutomaton>} automaton
 * @param {string} text
 * @param {{minNameLength?:number, requireBoundary?:boolean}} [options]
 * @returns {Array<{start:number,end:number,p:number}>}
 */
export function pickMatches(automaton, text, options = {}) {
    const minLen = options.minNameLength == null ? 2 : options.minNameLength;
    const needBoundary = options.requireBoundary !== false;

    const raw = automaton.scan(text);
    if (!raw.length) return [];

    const filtered = [];
    for (const m of raw) {
        const name = automaton.patterns[m.p];
        if (name.length < minLen) continue;
        if (needBoundary) {
            if (isLatinName(name)) {
                // 拉丁名：两侧都必须是词边界，避免 "Ray" 命中 "BluRay" 这类词内子串
                if (!isLatinWordBoundary(text, m.start - 1) || !isLatinWordBoundary(text, m.end)) continue;
            } else {
                // 中日文名：日文没有词分隔符，只要不是两侧都被名字字符夹住即可放行
                const leftOk = isBoundary(text, m.start - 1);
                const rightOk = isBoundary(text, m.end);
                if (!leftOk && !rightOk) continue;
            }
        }
        filtered.push(m);
    }
    if (!filtered.length) return [];

    filtered.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const taken = [];
    for (const m of filtered) {
        let clash = false;
        for (const t of taken) {
            if (m.start < t.end && t.start < m.end) { clash = true; break; }
        }
        if (!clash) taken.push(m);
    }
    // 返回文档顺序，方便调用方按下标处理
    return taken.sort((a, b) => a.start - b.start);
}