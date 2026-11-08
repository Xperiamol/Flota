## 画布原语手册

格式：
{"title":"可选","layout":{"type":"stack.v","gap":32},"children":[],"connectors":[{"from":"id","to":"id","label":"可选","dashed":false,"curve":false}]}
- 顶层 title 会渲染成画布最上方的大标题；children 里已经自己写了标题时不要再填顶层 title，避免重复

容器：
- stack.v / stack.h / grid：props 可含 gap、padding、align、cols、w、bg；stack.h 还可用 justify(start|center|end|between|stretch)，stretch 让未写 w 的块级子节点等宽填满整行
- canvas：自由构图，props {w,h?,bg?,allowOverlap?}，children 的 props 可含局部 x,y,w。适合海报、杂志式信息图，内容仍自动测量，不得重叠或越界。结构图优先 graph 或 stack/grid。
- graph：props 含 direction("TB"|"LR")、edges、nodeMaxW、nodeGap、layerGap；edges/connectors 可选 label、dashed、tone、curve（true 为圆滑曲线，默认直角折线）；children 中节点必须有 props.id
- group：props 含 title、tone、padding、gap、dashed
- screen：props 含 device、title；适合界面原型

内容：
- text {content,level,fontSize?,color?,align?,w?}；card {title,body,tone?,fill?,stroke?,titleColor?,bodyColor?,titleSize?,bodySize?,padding?,w?}；list {items}
- rect {w,h,fill,stroke,strokeWidth?,rounded?}；ellipse {w,h,fill,stroke} 用作克制的视觉装饰
- callout {text,tone}；badge {text,tone}；icon {symbol:emoji 或单个符号如 🚲 ★ ✓,size}
- table {headers,rows}；input {label,placeholder}；button {label,variant}
- avatar {label,size}；divider；image {label,ratio}
- stat {value,unit?,label?,delta?,trend?(up|down|flat),tone?,size?(数值字号，默认 36),align?,plain?}：关键数字
- progress {value,max?,label?,tone?,showValue?,valueText?,barH?}：进度条
- chart {kind:bar|line|donut, data:[{label,value,tone?}] 或 labels+series:[{name,values,tone?}], title?, unit?, showValues?, max?, h?, smooth?, centerText?}：原生图元绘制的图表；单组数据默认同色，逐项 tone 可强调某一项
- timeline {items:[{time,title,body?,tone?}], direction?(v|h)}；steps {items:[字符串或{title,body?}], current?, direction?(h|v), tone?}
- quote {text,author?,tone?,size?(数字字号),plain?}
- svg {source,w?,h?}：完整的 <svg>…</svg> 源码，必须有 viewBox，不用 script、foreignObject、外链和 style 标签；插画、氛围图用它，生成后不能拆分编辑
- stack.h / grid 加 align:"stretch" 时同一行带底框的子节点等高（stack.h 默认 center 垂直居中）
- 带底框的原语（card/group/stat/callout/quote/list/table/rect/badge/button/input/progress 等）都可加 radius（圆角像素，0 为直角）；默认外层大、内层小，统一风格时再改
- tone 可选：primary、success、warning、danger、accent、info、neutral

原则：
1. 结构、步骤和关系用可编辑原生节点；局部插画、场景图、装饰性视觉可穿插 svg，不必二选一。
2. 流程、依赖和层级关系放进 graph，不手算位置；其余用容器自动排版。
3. 先在内部确定信息层级与构图，再输出：一个清晰主视觉，标题/关键数字/正文有明显尺度差异；统一对齐轴与留白节奏。按内容选择节点数量，不凑卡片。默认现代编辑设计：中性底色、一个强调色、细边框、充足留白；用户指定风格优先，不强制蓝紫配色或圆角卡片。
4. SVG 最多 4 个，每个只画一块局部视觉；结构和文字用原生节点。纯结构图或用户要求可拆分时可不用 SVG。
5. 文字简短、具体，来自用户素材；没有的数据不要编造。浅底用深字、深底用浅字，正文对比度至少 4.5:1。
6. 原生 fill/stroke/bg/color 使用 #RGB、#RRGGBB、rgb() 或 transparent；不能填 CSS 渐变、变量或颜色对象。渐变使用 svg 原语。
