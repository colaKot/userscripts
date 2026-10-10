#!/usr/bin/env node
/**
 * fetch-warashi-height.mjs
 * ---------------------------------------------------------------
 * 从 warashi-asian-pornstars.fr 爬取 AV 女优身高数据。
 *
 * 站点结构：
 *   列表页: /fr/s-2-2/pornostars-feminines/toutes/all/page/{N}  (98 页, 3524 女优)
 *   详情页: /fr/s-2-0/{slug}/pornostar-feminine-asiatique/{id}
 *   身高:   <p itemprop="height">...<span itemprop="value">162</span> cm
 *   日文名: <title>English Name - 日本名 - pornostar japonaise...
 *
 * 用法：
 *   node tools/fetch-warashi-height.mjs              # 全量爬取
 *   node tools/fetch-warashi-height.mjs --delay 500  # 每请求间隔毫秒
 *   node tools/fetch-warashi-height.mjs --resume     # 断点续传
 *
 * 产物：
 *   build/cache/warashi-height.jsonl  每行 {name, height, source, url}
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'build', 'cache');
const OUT = path.join(ROOT, 'build', 'cache', 'warashi-height.jsonl');
const LINKS_CACHE = path.join(ROOT, 'build', 'cache', 'warashi-links.json');

const BASE = 'https://warashi-asian-pornstars.fr';
const DELAY_MS = 400;
const RETRY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const opts = { delay: DELAY_MS, resume: true, maxPages: Infinity };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--delay') opts.delay = parseInt(argv[++i], 10) || DELAY_MS;
        else if (argv[i] === '--no-resume') opts.resume = false;
        else if (argv[i] === '--max-pages') opts.maxPages = parseInt(argv[++i], 10) || Infinity;
    }
    return opts;
}

async function fetchWithRetry(url, attempt = 0) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'MTeamHeightBot/1.1 (userscript data builder)' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } catch (err) {
        if (attempt >= RETRY) throw err;
        const backoff = 1000 * Math.pow(2, attempt);
        console.warn(`  ! 重试 ${url} (${err.message}) ${backoff}ms`);
        await sleep(backoff);
        return fetchWithRetry(url, attempt + 1);
    }
}

// ---- Phase 1: 爬取列表页，收集所有女优链接 ----
async function collectLinks(opts) {
    // 检查缓存
    if (opts.resume && fs.existsSync(LINKS_CACHE)) {
        const links = JSON.parse(fs.readFileSync(LINKS_CACHE, 'utf8'));
        console.log(`链接缓存已有 ${links.length} 个女优链接`);
        return links;
    }

    console.log('=== Phase 1: 爬取列表页 ===');
    const allLinks = [];
    const seen = new Set();

    for (let page = 1; page <= 98; page++) {
        const url = `${BASE}/fr/s-2-2/pornostars-feminines/toutes/all/page/${page}`;
        const html = await fetchWithRetry(url);

        // 提取女优链接: /fr/s-2-0/{slug}/pornostar-feminine-asiatique/{id}
        const matches = [...html.matchAll(/href="(\/fr\/s-2-0\/[^"]+\/pornostar-feminine-asiatique\/\d+)"/g)]
            .map(m => m[1]);

        let fresh = 0;
        for (const link of matches) {
            if (!seen.has(link)) {
                seen.add(link);
                allLinks.push(link);
                fresh++;
            }
        }

        process.stdout.write(`\r  列表页 ${page}/98  累计 ${allLinks.length} 个链接  (+${fresh})  `);
        if (page >= opts.maxPages) break;
        if (opts.delay) await sleep(opts.delay);
    }
    console.log('\n列表页爬取完成。');

    fs.writeFileSync(LINKS_CACHE, JSON.stringify(allLinks), 'utf8');
    console.log(`已缓存 ${allLinks.length} 个链接到 ${LINKS_CACHE}`);
    return allLinks;
}

// ---- Phase 2: 逐个爬取女优详情页，提取日文名和身高 ----
async function collectHeights(links, opts) {
    console.log('\n=== Phase 2: 爬取女优详情页 ===');

    // 加载已有缓存（断点续传）
    const results = [];
    const doneUrls = new Set();
    if (opts.resume && fs.existsSync(OUT)) {
        const lines = fs.readFileSync(OUT, 'utf8').split('\n');
        for (const line of lines) {
            const s = line.trim();
            if (!s) continue;
            try {
                const rec = JSON.parse(s);
                results.push(rec);
                doneUrls.add(rec.url);
            } catch {}
        }
        console.log(`断点续传：已有 ${results.length} 条记录`);
    }

    const total = links.length;
    let processed = 0;
    let withHeight = 0;
    const startedAt = Date.now();

    for (const link of links) {
        if (doneUrls.has(link)) {
            processed++;
            continue;
        }

        const url = `${BASE}${link}`;
        try {
            const html = await fetchWithRetry(url);

            // 提取日文名: <title>English - 日本名 - pornostar japonaise...
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            let jaName = null;
            if (titleMatch) {
                const parts = titleMatch[1].split(' - ');
                // 日文名通常在第二个部分
                for (const part of parts) {
                    const jaMatch = part.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]{2,10}/);
                    if (jaMatch && part.trim().length <= 12) {
                        jaName = part.trim();
                        break;
                    }
                }
            }

            // 提取身高: <span itemprop="value">162</span> cm
            const heightMatch = html.match(/itemprop="value"[^>]*>(\d{2,3})<\s*\/span>\s*cm/i);
            let height = null;
            if (heightMatch) {
                height = parseInt(heightMatch[1], 10);
                if (height < 130 || height > 200) height = null;
            }

            if (jaName && height) {
                const rec = { name: jaName, height, source: 'warashi', url: link };
                results.push(rec);
                withHeight++;
                // 追加写入缓存
                fs.appendFileSync(OUT, JSON.stringify(rec) + '\n', 'utf8');
            }
        } catch (err) {
            // 记录失败但不中断
            process.stdout.write(`\n  ! 失败 ${link}: ${err.message}\n`);
        }

        processed++;
        const pct = ((processed / total) * 100).toFixed(1);
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        process.stdout.write(`\r  ${processed}/${total} (${pct}%)  有身高 ${withHeight}  已用 ${elapsed}s  `);

        if (opts.delay) await sleep(opts.delay);
    }

    console.log('\n详情页爬取完成。');
    return results;
}

// ---- Main ----
async function main() {
    const opts = parseArgs(process.argv.slice(2));
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const links = await collectLinks(opts);
    console.log(`共 ${links.length} 个女优链接`);

    const results = await collectHeights(links, opts);

    // 统计
    console.log('\n=============================================');
    console.log(`总记录数: ${results.length}`);
    console.log(`有身高记录: ${results.filter(r => r.height).length}`);

    // 显示一些示例
    console.log('\n示例（前 20 条）:');
    for (const r of results.slice(0, 20)) {
        console.log(`  ${r.name} -> ${r.height}cm`);
    }
}

main().catch((e) => {
    console.error('\n失败:', e);
    process.exit(1);
});
