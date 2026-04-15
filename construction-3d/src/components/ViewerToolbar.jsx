import {
  RotateCcw, Eye, EyeOff, Download, Sparkles, Orbit,
  Upload, Camera,
} from 'lucide-react'

/**
 * ModelViewer 的工具栏：自动旋转、视角预设、去噪开关、下载等按钮。
 */
export default function ViewerToolbar({
  phase,
  modelUrl,
  carouselOn,
  setCarouselOn,
  showCamPanel,
  setShowCamPanel,
  hasCameras,
  camerasCount,
  camerasFileRef,
  handleUploadCameras,
  showFilter,
  setShowFilter,
  filterStats,
  showInfo,
  setShowInfo,
  handleResetCamera,
}) {
  return (
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
            {hasCameras && <span style={{ marginLeft: 4, opacity: 0.85 }}>({camerasCount})</span>}
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
  )
}
