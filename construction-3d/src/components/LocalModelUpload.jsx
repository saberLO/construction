/**
 * LocalModelUpload.jsx — 本地 .splat / .ksplat 模型查看（含去噪）
 */

import { useState, useCallback, useRef } from 'react'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { FolderOpen, X, FileBox, Eye, EyeOff, RotateCcw, AlertCircle, Sparkles, RotateCw } from 'lucide-react'
import { formatSize } from '../utils/format'
import { useGaussianViewer } from '../hooks/useGaussianViewer'
import { analyzeSplatBuffer, filterSplatBuffer } from '../utils/splatFilter'
import ThreeTzViewer from './ThreeTzViewer'

/**
 * 从 splat buffer 计算包围盒 + 归一化参数
 */
function computeSplatBounds(buffer) {
  const view  = new DataView(buffer)
  const count = buffer.byteLength / 32
  if (count === 0) return null

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < count; i++) {
    const base = i * 32
    const x = view.getFloat32(base + 0,  true)
    const y = view.getFloat32(base + 4,  true)
    const z = view.getFloat32(base + 8,  true)
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue
    if (x < minX) minX = x;  if (x > maxX) maxX = x
    if (y < minY) minY = y;  if (y > maxY) maxY = y
    if (z < minZ) minZ = z;  if (z > maxZ) maxZ = z
  }

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2

  return { cx, cy, cz, radius, count }
}

