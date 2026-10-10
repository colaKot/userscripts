#!/usr/bin/env node
/**
 * fetch-actress-height.mjs
 * ---------------------------------------------------------------
 * 从 DMM / FANZA 公开的 ActressSearch API 采集『女优名 -> 身高』数据。
 *
 * 该 API 即 joyu.sexy 等站点的数据来源：
 *   https://api.dmm.com/affiliate/v3/ActressSearch
 *
 * 用法：
 *   node tools/fetch-actress-height.mjs                # 全量抓取（约 607 页）
 *   node tools/fetch-actress-height.mjs --hits 100     # 每页条数（API 上限 100）
 *   node tools/fetch-actress-height.mjs --delay 300    # 每请求间隔毫秒
 *   node tools/fetch-actress-height.mjs --resume       # 断点续传（默认开启缓存）
 *   node tools/fetch-actress-height.mjs --merge-only   # 只用缓存，不发请求
 *
 * 产物：
 *   build/cache/actress-raw.jsonl   原始记录缓存（每行一条 JSON，可断点续传）
 *   build/actress-height.json       最终数据集 { "三上悠亜": 159, ... }
 *
 * 说明：
 *   api_id / affiliate_id 默认沿用 joyu.sexy 的公开凭据。若你希望请求
 *   归属到自己的账号，可在下方 CONFIG 中替换为自申请的 DMM API 凭据
 *   （https://affiliate.dmm.com/api/ 免费申请）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG = {
    API: 'https://api.dmm.com/affiliate/v3/ActressSearch',
    API_ID: 'cKLxQzpehtWUh0bpBvTZ',   // 可替换为你自己的 api_id
    AFFILIATE_ID: 'joyusexy-990',      // 可替换为你自己的 affiliate_id
    HITS: 100,                         // API 单页上限
    DELAY_MS: 300,                     // 请求间隔，避免触发限流
    RETRY: 4,
    SORT: 'name',                      // 稳定排序，保证翻页不重不漏
    HEIGHT_MIN: 130,
    HEIGHT_MAX: 200,
    CACHE_DIR: path.join(ROOT, 'build', 'cache'),
    RAW_CACHE: path.join(ROOT, 'build', 'cache', 'actress-raw.jsonl'),
    OUT: path.join(ROOT, 'build', 'actress-height.json'),
};

// ---------------- 参数解析 ----------------
function parseArgs(argv) {
    const opts = { hits: CONFIG.HITS, delay: CONFIG.DELAY_MS, mergeOnly: false, resume: true, pages: Infinity };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--hits') opts.hits = Math.min(100, parseInt(argv[++i], 10) || 100);
        else if (a === '--pages') opts.pages = parseInt(argv[++i], 10) || Infinity;
        else if (a === '--delay') opts.delay = parseInt(argv[++i], 10) || 0;
        else if (a === '--merge-only') opts.mergeOnly = true;
        else if (a === '--no-resume') opts.resume = false;
        else if (a === '--resume') opts.resume = true;
    }
    return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- 读取已有缓存 ----------------
function loadCache() {
    const seenIds = new Set();
    const rows = [];
    if (!fs.existsSync(CONFIG.RAW_CACHE)) return { seenIds, rows, nextOffset: 1 };
    const lines = fs.readFileSync(CONFIG.RAW_CACHE, 'utf8').split('\n');
    for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
            const rec = JSON.parse(s);
            if (rec && rec.id != null) {
                if (seenIds.has(String(rec.id))) continue;
                seenIds.add(String(rec.id));
            }
            rows.push(rec);
        } catch {
            /* 忽略损坏行 */
        }
    }
    return { seenIds, rows, nextOffset: 1 };
}

function appendCache(recs) {
    fs.mkdirSync(path.dirname(CONFIG.RAW_CACHE), { recursive: true });
    const buf = recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(CONFIG.RAW_CACHE, buf, 'utf8');
}

// ---------------- 单页请求 ----------------
async function fetchPage(offset, hits, attempt = 0) {
    const url = new URL(CONFIG.API);
    url.searchParams.set('api_id', CONFIG.API_ID);
    url.searchParams.set('affiliate_id', CONFIG.AFFILIATE_ID);
    url.searchParams.set('output', 'json');
    url.searchParams.set('hits', String(hits));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', CONFIG.SORT);

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (userscript-data-builder)' },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        const result = json && json.result;
        if (!result) throw new Error('响应缺少 result 字段');
        if (String(result.status) !== '200') throw new Error('API status=' + result.status);
        return {
            total: parseInt(result.total_count, 10) || 0,
            list: result.actress || [],
        };
    } catch (err) {
        if (attempt >= CONFIG.RETRY) throw err;
        const backoff = 800 * Math.pow(2, attempt);
        console.warn(`  ! offset=${offset} 失败(${err.message})，${backoff}ms 后重试 (${attempt + 1}/${CONFIG.RETRY})`);
        await sleep(backoff);
        return fetchPage(offset, hits, attempt + 1);
    }
}

