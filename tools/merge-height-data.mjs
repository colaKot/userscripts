#!/usr/bin/env node
/**
 * Merge height data from multiple sources into build/actress-height.json.
 *
 * Sources (in priority order):
 *   1. build/actress-height.json (existing, highest priority)
 *   2. build/avjoyudb-cache.json (av-joyu-db.com)
 *   3. build/cache/warashi-height.jsonl (warashi-asian-pornstars.fr)
 *
 * Name matching:
 *   - Exact match on Japanese name
 *   - Match after removing parentheses/aliases
 *   - Match after fullwidth↔halfwidth normalization
 *
 * Usage: node tools/merge-height-data.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const EXISTING_PATH = path.join(ROOT, 'build', 'actress-height.json');
const AVJOYUDB_PATH = path.join(ROOT, 'build', 'avjoyudb-cache.json');
const WARASHI_PATH = path.join(ROOT, 'build', 'cache', 'warashi-height.jsonl');

/** Normalize a name for matching: remove spaces, parens content, fullwidth→halfwidth */
function normalizeName(name) {
    return name
        .replace(/[（(][^）)]*[）)]/g, '') // remove parenthesized content
        .replace(/[\s\u3000]/g, '')        // remove spaces
        .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) // fullwidth→halfwidth
        .trim();
}

/**
 * Extract the actual actress name from av-joyu-db list page text.
 * List page format: "actualName reading studio works [引退]"
 * e.g. "成瀬心美（ここみ） なるせここみ（ここみ） IDEAPOCKET 主要631本" → "成瀬心美"
 *      "奥田咲 おくださき S1 主要606本" → "奥田咲"
 * Strategy: take the first space-separated token, then remove parens content.
 * For Latin names (no CJK), take the first token before the reading/studio.
 */
function extractActualName(rawName) {
    // Remove parenthesized content first
    let name = rawName.replace(/[（(][^）)]*[）)]/g, '').trim();
    // Split by spaces
    const parts = name.split(/\s+/);
    if (parts.length <= 1) return name;

    // The first part is usually the actual name
    // But check if it's just a reading (all hiragana/katakana) — if so, the name might be Latin
    const first = parts[0];
    const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(first);
    if (isCJK) {
        return first;
    }

    // For Latin names: take everything before the first hiragana/katakana reading or studio marker
    // Studio names are typically uppercase Latin (S1, MOODYZ, IDEAPOCKET, etc.)
    // Readings are hiragana/katakana
    const result = [];
    for (const part of parts) {
        // Stop at hiragana/katakana reading
        if (/^[\u3040-\u309f\u30a0-\u30ff]+$/.test(part)) break;
        // Stop at studio names (all uppercase Latin, or known studios)
        if (/^[A-Z0-9\-]+$/.test(part) && part.length > 1) break;
        // Stop at "主要" or "引退"
        if (part === '主要' || part === '引退') break;
        result.push(part);
    }
    return result.length > 0 ? result.join(' ') : first;
}

/** Check if a name looks like a bad merged entry (contains studio/work info) */
function isBadName(name) {
    return /\s(主要|引退|MOODYZ|IDEAPOCKET|S1|OPPAI|E-BODY|Madonna|MAXING|WANZ|kawaii|BAZOOKA|CRYSTAL|DASS)\b/.test(name)
        || /主要\d+本/.test(name);
}

/** Load existing dataset */
function loadExisting() {
    const data = JSON.parse(fs.readFileSync(EXISTING_PATH, 'utf8'));
    // data is { "actressName": height, ... }
    return data;
}

/** Load av-joyu-db cache */
function loadAvJoyuDb() {
    if (!fs.existsSync(AVJOYUDB_PATH)) return [];
    const cache = JSON.parse(fs.readFileSync(AVJOYUDB_PATH, 'utf8'));
    const entries = [];
    for (const [url, info] of Object.entries(cache.fetched || {})) {
        if (info.height && info.name) {
            const actualName = extractActualName(info.name);
            if (actualName && actualName.length >= 2) {
                entries.push({ name: actualName, height: info.height, source: 'av-joyu-db' });
            }
        }
    }
    return entries;
}

/** Load warashi cache (JSONL format) */
function loadWarashi() {
    if (!fs.existsSync(WARASHI_PATH)) return [];
    const lines = fs.readFileSync(WARASHI_PATH, 'utf8').trim().split('\n');
    const entries = [];
    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            if (obj.height && obj.name) {
                entries.push({ name: obj.name, height: obj.height, source: 'warashi' });
            }
        } catch {}
    }
    return entries;
}

function main() {
    let existing = loadExisting();
    console.log(`Existing dataset: ${Object.keys(existing).length} entries`);

    // Clean up bad entries from previous merge (names with studio/work info)
    let removed = 0;
    for (const name of Object.keys(existing)) {
        if (isBadName(name)) {
            delete existing[name];
            removed++;
        }
    }
    if (removed > 0) {
        console.log(`Removed ${removed} bad entries from previous merge`);
        console.log(`Clean dataset: ${Object.keys(existing).length} entries`);
    }

    const avjoyu = loadAvJoyuDb();
    console.log(`av-joyu-db entries with height: ${avjoyu.length}`);

    const warashi = loadWarashi();
    console.log(`warashi entries with height: ${warashi.length}`);

    // Build normalized lookup of existing names
    const existingNormMap = new Map(); // normalized name -> original name
    for (const name of Object.keys(existing)) {
        existingNormMap.set(normalizeName(name), name);
    }

    // Merge new entries
    let added = 0;
    let skipped = 0;
    const newEntries = [];

    function tryAdd(name, height, source) {
        const norm = normalizeName(name);
        if (!norm || norm.length < 2) return;

        // Check if already in dataset (by exact or normalized name)
        if (existing[name] !== undefined) {
            skipped++;
            return;
        }
        if (existingNormMap.has(norm)) {
            skipped++;
            return;
        }

        // New entry!
        existing[name] = height;
        existingNormMap.set(norm, name);
        newEntries.push({ name, height, source });
        added++;
    }

    // Add av-joyu-db entries first (higher quality - exact heights)
    for (const e of avjoyu) {
        tryAdd(e.name, e.height, e.source);
    }

    // Then warashi entries
    for (const e of warashi) {
        tryAdd(e.name, e.height, e.source);
    }

    console.log(`\n=== Merge Results ===`);
    console.log(`Added: ${added}`);
    console.log(`Skipped (already exist): ${skipped}`);
    console.log(`Total dataset: ${Object.keys(existing).length}`);

    if (added > 0) {
        // Sort by name for consistent output
        const sorted = {};
        const names = Object.keys(existing).sort();
        for (const n of names) sorted[n] = existing[n];
        fs.writeFileSync(EXISTING_PATH, JSON.stringify(sorted, null, 0));
        console.log(`\nSaved to ${path.relative(ROOT, EXISTING_PATH)}`);

        // Show sample of new entries
        console.log(`\nSample new entries:`);
        for (const e of newEntries.slice(0, 20)) {
            console.log(`  ${e.name}: ${e.height}cm (${e.source})`);
        }
        if (newEntries.length > 20) {
            console.log(`  ... and ${newEntries.length - 20} more`);
        }
    } else {
        console.log('No new entries to add.');
    }
}

main();
