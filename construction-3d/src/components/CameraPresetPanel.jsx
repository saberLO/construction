import { Camera, X, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * COLMAP 拍摄视角预设面板：导航按钮、数字快捷切换。
 */
export default function CameraPresetPanel({
  cameraPresets,
  presetIndex,
  applyPresetAt,
  onClose,
}) {
  const hasCameras = cameraPresets.length > 0

  return (
    <div className="viewer-camera-panel">
      <div className="viewer-camera-panel-header">
        <Camera size={14} style={{ color: 'var(--accent)' }} />
        <span>拍摄视角</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto', padding: '2px 4px' }}
          onClick={onClose}
          aria-label="关闭视角面板"
        >
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
  )
}
