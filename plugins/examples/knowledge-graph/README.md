# 知识图谱

把笔记之间的关联画成一张图。启用后，主侧栏会出现「图谱」入口；笔记的「更多」菜单里有「在图谱中查看」。

## 关联从哪里来

- `[[笔记名]]` 双链；指向还不存在的笔记时显示为虚线空心点，双击可以创建
- 插入的笔记 / 画布链接（`app://note/…`、`app://whiteboard/…`）
- 相同的标签：标签是一个小空心点，带这个标签的笔记都连到它上面（可在「显示内容」里关掉）

## 使用

- 单击节点：右侧显示摘要和它连着的内容，点列表里的项目跳到那个节点
- 双击节点：打开笔记
- 「全部 / 当前笔记」：只看正在看的这篇笔记两步之内的内容
- 拖动节点整理位置，滚轮缩放，Esc 取消选中

## 开发

视图源码在 `view/index.jsx`，修改后重新生成 `view/index.js`：

```bash
npx esbuild view/index.jsx --jsx-factory=React.createElement --jsx-fragment=React.Fragment --format=esm --target=es2020 --outfile=view/index.js
```
