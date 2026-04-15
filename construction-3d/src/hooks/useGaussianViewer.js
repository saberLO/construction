import { useRef, useEffect } from 'react'

/**
 * Manages the lifecycle of a GaussianSplats3D.Viewer:
 *   - Tracks mount state via mountedRef
 *   - Provides a safe destroyViewer that removes the canvas before dispose
 *   - Revokes any stored blob URL
 *   - Cleans up on unmount
 */
export function useGaussianViewer() {
  const containerRef = useRef(null)
  const viewerRef    = useRef(null)
  const mountedRef   = useRef(true)
  const blobUrlRef   = useRef(null)

  const destroyViewer = () => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewerRef.current = null
    try {
      viewer.stop?.()
      const canvas = viewer.renderer?.domElement
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas)
      viewer.dispose?.()
    } catch (e) {
      console.warn('[GaussianViewer] dispose warning:', e.message)
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      destroyViewer()
    }
  }, [])

  return { containerRef, viewerRef, mountedRef, blobUrlRef, destroyViewer }
}
