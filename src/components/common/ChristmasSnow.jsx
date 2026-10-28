import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, GlobalStyles, useMediaQuery } from '@mui/material';
import { keyframes } from '@emotion/react';
import { CHRISTMAS_ART } from '../../assets/christmas';

export const CHRISTMAS_COLORS = {
  primary: '#c41e3a', secondary: '#165B33', gold: '#FFD700', ivory: '#FFFFF0',
  holly: '#00563F', burgundy: '#800020', snow: '#FFFAFA', pine: '#01796F',
  gradient: 'linear-gradient(135deg, #c41e3a 0%, #165B33 100%)',
  softGradient: 'linear-gradient(135deg, rgba(196,30,58,.1), rgba(22,91,51,.1))',
};
const palette = ['#ba4050', '#609575', '#e5c679', '#f7eac5'];
const fall = keyframes`
  from { transform: translate3d(0,-20px,0); opacity: 0; }
  12%,85% { opacity: var(--snow-opacity); }
  to { transform: translate3d(35px,105vh,0); opacity: 0; }
`;
const fly = keyframes`
  from { transform: translateX(-260px); opacity: 0; }
  8%,90% { opacity: .9; }
  to { transform: translateX(calc(100vw + 260px)); opacity: 0; }
`;
const scatter = keyframes`
  from { transform: translate3d(0,0,0) scale(.4); opacity: 1; }
  to { transform: translate3d(var(--dx),var(--dy),0) scale(.1) rotate(160deg); opacity: 0; }
`;
const peek = keyframes`
  from { transform: translateY(36px) rotate(5deg); opacity: 0; }
  15%,75% { transform: translateY(0) rotate(0); opacity: 1; }
  to { transform: translateY(28px); opacity: 0; }
`;

export default function ChristmasDecorations() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [paused, setPaused] = useState(document.hidden);
  const [burst, setBurst] = useState(null);
  const [surprise, setSurprise] = useState(null);
  const burstTimer = useRef(null);
  const surpriseTimer = useRef(null);
  const lastBurst = useRef(0);
  const lastReveal = useRef(0);
  const moments = useRef({ note: 0, todo: 0, writing: 0, writingStarted: 0 });
  const flakes = useMemo(() => Array.from({ length: 32 }, (_, i) => ({
    left: Math.random() * 100, size: 2 + Math.random() * 3,
    duration: 10 + Math.random() * 12, delay: -Math.random() * 22,
    opacity: .2 + Math.random() * .35, edge: i % 3 !== 0,
  })), []);
  const celebrate = useCallback(() => {
    if (reduced || document.hidden || Date.now() - lastBurst.current < 650) return;
    lastBurst.current = Date.now();
    const target = document.querySelector('[data-tour="todo"]')?.getBoundingClientRect();
    setBurst({ id: Date.now(), x: target ? target.right + 8 : innerWidth - 50, y: target ? target.top + target.height / 2 : innerHeight - 90 });
    clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => setBurst(null), 950);
  }, [reduced]);
  const reveal = useCallback(art => {
    // 彩蛋只由真实使用触发，并留出安静的间隔。
    if (document.hidden || Date.now() - lastReveal.current < 45000) return;
    lastReveal.current = Date.now();
    const flight = art === 'sleigh' && !reduced;
    setSurprise({ id: Date.now(), art: reduced && art === 'sleigh' ? 'gifts' : art, flight });
    clearTimeout(surpriseTimer.current);
    surpriseTimer.current = setTimeout(() => setSurprise(null), flight ? 9000 : 3600);
  }, [reduced]);
  useEffect(() => {
    document.documentElement.dataset.flotaChristmas = 'true';
    const visibility = () => {
      setPaused(document.hidden);
      if (document.hidden) { setSurprise(null); setBurst(null); clearTimeout(surpriseTimer.current); clearTimeout(burstTimer.current); }
    };
    const onMoment = event => {
      if (document.hidden) return;
      const kind = event.detail?.kind || 'todo';
      if (kind === 'note') {
        moments.current.note++;
        if (moments.current.note % 3 === 0) reveal('tree');
      } else if (kind === 'todo') {
        celebrate();
        moments.current.todo++;
        if (moments.current.todo % 3 === 0) reveal('sleigh');
      }
    };
    const onWriting = event => {
      if (!(event.target instanceof Element) || !event.target.closest('.ProseMirror') || event.isComposing || document.hidden) return;
      const now = Date.now();
      if (!moments.current.writingStarted) moments.current.writingStarted = now;
      moments.current.writing++;
      if (moments.current.writing >= 16 && now - moments.current.writingStarted >= 8000) {
        reveal('snowman'); moments.current.writing = 0; moments.current.writingStarted = now;
      }
    };
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('input', onWriting);
    window.addEventListener('flota:christmas-celebrate', onMoment);
    return () => {
      delete document.documentElement.dataset.flotaChristmas;
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('input', onWriting);
      window.removeEventListener('flota:christmas-celebrate', onMoment);
      clearTimeout(burstTimer.current); clearTimeout(surpriseTimer.current);
    };
  }, [celebrate, reveal]);

  return <>
    <GlobalStyles styles={{ '@media print': { '[data-christmas-layer]': { display: 'none !important' } } }} />
    <Box data-christmas-layer aria-hidden="true" sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1401, overflow: 'hidden', '& *': { animationPlayState: paused ? 'paused !important' : 'running' } }}>
      <Box sx={{ position: 'absolute', inset: 0, border: '3px solid transparent', borderImage: 'linear-gradient(135deg,#a43e4b,#d6b56e,#37644c,#a43e4b) 1', borderRadius: '10px' }} />
      {!reduced && flakes.map((flake, i) => <Box key={i} data-christmas-snow sx={{ position: 'absolute', top: -10,
        left: `${flake.edge ? (i % 2 ? flake.left * .18 : 82 + flake.left * .18) : flake.left}%`, width: flake.size, height: flake.size, borderRadius: '50%', bgcolor: '#b5d8e8',
        '--snow-opacity': flake.opacity, opacity: 0, animation: `${fall} ${flake.duration}s linear infinite`, animationDelay: `${flake.delay}s`,
      }} />)}
      {burst && <Box key={burst.id} data-christmas-burst sx={{ position: 'absolute', left: burst.x, top: burst.y }}>{palette.map((color, i) => <Box key={i} sx={{ position: 'absolute', fontSize: 11, color, '--dx': `${18 + i * 8}px`, '--dy': `${(i - 2) * 16}px`, animation: `${scatter} 900ms ease-out forwards` }}>✦</Box>)}</Box>}
      {surprise && <Box key={surprise.id} component="img" data-christmas-surprise={surprise.art} src={CHRISTMAS_ART[surprise.art]} alt="" draggable={false} sx={{ position: 'absolute', objectFit: 'contain', filter: 'drop-shadow(0 3px 6px rgba(35,50,30,.15))',
        ...(surprise.flight ? { top: 42, left: -220, width: 200, height: 100, animation: `${fly} 9s linear forwards` } : { bottom: 52, right: 18, width: 86, height: 100, animation: reduced ? 'none' : `${peek} 3.6s ease-in-out forwards` }),
      }} />}
    </Box>
  </>;
}
