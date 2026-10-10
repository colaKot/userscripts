#!/usr/bin/env node
/**
 * test-matching.mjs — 核心匹配逻辑单元测试
 *
 * 用法：node tools/test-matching.mjs
 * 可用真实数据集做冒烟测试（若 build/actress-height.json 存在）。
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { buildAutomaton, pickMatches, isBoundary, isLatinName, isLatinWordBoundary, normalizeChar, normalizeStr } from '../src/core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'build', 'actress-height.json');

let passed = 0;
let failed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok  ${name}`);
    } catch (e) {
        failed++;
        console.error(`FAIL  ${name}\n      ${e.message}`);
    }
}

/** 便捷：返回命中的名字数组 */
function matchedNames(map, text, opts) {
    const ac = buildAutomaton(Object.keys(map));
    return pickMatches(ac, text, opts).map((m) => ac.patterns[m.p]);
}

console.log('--- 单元测试 ---');

// 1) 基础：名字前后有空格
test('空格分隔的名字可命中', () => {
    const map = { '三上悠亜': 159, '葵つかさ': 158 };
    assert.deepStrictEqual(matchedNames(map, 'SSIS-001 三上悠亜 中出し'), ['三上悠亜']);
});

// 2) 名字后面紧跟假名：左侧是边界，应命中
test('名字后紧跟假名（左侧边界）可命中', () => {
    const map = { '三上悠亜': 159 };
    assert.deepStrictEqual(matchedNames(map, '三上悠亜と中出し'), ['三上悠亜']);
});

// 3) 名字被标点包围
test('顿号/括号分隔可命中', () => {
    const map = { '三上悠亜': 159, '葵つかさ': 158 };
    assert.deepStrictEqual(matchedNames(map, '【三上悠亜】、葵つかさ、初共演'), ['三上悠亜', '葵つかさ']);
});

// 4) 默认不应命中子串（长度 < minNameLength）
test('长度为 1 的名字默认不命中', () => {
    const map = { '愛': 160, '愛田るか': 152 };
    assert.deepStrictEqual(matchedNames(map, '愛田るかの作品'), ['愛田るか']);
});

// 5) 长优先：同时命中两个前缀时取最长的
test('取最长匹配（不重叠）', () => {
    const map = { '三上': 159, '三上悠亜': 159 };
    assert.deepStrictEqual(matchedNames(map, '三上悠亜 出演'), ['三上悠亜']);
});

// 6) 名字完全嵌在汉字串中（两侧都是文字）默认不命中
test('嵌在长汉字串中默认不命中', () => {
    const map = { '三上悠亜': 159 };
    assert.deepStrictEqual(matchedNames(map, '超三上悠亜級美人'), []);
});

// 7) 关闭边界要求后可以命中
test('requireBoundary=false 时嵌入也能命中', () => {
    const map = { '三上悠亜': 159 };
    assert.deepStrictEqual(
        matchedNames(map, '超三上悠亜級美人', { requireBoundary: false }),
        ['三上悠亜'],
    );
});

// 8) 数字/字母属于文字，不算边界；但左侧有空格即可命中
test('数字紧邻名字（右侧非边界，左侧空格的边界）可命中', () => {
    const map = { '波多野結衣': 163 };
    assert.deepStrictEqual(matchedNames(map, '波多野結衣2 精选'), ['波多野結衣']);
});

// 9) ASCII 名字：大小写敏感
test('ASCII 名字大小写敏感', () => {
    const map = { Lisa: 160 };
    assert.deepStrictEqual(matchedNames(map, 'Lisa 登场'), ['Lisa']);
    assert.deepStrictEqual(matchedNames(map, 'LISA 登场'), []);
});

// 9b) 拉丁名不应命中别的拉丁单词内部（回归：Ray / BluRay）
test('拉丁名不命中词内子串（BluRay 不含 Ray）', () => {
    const map = { Ray: 164, Blu: 150 };
    assert.deepStrictEqual(matchedNames(map, 'HEYZO-0001 1080p BluRay x265 中文字幕'), []);
    assert.deepStrictEqual(matchedNames(map, 'xRay 影像'), []);
});

// 9c) 拉丁名独立成词可命中
test('拉丁名独立成词可命中', () => {
    const map = { Ray: 164 };
    assert.deepStrictEqual(matchedNames(map, 'Ray 出演'), ['Ray']);
    assert.deepStrictEqual(matchedNames(map, '【Ray】新作'), ['Ray']);
});

