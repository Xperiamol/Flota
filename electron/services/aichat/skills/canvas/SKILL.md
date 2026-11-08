# canvas

画布内容由你直接写出，工具只负责排版和渲染，不会再替你规划：
- 结构化内容（看板、卡片、步骤、时间线、对比、思维导图、海报等）：create_whiteboard 的 canvas 传原语树（手册见下文），对象直接放进参数，不要写成字符串
- 时序图、类图、状态图、ER 图：mermaid 传 Mermaid 源码
- 提交时会先实际渲染一次。报错会原样返回（哪个节点、什么值、为什么），照着改了再调用同一个工具；通过后生成确认卡，用户确认后才写入
- 返回里的 rendered 是渲染后的尺寸和元素数；附图时是实际效果图，发现排版、配色或信息问题就再提交修正版。只有确实需要改时才重交
- 修正版会替换同一画布的上一张确认卡，不是叠加：patch 修正版要把上一版里的所有修改一起带上

修改已有画布：
- 追加或整张重画：update_whiteboard 传 canvas / mermaid，mode 为 append（放在已有内容右侧）或 replace
- 局部修改（改字、改色、移动、删除、加节点或连线）：先 read_whiteboard 拿到元素 id，再用 patch：{"updates":[{"id":"…","changes":{"text":"新文字","strokeColor":"#…"}}],"remove":["id"],"add":[{"id","type","x","y","width","height","label?"},{"id","type":"arrow","from":"节点id","to":"节点id"}],"reroute":["连线id"]}
  changes 可改 x,y,width,height,fontSize(12–160),opacity(0–100),angle,strokeWidth(0–12),strokeColor,backgroundColor,text,type（rectangle/diamond/ellipse 互换）；SVG 图片用 svgSource 给完整新源码
- 修改刚创建的画布时，用确认卡结果里的笔记 ID 作为 target_note_id；创建失败的卡没有结果可改

其他：
- 当前笔记是画布时，不要用 edit_note 改它；不要用 create_note 存画布，也不要把 Mermaid 文本存进普通笔记
- 需要基于某篇笔记画图时，先加载 notes 技能读取内容，再把真实内容写进画布；不要猜测笔记 ID
- 用户在设置里关闭了 AI 绘制 SVG 时，svg 节点会被拒绝，改用原生图元

示例（数据看板）：
{"title":"Flota 本月数据","layout":{"type":"stack.v","gap":28},"children":[{"type":"grid","props":{"cols":4,"gap":16,"align":"stretch"},"children":[{"type":"stat","props":{"value":"1.2","unit":"万","label":"日活","delta":"+18%","trend":"up","tone":"primary"}},{"type":"stat","props":{"value":"3400","label":"新增用户"}},{"type":"stat","props":{"value":"41","unit":"%","label":"7 日留存"}},{"type":"stat","props":{"value":"3.2","unit":"%","label":"付费转化"}}]},{"type":"grid","props":{"cols":2,"gap":24},"children":[{"type":"chart","props":{"kind":"line","title":"四周日活（万）","data":[{"label":"第1周","value":0.9},{"label":"第2周","value":1.0},{"label":"第3周","value":1.1},{"label":"第4周","value":1.2}]}},{"type":"chart","props":{"kind":"donut","title":"用户来源","centerText":"来源","data":[{"label":"小红书","value":45},{"label":"搜索","value":25},{"label":"推荐","value":20},{"label":"其他","value":10}]}}]}]}
