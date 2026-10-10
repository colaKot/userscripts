#!/usr/bin/env node
/**
 * fetch-wikidata-height.mjs
 * ---------------------------------------------------------------
 * 从 Wikidata SPARQL 端点批量获取 AV 女优身高数据。
 *
 * Wikidata 中 AV 女优的职业标识：
 *   Q488111   — pornographic actor
 *   Q10891148 — AV idol (日本)
 *
 * 用法：
 *   node tools/fetch-wikidata-height.mjs
 *
 * 产物：
 *   build/cache/wikidata-height.jsonl   每行一条 {name, height, source}
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'build', 'cache');
const OUT = path.join(ROOT, 'build', 'cache', 'wikidata-height.jsonl');

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

// 查询：职业为 AV 女优 / pornographic actor，且有身高 (P2044)
// 同时获取日文标签 (P1448 或 label) 和别名
const SPARQL_QUERY = `
SELECT DISTINCT ?item ?nameJa ?nameEn ?height WHERE {
  {
    ?item wdt:P106 wd:Q488111 .
  } UNION {
    ?item wdt:P106 wd:Q10891148 .
  }
  ?item wdt:P2044 ?height .
  OPTIONAL { ?item rdfs:label ?nameJa . FILTER(LANG(?nameJa) = "ja") }
  OPTIONAL { ?item rdfs:label ?nameEn . FILTER(LANG(?nameEn) = "en") }
  FILTER(BOUND(?nameJa))
}
LIMIT 10000
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWikidata() {
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    console.log('向 Wikidata SPARQL 端点发送查询...');
    console.log('（首次请求可能需要 30-60 秒）');

    const url = new URL(SPARQL_ENDPOINT);
    url.searchParams.set('query', SPARQL_QUERY);
    url.searchParams.set('format', 'json');

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'MTeamHeightBot/1.0 (userscript data builder)',
            'Accept': 'application/sparql-results+json',
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = await res.json();
    const bindings = json.results?.bindings || [];
    console.log(`Wikidata 返回 ${bindings.length} 条记录`);

    // 去重：同名取最常见身高
    const tally = new Map(); // name -> Map<height, count>

    for (const b of bindings) {
        const name = b.nameJa?.value;
        if (!name) continue;
        const heightRaw = b.height?.value;
        if (!heightRaw) continue;

        // Wikidata 身高单位是米（如 1.59），转成 cm
        let h = parseFloat(heightRaw);
        if (h < 10) h = Math.round(h * 100); // 米 → cm
        else h = Math.round(h); // 已经是 cm

        if (h < 130 || h > 200) continue;

        if (!tally.has(name)) tally.set(name, new Map());
        const m = tally.get(name);
        m.set(h, (m.get(h) || 0) + 1);
    }

    // 写入缓存
    const records = [];
    for (const [name, m] of tally) {
        let bestH = 0, bestC = -1;
        for (const [h, c] of [...m.entries()].sort((x, y) => x[0] - y[0])) {
            if (c > bestC) { bestC = c; bestH = h; }
        }
        records.push({ name, height: bestH, source: 'wikidata' });
    }

    records.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    const buf = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(OUT, buf, 'utf8');

    console.log(`写入 ${records.length} 条记录到 ${OUT}`);
    console.log(`示例：`);
    for (const r of records.slice(0, 10)) {
        console.log(`  ${r.name} -> ${r.height}cm`);
    }

    return records;
}

fetchWikidata().catch((e) => {
    console.error('失败:', e.message);
    process.exit(1);
});