// 9d) 拉丁名后紧跟汉字仍可命中（右侧非字母数字）
test('拉丁名后紧跟汉字可命中', () => {
    const map = { Ray: 164 };
    assert.deepStrictEqual(matchedNames(map, 'Ray中出し'), ['Ray']);
});

// 9e) isLatinName / isLatinWordBoundary 直接判定
test('isLatinName / isLatinWordBoundary 逻辑', () => {
    assert.strictEqual(isLatinName('Ray'), true);
    assert.strictEqual(isLatinName('三上悠亜'), false);
    assert.strictEqual(isLatinName('あい'), false);
    const t = 'BluRay';
    assert.strictEqual(isLatinWordBoundary(t, 2), false);  // 'u' 是字母 → 不是边界
    assert.strictEqual(isLatinWordBoundary(t, 5), false);  // 'y' 是字母 → 不是边界
    assert.strictEqual(isLatinWordBoundary(t, 6), true);   // 越界 → 视为边界
    assert.strictEqual(isLatinWordBoundary('BluRay - 1', 6), true); // ' ' → 边界
});

// 10) 中文界面里多个名字、含全角空格
test('全角空格分隔多个名字', () => {
    const map = { '三上悠亜': 159, '橋本ありな': 160, '葵つかさ': 158 };
    assert.deepStrictEqual(
        matchedNames(map, '三上悠亜　葵つかさ　橋本ありな'),
        ['三上悠亜', '葵つかさ', '橋本ありな'],
    );
});

// 11) 不命中无关文本
test('无关文本不命中', () => {
    const map = { '三上悠亜': 159 };
    assert.deepStrictEqual(matchedNames(map, '1080p BluRay x265 10bit 中文字幕'), []);
});

// 12) isBoundary 边界判定
test('isBoundary 逻辑', () => {
    const t = 'a漢 1';
    assert.strictEqual(isBoundary(t, -1), true);   // 起始
    assert.strictEqual(isBoundary(t, t.length), true); // 结束
    assert.strictEqual(isBoundary(t, 0), false);   // 'a' 是文字
    assert.strictEqual(isBoundary(t, 1), false);   // '漢'
    assert.strictEqual(isBoundary(t, 2), true);    // 空格
    assert.strictEqual(isBoundary(t, 3), false);   // '1'
});

// 13) 全角→半角归一化
test('normalizeChar 全角英数空格括号归一化', () => {
    assert.strictEqual(normalizeChar('Ａ'), 'A');
    assert.strictEqual(normalizeChar('ｚ'), 'z');
    assert.strictEqual(normalizeChar('０'), '0');
    assert.strictEqual(normalizeChar('９'), '9');
    assert.strictEqual(normalizeChar('　'), ' ');
    assert.strictEqual(normalizeChar('（'), '(');
    assert.strictEqual(normalizeChar('）'), ')');
    // 非全角字符不变
    assert.strictEqual(normalizeChar('A'), 'A');
    assert.strictEqual(normalizeChar('漢'), '漢');
    assert.strictEqual(normalizeChar('あ'), 'あ');
    assert.strictEqual(normalizeChar('-'), '-');
});

test('normalizeStr 保持长度且逐字符归一化', () => {
    assert.strictEqual(normalizeStr('ＡＩＫＡ'), 'AIKA');
    assert.strictEqual(normalizeStr('ＡＩＫＡ（三浦あいか）'), 'AIKA(三浦あいか)');
    assert.strictEqual(normalizeStr('クリスチャン　リー'), 'クリスチャン リー');
    assert.strictEqual(normalizeStr('三上悠亜'), '三上悠亜'); // 纯假名/汉字不变
    // 长度不变
    assert.strictEqual(normalizeStr('ＡＩＫＡ').length, 'ＡＩＫＡ'.length);
    assert.strictEqual(normalizeStr('　').length, 1);
});

// 14) 归一化后全角名可命中半角文本，反之亦然
test('归一化后全角/半角互通匹配', () => {
    // 数据集中用全角，标题中用半角
    const map = { 'ＡＩＫＡ': 152 };
    const names = Object.keys(map).map(normalizeStr);
    const ac = buildAutomaton(names);
    const hits = pickMatches(ac, normalizeStr('SSIS-001 AIKA 中出し'), { minNameLength: 2, requireBoundary: true });
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(ac.patterns[hits[0].p], 'AIKA');

    // 数据集中用半角，标题中用全角
    const map2 = { AIKA: 152 };
    const names2 = Object.keys(map2).map(normalizeStr);
    const ac2 = buildAutomaton(names2);
    const hits2 = pickMatches(ac2, normalizeStr('SSIS-001 ＡＩＫＡ 中出し'), { minNameLength: 2, requireBoundary: true });
    assert.strictEqual(hits2.length, 1);
    assert.strictEqual(ac2.patterns[hits2[0].p], 'AIKA');
});