// ---------------- 主流程 ----------------
async function main() {
    const opts = parseArgs(process.argv.slice(2));
    fs.mkdirSync(CONFIG.CACHE_DIR, { recursive: true });

    const { seenIds, rows } = loadCache();
    console.log(`缓存已有记录：${rows.length} 条（去重后）`);

    if (!opts.mergeOnly) {
        console.log(`开始抓取：每页 ${opts.hits} 条，间隔 ${opts.delay}ms ...`);
        // 断点续传：已缓存 records 数即为已完整抓取的条数，从其后的整页边界继续
        let offset = opts.resume && rows.length > 0
            ? Math.floor(rows.length / opts.hits) * opts.hits + 1
            : 1;
        if (offset > 1) console.log(`断点续传：从 offset=${offset} 继续`);
        let total = Infinity;
        let page = 0;
        const startedAt = Date.now();

        while (offset <= total) {
            const { total: t, list } = await fetchPage(offset, opts.hits);
            total = t;
            page++;
            const fresh = [];
            for (const a of list) {
                const id = String(a.id);
                if (seenIds.has(id)) continue;
                seenIds.add(id);
                fresh.push(a);
            }
            if (fresh.length) {
                rows.push(...fresh);
                appendCache(fresh);
            }
            const done = Math.min(offset + opts.hits - 1, total);
            const pct = ((done / total) * 100).toFixed(1);
            process.stdout.write(
                `\r  第 ${page} 页  进度 ${done}/${total} (${pct}%)  累计 ${rows.length}  已用 ${((Date.now() - startedAt) / 1000).toFixed(0)}s   `,
            );
            if (list.length < opts.hits) break;
            if (page >= opts.pages) break;
            offset += opts.hits;
            if (opts.delay) await sleep(opts.delay);
        }
        console.log('\n抓取完成。');
    } else {
        console.log('--merge-only：仅使用缓存合并，不发起网络请求。');
    }

    // ---------------- 归并 name -> height ----------------
    /** @type {Map<string, Map<number, number>>} name -> (height -> 命中次数) */
    const tally = new Map();
    let withHeight = 0;

    for (const a of rows) {
        if (!a || !a.name) continue;
        const name = String(a.name).trim();
        if (!name) continue;

        const h = parseInt(a.height, 10);
        if (!Number.isFinite(h) || h < CONFIG.HEIGHT_MIN || h > CONFIG.HEIGHT_MAX) continue;

        withHeight++;
        if (!tally.has(name)) tally.set(name, new Map());
        const m = tally.get(name);
        m.set(h, (m.get(h) || 0) + 1);
    }

    /** @type {Record<string, number>} */
    const dataset = {};
    for (const [name, m] of tally) {
        let bestH = 0;
        let bestC = -1;
        // 同名词条取出现次数最多的身高；次数相同取较矮的（更常见的公开数据）
        for (const [h, c] of [...m.entries()].sort((x, y) => x[0] - y[0])) {
            if (c > bestC) {
                bestC = c;
                bestH = h;
            }
        }
        dataset[name] = bestH;
    }

    const names = Object.keys(dataset).sort((a, b) => a.localeCompare(b, 'ja'));
    const sorted = {};
    for (const n of names) sorted[n] = dataset[n];

    fs.mkdirSync(path.dirname(CONFIG.OUT), { recursive: true });
    fs.writeFileSync(CONFIG.OUT, JSON.stringify(sorted), 'utf8');

    const sizeKB = (fs.statSync(CONFIG.OUT).size / 1024).toFixed(1);
    console.log('---------------------------------------------');
    console.log(`原始条目：${rows.length}`);
    console.log(`含身高条目：${withHeight}`);
    console.log(`唯一女优名（去重）：${names.length}`);
    console.log(`输出：${CONFIG.OUT}  (${sizeKB} KB)`);
}

main().catch((e) => {
    console.error('\n抓取失败：', e);
    process.exit(1);
});