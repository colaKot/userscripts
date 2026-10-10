import fs from 'fs';
const data = JSON.parse(fs.readFileSync('build/actress-height.json', 'utf8'));

// Search for partial matches
const search = '成瀬';
for (const name of Object.keys(data)) {
    if (name.includes(search)) {
        console.log(`  "${name}": ${data[name]}cm`);
    }
}

// Also check the av-joyu-db cache
const cache = JSON.parse(fs.readFileSync('build/avjoyudb-cache.json', 'utf8'));
console.log('\n=== av-joyu-db cache entries with 成瀬 ===');
for (const [url, info] of Object.entries(cache.fetched)) {
    if (info.name.includes('成瀬')) {
        console.log(`  name: "${info.name}"`);
        console.log(`  cleanName: "${info.cleanName}"`);
        console.log(`  height: ${info.height}`);
        // Apply extractActualName logic
        let n = info.name.replace(/[（(][^）)]*[）)]/g, '').trim();
        const parts = n.split(/\s+/);
        console.log(`  parts: ${JSON.stringify(parts)}`);
        console.log(`  extracted: "${parts[0]}"`);
    }
}