// 15) 归一化后含全角括号的名字可命中半角括号文本
test('归一化后全角括号名字可匹配', () => {
    const map = { 'AIKA（三浦あいか）': 152 };
    const names = Object.keys(map).map(normalizeStr);
    const ac = buildAutomaton(names);
    // 标题中用半角括号
    const hits = pickMatches(ac, normalizeStr('AIKA(三浦あいか) 作品'), { minNameLength: 2, requireBoundary: true });
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(ac.patterns[hits[0].p], 'AIKA(三浦あいか)');
});

// ---------------- 真实数据冒烟测试 ----------------
if (fs.existsSync(DATA_FILE)) {
    console.log('\n--- 真实数据集冒烟测试 ---');
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const names = Object.keys(data);
    console.log(`  数据集条数：${names.length}`);

    test(`构建自动机（${names.length} 个模式串）`, () => {
        const t0 = Date.now();
        const ac = buildAutomaton(names);
        const ms = Date.now() - t0;
        console.log(`      自动机节点数 ${ac.size}，构建耗时 ${ms}ms`);
        assert.ok(ac.size > names.length);
    });

    test('对典型标题扫描不报错且有合理结果', () => {
        const ac = buildAutomaton(names);
        const titles = [
            'SSIS-001 三上悠亜 激しい中出し',
            'ABP-123 【葵つかさ】初めての体験',
            'MIDV-999 1080p BluRay x265 中文字幕',
        ];
        for (const t of titles) {
            const hits = pickMatches(ac, t, { minNameLength: 2, requireBoundary: true });
            console.log(`      「${t}」 -> ${hits.map((h) => ac.patterns[h.p] + '(' + data[ac.patterns[h.p]] + ')').join(', ') || '(无)'}`);
        }
    });

    test('全量扫描性能（100 个标题 < 200ms）', () => {
        const ac = buildAutomaton(names);
        const title = 'SSIS-001 三上悠亜 葵つかさ 橋本ありな 特典映像 中文字幕 1080p';
        const t0 = Date.now();
        for (let i = 0; i < 100; i++) pickMatches(ac, title, { minNameLength: 2, requireBoundary: true });
        const ms = Date.now() - t0;
        console.log(`      100 次扫描耗时 ${ms}ms（${(ms / 100).toFixed(2)}ms/次）`);
        assert.ok(ms < 200, `扫描过慢：${ms}ms`);
    });

    test('归一化后模式串数量与去重效果', () => {
        const normalized = names.map(normalizeStr);
        const uniqueNorm = new Set(normalized);
        const dupCount = normalized.length - uniqueNorm.size;
        console.log(`      原始名 ${names.length}，归一化后去重 ${uniqueNorm.size}（合并 ${dupCount} 个重复）`);
        assert.ok(uniqueNorm.size > 0);
        assert.ok(uniqueNorm.size <= names.length);
    });

    test('归一化对全角标题的识别提升', () => {
        // 构建归一化后的自动机
        const normNames = [...new Set(names.map(normalizeStr))];
        const acNorm = buildAutomaton(normNames);

        // 找一个数据集中含全角英数的名字，构造全角/半角两种标题
        const fullWidthName = names.find((n) => /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/.test(n));
        if (fullWidthName) {
            const halfWidthName = normalizeStr(fullWidthName);
            // 半角标题（归一化后应命中）
            const hitsHalf = pickMatches(acNorm, normalizeStr(`作品 ${halfWidthName} 出演`), { minNameLength: 2, requireBoundary: true });
            // 全角标题（归一化后也应命中）
            const hitsFull = pickMatches(acNorm, normalizeStr(`作品 ${fullWidthName} 出演`), { minNameLength: 2, requireBoundary: true });
            console.log(`      全角名「${fullWidthName}」→ 半角「${halfWidthName}」`);
            console.log(`      半角标题命中 ${hitsHalf.length}，全角标题命中 ${hitsFull.length}`);
            assert.ok(hitsHalf.length >= 1, '半角标题应命中');
            assert.ok(hitsFull.length >= 1, '全角标题应命中');
        } else {
            console.log('      数据集中无全角英数名字，跳过');
        }
    });
} else {
    console.log('\n（跳过真实数据测试：build/actress-height.json 不存在）');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);