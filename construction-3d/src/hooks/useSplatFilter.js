import { useRef, useEffect, useCallback } from 'react'

/**
 * useSplatFilter — 管理 splatFilter Web Worker 的生命周期。
 *
 * 返回:
 *   analyze(buffer)  → Promise<analysis>
 *   filter(buffer, analysis, options) → Promise<{ buffer, kept, removed, total }>
 *
 * 注意：buffer 是通过 Transferable 传给 Worker 的，
 * 调用方必须在传入前 buffer.slice(0) 保留副本！
 */
export function useSplatFilter() {
  const workerRef = useRef(null)
  const pendingRef = useRef(null) // { resolve, reject }

  useEffect(() => {
    const w = new Worker(
      new URL('../workers/splatFilter.worker.js', import.meta.url),
      { type: 'module' },
    )

    w.onmessage = (e) => {
      const { type, result, error } = e.data
      const pending = pendingRef.current
      if (!pending) return

      if (type === 'error') {
        pendingRef.current = null
        pending.reject(new Error(error))
      } else if (type === 'analyze-result' || type === 'filter-result') {
        pendingRef.current = null
        pending.resolve(result)
      }
    }

    w.onerror = (err) => {
      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        pending.reject(new Error(err.message || 'Worker error'))
      }
    }

    workerRef.current = w

    return () => {
      w.terminate()
      workerRef.current = null
      if (pendingRef.current) {
        pendingRef.current.reject(new Error('Worker terminated'))
        pendingRef.current = null
      }
    }
  }, [])

  const analyze = useCallback((buffer) => {
    return new Promise((resolve, reject) => {
      const w = workerRef.current
      if (!w) { reject(new Error('Worker not ready')); return }
      pendingRef.current = { resolve, reject }
      // slice 保留调用方副本，transfer 给 worker
      const copy = buffer.slice(0)
      w.postMessage({ type: 'analyze', buffer: copy }, [copy])
    })
  }, [])

  const filter = useCallback((buffer, analysis, options) => {
    return new Promise((resolve, reject) => {
      const w = workerRef.current
      if (!w) { reject(new Error('Worker not ready')); return }
      pendingRef.current = { resolve, reject }
      // slice 保留调用方副本，transfer 给 worker
      const copy = buffer.slice(0)
      w.postMessage({ type: 'filter', buffer: copy, analysis, options }, [copy])
    })
  }, [])

  return { analyze, filter }
}
