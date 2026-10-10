# 油猴脚本集合（Tampermonkey Userscripts）

个人编写 / 收集的 Tampermonkey 油猴脚本集合。每个脚本独立成节，可单独安装、单独维护，
后续新增的脚本会继续补充到下面的列表与章节里。

## 脚本列表

| 脚本 | 安装入口 | 说明 |
|------|----------|------|
| m-team 女优身高标注 + 列表大图 | [`dist/m-team-actress-height.user.js`](dist/m-team-actress-height.user.js) | 在 m-team 种子列表标题里给女优名追加身高，并增强列表大图 / 完整标题 |

> 部分脚本的「列表大图」等能力移植自第三方（见各章节末的致谢），均为 MIT 许可。

---

## m-team 女优身高标注 + 列表大图

在 m-team 种子列表/详情页标题里的女优名字后面追加身高，例如：

```
SSIS-001 三上悠亜 159cm 激しい中出演出
```

同时提供 **列表大图** 能力（移植自 XMXM 的「m-team 列表大图」，MIT）：

- **缩略图放大**：列表缩略图按短边 240 / 360 / 480px 等比缩放，可随时切换；
- **种子名完整显示**：被省略号 / line-clamp 截断的种子名自动放开，不再截断；
- **旧版界面 DMM 处理**：旧版 NexusPHP 界面下替换 DMM 缩略图并修正表格宽度。

身高数据来自 DMM / FANZA 公开的演员库（`ActressSearch` API，即 joyu.sexy 等站点的数据来源），
抓取后**内嵌进脚本**，运行时不需要联网、不发送任何请求。

### 快速开始

1. 运行构建（需要 Node.js 18+，依赖全局 `fetch`）：

   ```powershell
   # 1) 抓取全部「有身高」的女优（约 607 次分页请求，10 分钟左右，支持断点续传）
   node tools/fetch-actress-height.mjs

   # 2) 把数据集注入脚本模板
   node tools/build-userscript.mjs
   ```

2. 安装 `dist/m-team-actress-height.user.js` 到 Tampermonkey。

3. 打开 m-team 的浏览 / 搜索列表页即可看到身高标签，以及放大后的缩略图与完整种子名。
   右下角的统一面板可切换身高开关与大图尺寸。

> 不想自己抓数据？直接使用仓库里已构建好的 `dist/m-team-actress-height.user.js` 即可。

### 目录结构

```
├── src/
│   ├── core.mjs                    # 核心匹配逻辑（Aho-Corasick，可单独测试）
│   └── userscript.template.js      # 油猴脚本模板（身高标注 + 列表大图，含数据/核心逻辑占位符）
├── tools/
│   ├── fetch-actress-height.mjs    # 抓取 DMM 演员库 -> build/actress-height.json
│   ├── fetch-avjoyudb-height.mjs   # 抓取 av-joyu-db.com -> build/avjoyudb-cache.json
│   ├── fetch-warashi-height.mjs    # 抓取 warashi-asian-pornstars.fr
│   ├── fetch-wikidata-height.mjs   # 抓取 Wikidata
│   ├── merge-height-data.mjs       # 合并多个来源的身高数据
│   ├── build-userscript.mjs        # 注入数据集 -> dist/xxx.user.js
│   ├── test-matching.mjs           # 匹配逻辑单元测试
│   ├── test-dom.mjs                # 迷你 DOM 集成测试（真实执行构建产物）
│   └── test-fetch.mjs              # 抓取缓存数据检查
├── build/
│   ├── cache/                      # 抓取中间缓存（已 gitignore，支持断点续传）
│   └── actress-height.json         # 最终数据集 { "三上悠亜": 159, ... }
└── dist/
    └── m-team-actress-height.user.js   # 最终可安装脚本
```

### 工作原理

1. **取数**：`fetch-actress-height.mjs` 分页调用 `https://api.dmm.com/affiliate/v3/ActressSearch`
   （`hits=100`、`offset` 递增、`sort=name` 保证翻页稳定），只保留 `height` 合法的记录，
   按 `name` 归并成 `{ 女优名: 身高 }`。
2. **匹配**：脚本启动时用全部女优名构建 **Aho-Corasick 自动机**，对列表标题做一次线性扫描，
   多个名字可一次命中，复杂度 O(标题长度)，与女优数量无关。
3. **标注**：命中的名字后面用 `Range.insertNode` 插入一个 `<span>` 身高标签。
   从后往前插入，保证插入不会打乱前面命中的字符偏移。
4. **列表大图**：对缩略图按短边等比缩放；用 `getComputedStyle` 检测被截断的标题并打类放开。
   这几项与身高标注相互独立，在 MutationObserver 每次调度时一并处理。

### 匹配规则与调参

在脚本顶部的 `OPTIONS` 中调整：

| 配置 | 默认 | 说明 |
|------|------|------|
| `minNameLength` | `2` | 名字最短长度。太短的名字容易误伤（如单字名） |
| `requireBoundary` | `true` | 名字必须处于「词边界」才认（详见下方「边界规则」）。设为 `false` 召回更高但更易误判 |
| `suffixTemplate` | `' {h}cm'` | 身高显示模板，`{h}` 会替换为数字 |
| `extraSelectors` | `[]` | 额外需要扫描的容器选择器（如详情页标题） |
| `enablePanel` | `true` | 是否显示右下角统一面板（身高开关 + 大图尺寸） |

