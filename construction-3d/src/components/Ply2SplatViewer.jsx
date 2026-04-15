/**
 * Ply2SplatViewer.jsx
 * 
 * 浏览器端 PLY → SPLAT 实时转换 + 渲染
 * - 纯 JS 实现，无需服务器，文件不离开本地
 * - 完整保留：坐标、缩放、颜色（0阶SH→RGB）、不透明度、旋转
 * - 转换完成后直接用 @mkkellogg/gaussian-splats-3d 渲染
 * - 支持导出转换后的 .splat 文件
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { Download, FolderOpen, X, RefreshCw, FileBox, AlertCircle, CheckCircle } from 'lucide-react'
import { formatSize } from '../utils/format'

// ─── PLY 解析工具 ──────────────────────────────────────────────────────────

/**
 * 解析 PLY 文件头，返回字段列表和数据起始偏移量
 */
function parsePlyHeader(buffer) {
  const bytes = new Uint8Array(buffer)
  const decoder = new TextDecoder('ascii')

  // PLY header 通常不超过 64KB，限制搜索范围避免在大文件上逐字节扫描
  const searchLimit = Math.min(bytes.length, 65536)
  let headerEnd = -1
  const marker = [101,110,100,95,104,101,97,100,101,114,10] // "end_header\n" in ASCII
  for (let i = 0; i < searchLimit - 10; i++) {
    let match = true
    for (let j = 0; j < 11; j++) {
      if (bytes[i + j] !== marker[j]) { match = false; break }
    }
    if (match) {
      headerEnd = i + 11
      break
    }
  }
  if (headerEnd === -1) throw new Error('无法找到 PLY header 结束标记，文件可能已损坏')

  const headerText = decoder.decode(bytes.slice(0, headerEnd))
  const lines = headerText.split('\n').map(l => l.trim()).filter(Boolean)

  // 验证格式
  if (!lines[0].startsWith('ply')) throw new Error('不是有效的 PLY 文件')
  
  const formatLine = lines.find(l => l.startsWith('format'))
  if (!formatLine) throw new Error('PLY header 缺少 format 行')
  if (!formatLine.includes('binary_little_endian')) {
    throw new Error(`不支持的 PLY 格式: ${formatLine}\n3DGS 训练输出必须是 binary_little_endian`)
  }

  // 解析 vertex 属性
  let vertexCount = 0
  const properties = []
  let inVertex = false

  for (const line of lines) {
    if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(' ')[2])
      inVertex = true
    } else if (line.startsWith('element') && !line.startsWith('element vertex')) {
      inVertex = false
    } else if (inVertex && line.startsWith('property')) {
      const parts = line.split(' ')
      properties.push({ type: parts[1], name: parts[2] })
    }
  }

  if (vertexCount === 0) throw new Error('PLY 文件中没有顶点数据')

  // 计算每个顶点的字节大小
  const typeSize = { float: 4, float32: 4, double: 8, int: 4, uint: 4, uchar: 1, char: 1, short: 2, ushort: 2 }
  let stride = 0
  const offsets = {}
  for (const prop of properties) {
    offsets[prop.name] = stride
    stride += typeSize[prop.type] || 4
  }

  return { vertexCount, properties, offsets, stride, dataOffset: headerEnd }
}

/**
 * 从 PLY ArrayBuffer 中读取所有高斯点数据
 * 返回结构化的 Float32Array 数组
 */
