import { useEffect, useState } from 'react'
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material'
import { TypewriterText } from './thinking'

export const AI_CAPABILITY_EXAMPLES = [
  { label: '做组件', text: '做一个读书打卡组件', detail: '描述你想要的工具，AI 帮你生成组件。', prompt: '帮我做一个读书打卡组件：记录每天读了多少页，显示本月的连续打卡天数。' },
  { label: '写长文', text: '分章节写一部 6 万字小说', detail: '先确认人物和大纲，再分章节完成长篇小说并保存为笔记。', prompt: '帮我创作一部约 60000 字的长篇小说，背景是一座会下雨的图书馆，主角负责整理读者遗落的记忆。先和我确认题材、人物与故事走向，给出完整大纲和章节字数安排；等我确认后分章节写作，保持人物设定和情节连贯，完成后存为新笔记。' },
  { label: '长期记忆', text: '记住你的偏好与背景', detail: '长期记忆需要先在设置里开启。', prompt: '我想使用长期记忆，请先检查是否已开启，再记住：我更喜欢简洁的要点式回答，除非我要求展开。' },
  { label: '画画布', text: '把想法画成流程图', detail: '创建画布，或继续修改、解释已有的图。', prompt: '帮我在新画布中画一个项目审批流程：提交申请、负责人审核、通过后执行，不通过则修改后重新提交。' },
  { label: '规划待办', text: '把大目标拆成小待办', detail: '把目标拆成阶段和具体行动，确认后再创建。', prompt: '帮我把一个大目标拆成可执行的待办。先问我目标、截止日期和限制条件，再给出分阶段方案，等我确认后创建待办。' },
  { label: '整理笔记', text: '整理笔记和标签', detail: '查找记录、梳理要点，整理前先确认方案。', prompt: '找出我最近一周的笔记，概括每篇的核心要点，并给出标签整理建议，修改前先让我确认。' },
  { label: '联网检索', text: '搜索新信息并给出来源', detail: '需要先配置联网搜索服务。', prompt: '搜索最近一周与端侧 AI 有关的重要进展，概括值得关注的内容，并附上来源链接。' },
  { label: '看图问答', text: '读懂笔记里的图片', detail: '读取笔记图片需要开启图片识别，并使用支持视觉的模型。', prompt: '请读取当前笔记中的图片，解释主要内容，提取其中的重要信息；如果未开启图片识别，先告诉我如何配置。' },
  { label: '长笔记查找', text: '在长笔记里找关键细节', detail: '可以分段读取并在当前笔记中搜索。', prompt: '请在当前笔记中查找与截止时间、预算和风险有关的内容，列出原文位置，并概括关键细节。' },
  { label: '批量修改', text: '统一多篇笔记的标题和标签', detail: '提出批量修改方案，确认后执行。', prompt: '查找最近一周的笔记，建议更清晰的标题和统一的标签。一次列出所有修改方案，等我确认后再批量更新。' },
  { label: '提取待办', text: '把会议记录变成待办', detail: '可以创建任务、截止日期和子任务。', prompt: '从当前笔记中提取行动项，整理负责人、截止日期和子任务。缺失的信息先问我，列出方案确认后再创建待办。' },
  { label: '修改组件', text: '给已有组件加上新功能', detail: '可以读取组件代码和数据，修改后预跑检查。', prompt: '我想给一个已有组件加功能。先列出我的组件，让我选择要修改的对象，再问清需求并给出修改方案。' },
  { label: '组件录入', text: '把记录整理进自己的组件', detail: '需要先选择已有组件、实例和对应数据集合。', prompt: '我有一批记录想整理进已有组件。请先查看组件和数据集合，问我选择哪个实例以及要录入的内容，确认字段映射后再写入。' },
  { label: '组件多实例', text: '为同一组件分开保存数据', detail: '同一个组件可以创建多个独立实例。', prompt: '我想把同一组件的数据按不同用途分开保存。先列出已有组件和实例，让我选择组件、确认新实例的名称，再创建独立实例。' },
  { label: '更正记忆', text: '查看并纠正过时的记忆', detail: '需要先开启长期记忆。', prompt: '查看当前已保存的长期记忆，按类别列出。先让我指出哪些已经过时，再确认并更正，不要自行改写。' },
  { label: '调整设置', text: '调整主题、排版和显示偏好', detail: '说出想调整的设置，确认后直接应用。', prompt: '帮我切换为深色主题，并隐藏编辑器里的阅读时长。先展示具体修改，等我确认后应用。' },
]

export default function AICapabilityTicker({ onSelect, paused = false, sx }) {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const item = AI_CAPABILITY_EXAMPLES[index]
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  const next = () => setIndex(current => (current + 1) % AI_CAPABILITY_EXAMPLES.length)
  return <Box data-ai-capability-ticker data-current-capability={item.label} role="group" aria-label={`AI 功能示例：${AI_CAPABILITY_EXAMPLES.map(example => example.label).join('、')}`}
    sx={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 0, minHeight: 28, ...sx }}>
    <Tooltip title={item.detail} placement="top">
      <ButtonBase onClick={() => onSelect?.(item.prompt)} aria-label={`试试 AI：${item.label}`} sx={{ display: 'flex', justifyContent: 'flex-start', gap: .75, px: .75, py: .5, flex: 1, minWidth: 0, borderRadius: '8px', '&:hover': { bgcolor: 'action.hover' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
        <Typography component="span" sx={{ color: 'text.secondary', fontSize: 11.5, fontWeight: 400, flexShrink: 0 }}>试试：</Typography>
        <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', '& > span': { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle', color: 'primary.main', fontWeight: 500 } }}>
          {visible ? <TypewriterText key={index} text={item.text} fontSize={12.5} onCycle={next} paused={paused} /> : <Typography component="span" sx={{ fontSize: 12.5 }}>{item.text}</Typography>}
        </Box>
      </ButtonBase>
    </Tooltip>
  </Box>
}
