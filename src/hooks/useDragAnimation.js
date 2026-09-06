import { createContext, useContext } from 'react'

// Keep context identity independent of the provider's visual/HMR dependencies.
export const DragAnimationContext = createContext(null)

export const useDragAnimation = () => {
  const context = useContext(DragAnimationContext)
  if (!context) {
    throw new Error('useDragAnimation must be used within a DragAnimationProvider')
  }
  return context
}
