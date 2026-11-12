# SAT/PSAT 考试界面图片尺寸优化方案

## 1. 问题分析

### 现象

考试预览/作答界面（`SatFormalExamPage.vue`）的题干材料图片过小。用户截图中的表格图片在 718px 宽的左侧阅读栏里只占 295px，文字几乎无法辨认。

### 根因

材料图片经 `renderMarkdown()` 渲染为 Markdown 图片节点，实际 CSS 规则只有：

```css
/* QuestionContent.vue */
.passage-content :deep(img) {
  margin: 4px auto;
  cursor: zoom-in;
}
.material-image img {
  max-width: 100%;
  height: auto;
}
```

`max-width: 100%` 是**上限约束**，只在小图超出容器时缩小，不会把小图放大。因此小尺寸上传的表格/图表截图（295×122）就按原始像素显示，在 718px 的栏宽里只占 41%，远低于可读尺寸。

实测（Playwright 在真实页面测量）：

| 项 | 值 |
| --- | --- |
| 左侧阅读栏宽 | 718 px |
| 材料图片渲染尺寸 | 295 × 122 px |
| 图片自然尺寸 | 295 × 122 px |

即渲染尺寸 = 自然尺寸，未被放大。

### 数据侧确认

数据库 `sat_materials.content` 中，图片均为**独占一段**的 Markdown 图片（`![...](...)` 单独成段），不存在行内插图或图文混排。因此把图片放宽到栏宽不会破坏行内排版。

## 2. 技术方案

### 目标

材料图片、题干图片、选项图片默认**放大到阅读栏宽度**，同时：

- 保持原始宽高比，不拉伸变形
- 超大图片加高度上限，避免单图占据多屏
- 保留点击放大预览能力

### 实现方式

纯 CSS 改动，不引入依赖、不改数据结构。

关键点：用 `width: 100%` 让图片主动撑满栏宽（这才是"放大"），再用 `max-height` + `object-fit: contain` 约束超高图片。

```css
.passage-content :deep(img),
.question-text :deep(img) {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: 70vh;
  object-fit: contain;
  margin: 10px auto;
}
```

`object-fit: contain` 保证被 `max-height` 裁到的超高图片是等比居中缩放，而非拉伸。

### 涉及文件与改动点

| 文件 | 选择器 | 说明 |
| --- | --- | --- |
| `src/examTypes/sat/student/components/exam/QuestionContent.vue` | `.passage-content :deep(img)` | 材料区图片（核心场景） |
| 同上 | `.question-text :deep(img)` | 无材料时的题干图片 |
| 同上 | `.material-image img` | `materialFileUrl` 直连材料图片 |
| `src/examTypes/sat/student/components/exam/AnswerOptions.vue` | `.options-title :deep(img)` | 右侧题干区图片 |

**选项内图片（`.option-text :deep(img)`）保持不变**：选项里的图片多为小图标或公式片段，强制撑满宽度会放大失真，保持原有 `max-width: 100%` + `max-height: 320px`。

PSAT 复用 `SatFormalExamPage.vue`（路由别名），一套改动同时覆盖 SAT 与 PSAT。

### 边界情况

| 情况 | 处理 |
| --- | --- |
| 小图（295×122） | 放大到栏宽（≈718px），文字可读 |
| 已是大图（1200px+） | 缩小到栏宽，不超出 |
| 超高竖图 | `max-height: 70vh` 截断并等比缩放 |
| 极宽横图 | `max-width: 100%` 兜底，等比缩小 |
| 图片加载失败 | 走既有 `handleInlineImageError` 回退，不受影响 |
| 高亮模式选中文字 | 既有逻辑显式排除 `img`，不受影响 |
| 点击放大预览 | `cursor: zoom-in` 与 `preview-image` 事件保持不变 |

### 不改动的部分

- 不改 `renderMarkdown()` 输出、不改后端数据、不改上传逻辑
- 不改选项文字字号与 `--exam-font-scale` 字体缩放机制
- 不改答题导航、计时器等无关 UI

## 3. 验收标准

1. 材料图片渲染宽度占满阅读栏（容差 ±2px）
2. 图片渲染宽高比与自然宽高比一致（比例误差 < 1%）
3. 超高图片高度不超过 70vh
4. 大图（1200px 宽）不超出栏宽
5. 点击图片仍能打开放大预览
6. `npm run build` 通过
7. 现有 `sat-formal-exam.cjs` 回归用例不失败

## 4. 验证方法

用 Playwright + 路由 mock 加载真实页面，测量 `.passage-content img` 的 `getBoundingClientRect()`，对比改动前后尺寸与宽高比，并截图留证。
