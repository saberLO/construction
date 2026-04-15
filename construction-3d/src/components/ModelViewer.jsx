import { useState, useEffect, useRef, useCallback } from 'react'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import { useGaussianViewer } from '../hooks/useGaussianViewer'
import { useSplatFilter } from '../hooks/useSplatFilter'
import { toAbsoluteUrl } from '../utils/resolveAssetUrl'
import { parseCamerasJson, applyColmapPresetToViewer } from '../utils/cameraPresets'
import ViewerToolbar from './ViewerToolbar'
import DenoisePanel from './DenoisePanel'
import CameraPresetPanel from './CameraPresetPanel'

/** 与库内部 LoaderStatus 一致（未导出） */
const LoaderStatus = { Downloading: 0, Processing: 1, Done: 2 }

export default function ModelViewer({ modelUrl, modelFormat, camerasUrl }) {
  /* ─── 基础状态 ──────────────────────────────────────────── */
  const [phase,    setPhase]    = useState('empty')
  const [error,    setError]    = useState('')
  const [showInfo, setShowInfo] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)

  /* ─── 去噪状态 ──────────────────────────────────────────── */
  const [showFilter,     setShowFilter]     = useState(false)
  const [filterSettings, setFilterSettings] = useState({ opacityMin: 10, keepPercent: 95 })
  const [filterStats,    setFilterStats]    = useState(null)
  const [filtering,      setFiltering]      = useState(false)

  /* ─── 旋转展示 ──────────────────────────────────────────── */
  const [carouselOn, setCarouselOn] = useState(true)

  /* ─── 相机预设 ──────────────────────────────────────────── */
  const [cameraPresets, setCameraPresets] = useState([])
  const [presetIndex,   setPresetIndex]   = useState(0)
  const [showCamPanel,  setShowCamPanel]  = useState(false)

  /* ─── refs ──────────────────────────────────────────────── */
  const { containerRef, viewerRef, mountedRef, blobUrlRef, destroyViewer } = useGaussianViewer()
  const { analyze: workerAnalyze, filter: workerFilter } = useSplatFilter()

  const currentUrlRef     = useRef(null)
  const originalBufferRef = useRef(null)
  const analysisRef       = useRef(null)
  const loadPollRef       = useRef(null)
  const camerasFileRef    = useRef(null)
  const carouselOnRef     = useRef(carouselOn)

  useEffect(() => { carouselOnRef.current = carouselOn }, [carouselOn])

  /* ─── 清理工具 ──────────────────────────────────────────── */
  const disposeViewerExtra = useCallback(() => {
    try { viewerRef.current?._gsDetachInteraction?.() } catch (_) { /* noop */ }
    destroyViewer()
  }, [destroyViewer])

  const clearLoadPoll = () => {
    if (loadPollRef.current) {
      clearInterval(loadPollRef.current)
      loadPollRef.current = null
    }
  }

  /* ─── 旋转控制 ──────────────────────────────────────────── */
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
    return () => { try { c.removeEventListener('start', stopCarousel) } catch (_) { /* noop */ } }
  }, [])

  useEffect(() => {
    const v = viewerRef.current
    if (phase !== 'loaded' || !v) return
    syncCarouselControls(v, carouselOn)
  }, [carouselOn, phase, syncCarouselControls])

  /* ─── 模型加载入口 ──────────────────────────────────────── */
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

  /* ─── 后台拉取完整缓冲（供去噪） ─────────────────────────── */
  const prefetchFullBufferForDenoise = useCallback(async (url) => {
    if (modelFormat === 'ply' || modelFormat === 'ksplat' || !url || originalBufferRef.current) return
    try {
      const abs = toAbsoluteUrl(url)
      const res = await fetch(abs)
      if (!res.ok) return
      const buffer = await res.arrayBuffer()
      if (!mountedRef.current) return
      originalBufferRef.current = buffer
      analysisRef.current = await workerAnalyze(buffer)
    } catch (e) {
      console.warn('[ModelViewer] 预取去噪缓冲失败:', e)
    }
  }, [modelFormat, workerAnalyze])

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
      analysisRef.current = await workerAnalyze(buffer)
      return true
    } catch (e) {
      console.error(e)
      setError('下载模型失败，无法进行去噪处理')
      return false
    }
  }

  /* ─── 加载逻辑 ──────────────────────────────────────────── */
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
          analysisRef.current = await workerAnalyze(buffer)
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
            analysisRef.current = await workerAnalyze(buffer)
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
      selfDrivenMode: true, useBuiltInControls: true,
      rootElement: containerRef.current, cameraUp: [0, -1, 0],
      sharedMemoryForWorkers: false, dynamicScene: false,
    })
    viewerRef.current = viewer

    await viewer.addSplatScene(absoluteUrl, {
      format, progressiveLoad: true, showLoadingUI: false,
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
    const detach = attachControlInteraction(viewer)

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

    viewer._gsDetachInteraction = detach
  }

  const loadFromBuffer = async (buffer, { format = GaussianSplats3D.SceneFormat.Splat } = {}) => {
    clearLoadPoll()
    disposeViewerExtra()
    await new Promise(r => setTimeout(r, 50))
    if (!mountedRef.current || !containerRef.current) return

    try {
      const viewer = new GaussianSplats3D.Viewer({
        selfDrivenMode: true, useBuiltInControls: true,
        rootElement: containerRef.current, cameraUp: [0, -1, 0],
        sharedMemoryForWorkers: false, dynamicScene: false,
      })
      viewerRef.current = viewer

      const blob = new Blob([buffer], { type: 'application/octet-stream' })
      const bUrl = URL.createObjectURL(blob)
      blobUrlRef.current = bUrl

      await viewer.addSplatScene(bUrl, { format, progressiveLoad: false, showLoadingUI: false })

      if (!mountedRef.current) { disposeViewerExtra(); return }

      viewer.start()
      setPhase('loaded')
      setLoadProgress(100)
      syncCarouselControls(viewer, carouselOnRef.current)
      viewer._gsDetachInteraction = attachControlInteraction(viewer)
    } catch (e) {
      console.error('[ModelViewer] 渲染失败:', e)
      if (!mountedRef.current) return
      disposeViewerExtra()
      setError(e.message || '模型渲染失败')
      setPhase('error')
    }
  }

  /* ─── 去噪操作（Worker 卸载） ──────────────────────────── */
  const handleApplyFilter = async () => {
    const ok = await ensureBufferForDenoise()
    if (!ok) { setPhase('loaded'); return }
    if (!analysisRef.current) { setPhase('loaded'); setError('无法分析模型数据，请稍后重试'); return }

    setFiltering(true)
    setPhase('loading')
    await new Promise(r => setTimeout(r, 80))

    try {
      const result = await workerFilter(originalBufferRef.current, analysisRef.current, filterSettings)
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

  /* ─── 相机预设 ──────────────────────────────────────────── */
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
      applyPresetAt(n >= cameraPresets.length ? cameraPresets.length - 1 : n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, cameraPresets, applyPresetAt])

  const handleResetCamera = () => { try { viewerRef.current?.controls?.reset?.() } catch (_) { /* noop */ } }

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

  /* ─── 渲染 ──────────────────────────────────────────────── */
  const showCanvas = modelUrl && phase !== 'empty' && phase !== 'error'
  const hasCameras = cameraPresets.length > 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <ViewerToolbar
        phase={phase}
        modelUrl={modelUrl}
        carouselOn={carouselOn}
        setCarouselOn={setCarouselOn}
        showCamPanel={showCamPanel}
        setShowCamPanel={setShowCamPanel}
        hasCameras={hasCameras}
        camerasCount={cameraPresets.length}
        camerasFileRef={camerasFileRef}
        handleUploadCameras={handleUploadCameras}
        showFilter={showFilter}
        setShowFilter={setShowFilter}
        filterStats={filterStats}
        showInfo={showInfo}
        setShowInfo={setShowInfo}
        handleResetCamera={handleResetCamera}
      />

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
          style={{ width: '100%', height: '100%', display: showCanvas ? 'block' : 'none' }}
        />

        {/* 视角预设面板 */}
        {showCamPanel && phase === 'loaded' && (
          <CameraPresetPanel
            cameraPresets={cameraPresets}
            presetIndex={presetIndex}
            applyPresetAt={applyPresetAt}
            onClose={() => setShowCamPanel(false)}
          />
        )}

        {/* 去噪面板 */}
        {showFilter && phase === 'loaded' && (
          <DenoisePanel
            filterSettings={filterSettings}
            setFilterSettings={setFilterSettings}
            filterStats={filterStats}
            filtering={filtering}
            analysisCount={analysisRef.current?.count}
            onApply={handleApplyFilter}
            onReset={handleResetFilter}
            onClose={() => setShowFilter(false)}
          />
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
            <button className="btn btn-secondary" onClick={() => modelUrl && fetchAndLoad(modelUrl)}>
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
