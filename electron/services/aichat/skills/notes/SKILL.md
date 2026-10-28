# notes

## 长笔记上下文策略
- 从笔记入口提问时应用会注入「当前笔记」上下文；独立 AI 页面不默认携带笔记。短笔记直接给全文；长笔记只给元信息、目录大纲、首尾预览，中段被省略。
- 当看到「⚠️ 内容已省略中段」或 total_lines 很大时：先调用 search_in_current_note(query) 用关键词定位，或用 read_current_note(start_line, line_count) 按目录大纲指向的行号读取需要的段落。
- 不要在长笔记上凭首尾预览臆测中段内容；不确定时主动读取。


- 修改笔记正文时优先用 edit_note 的 edits 只替换需要改的片段（find 写原文、replace 写新文），不要为了改几句话把整篇笔记重新输出；重写全文或大幅调整结构时才用 content
- 当前笔记类型为 whiteboard 时，不要调用 edit_note 修改 content；需要修改画布时先加载 canvas 技能，再调用 update_whiteboard
搜索结果是摘要；用 read_note(id, offset, limit) 按 next_offset 继续读取所需正文。没有当前笔记时不要把后台最近查看的笔记当成当前笔记。

笔记里的本地图片不会自动提供视觉信息。图片与问题有关且图片理解已启用时，用 read_note_image(path) 按需取图，不必另行询问许可。不要一次读取多张无关图片。
涉及画布修改时先加载 canvas 技能，不要用 edit_note 改画布正文。
