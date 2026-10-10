#!/usr/bin/env node
/**
 * build-userscript.mjs
 * ---------------------------------------------------------------
 * 把 tools/fetch-actress-height.mjs 产出的数据集注入油猴脚本模板，
 * 生成最终可安装的 dist/m-team-actress-height.user.js。
 *
 * 用法：
 *   node tools/build-userscript.mjs
 *
 * 输入：
 *   build/actress-height.json      { "三上悠亜": 159, ... }
 *   src/userscript.template.js     含 `/* @__DATA__ *\/ {}` 占位符的脚本模板
 * 输出：
 *   dist/m-team-actress-height.user.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DATA_FILE = path.join(ROOT, 'build', 'actress-height.json');
const TPL_FILE = path.join(ROOT, 'src', 'userscript.template.js');
const CORE_FILE = path.join(ROOT, 'src', 'core.mjs');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'm-team-actress-height.user.js');

const DATA_PLACEHOLDER = '/* @__DATA__ */ {}';
const CORE_PLACEHOLDER = '/* @__CORE__ */';

function main() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`缺少数据集：${DATA_FILE}\n请先运行：node tools/fetch-actress-height.mjs`);
        process.exit(1);
    }
    if (!fs.existsSync(TPL_FILE)) {
        console.error(`缺少模板：${TPL_FILE}`);
        process.exit(1);
    }
    if (!fs.existsSync(CORE_FILE)) {
        console.error(`缺少核心逻辑：${CORE_FILE}`);
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const tpl = fs.readFileSync(TPL_FILE, 'utf8');
    const core = fs.readFileSync(CORE_FILE, 'utf8');

    if (!tpl.includes(DATA_PLACEHOLDER)) {
        console.error(`模板中找不到数据占位符：${DATA_PLACEHOLDER}`);
        process.exit(1);
    }
    if (!tpl.includes(CORE_PLACEHOLDER)) {
        console.error(`模板中找不到核心逻辑占位符：${CORE_PLACEHOLDER}`);
        process.exit(1);
    }

    // 去掉 export 关键字后内联核心逻辑
    const coreInline = core
        .replace(/^\s*export\s+/gm, '')
        .replace(/^#!.*$/m, '');

    let out = tpl
        .replace(CORE_PLACEHOLDER, () => coreInline)
        .replace(DATA_PLACEHOLDER, () => JSON.stringify(data));

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, out, 'utf8');

    const count = Object.keys(data).length;
    const sizeKB = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
    console.log('---------------------------------------------');
    console.log(`内嵌女优数：${count}`);
    console.log(`输出：${OUT_FILE}  (${sizeKB} KB)`);
}

main();