export default function LocalModelUpload() {
  const [fileInfo,    setFileInfo]    = useState(null)
  const [isDragOver,  setIsDragOver]  = useState(false)
  const [phase,       setPhase]       = useState('idle')
  const [loadMsg,     setLoadMsg]     = useState('')
  const [error,       setError]       = useState('')
  const [debugInfo,   setDebugInfo]   = useState('')
  const [showInfo,    setShowInfo]    = useState(true)

  const [showFilter,     setShowFilter]     = useState(false)
  const [filterSettings, setFilterSettings] = useState({ opacityMin: 10, keepPercent: 95 })
  const [filterStats,    setFilterStats]    = useState(null)
  const [filtering,      setFiltering]      = useState(false)

  const { containerRef, viewerRef, mountedRef, blobUrlRef, destroyViewer } = useGaussianViewer()
  const threeTzViewerRef  = useRef(null)
  const inputRef          = useRef(null)
  const originalBufferRef = useRef(null)
  const analysisRef       = useRef(null)

  const loadBufferIntoViewer = async (buffer, fmt = 'splat') => {
    destroyViewer()
    await new Promise(r => setTimeout(r, 30))
    if (!mountedRef.current || !containerRef.current) return

    const isKsplat = fmt === 'ksplat'
    let scenePosition, sceneScale, debugText

    if (!isKsplat) {
      // splat 格式：每点 32 字节，可手动解析包围盒
      const bounds = computeSplatBounds(buffer)
      if (!bounds) throw new Error('无法读取高斯点坐标')
      const { cx, cy, cz, radius, count } = bounds
      const normScale = Math.max(radius, 0.1)
      scenePosition = [-cx / normScale, -cy / normScale, -cz / normScale]
      sceneScale = [1 / normScale, 1 / normScale, 1 / normScale]
      debugText = `${count.toLocaleString()} 个高斯点 ｜ 场景半径 ${radius.toFixed(2)}m ｜ 中心 (${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)})`
    } else {
      // ksplat 格式：压缩结构，无法按 32 字节解析，交由库内部处理
      debugText = `KSplat 格式 ｜ 文件大小 ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`
    }

    const viewer = new GaussianSplats3D.Viewer({
      selfDrivenMode:          true,
      useBuiltInControls:      true,
      rootElement:             containerRef.current,
      cameraUp:               [0, -1, 0],
      initialCameraPosition:  [0, 0, Math.max(2.5, 1.0)],
      initialCameraLookAt:    [0, 0, 0],
      sharedMemoryForWorkers:  false,
      dynamicScene:            false,
    })
    viewerRef.current = viewer

    const blob    = new Blob([buffer], { type: 'application/octet-stream' })
    const blobUrl = URL.createObjectURL(blob)
    blobUrlRef.current = blobUrl

    const sceneOpts = {
      format: isKsplat ? GaussianSplats3D.SceneFormat.KSplat : GaussianSplats3D.SceneFormat.Splat,
    }
    if (scenePosition) sceneOpts.position = scenePosition
    if (sceneScale) sceneOpts.scale = sceneScale

    await viewer.addSplatScene(blobUrl, sceneOpts)

    if (!mountedRef.current) { destroyViewer(); return }

    viewer.start()
    setDebugInfo(debugText)
  }

  const handleThreeTzProgress = useCallback((msg, pct) => {
    setPhase('loading')
    setLoadMsg(`${msg} (${pct}%)`)
  }, [])

  const handleThreeTzLoaded = useCallback((info) => {
    setPhase('loaded')
    if (info.boundingRadius) {
       setDebugInfo(`3D Tiles 场景半径: ${info.boundingRadius.toFixed(2)}m ｜ 文件数: ${info.entryCount}`)
    } else {
       setDebugInfo(`3D Tiles 文件数: ${info.entryCount} ｜ 解析完成`)
    }
  }, [])

  const handleThreeTzError = useCallback((msg) => {
    setError(msg)
    setPhase('error')
  }, [])

  const loadFile = useCallback(async (file) => {
    if (!file) return

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    const fmt = { '.splat': 'splat', '.ksplat': 'ksplat', '.ply': 'ply', '.3tz': '3tz' }[ext]
    if (!fmt) { setError(`不支持 ${ext}，请选择 .splat / .ksplat / .3tz 文件`); return }
    if (fmt === 'ply') { setError('请先用 PLY→SPLAT 标签页转换后再加载'); return }

    setError('')
    setPhase('loading')
    setLoadMsg('读取文件...')
    setFileInfo({ name: file.name, size: file.size, format: fmt, fileObj: file })
    setDebugInfo('')
    setFilterStats(null)
    setShowFilter(false)
    destroyViewer()

    if (fmt === '3tz') {
      // 3tz 由子组件挂载时处理自己的生命周期
      return
    }

    await new Promise(r => setTimeout(r, 30))
    if (!mountedRef.current || !containerRef.current) return

    let buffer
    try {
      setLoadMsg('读取文件数据...')
      buffer = await file.arrayBuffer()
    } catch (e) {
      setError('文件读取失败：' + e.message)
      setPhase('error')
      return
    }
    if (!mountedRef.current) return

    originalBufferRef.current = buffer
    // ksplat 是压缩格式，无法按 splat 32字节结构分析，跳过去噪预分析
    analysisRef.current = fmt === 'splat' ? analyzeSplatBuffer(buffer) : null

    setLoadMsg('初始化渲染器...')
    try {
      await loadBufferIntoViewer(buffer, fmt)
      setPhase('loaded')
    } catch (e) {
      console.error('[LocalViewer] 加载失败:', e)
      if (!mountedRef.current) return
      destroyViewer()
      setError(e.message || '模型加载失败')
      setPhase('error')
    }
  }, [])

  const handleApplyFilter = async () => {
    if (!originalBufferRef.current || !analysisRef.current) return
    setFiltering(true)
    setPhase('loading')
    setLoadMsg('去噪处理中...')

    await new Promise(r => setTimeout(r, 80))

    try {
      const result = filterSplatBuffer(originalBufferRef.current, analysisRef.current, filterSettings)
      setFilterStats(result)
      await loadBufferIntoViewer(result.buffer)
      setPhase('loaded')
    } catch (e) {
      setError('去噪处理失败: ' + e.message)
      setPhase('error')
    } finally {
      setFiltering(false)
    }
  }

  const handleResetFilter = async () => {
    if (!originalBufferRef.current) return
    setFilterStats(null)
    setFilterSettings({ opacityMin: 10, keepPercent: 95 })
    setPhase('loading')
    setLoadMsg('还原原始模型...')
    try {
      await loadBufferIntoViewer(originalBufferRef.current)
      setPhase('loaded')
    } catch (e) {
      setError('还原失败: ' + e.message)
      setPhase('error')
    }
  }

  const handleReset = () => {
    destroyViewer()
    setPhase('idle')
    setFileInfo(null)
    setError('')
    setDebugInfo('')
    setFilterStats(null)
    setShowFilter(false)
    originalBufferRef.current = null
    analysisRef.current = null
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleResetCamera = () => {
    if (fileInfo?.format === '3tz') {
      threeTzViewerRef.current?.resetCamera?.()
    } else {
      viewerRef.current?.resetCamera?.()
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* 顶部栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 16px', background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        {fileInfo ? (
          <>
            <FileBox size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileInfo.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{formatSize(fileInfo.size)}</span>
            <span style={{
              fontSize: 11, padding: '2px 8px', background: 'var(--accent-dim)',
              color: 'var(--accent)', borderRadius: 4, flexShrink: 0,
              fontFamily: 'var(--font-display)', letterSpacing: 1
            }}>.{fileInfo.format.toUpperCase()}</span>
          </>
        ) : (
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 1, flex: 1 }}>
            本地模型查看
          </span>
        )}

        {phase === 'loaded' && (
          <>
            {fileInfo?.format !== '3tz' && (
              <button
                className={`btn btn-sm ${showFilter ? 'btn-filter-active' : 'btn-ghost'}`}
                onClick={() => setShowFilter(p => !p)}
                aria-label="模型去噪"
                title="模型去噪"
              >
                <Sparkles size={13} />
                去噪
                {filterStats && (
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 10,
                    background: 'var(--green-dim)', color: 'var(--green)', marginLeft: 2,
                  }}>
                    -{filterStats.removed.toLocaleString()}
                  </span>
                )}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInfo(p => !p)} title="显示/隐藏信息" aria-label={showInfo ? '隐藏信息' : '显示信息'}>
              {showInfo ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleResetCamera} title="复位视角" aria-label="复位视角">
              <RotateCcw size={13} />
            </button>
          </>
        )}
        {fileInfo && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()} title="换文件" aria-label="更换文件">
              <FolderOpen size={13} /> 换文件
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleReset} title="关闭" aria-label="关闭模型">
              <X size={13} />
            </button>
          </>
        )}
        {!fileInfo && (
          <button className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} aria-label="选择本地模型文件">
            <FolderOpen size={13} /> 选择文件
          </button>
        )}
        <input ref={inputRef} type="file" accept=".splat,.ksplat,.3tz"
          style={{ display: 'none' }}
          onChange={e => loadFile(e.target.files[0])} />
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#050810' }}>

        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', display: phase === 'loaded' && fileInfo?.format !== '3tz' ? 'block' : 'none' }}
        />

        {fileInfo?.format === '3tz' && phase !== 'idle' && phase !== 'error' && (
           <div style={{ display: phase === 'loaded' ? 'block' : 'none', width: '100%', height: '100%' }}>
              <ThreeTzViewer
                ref={threeTzViewerRef}
                file={fileInfo.fileObj}
                onLoaded={handleThreeTzLoaded}
                onProgress={handleThreeTzProgress}
                onError={handleThreeTzError}
              />
           </div>
        )}

        {/* 去噪面板 */}
        {showFilter && phase === 'loaded' && (
          <div className="filter-panel">
            <div className="filter-panel-header">
              <Sparkles size={14} style={{ color: 'var(--accent)' }} />
              <span>模型去噪</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto', padding: '2px 4px' }}
                onClick={() => setShowFilter(false)}
                aria-label="关闭去噪面板"
              >
                <X size={12} />
              </button>
            </div>
            <div className="filter-panel-body">
              <div className="filter-slider-group">
                <div className="filter-slider-label">
                  <span>最低不透明度</span>
                  <span className="filter-slider-value">{filterSettings.opacityMin}%</span>
                </div>
                <input type="range" min={0} max={60} value={filterSettings.opacityMin}
                  onChange={e => setFilterSettings(s => ({ ...s, opacityMin: +e.target.value }))}
                  className="filter-range" />
                <div className="filter-slider-hint">移除半透明的噪点浮块</div>
              </div>
              <div className="filter-slider-group">
                <div className="filter-slider-label">
                  <span>保留范围</span>
                  <span className="filter-slider-value">{filterSettings.keepPercent}%</span>
                </div>
                <input type="range" min={50} max={100} value={filterSettings.keepPercent}
                  onChange={e => setFilterSettings(s => ({ ...s, keepPercent: +e.target.value }))}
                  className="filter-range" />
                <div className="filter-slider-hint">裁去远离场景中心的离群点</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleApplyFilter} disabled={filtering}>
                  {filtering ? <><RotateCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> 处理中...</> : <><Sparkles size={12} /> 应用去噪</>}
                </button>
                {filterStats && (
                  <button className="btn btn-ghost btn-sm" onClick={handleResetFilter} disabled={filtering} aria-label="还原原始模型">还原</button>
                )}
              </div>
              {filterStats && (
                <div className="filter-stats">
                  <div>移除 <b style={{ color: 'var(--red)' }}>{filterStats.removed.toLocaleString()}</b> 个噪点</div>
                  <div>保留 <b style={{ color: 'var(--green)' }}>{filterStats.kept.toLocaleString()}</b> / {filterStats.total.toLocaleString()} 个高斯点（{(filterStats.kept / filterStats.total * 100).toFixed(1)}%）</div>
                </div>
              )}
              {analysisRef.current && !filterStats && (
                <div className="filter-stats" style={{ color: 'var(--text-muted)' }}>
                  模型共 {analysisRef.current.count.toLocaleString()} 个高斯点
                </div>
              )}
            </div>
          </div>
        )}

        {/* 空闲：拖放区 */}
        {phase === 'idle' && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <div style={{ width: '100%', maxWidth: 500 }}>
              <div
                className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
                style={{ padding: '52px 32px', marginBottom: 16 }}
                onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => { e.preventDefault(); setIsDragOver(false); loadFile(e.dataTransfer.files[0]) }}
                onClick={() => inputRef.current?.click()}
              >
                <div style={{ fontSize: 52, marginBottom: 16 }}>🧊</div>
                <h3 style={{ marginBottom: 8 }}>拖放 .splat 文件到此处</h3>
                <p style={{ marginBottom: 12 }}>或点击选择文件</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                  {['.splat', '.ksplat', '.3tz'].map(ext => (
                    <span key={ext} style={{
                      padding: '3px 10px', background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)', borderRadius: 4,
                      fontFamily: 'var(--font-display)', fontSize: 12,
                      color: 'var(--text-secondary)'
                    }}>{ext}</span>
                  ))}
                </div>
              </div>
              {error && (
                <div style={{
                  padding: '10px 14px', marginBottom: 12,
                  background: 'rgba(255,77,77,0.1)', border: '1px solid rgba(255,77,77,0.3)',
                  borderRadius: 'var(--radius)', color: 'var(--red)',
                  fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start'
                }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  {error}
                </div>
              )}
              <div style={{
                padding: '12px 14px', background: 'var(--bg-card)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.9
              }}>
                <div style={{ color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 4 }}>💡 提示</div>
                <div>• 支持 <b style={{ color: 'var(--accent)' }}>.splat</b>、<b style={{ color: 'var(--accent)' }}>.ksplat</b> 格式高斯点云直接查看</div>
                <div>• 新增支持 <b style={{ color: 'var(--accent)' }}>.3tz</b> 格式（ArcGIS/大疆智图等导出的 3D Tiles 包）渲染</div>
                <div>• 请先用上方 <b style={{ color: 'var(--accent)' }}>PLY→SPLAT</b> 工具转换 .ply 文件</div>
              </div>
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div className="loading-screen">
            <div className="loading-spinner" />
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {loadMsg}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {fileInfo && formatSize(fileInfo.size)}
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="loading-screen">
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ color: 'var(--red)', fontSize: 14, marginBottom: 16, maxWidth: 400, textAlign: 'center' }}>
              {error}
            </div>
            <button className="btn btn-secondary" onClick={handleReset}>重新选择文件</button>
          </div>
        )}

        {phase === 'loaded' && showInfo && debugInfo && (
          <div className="viewer-info">
            <div>旋转：左键拖动 &nbsp;|&nbsp; 缩放：滚轮 &nbsp;|&nbsp; 平移：右键拖动</div>
            <div style={{ marginTop: 4, color: 'var(--green)', fontSize: 11 }}>{debugInfo}</div>
          </div>
        )}
      </div>
    </div>
  )
}
