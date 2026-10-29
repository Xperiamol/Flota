import { Box, Collapse, useMediaQuery } from '@mui/material'

// TransitionGroup retains removed rows until the space has closed; data deletion never waits on animation.
export default function NoteRowTransition({ children, in: visible, ...props }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  return <Collapse {...props} in={visible} component="li" timeout={reduced ? 0 : { enter: 0, exit: 220 }} sx={{ listStyle: 'none' }}>
    <Box sx={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateX(-8px) scale(0.985)', transformOrigin: 'left center', pointerEvents: visible ? 'auto' : 'none', transition: reduced ? 'none' : 'opacity 140ms ease, transform 180ms cubic-bezier(0.2,0,0,1)' }}>
      {children}
    </Box>
  </Collapse>
}