function readPlyGaussians(buffer, header) {
  const { vertexCount, offsets, stride, dataOffset } = header
  const dataView = new DataView(buffer, dataOffset)

  const n = vertexCount

  // 分配输出数组
  const xyz       = new Float32Array(n * 3)
  const scale     = new Float32Array(n * 3)
  const f_dc      = new Float32Array(n * 3)
  const opacity   = new Float32Array(n)
  const rotation  = new Float32Array(n * 4)

  // 必须字段检查
  const required = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2',
                    'f_dc_0', 'f_dc_1', 'f_dc_2',
                    'opacity', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
  for (const field of required) {
    if (offsets[field] === undefined) {
      throw new Error(
        `PLY 文件缺少字段 "${field}"。\n` +
        `这不是 3DGS 训练输出的高斯 PLY 文件。\n` +
        `3DGS 输出路径：output/point_cloud/iteration_30000/point_cloud.ply`
      )
    }
  }

  for (let i = 0; i < n; i++) {
    const base = i * stride

    // 位置
    xyz[i * 3 + 0] = dataView.getFloat32(base + offsets['x'], true)
    xyz[i * 3 + 1] = dataView.getFloat32(base + offsets['y'], true)
    xyz[i * 3 + 2] = dataView.getFloat32(base + offsets['z'], true)

    // 缩放（log 空间，需要 exp 激活）
    scale[i * 3 + 0] = dataView.getFloat32(base + offsets['scale_0'], true)
    scale[i * 3 + 1] = dataView.getFloat32(base + offsets['scale_1'], true)
    scale[i * 3 + 2] = dataView.getFloat32(base + offsets['scale_2'], true)

    // 0阶球谐颜色
    f_dc[i * 3 + 0] = dataView.getFloat32(base + offsets['f_dc_0'], true)
    f_dc[i * 3 + 1] = dataView.getFloat32(base + offsets['f_dc_1'], true)
    f_dc[i * 3 + 2] = dataView.getFloat32(base + offsets['f_dc_2'], true)

    // 不透明度（logit 空间，需要 sigmoid 激活）
    opacity[i] = dataView.getFloat32(base + offsets['opacity'], true)

    // 旋转四元数
    rotation[i * 4 + 0] = dataView.getFloat32(base + offsets['rot_0'], true)
    rotation[i * 4 + 1] = dataView.getFloat32(base + offsets['rot_1'], true)
    rotation[i * 4 + 2] = dataView.getFloat32(base + offsets['rot_2'], true)
    rotation[i * 4 + 3] = dataView.getFloat32(base + offsets['rot_3'], true)
  }

  return { xyz, scale, f_dc, opacity, rotation, n }
}

// ─── 数学激活函数 ──────────────────────────────────────────────────────────

const SH_C0 = 0.28209479177387814

function sigmoidActivate(arr) {
  const out = new Float32Array(arr.length)
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[i] >= 0
      ? 1 / (1 + Math.exp(-arr[i]))
      : Math.exp(arr[i]) / (1 + Math.exp(arr[i]))
  }
  return out
}

function expActivate(arr) {
  const out = new Float32Array(arr.length)
  for (let i = 0; i < arr.length; i++) out[i] = Math.exp(arr[i])
  return out
}

function shDcToRgb(f_dc) {
  // color = clamp(SH_C0 * f_dc + 0.5, 0, 1)
  const out = new Float32Array(f_dc.length)
  for (let i = 0; i < f_dc.length; i++) {
    out[i] = Math.max(0, Math.min(1, SH_C0 * f_dc[i] + 0.5))
  }
  return out
}

function normalizeQuaternions(rot, n) {
  const out = new Float32Array(rot.length)
  for (let i = 0; i < n; i++) {
    const b = i * 4
    const len = Math.sqrt(
      rot[b]*rot[b] + rot[b+1]*rot[b+1] + rot[b+2]*rot[b+2] + rot[b+3]*rot[b+3]
    ) || 1e-8
    out[b]   = rot[b]   / len
    out[b+1] = rot[b+1] / len
    out[b+2] = rot[b+2] / len
    out[b+3] = rot[b+3] / len
  }
  return out
}

// ─── PLY → SPLAT 转换核心 ─────────────────────────────────────────────────

/**
 * 将解析后的高斯数据转换为 .splat 二进制 ArrayBuffer
 * splat 每点 32 字节：xyz(12) + scale(12) + rgba(4) + rot_u8(4)
 */
