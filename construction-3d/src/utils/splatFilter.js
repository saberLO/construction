/**
 * splatFilter.js — 3DGS splat 去噪工具
 *
 * splat 格式每点 32 字节：
 *   [0..11]  xyz       3 × float32  位置
 *   [12..23] scale     3 × float32  缩放
 *   [24..26] rgb       3 × uint8    颜色
 *   [27]     alpha     1 × uint8    不透明度
 *   [28..31] rotation  4 × uint8    旋转四元数
 */

const BYTES_PER_SPLAT = 32

/**
 * 分析 splat buffer，预计算用于过滤的统计数据
 */
export function analyzeSplatBuffer(buffer) {
  const count = Math.floor(buffer.byteLength / BYTES_PER_SPLAT)
  if (count === 0) return null

  const view = new DataView(buffer)

  let sumX = 0, sumY = 0, sumZ = 0

  for (let i = 0; i < count; i++) {
    const base = i * BYTES_PER_SPLAT
    sumX += view.getFloat32(base, true)
    sumY += view.getFloat32(base + 4, true)
    sumZ += view.getFloat32(base + 8, true)
  }

  const cx = sumX / count
  const cy = sumY / count
  const cz = sumZ / count

  const distances = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const base = i * BYTES_PER_SPLAT
    const dx = view.getFloat32(base, true) - cx
    const dy = view.getFloat32(base + 4, true) - cy
    const dz = view.getFloat32(base + 8, true) - cz
    distances[i] = Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  const sorted = Float32Array.from(distances).sort()
  const p50 = sorted[Math.floor(count * 0.5)]
  const p90 = sorted[Math.floor(count * 0.9)]
  const p95 = sorted[Math.floor(count * 0.95)]
  const p99 = sorted[Math.floor(count * 0.99)]
  const max = sorted[count - 1]

  return { count, center: { x: cx, y: cy, z: cz }, distances, percentiles: { p50, p90, p95, p99, max } }
}

/**
 * 过滤 splat buffer
 *
 * @param {ArrayBuffer} buffer - 原始 splat 数据
 * @param {object} analysis - analyzeSplatBuffer 返回的统计数据
 * @param {object} options
 *   - opacityMin  (0-100)  最低不透明度百分比，低于此值的点被移除
 *   - keepPercent (50-100) 基于距离中心的百分位保留比例
 * @returns {{ buffer: ArrayBuffer, kept: number, removed: number }}
 */
export function filterSplatBuffer(buffer, analysis, options = {}) {
  const { opacityMin = 5, keepPercent = 95 } = options
  const { count, distances } = analysis

  const alphaThreshold = Math.round(opacityMin * 255 / 100)

  const sortedDist = Float32Array.from(distances).sort()
  const distCutoff = sortedDist[Math.min(Math.floor(count * keepPercent / 100), count - 1)]

  const view = new DataView(buffer)
  const src = new Uint8Array(buffer)

  let keepCount = 0
  for (let i = 0; i < count; i++) {
    if (view.getUint8(i * BYTES_PER_SPLAT + 27) >= alphaThreshold && distances[i] <= distCutoff) {
      keepCount++
    }
  }

  const dst = new Uint8Array(keepCount * BYTES_PER_SPLAT)
  let w = 0
  for (let i = 0; i < count; i++) {
    if (view.getUint8(i * BYTES_PER_SPLAT + 27) >= alphaThreshold && distances[i] <= distCutoff) {
      dst.set(src.subarray(i * BYTES_PER_SPLAT, (i + 1) * BYTES_PER_SPLAT), w * BYTES_PER_SPLAT)
      w++
    }
  }

  return { buffer: dst.buffer, kept: keepCount, removed: count - keepCount, total: count }
}
