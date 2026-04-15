import { useState, useEffect, useRef, useCallback } from 'react'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import {
  RotateCcw, Eye, EyeOff, Download, Sparkles, X, RotateCw,
  Orbit, Upload, Camera, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useGaussianViewer } from '../hooks/useGaussianViewer'
import { analyzeSplatBuffer, filterSplatBuffer } from '../utils/splatFilter'
import { toAbsoluteUrl } from '../utils/resolveAssetUrl'
import { parseCamerasJson, applyColmapPresetToViewer } from '../utils/cameraPresets'

/** 与库内部 LoaderStatus 一致（未导出） */
const LoaderStatus = { Downloading: 0, Processing: 1, Done: 2 }

export default function ModelViewer({ modelUrl, modelFormat, camerasUrl }) {
  const [phase,    setPhase]    = useState('empty')
  const [error,    setError]    = useState('')
  const [showInfo, setShowInfo] = useState(true)

  const [showFilter,    setShowFilter]    = useState(false)
  const [filterSettings, setFilterSettings] = useState({ opacityMin: 10, keepPercent: 95 })
  const [filterStats,   setFilterStats]   = useState(null)
  const [filtering,     setFiltering]     = useState(false)

  const [loadProgress, setLoadProgress]   = useState(0)
  const [carouselOn,   setCarouselOn]   = useState(true)
  const [cameraPresets, setCameraPresets] = useState([])
  const [presetIndex,  setPresetIndex]  = useState(0)
  const [showCamPanel,  setShowCamPanel]  = useState(false)

  const { containerRef, viewerRef, mountedRef, blobUrlRef, destroyViewer } = useGaussianViewer()

  const disposeViewerExtra = useCallback(() => {
    try { viewerRef.current?._gsDetachInteraction?.() } catch (_) { /* noop */ }
    destroyViewer()
  }, [destroyViewer])
  const currentUrlRef     = useRef(null)
  const originalBufferRef = useRef(null)
  const analysisRef       = useRef(null)
  const loadPollRef       = useRef(null)
  const camerasFileRef    = useRef(null)
  const carouselOnRef     = useRef(carouselOn)

  useEffect(() => { carouselOnRef.current = carouselOn }, [carouselOn])

  const clearLoadPoll = () => {
    if (loadPollRef.current) {
      clearInterval(loadPollRef.current)
      loadPollRef.current = null
    }
  }

  useEffect(() => {
    if (!modelUrl) {
      currentUrlRef.current = null
      setPhase('empty')
      setShowFilter(false)
      setFilterStats(null)
      setLoadProgress(0)
      setCameraPresets([])
      originalBufferRef.current = null
      analysisRef.current = null
      clearLoadPoll()
      disposeViewerExtra()
      return
    }
    if (currentUrlRef.current === modelUrl) return
    currentUrlRef.current = modelUrl
    fetchAndLoad(modelUrl)
  }, [modelUrl, modelFormat])

  /** 后台拉取完整 splat，供去噪使用（渐进加载不保留整包缓冲） */
  const prefetchFullBufferForDenoise = useCallback(async (url) => {
    if (modelFormat === 'ply' || modelFormat === 'ksplat' || !url || originalBufferRef.current) return
    try {
      const abs = toAbsoluteUrl(url)
      const res = await fetch(abs)
      if (!res.ok) return
      const buffer = await res.arrayBuffer()
      if (!mountedRef.current) return
      originalBufferRef.current = buffer
      analysisRef.current = analyzeSplatBuffer(buffer)
    } catch (e) {
      console.warn('[ModelViewer] 预取去噪缓冲失败:', e)
    }
  }, [modelFormat])

  const ensureBufferForDenoise = async () => {
    if (modelFormat === 'ply' || modelFormat === 'ksplat') {
      setError('当前为 ' + (modelFormat === 'ply' ? 'PLY' : 'KSplat') + ' 模型，去噪仅支持 SPLAT 格式')
      return false
    }
    if (originalBufferRef.current && analysisRef.current) return true
    if (!modelUrl) return false
    try {
      const res = await fetch(toAbsoluteUrl(modelUrl))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = await res.arrayBuffer()
      originalBufferRef.current = buffer
      analysisRef.current = analyzeSplatBuffer(buffer)
      return true
    } catch (e) {
      console.error(e)
      setError('下载模型失败，无法进行去噪处理')
      return false
    }
  }

  const syncCarouselControls = useCallback((viewer, on) => {
    const c = viewer?.controls
    if (!c) return
    c.autoRotate = !!on
    c.autoRotateSpeed = 0.9
    c.enableDamping = true
    c.update?.()
  }, [])

  const attachControlInteraction = useCallback((viewer) => {
    const c = viewer?.controls
    if (!c) return () => {}
    const stopCarousel = () => {
      setCarouselOn(false)
      carouselOnRef.current = false
      c.autoRotate = false
    }
    c.addEventListener('start', stopCarousel)
    return () => {
      try { c.removeEventListener('start', stopCarousel) } catch (_) { /* noop */ }
    }
  }, [])

  useEffect(() => {
    const v = viewerRef.current
    if (phase !== 'loaded' || !v) return
    syncCarouselControls(v, carouselOn)
  }, [carouselOn, phase, syncCarouselControls])

  useEffect(() => {
    if (!camerasUrl || phase !== 'loaded') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(toAbsoluteUrl(camerasUrl))
        if (!res.ok) return
        const text = await res.text()
        if (cancelled || !mountedRef.current) return
        const list = parseCamerasJson(text)
        setCameraPresets(list)
        setPresetIndex(0)
        if (list.length) setShowCamPanel(true)
      } catch (e) {
        console.warn('[ModelViewer] 加载 cameras.json 失败:', e)
      }
    })()
    return () => { cancelled = true }
  }, [camerasUrl, phase, modelUrl])

  const applyPresetAt = useCallback((idx) => {
    const v = viewerRef.current
    const list = cameraPresets
    if (!v || !list.length) return
    const i = ((idx % list.length) + list.length) % list.length
    setPresetIndex(i)
    applyColmapPresetToViewer(v, list[i])
    setCarouselOn(false)
    carouselOnRef.current = false
    syncCarouselControls(v, false)
  }, [cameraPresets, syncCarouselControls])

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      if (phase !== 'loaded' || !cameraPresets.length) return
      if (!/^[0-9]$/.test(e.key)) return
      e.preventDefault()
      const n = parseInt(e.key, 10)
      const idx = n >= cameraPresets.length ? cameraPresets.length - 1 : n
      applyPresetAt(idx)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, cameraPresets, applyPresetAt])

  const fetchAndLoad = async (url) => {
    setPhase('loading')
    setError('')
    setFilterStats(null)
    setShowFilter(false)
    setLoadProgress(0)
    setCarouselOn(true)
    carouselOnRef.current = true
    setCameraPresets([])
    clearLoadPoll()
    disposeViewerExtra()
    originalBufferRef.current = null
    analysisRef.current = null

    const absoluteUrl = toAbsoluteUrl(url)
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase()
    const wantPly = modelFormat === 'ply' || ext === 'ply'
    const wantKsplat = modelFormat === 'ksplat' || ext === 'ksplat'
    const canProgressive = !url.startsWith('blob:') && (ext === 'splat' || ext === 'ksplat' || ext === 'ply')

    const sceneFormat = wantPly ? GaussianSplats3D.SceneFormat.Ply
                      : wantKsplat ? GaussianSplats3D.SceneFormat.KSplat
                      : GaussianSplats3D.SceneFormat.Splat

    try {
      if (canProgressive) {
        await loadFromUrlProgressive(absoluteUrl, sceneFormat)
      } else {
        const response = await fetch(absoluteUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const buffer = await response.arrayBuffer()
        if (!mountedRef.current) return
        if (!wantPly && !wantKsplat) {
          originalBufferRef.current = buffer
          analysisRef.current = analyzeSplatBuffer(buffer)
        }
        await loadFromBuffer(buffer, { format: sceneFormat })
      }
    } catch (e) {
      if (canProgressive) {
        console.warn('[ModelViewer] 渐进加载失败，回退整包下载:', e)
        try {
          const response = await fetch(absoluteUrl)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const buffer = await response.arrayBuffer()
          if (!mountedRef.current) return
          if (!wantPly && !wantKsplat) {
            originalBufferRef.current = buffer
            analysisRef.current = analyzeSplatBuffer(buffer)
          }
          await loadFromBuffer(buffer, { format: sceneFormat })
          return
        } catch (e2) {
          console.error('[ModelViewer] 回退加载失败:', e2)
          if (!mountedRef.current) return
          setError(e2.message || '模型加载失败')
          setPhase('error')
          return
        }
      }
      console.error('[ModelViewer] 加载失败:', e)
      if (!mountedRef.current) return
      setError(e.message || '模型加载失败')
      setPhase('error')
    }
  }

  const loadFromUrlProgressive = async (absoluteUrl, format) => {
    disposeViewerExtra()
    await new Promise(r => setTimeout(r, 50))
    if (!mountedRef.current || !containerRef.current) return

    const viewer = new GaussianSplats3D.Viewer({
      selfDrivenMode:         true,
      useBuiltInControls:     true,
      rootElement:            containerRef.current,
      cameraUp:               [0, -1, 0],
      sharedMemoryForWorkers: false,
      dynamicScene:           false,
    })
    viewerRef.current = viewer

    let detachInteraction = () => {}

    await viewer.addSplatScene(absoluteUrl, {
      format,
      progressiveLoad: true,
      showLoadingUI: false,
      splatAlphaRemovalThreshold: 1,
      onProgress: (pct, _label, status) => {
        if (status === LoaderStatus.Downloading) setLoadProgress(Math.min(100, Math.round(pct)))
        if (status === LoaderStatus.Done) setLoadProgress(100)
      },
    })

    if (!mountedRef.current) { disposeViewerExtra(); return }

    viewer.start()
    setPhase('loaded')
    setLoadProgress(100)
    syncCarouselControls(viewer, carouselOnRef.current)
    detachInteraction = attachControlInteraction(viewer)

    clearLoadPoll()
    loadPollRef.current = setInterval(() => {
      const v = viewerRef.current
      if (!v || !mountedRef.current) return
      try {
        if (!v.isLoadingOrUnloading?.()) {
          clearLoadPoll()
          prefetchFullBufferForDenoise(absoluteUrl)
        }
      } catch (_) { /* noop */ }
    }, 250)

    viewer._gsDetachInteraction = detachInteraction
  }

  const loadFromBuffer = async (buffer, { format = GaussianSplats3D.SceneFormat.Splat } = {}) => {
    clearLoadPoll()
    disposeViewerExtra()
    await new Promise(r => setTimeout(r, 50))
    if (!mountedRef.current || !containerRef.current) return

    try {
      const viewer = new GaussianSplats3D.Viewer({
        selfDrivenMode:         true,
        useBuiltInControls:     true,
        rootElement:            containerRef.current,
        cameraUp:               [0, -1, 0],
        sharedMemoryForWorkers: false,
        dynamicScene:           false,
      })
      viewerRef.current = viewer

      const blob = new Blob([buffer], { type: 'application/octet-stream' })
      const bUrl = URL.createObjectURL(blob)
      blobUrlRef.current = bUrl

      await viewer.addSplatScene(bUrl, {
        format,
        progressiveLoad: false,
        showLoadingUI: false,
      })

      if (!mountedRef.current) { disposeViewerExtra(); return }

      viewer.start()
      setPhase('loaded')
      setLoadProgress(100)
      syncCarouselControls(viewer, carouselOnRef.current)
      const detach = attachControlInteraction(viewer)
      viewer._gsDetachInteraction = detach
    } catch (e) {
      console.error('[ModelViewer] 渲染失败:', e)
      if (!mountedRef.current) return
      disposeViewerExtra()
      setError(e.message || '模型渲染失败')
      setPhase('error')
    }
  }

  const handleApplyFilter = async () => {
    const ok = await ensureBufferForDenoise()
    if (!ok) {
      setPhase('loaded')
      return
    }
    if (!analysisRef.current) {
      setPhase('loaded')
      setError('无法分析模型数据，请稍后重试')
      return
    }
    setFiltering(true)
    setPhase('loading')

    await new Promise(r => setTimeout(r, 80))

    try {
      const result = filterSplatBuffer(originalBufferRef.current, analysisRef.current, filterSettings)
      setFilterStats(result)
      await loadFromBuffer(result.buffer)
    } catch (e) {
      console.error('[ModelViewer] 去噪失败:', e)
      setError('去噪处理失败: ' + e.message)
      setPhase('error')
    } finally {
      setFiltering(false)
    }
  }

  const handleResetFilter = async () => {
    if (!originalBufferRef.current) {
      const ok = await ensureBufferForDenoise()
      if (!ok) return
    }
    setFilterStats(null)
    setFilterSettings({ opacityMin: 10, keepPercent: 95 })
    setPhase('loading')
    await loadFromBuffer(originalBufferRef.current)
  }

  const handleResetCamera = () => {
    const v = viewerRef.current
    try {
      v?.controls?.reset?.()
    } catch (_) { /* noop */ }
  }

  const handleUploadCameras = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fr = new FileReader()
    fr.onload = () => {
      try {
        const list = parseCamerasJson(String(fr.result))
        setCameraPresets(list)
        setPresetIndex(0)
        setShowCamPanel(true)
        if (list.length && viewerRef.current) applyPresetAt(0)
      } catch (err) {
        setError('cameras.json 格式无效: ' + err.message)
      }
    }
    fr.readAsText(file)
    e.target.value = ''
  }

  const showCanvas = modelUrl && phase !== 'empty' && phase !== 'error'
  const hasCameras = cameraPresets.length > 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '8px 16px', background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
          letterSpacing: 1, flex: '1 1 120px'
        }}>
          三维模型查看器
        </span>

        {phase === 'loaded' && (
          <>
            <button
              type="button"
              className={`btn btn-sm ${carouselOn ? 'btn-filter-active' : 'btn-ghost'}`}
              onClick={() => setCarouselOn(p => !p)}
              aria-label={carouselOn ? '关闭自动旋转展示' : '开启自动旋转展示'}
              title="绕场景缓慢旋转（点击画布操作后会自动关闭）"
            >
              <Orbit size={13} />
              {carouselOn ? '自动旋转开' : '自动旋转关'}
            </button>

            <button
              type="button"
              className={`btn btn-sm ${showCamPanel ? 'btn-filter-active' : 'btn-ghost'}`}
              onClick={() => setShowCamPanel(p => !p)}
              aria-label="拍摄视角预设"
              title="COLMAP 相机位姿（任务完成后由服务端生成，也可本地上传）"
            >
              <Camera size={13} />
              视角
              {hasCameras && <span style={{ marginLeft: 4, opacity: 0.85 }}>({cameraPresets.length})</span>}
            </button>

            <input
              ref={camerasFileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleUploadCameras}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => camerasFileRef.current?.click()}
              aria-label="上传 cameras.json"
              title="上传 antimatter15/splat 风格的 cameras.json"
            >
              <Upload size={13} /> 上传相机 JSON
            </button>

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
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInfo(p => !p)} title="显示/隐藏信息" aria-label={showInfo ? '隐藏操作提示' : '显示操作提示'}>
              {showInfo ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleResetCamera} title="复位视角" aria-label="复位视角">
              <RotateCcw size={13} />
            </button>
          </>
        )}

        {modelUrl && (
          <a href={modelUrl} download="scene.splat" className="btn btn-ghost btn-sm" title="下载模型文件" aria-label="下载模型文件">
            <Download size={13} /> 下载
          </a>
        )}
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#050810' }}>

        {phase === 'loading' && (
          <div
            className="viewer-progress-bar"
            style={{ width: `${Math.max(3, loadProgress)}%` }}
            role="progressbar"
            aria-valuenow={loadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        )}

        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            display: showCanvas ? 'block' : 'none',
          }}
        />

        {/* 视角预设面板 */}
        {showCamPanel && phase === 'loaded' && (
          <div className="viewer-camera-panel">
            <div className="viewer-camera-panel-header">
              <Camera size={14} style={{ color: 'var(--accent)' }} />
              <span>拍摄视角</span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 4px' }} onClick={() => setShowCamPanel(false)} aria-label="关闭视角面板">
                <X size={12} />
              </button>
            </div>
            <div className="viewer-camera-panel-body">
              {!hasCameras && (
                <p className="viewer-camera-hint">
                  若云端已安装 <code>colmap</code>，任务完成后会自动提供相机文件；也可点击「上传相机 JSON」导入与 splat 演示相同格式的列表。
                </p>
              )}
              {hasCameras && (
                <>
                  <div className="viewer-camera-nav">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPresetAt(presetIndex - 1)} aria-label="上一视角">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="viewer-camera-title">
                      {cameraPresets[presetIndex]?.img_name || `视角 ${presetIndex + 1}`}
                      <span className="viewer-camera-sub"> {presetIndex + 1}/{cameraPresets.length}</span>
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPresetAt(presetIndex + 1)} aria-label="下一视角">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="viewer-camera-chips">
                    {cameraPresets.slice(0, 12).map((c, i) => (
                      <button
                        key={`${c.img_name}-${i}`}
                        type="button"
                        className={`viewer-camera-chip ${i === presetIndex ? 'active' : ''}`}
                        onClick={() => applyPresetAt(i)}
                      >
                        {i}
                      </button>
                    ))}
                    {cameraPresets.length > 12 && <span className="viewer-camera-more">…共 {cameraPresets.length} 个，可用键盘 0–9 快速切换</span>}
                  </div>
                </>
              )}
            </div>
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
                <input
                  type="range"
                  min={0}
                  max={60}
                  value={filterSettings.opacityMin}
                  onChange={e => setFilterSettings(s => ({ ...s, opacityMin: +e.target.value }))}
                  className="filter-range"
                />
                <div className="filter-slider-hint">移除半透明的噪点浮块</div>
              </div>

              <div className="filter-slider-group">
                <div className="filter-slider-label">
                  <span>保留范围</span>
                  <span className="filter-slider-value">{filterSettings.keepPercent}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={filterSettings.keepPercent}
                  onChange={e => setFilterSettings(s => ({ ...s, keepPercent: +e.target.value }))}
                  className="filter-range"
                />
                <div className="filter-slider-hint">裁去远离场景中心的离群点</div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1 }}
                  onClick={handleApplyFilter}
                  disabled={filtering}
                >
                  {filtering ? (
                    <><RotateCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> 处理中...</>
                  ) : (
                    <><Sparkles size={12} /> 应用去噪</>
                  )}
                </button>
                {filterStats && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleResetFilter}
                    disabled={filtering}
                    aria-label="还原原始模型"
                  >
                    还原
                  </button>
                )}
              </div>

              {filterStats && (
                <div className="filter-stats">
                  <div>
                    移除 <b style={{ color: 'var(--red)' }}>{filterStats.removed.toLocaleString()}</b> 个噪点
                  </div>
                  <div>
                    保留 <b style={{ color: 'var(--green)' }}>{filterStats.kept.toLocaleString()}</b> / {filterStats.total.toLocaleString()} 个高斯点
                    （{(filterStats.kept / filterStats.total * 100).toFixed(1)}%）
                  </div>
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

        {phase === 'empty' && (
          <div className="empty-state">
            <div className="icon">🏗️</div>
            <h3>尚未选择模型</h3>
            <p>从左侧任务列表选择一个已完成的建模任务</p>
          </div>
        )}

        {phase === 'loading' && (
          <div className="loading-screen" style={{ pointerEvents: 'none' }}>
            <div className="loading-spinner" />
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {filtering ? '去噪处理中...' : '加载 3D 模型...'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {filtering ? '正在重建场景' : `${loadProgress}% · ${modelUrl?.split('/').pop()}`}
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="loading-screen">
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ color: 'var(--red)', fontSize: 14, marginBottom: 16, maxWidth: 400, textAlign: 'center' }}>
              {error}
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => modelUrl && fetchAndLoad(modelUrl)}
            >
              重新加载
            </button>
          </div>
        )}

        {phase === 'loaded' && showInfo && (
          <div className="viewer-info">
            <div>旋转：左键拖动 &nbsp;|&nbsp; 缩放：滚轮 &nbsp;|&nbsp; 平移：右键拖动</div>
            {hasCameras && <div style={{ marginTop: 4 }}>键盘 <kbd>0</kbd>–<kbd>9</kbd> 快速切换前 10 个拍摄视角</div>}
            {carouselOn && <div style={{ marginTop: 4, opacity: 0.9 }}>自动旋转展示中，操作模型后会暂停</div>}
          </div>
        )}
      </div>
    </div>
  )
}