function gaussiansToSplatBuffer(gaussians, onProgress) {
  const { n } = gaussians

  // 激活函数
  const opacity_act = sigmoidActivate(gaussians.opacity)   // sigmoid
  const scale_act   = expActivate(gaussians.scale)         // exp
  const rgb_act     = shDcToRgb(gaussians.f_dc)            // SH0 → RGB
  const rot_norm    = normalizeQuaternions(gaussians.rotation, n)

  // 按不透明度排序（从大到小）—— splat 渲染器要求
  onProgress?.('排序高斯点...', 60)
  const indices = new Uint32Array(n)
  for (let i = 0; i < n; i++) indices[i] = i
  indices.sort((a, b) => opacity_act[b] - opacity_act[a])

  // 写出二进制
  onProgress?.('写出 SPLAT 数据...', 80)
  const splatBuffer = new ArrayBuffer(n * 32)
  const view        = new DataView(splatBuffer)

  for (let j = 0; j < n; j++) {
    const i    = indices[j]
    const base = j * 32

    // xyz  (3 × float32)
    view.setFloat32(base + 0,  gaussians.xyz[i*3+0], true)
    view.setFloat32(base + 4,  gaussians.xyz[i*3+1], true)
    view.setFloat32(base + 8,  gaussians.xyz[i*3+2], true)

    // scale (3 × float32, already exp-activated)
    view.setFloat32(base + 12, scale_act[i*3+0], true)
    view.setFloat32(base + 16, scale_act[i*3+1], true)
    view.setFloat32(base + 20, scale_act[i*3+2], true)

    // rgba (4 × uint8)
    view.setUint8(base + 24, Math.round(rgb_act[i*3+0] * 255))
    view.setUint8(base + 25, Math.round(rgb_act[i*3+1] * 255))
    view.setUint8(base + 26, Math.round(rgb_act[i*3+2] * 255))
    view.setUint8(base + 27, Math.round(opacity_act[i]  * 255))

    // rotation (4 × uint8, normalized quaternion mapped to 0-255)
    view.setUint8(base + 28, Math.round((rot_norm[i*4+0] * 128) + 128))
    view.setUint8(base + 29, Math.round((rot_norm[i*4+1] * 128) + 128))
    view.setUint8(base + 30, Math.round((rot_norm[i*4+2] * 128) + 128))
    view.setUint8(base + 31, Math.round((rot_norm[i*4+3] * 128) + 128))
  }

  return splatBuffer
}

// ─── React 组件 ────────────────────────────────────────────────────────────

