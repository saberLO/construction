/**
 * splatFilter Web Worker
 *
 * 接收消息：
 *   { type: 'analyze', buffer: ArrayBuffer }
 *   { type: 'filter',  buffer: ArrayBuffer, analysis: object, options: object }
 *
 * buffer 通过 Transferable 传递，避免拷贝。
 * 调用方需在 transfer 前 slice() 保留副本。
 */

import { analyzeSplatBuffer, filterSplatBuffer } from '../utils/splatFilter'

self.onmessage = (e) => {
  const { type, buffer, analysis, options } = e.data

  try {
    if (type === 'analyze') {
      const result = analyzeSplatBuffer(buffer)
      // distances 是 Float32Array，不能直接 postMessage 给主线程再用，
      // 需要转成普通对象 — 但 distances 太大了，仍然通过 Transferable 传
      self.postMessage(
        { type: 'analyze-result', result },
        result?.distances ? [result.distances.buffer] : [],
      )
    } else if (type === 'filter') {
      const result = filterSplatBuffer(buffer, analysis, options)
      // 将过滤后的 buffer 通过 Transferable 传回
      self.postMessage(
        { type: 'filter-result', result },
        [result.buffer],
      )
    } else {
      self.postMessage({ type: 'error', error: `Unknown message type: ${type}` })
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || String(err) })
  }
}
