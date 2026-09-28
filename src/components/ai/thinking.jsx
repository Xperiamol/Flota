import { useEffect, useState } from 'react'
import { Box, Typography, alpha } from '@mui/material'

/**
 * AI 「思考中」的提示语与动画：AI 页面、AI 小窗和执行中的动作卡片共用。
 * - TypewriterText：切换短语时淡入，不出现整段空白
 * - ThinkingDots：三个依次跳动的点
 * - pickThinkingPhrase：从短语表里随机取一句，最近用过的不重复
 */

export const TypewriterText = ({ text, fontSize = 12 }) => {
  const [display, setDisplay] = useState(text || '')
  const [animKey, setAnimKey] = useState(0)
  useEffect(() => {
    const next = text || ''
    if (next === display) return
    setDisplay(next)
    setAnimKey((k) => k + 1)
  }, [text, display])
  return (
    <Typography
      key={animKey}
      component="span"
      variant="caption"
      sx={(theme) => ({
        fontSize,
        lineHeight: 1.4,
        color: alpha(theme.palette.text.primary, 0.7),
        animation: 'flota-thinking-fade 280ms ease',
        '@keyframes flota-thinking-fade': {
          '0%': { opacity: 0, transform: 'translateY(2px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' }
        }
      })}
    >
      {display}
      <Box component="span" sx={{ opacity: 0.5, ml: 0.25 }}>…</Box>
    </Typography>
  )
}

export const ThinkingDots = ({ dotSize = 4, gap = 3 }) => (
  <Box
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: `${gap}px`,
      '@keyframes flota-thinking-dot': {
        '0%, 80%, 100%': { opacity: 0.35, transform: 'translateY(0) scale(0.92)' },
        '40%': { opacity: 1, transform: 'translateY(-1.5px) scale(1)' }
      }
    }}
  >
    {[0, 1, 2].map((i) => (
      <Box
        key={i}
        component="span"
        sx={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          bgcolor: 'currentColor',
          animation: 'flota-thinking-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.16}s`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.6 },
        }}
      />
    ))}
  </Box>
)

// 模型空闲思考阶段随机展示的英文短语
export const THINKING_PHRASES = [
  'Absorbing', 'Aggregating', 'Aligning', 'Analyzing', 'Assembling',
  'Baking', 'Blending', 'Brewing', 'Building', 'Bundling',
  'Calculating', 'Churning', 'Clustering', 'Coalescing', 'Composing',
  'Compressing', 'Computing', 'Crunching', 'Smooshing',
  'Decoding', 'Decomposing', 'Diagnosing', 'Digesting',
  'Encoding', 'Evaluating', 'Exploring', 'Extracting',
  'Filtering', 'Formatting', 'Formulating',
  'Generating', 'Gathering', 'Grokking',
  'Hashing', 'Harvesting',
  'Indexing', 'Inferring', 'Initializing', 'Integrating', 'Iterating',
  'Joining', 'Judging',
  'Loading', 'Linking', 'Layering',
  'Mapping', 'Matching', 'Merging', 'Mining', 'Modelling',
  'Normalizing', 'Narrowing',
  'Optimizing', 'Organizing',
  'Parsing', 'Processing', 'Polishing', 'Programming', 'Projecting',
  'Quantizing', 'Querying', 'Queueing',
  'Rendering', 'Refactoring', 'Retrieving', 'Routing',
  'Sampling', 'Scraping', 'Searching', 'Sorting', 'Synthesizing', 'Solving',
  'Translating', 'Traversing', 'Tracing', 'Trimming',
  'Updating', 'Unifying',
  'Validating', 'Vectorizing', 'Verifying',
  'Weaving', 'Wrangling',
  // 更有趣一点的
  'Accomplishing', 'Actualizing', 'Brainstorming', 'Cogitating', 'Concocting', 'Conjuring', 'Contemplating',
  'Crafting', 'Daydreaming', 'Deliberating', 'Dreaming up', 'Enchanting', 'Envisioning', 'Fermenting',
  'Finessing', 'Forging', 'Hatching', 'Ideating', 'Imagining', 'Inventing', 'Manifesting', 'Marinating',
  'Mulling', 'Musing', 'Noodling', 'Orchestrating', 'Percolating', 'Pondering', 'Puzzling', 'Reticulating',
  'Ruminating', 'Scheming', 'Simmering', 'Sketching', 'Spellcasting', 'Stewing', 'Tinkering', 'Transmuting',
  'Untangling', 'Whisking', 'Wondering',
]

const recentByList = new WeakMap()
const RECENT_PHRASE_MEMORY = 8
/** 从短语表里随机取一句；同一张表最近用过的几句不重复 */
export const pickThinkingPhrase = (phrases = THINKING_PHRASES) => {
  if (phrases.length <= 1) return phrases[0] || ''
  const recent = recentByList.get(phrases) || []
  const memory = Math.min(RECENT_PHRASE_MEMORY, phrases.length - 1)
  let next
  do {
    next = phrases[Math.floor(Math.random() * phrases.length)]
  } while (recent.includes(next))
  recent.push(next)
  while (recent.length > memory) recent.shift()
  recentByList.set(phrases, recent)
  return next
}
