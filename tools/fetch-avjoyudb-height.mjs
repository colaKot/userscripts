#!/usr/bin/env node
/**
 * Crawl av-joyu-db.com for actress height data.
 *
 * Strategy:
 * 1. Fetch 4 height-category pages to get all actress URLs + names
 * 2. Crawl each profile page to extract exact height from <dl> element
 * 3. Save to build/avjoyudb-cache.json
 *
 * Usage: node tools/fetch-avjoyudb-height.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';

const CACHE_PATH = 'build/avjoyudb-cache.json';
const DELAY_MS = 200; // be polite
const HEIGHT_RANGES = ['-150', '150-160', '160-170', '170-'];

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Load existing cache for resume */
function loadCache() {
    if (existsSync(CACHE_PATH)) {
        try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch {}
    }
    return { fetched: {}, pending: [], phase: 1 };
}

function saveCache(cache) {
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

/** Extract actress names and URLs from a height-category page */
async function fetchHeightCategory(range) {
    const url = `https://av-joyu-db.com/actresses/height/${range}/`;
    const res = await fetch(url);
    const html = await res.text();

    // Parse all <a> tags linking to individual actress pages
    // JSON-LD only has 30 entries; the full page has all actresses
    const linkMatches = [...html.matchAll(/<a[^>]*href="(\/actresses\/[^"?]+\/)"[^>]*>([\s\S]*?)<\/a>/gi)]
        .filter(m => !m[1].includes('/height/') && !m[1].includes('/cup/') && !m[1].includes('/kana/') && !m[1].includes('/era/'));

    const actresses = [];
    for (const m of linkMatches) {
        const name = m[2].replace(/<[^>]+>/g, '').trim();
        if (name && name.length > 0 && name.length < 80) {
            actresses.push({ name, url: 'https://av-joyu-db.com' + m[1] });
        }
    }

    // Deduplicate by URL
    const seen = new Set();
    return actresses.filter(a => {
        if (seen.has(a.url)) return false;
        seen.add(a.url);
        return true;
    });
}

/** Extract exact height from a profile page */
function extractHeight(html) {
    // Method 1: <dl> element with 身長
    const dlMatches = [...html.matchAll(/<dl[^>]*>([\s\S]*?)<\/dl>/gi)];
    for (const m of dlMatches) {
        const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const heightMatch = text.match(/身長\s*(\d{3})\s*cm/);
        if (heightMatch) return parseInt(heightMatch[1]);
    }

    // Method 2: JSON-LD FAQ
    const jsonldMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of jsonldMatches) {
        try {
            const data = JSON.parse(m[1]);
            if (data['@type'] === 'FAQPage' && data.mainEntity) {
                for (const q of data.mainEntity) {
                    if (q.name && q.name.includes('身長') && q.acceptedAnswer) {
                        const hm = q.acceptedAnswer.text.match(/身長\s*(\d{3})\s*cm/);
                        if (hm) return parseInt(hm[1]);
                    }
                }
            }
        } catch {}
    }

    // Method 3: raw 身長 pattern
    const hm = html.match(/身長[：:\s]*(\d{3})\s*(?:cm|㎝)?/);
    if (hm) return parseInt(hm[1]);

    return null;
}

/** Clean actress name: remove aliases in parentheses */
function cleanName(name) {
    // Remove content in parentheses: "成瀬心美（ここみ）" -> "成瀬心美"
    // But keep the main name
    return name.replace(/[（(][^）)]*[）)]/g, '').trim();
}

async function main() {
    let cache = loadCache();
    if (!cache.fetched) cache.fetched = {};
    if (!cache.pending) cache.pending = [];
    if (!cache.phase) cache.phase = 1;

    // Phase 1: Collect actress URLs from height category pages
    if (cache.phase === 1) {
        console.log('=== Phase 1: Fetching height category pages ===');
        const allActresses = [];
        for (const range of HEIGHT_RANGES) {
            console.log(`Fetching range ${range}...`);
            const actresses = await fetchHeightCategory(range);
            console.log(`  found ${actresses.length} actresses`);
            for (const a of actresses) {
                a.range = range;
                allActresses.push(a);
            }
            await sleep(500);
        }

        // Deduplicate by URL
        const seen = new Set();
        const unique = allActresses.filter(a => {
            if (seen.has(a.url)) return false;
            seen.add(a.url);
            return true;
        });
        console.log(`Total unique actresses: ${unique.length}`);

        // Build pending list (skip already fetched)
        cache.pending = unique.filter(a => !cache.fetched[a.url]);
        cache.phase = 2;
        saveCache(cache);
        console.log(`Phase 1 done. ${cache.pending.length} profiles to fetch.`);
    }

    // Phase 2: Crawl individual profile pages (concurrent batches)
    if (cache.phase === 2) {
        const CONCURRENCY = 5;
        console.log(`\n=== Phase 2: Crawling ${cache.pending.length} profiles (concurrency=${CONCURRENCY}) ===`);
        let count = 0;
        let found = 0;
        const total = cache.pending.length;

        async function fetchOne(actress) {
            try {
                const res = await fetch(actress.url);
                if (res.ok) {
                    const html = await res.text();
                    const height = extractHeight(html);
                    const cleanN = cleanName(actress.name);
                    return {
                        url: actress.url,
                        data: { name: actress.name, cleanName: cleanN, height, range: actress.range },
                    };
                }
                return { url: actress.url, data: { name: actress.name, cleanName: cleanName(actress.name), height: null, range: actress.range, error: `HTTP ${res.status}` } };
            } catch (e) {
                return { url: actress.url, data: { name: actress.name, cleanName: cleanName(actress.name), height: null, range: actress.range, error: e.message } };
            }
        }

        // Process in batches of CONCURRENCY
        for (let i = 0; i < cache.pending.length; i += CONCURRENCY) {
            const batch = cache.pending.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(fetchOne));
            for (const r of results) {
                cache.fetched[r.url] = r.data;
                if (r.data.height) found++;
                count++;
            }
            if (count % 100 < CONCURRENCY || count === total) {
                console.log(`  ${count}/${total} fetched, ${found} with height`);
                saveCache(cache);
            }
            await sleep(DELAY_MS);
        }

        cache.pending = [];
        cache.phase = 3;
        saveCache(cache);
        console.log(`Phase 2 done. ${found} actresses with height data.`);
    }

    // Summary
    const entries = Object.values(cache.fetched);
    const withHeight = entries.filter(e => e.height);
    console.log(`\n=== Summary ===`);
    console.log(`Total fetched: ${entries.length}`);
    console.log(`With height: ${withHeight.length}`);
    console.log(`Without height: ${entries.length - withHeight.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