**匹配的目标元素**：`a[href*="/detail/"]`（新版界面）、`a[href*="details.php"]`（旧版界面）。

**边界规则**（`requireBoundary = true` 时）：

- **中日文名**：日文没有词分隔符，因此只要名字**不是两侧都被文字字符夹住**即可命中。
  例如 `三上悠亜と中出し` ✅、`【三上悠亜】` ✅，而 `超三上悠亜級美人` ❌。
- **拉丁名**：要求**两侧都是词边界**（邻接字符不能是字母或数字），避免命中别的单词内部。
  例如 `Ray 出演` ✅、`Ray中出し` ✅，而 `BluRay` ❌（不会误命中 `Ray`）。

**已知取舍**：

- 默认大小写敏感，ASCII 名字（如 `Lisa`）不会匹配 `LISA`。
- 汉字名字若**完全嵌在**另一段汉字中（两侧都是汉字，如「超三上悠亜級」）默认不匹配，
  以免误伤；把 `requireBoundary` 设为 `false` 可命中，但误判会增加。
- 同名女优取公开数据中出现次数最多的身高。

### 列表大图

以下功能移植自 XMXM 的「m-team 列表大图」（SleazyFork #495505，MIT License），已合并进同一个脚本。

**缩略图放大**：对 `.torrent-list__thumbnail` 的图片按**短边**等比缩放——横图压高度、竖图压宽度，
始终不拉伸变形。可选尺寸 `240 / 360 / 480`（短边像素），切换后立即重绘、无需刷新。

**种子名完整显示**：种子列表里的标题（`a[href*="/detail/"]` / `a[href*="details.php"]`）
若被 `text-overflow: ellipsis`、`-webkit-line-clamp` 或 mask 截断，脚本会用
`getComputedStyle` 检测出来并打上 `.mt-full-title` 类，配合注入的样式放开截断、允许换行。
同时覆盖新版界面已知的 Tailwind 结构，避免首屏闪烁。

**旧版界面 DMM 处理**：旧版 NexusPHP 界面下，把 `pics.dmm.co.jp` 的大图 URL 换成更小的
`xxxjp-1.jpg` 版本，并修正表格 / 列宽，去掉多余的 grid 布局。

**右下角统一面板**：身高开关与大图尺寸按钮合并为一个面板（`#mt-height-panel`），避免两个浮层互相遮挡。
点击 `×` 可关闭当前会话的面板。

**可调参数**（脚本顶部）：

| 常量 / 键 | 默认 | 说明 |
|-----------|------|------|
| `THUMB_SIZES` | `[240, 360, 480]` | 缩略图短边可选尺寸 |
| `localStorage['mt_big_thumb_size']` | `240` | 记住用户选择的缩略图尺寸 |
| `localStorage['mt_height_enabled']` | `1` | 记住身高标注开关状态 |

> 列表大图 / 完整标题 / 旧版处理**始终生效**，与身高开关无关；身高开关只控制身高标签的显示。

### 数据更新

DMM 演员库会持续新增，建议每隔几个月更新一次：

```powershell
node tools/fetch-actress-height.mjs --no-resume   # 忽略缓存，全量重抓
node tools/build-userscript.mjs
```

常用参数：

| 参数 | 说明 |
|------|------|
| `--hits N` | 每页条数，上限 100 |
| `--delay N` | 每次请求间隔毫秒，默认 300（调小更快，调大更稳） |
| `--pages N` | 只抓前 N 页（调试用） |
| `--merge-only` | 不发请求，只用缓存重新生成数据集 |
| `--no-resume` | 忽略缓存，从头抓取 |

### 测试

```powershell
# 匹配逻辑单元测试（含全量数据集冒烟测试，需先 build）
node tools/test-matching.mjs

# 迷你 DOM 集成测试：用最小 DOM 实现真实执行 dist 里的脚本，
# 验证「名字后面插入身高标签」的完整链路（含多名字、SPA 复用节点等场景）
node tools/test-dom.mjs
```

`test-matching.mjs` 覆盖：空格 / 标点 / 全角空格分隔、名字后紧跟假名、最长匹配去重叠、
最小长度过滤、边界判定、ASCII 大小写敏感、拉丁名词内子串回归（`Ray` / `BluRay`），
以及全量数据集的自动机构建与扫描性能。

`test-dom.mjs` 覆盖：标题锚点（新版 `/detail/` + 旧版 `details.php`）、名字后正确插入标签、
不打断原文字、非目标元素不标注、无命中不插入、单条标题多名字逐个插入；
以及合并进来的「列表大图」能力（缩略图等比缩放、`.mt-full-title` 放开截断、右下角统一面板）。

### 关于 API 凭据

抓取脚本默认沿用 joyu.sexy 的公开 `api_id` / `affiliate_id`。这只是数据来源标识，
不涉及账号密码。若你希望请求归属到自己的账号，可到
<https://affiliate.dmm.com/api/> 免费申请自己的 `api_id` / `affiliate_id`，
并替换 `tools/fetch-actress-height.mjs` 顶部的 `CONFIG`。

请控制抓取频率（默认已加 300ms 间隔），避免给数据源造成压力。

---

## 许可

本项目采用 MIT 许可，详见 [LICENSE](LICENSE)。