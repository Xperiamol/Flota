import { useEffect, useRef, useState } from 'react'
import { Box, Typography, alpha, useMediaQuery } from '@mui/material'

/**
 * AI 「思考中」的提示语与动画：AI 页面、AI 小窗和执行中的动作卡片共用。
 * - TypewriterText：逐字输入、停顿、回删；短语切换等待本轮结束
 * - ThinkingDots：三个依次跳动的点
 * - pickThinkingPhrase：从短语表里随机取一句，最近用过的不重复
 */

export const TypewriterText = ({ text, fontSize = 12, onCycle, paused = false }) => {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const onCycleRef = useRef(onCycle)
  onCycleRef.current = onCycle
  const latestText = useRef(text || '')
  latestText.current = text || ''
  const [display, setDisplay] = useState('')

  useEffect(() => {
    if (reducedMotion || paused) return
    let timer
    let characters = []
    let count = 0
    let erasing = false
    const segmenter = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
    const tick = () => {
      if (!erasing && count === 0) {
        const phrase = latestText.current
        characters = segmenter ? Array.from(segmenter.segment(phrase), part => part.segment) : Array.from(phrase)
      }
      count += erasing ? -1 : 1
      count = Math.max(0, Math.min(count, characters.length))
      setDisplay(characters.slice(0, count).join(''))
      let delay = erasing ? 38 : 85
      if (!erasing && count === characters.length) {
        erasing = true
        delay = 1100
      } else if (erasing && count === 0) {
        erasing = false
        onCycleRef.current?.()
        delay = 260
      }
      timer = setTimeout(tick, delay)
    }
    setDisplay('')
    timer = setTimeout(tick, 120)
    return () => clearTimeout(timer)
  }, [reducedMotion, paused])

  return (
    <Typography
      component="span"
      variant="caption"
      aria-label={text || ''}
      sx={(theme) => ({
        display: 'inline-block',
        minHeight: '1.4em',
        fontSize,
        lineHeight: 1.4,
        color: alpha(theme.palette.text.primary, 0.7),
      })}
    >
      <Box component="span" aria-hidden="true">
        {reducedMotion || paused ? text : display}
        <Box component="span" sx={{
          display: 'inline-block', ml: 0.3, width: '1px', height: '0.9em',
          bgcolor: 'currentColor', verticalAlign: '-0.05em', opacity: 0.5,
          animation: reducedMotion || paused ? 'none' : 'flota-thinking-caret 1s step-end infinite',
          '@keyframes flota-thinking-caret': { '50%': { opacity: 0 } },
        }} />
      </Box>
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
