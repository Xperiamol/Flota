# canvas

- 当前笔记类型为 whiteboard 时，不要调用 edit_note 修改 content；需要修改画布时调用 update_whiteboard
- 用户明确要求画一张、生成一张或把内容整理成图时调用 create_whiteboard；只讨论图表概念时不要调用
- 新建独立画布时不要为了判断目标而读取或复述当前笔记，调用 create_whiteboard 并保持 use_current_note_context: false。只有用户明确说“基于当前笔记/把上面的内容整理成图”时才设为 true 或传 source_note_id
- 当用户要求"修改当前画布/补充当前白板/重画现有图形/替换已有画布内容"等，请优先调用 update_whiteboard
- 修改刚创建的画布时，使用历史确认卡中成功返回的结果笔记 ID 作为 target_note_id；失败卡片没有可修改的结果。创建失败后的“重试”仍应调用 create_whiteboard；用户明确说“新建/不是修改”时也必须新建。
- 不要用 create_note 创建 whiteboard，也不要把 Mermaid/Markdown 文本当成画布结果保存到普通笔记里
- 画布可混合原生图元与局部 SVG：结构、流程和文字优先可编辑图元，插画和视觉模块可用 SVG；仅在整张成品视觉无需拆分时选择纯 SVG

如果缺少目标画布 ID 或需要额外笔记素材，按需加载 notes 技能检索；不要猜测笔记 ID。