export default function Ply2SplatViewer() {
  const [phase, setPhase]         = useState('idle')     // idle | converting | viewing | error
  const [progress, setProgress]   = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [fileInfo, setFileInfo]   = useState(null)
  const [splatBuffer, setSplatBuffer] = useState(null)   // ArrayBuffer
  const [error, setError]         = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [stats, setStats]         = useState(null)

  const containerRef = useRef(null)
  const viewerRef    = useRef(null)
  const inputRef     = useRef(null)
  const mountedRef   = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      destroyViewer()
    }
  }, [])

  const destroyViewer = () => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewerRef.current = null
    try {
      viewer.stop?.()
      const canvas = viewer.renderer?.domElement
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
      viewer.dispose?.()
    } catch (e) {
      console.warn('[Ply2Splat] dispose warning:', e.message)
    }
  }

  // ── 初始化渲染器（在 splatBuffer 生成后）──────────────────────
  useEffect(() => {
    if (phase !== 'viewing' || !splatBuffer || !containerRef.current) return

    destroyViewer()

    // 从 splatBuffer 计算包围盒，确定相机位置
    const view  = new DataView(splatBuffer)
    const count = splatBuffer.byteLength / 32
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < count; i++) {
      const b = i * 32
      const x = view.getFloat32(b,     true)
      const y = view.getFloat32(b + 4, true)
      const z = view.getFloat32(b + 8, true)
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    const radius  = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2
    const camDist = Math.max(radius * 2.5, 1.0)
    console.log(`[Ply2Splat] 模型中心 (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) radius=${radius.toFixed(2)} camDist=${camDist.toFixed(2)}`)

    let viewer
    try {
      viewer = new GaussianSplats3D.Viewer({
        selfDrivenMode:         true,
        useBuiltInControls:     true,
        rootElement:            containerRef.current,
        initialCameraPosition:  [cx, cy, cz + camDist],
        initialCameraLookAt:    [cx, cy, cz],
        sharedMemoryForWorkers: false,
      })
      viewerRef.current = viewer
    } catch (e) {
      setError('渲染器初始化失败：' + e.message)
      setPhase('error')
      return
    }

    const blob    = new Blob([splatBuffer], { type: 'application/octet-stream' })
    const blobUrl = URL.createObjectURL(blob)

    viewer.addSplatScene(blobUrl, { format: GaussianSplats3D.SceneFormat.Splat })
      .then(() => {
        URL.revokeObjectURL(blobUrl)
        if (!mountedRef.current) return
        viewer.start()
      })
      .catch(err => {
        URL.revokeObjectURL(blobUrl)
        if (!mountedRef.current) return
        setError('渲染失败：' + err.message)
        setPhase('error')
      })

    return () => destroyViewer()
  }, [phase, splatBuffer])

  // ── 文件处理 ────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (ext !== '.ply') {
      setError(`请选择 .ply 文件（当前：${ext}）`)
      return
    }

    setError('')
    setPhase('converting')
    setProgress(5)
    setProgressMsg('读取文件...')
    setFileInfo({ name: file.name, size: file.size })
    setSplatBuffer(null)
    destroyViewer()

    try {
      // 1. 读取 ArrayBuffer（在主线程，可显示进度）
      const buffer = await file.arrayBuffer()
      if (!mountedRef.current) return
      setProgress(15)
      setProgressMsg('解析 PLY 文件头...')

      // 短暂让出主线程，让 UI 更新
      await new Promise(r => setTimeout(r, 10))

      // 2. 解析 PLY header
      const header = parsePlyHeader(buffer)
      setProgress(25)
      setProgressMsg(`解析 ${header.vertexCount.toLocaleString()} 个高斯点...`)
      await new Promise(r => setTimeout(r, 10))

      // 3. 读取所有高斯点数据
      const gaussians = readPlyGaussians(buffer, header)
      if (!mountedRef.current) return
      setProgress(55)
      setProgressMsg('激活函数处理...')
      await new Promise(r => setTimeout(r, 10))

      // 4. 转换为 splat buffer
      const splat = gaussiansToSplatBuffer(gaussians, (msg, pct) => {
        setProgressMsg(msg)
        setProgress(pct)
      })
      if (!mountedRef.current) return

      const inMB  = file.size / 1024 / 1024
      const outMB = splat.byteLength / 1024 / 1024
      setStats({
        count:  header.vertexCount,
        inMB:   inMB.toFixed(1),
        outMB:  outMB.toFixed(1),
        ratio:  (inMB / outMB).toFixed(1),
      })

      setSplatBuffer(splat)
      setProgress(100)
      setProgressMsg('准备渲染...')
      await new Promise(r => setTimeout(r, 200))

      setPhase('viewing')

    } catch (err) {
      console.error('[Ply2Splat]', err)
      if (!mountedRef.current) return
      setError(err.message)
      setPhase('error')
    }
  }, [])

  // ── 导出 .splat 文件 ─────────────────────────────────────────────
  const handleExport = () => {
    if (!splatBuffer) return
    const blob = new Blob([splatBuffer], { type: 'application/octet-stream' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = (fileInfo?.name || 'model').replace('.ply', '') + '.splat'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    destroyViewer()
    setPhase('idle')
    setSplatBuffer(null)
    setFileInfo(null)
    setError('')
    setStats(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // ────────────────────────────────────────────────────────────────
  // 渲染
  // ────────────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* 顶部栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: 1, color: 'var(--accent)' }}>
          PLY → SPLAT 转换器
        </span>

        {fileInfo && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
              {fileInfo.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {formatSize(fileInfo.size)}
            </span>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {phase === 'viewing' && splatBuffer && (
            <button className="btn btn-secondary btn-sm" onClick={handleExport} aria-label="导出 SPLAT 文件">
              <Download size={13} /> 导出 .splat
            </button>
          )}
          {phase !== 'idle' && (
            <button className="btn btn-ghost btn-sm" onClick={handleReset} aria-label="重新选择文件">
              <RefreshCw size={13} /> 重新选择
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} aria-label="选择 PLY 文件">
            <FolderOpen size={13} /> 选择 PLY 文件
          </button>
        </div>

        <input ref={inputRef} type="file" accept=".ply"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* ── 空闲状态：拖放区 ── */}
        {phase === 'idle' && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <div style={{ width: '100%', maxWidth: 520 }}>

              <div
                className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
                style={{ padding: '56px 32px', marginBottom: 20 }}
                onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFile(e.dataTransfer.files[0]) }}
                onClick={() => inputRef.current?.click()}
              >
                <div style={{ fontSize: 56, marginBottom: 16 }}>🔄</div>
                <h3 style={{ marginBottom: 8, fontSize: 18 }}>拖放 3DGS PLY 文件</h3>
                <p>浏览器内完成转换，文件不上传到任何服务器</p>
                <p style={{ marginTop: 8, color: 'var(--accent)', fontSize: 12 }}>
                  仅支持 3DGS 训练输出的高斯 PLY（含 f_dc、opacity、rot 等字段）
                </p>
              </div>

              {/* 流程说明 */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                gap: 10, marginBottom: 16
              }}>
                {[
                  { icon: '📂', title: '选择文件', desc: '.ply 本地文件' },
                  { icon: '⚡', title: '浏览器转换', desc: '自动 PLY→SPLAT' },
                  { icon: '🧊', title: '实时渲染', desc: '无需等待上传' },
                ].map((item, i) => (
                  <div key={i} style={{
                    padding: '14px 12px', background: 'var(--bg-card)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                ))}
              </div>

              {/* 训练路径提示 */}
              <div style={{
                padding: '12px 14px', background: 'var(--bg-card)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8
              }}>
                <div style={{ color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 4 }}>
                  📁 3DGS 训练输出文件路径
                </div>
                <code style={{ color: 'var(--accent)' }}>
                  output/point_cloud/iteration_30000/point_cloud.ply
                </code>
              </div>
            </div>
          </div>
        )}

        {/* ── 转换中 ── */}
        {phase === 'converting' && (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 20
          }}>
            <div style={{ fontSize: 48 }}>⚙️</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>
              正在转换...
            </div>
            <div style={{ width: 360 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{progressMsg}</span>
                <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{progress}%</span>
              </div>
              <div className="progress-track" style={{ height: 8, borderRadius: 4 }}>
                <div className="progress-fill" style={{ width: `${progress}%`, height: '100%' }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.8 }}>
              <div>文件: {fileInfo?.name}</div>
              <div>大小: {formatSize(fileInfo?.size || 0)}</div>
              <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                纯浏览器计算，处理大文件需要约 10-30 秒
              </div>
            </div>
          </div>
        )}

        {/* ── 查看器 ── */}
        {phase === 'viewing' && (
          <>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

            {/* 统计信息浮层 */}
            {stats && (
              <div style={{
                position: 'absolute', top: 16, left: 16,
                background: 'rgba(10,14,20,0.85)', backdropFilter: 'blur(8px)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)',
                lineHeight: 1.9, pointerEvents: 'none'
              }}>
                <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={12} /> 转换完成
                </div>
                <div>高斯点数：<b style={{ color: 'var(--text-primary)' }}>{Number(stats.count).toLocaleString()}</b></div>
                <div>原始大小：<b style={{ color: 'var(--text-primary)' }}>{stats.inMB} MB</b></div>
                <div>SPLAT 大小：<b style={{ color: 'var(--accent)' }}>{stats.outMB} MB</b>（{stats.ratio}x 压缩）</div>
              </div>
            )}

            {/* 操作提示 */}
            <div className="viewer-info">
              <div>旋转：左键拖动 &nbsp;|&nbsp; 缩放：滚轮 &nbsp;|&nbsp; 平移：右键拖动</div>
            </div>
          </>
        )}

        {/* ── 错误 ── */}
        {phase === 'error' && (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32
          }}>
            <div style={{ fontSize: 48 }}>⚠️</div>
            <div style={{ color: 'var(--red)', fontSize: 15, fontWeight: 600, textAlign: 'center', maxWidth: 500 }}>
              {error}
            </div>
            <div style={{
              fontSize: 12, color: 'var(--text-muted)', maxWidth: 480,
              background: 'var(--bg-card)', padding: '14px 18px',
              borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              lineHeight: 1.9
            }}>
              <div style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 6 }}>排查方向</div>
              <div>① 确认是 3DGS 训练输出（<code style={{ color: 'var(--accent)' }}>iteration_30000/point_cloud.ply</code>）</div>
              <div>② 普通点云 PLY（如 CloudCompare 导出）<b>不包含</b>高斯属性，无法渲染</div>
              <div>③ 文件过大（&gt;2GB）可能超出浏览器 ArrayBuffer 限制</div>
              <div>④ 按 F12 → Console 查看详细堆栈信息</div>
            </div>
            <button className="btn btn-primary" onClick={handleReset}>
              <RefreshCw size={14} /> 重新选择文件
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
