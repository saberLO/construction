import { useState, useRef, useCallback } from 'react'
import { Upload, X, Image, Film, AlertCircle, CheckCircle, Loader } from 'lucide-react'
import { useSubmitTask, useSelectedTask } from '../hooks/useTasks'
import useUIStore from '../stores/uiStore'
import { formatSize } from '../utils/format'

const QUALITY_OPTIONS = [
  { value: 'low',    label: '低质量',    detail: '7000次迭代 ≈20min',  },
  { value: 'medium', label: '中等质量',  detail: '15000次迭代 ≈40min', },
  { value: 'high',   label: '高质量',    detail: '30000次迭代 ≈80min', },
]

const MATCHER_OPTIONS = [
  { value: 'exhaustive', label: '普通照片', detail: 'exhaustive_matcher' },
  { value: 'sequential', label: '视频裁切', detail: 'sequential_matcher 重叠15' },
]

export default function TaskSubmit() {
  const [files,          setFiles]          = useState([])
  const [isDragOver,     setIsDragOver]     = useState(false)
  const [taskName,       setTaskName]       = useState('')
  const [quality,        setQuality]        = useState('medium')
  const [colmapMatcher,  setColmapMatcher]  = useState('exhaustive')
  const [phase,          setPhase]          = useState('idle')   // idle | uploading | success | error
  const [uploadProgress, setUploadProgress] = useState(0)
  const [createdTaskId,  setCreatedTaskId]  = useState(null)
  const [error,          setError]          = useState('')
  const inputRef = useRef(null)

  const currentTask = useSelectedTask()
  const onTaskCreated = useUIStore((s) => s.onTaskCreated)
  const submitMutation = useSubmitTask()

  const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'mp4', 'mov', 'avi']

  const addFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase()
      return ALLOWED_EXT.includes(ext)
    })
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size))
      return [...prev, ...valid.filter(f => !existing.has(f.name + f.size))]
    })
  }, [])

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx))

  const handleSubmit = async () => {
    if (files.length === 0) { setError('请至少上传一张照片'); return }
    setError('')
    setPhase('uploading')
    setUploadProgress(0)

    try {
      const name = taskName.trim() || `工地任务_${new Date().toLocaleString('zh-CN')}`
      const result = await submitMutation.mutateAsync({
        files,
        options: { quality, name, colmap_matcher: colmapMatcher },
        onProgress: setUploadProgress,
      })

      setPhase('success')
      setCreatedTaskId(result.task_id)
      onTaskCreated(result.task_id)

    } catch (err) {
      const msg = err.response?.status === 503
        ? '服务繁忙，请稍后再试'
        : (err.message || '提交失败，请检查后端服务是否运行')
      setError(msg)
      setPhase('error')
    }
  }

  const handleReset = () => {
    setFiles([])
    setPhase('idle')
    setUploadProgress(0)
    setCreatedTaskId(null)
    setError('')
    setTaskName('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0)

  // 当前选中任务的简要状态（从 react-query 缓存实时派生）
  const renderCurrentTaskStatus = () => {
    if (!currentTask) return null
    return (
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-header">
          当前选中任务：<span style={{ color: 'var(--accent)' }}>{currentTask.name}</span>
        </div>
        <div style={{ padding: 12, fontSize: 12 }}>
          <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
            <span>状态：{currentTask.status}</span>
            <span>进度：{currentTask.progress ?? 0}%</span>
          </div>
          {typeof currentTask.progress === 'number' && (
            <div className="progress-track" style={{ height: 8, marginBottom: 6 }}>
              <div className="progress-fill" style={{ width: `${currentTask.progress}%` }} />
            </div>
          )}
          {currentTask.message && (
            <div style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {currentTask.message}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── 进行中 / 完成 界面 ───────────────────────────────────────────
  if (phase === 'uploading' || phase === 'success') {
    return (
      <div style={{ padding: 24 }}>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 28
        }}>
          {phase === 'success' ? (
            /* 完成 */
            <div style={{ textAlign: 'center' }}>
              <CheckCircle size={52} style={{ color: 'var(--green)', marginBottom: 16 }} />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: 1, marginBottom: 8 }}>
                任务已提交！
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                任务 ID：{createdTaskId?.slice(0, 8)}... · 请在左侧任务列表中查看进度并等待训练完成。
              </p>
              <button className="btn btn-secondary" onClick={handleReset}>提交新任务</button>
            </div>
          ) : (
            <>
              {/* 上传阶段 */}
              {phase === 'uploading' && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--blue)' }} />
                      上传照片到本地后端...
                    </span>
                    <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      {uploadProgress}%
                    </span>
                  </div>
                  <div className="progress-track" style={{ height: 8 }}>
                    <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

            </>
          )}
        </div>
      </div>
    )
  }

  // ── 错误状态 ─────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div style={{ padding: 24 }}>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid rgba(255,77,77,0.3)',
          borderRadius: 'var(--radius-lg)', padding: 28, textAlign: 'center'
        }}>
          <AlertCircle size={44} style={{ color: 'var(--red)', marginBottom: 12 }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 8, color: 'var(--red)' }}>
            提交失败
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
            {error}
          </p>
          <button className="btn btn-secondary" onClick={handleReset}>重新提交</button>
        </div>
      </div>
    )
  }

  // ── 主表单 ───────────────────────────────────────────────────────
  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>

      {/* 当前选中任务的实时状态（从 react-query 缓存派生） */}
      {renderCurrentTaskStatus()}

      {/* 上传区 */}
      <div style={{ marginBottom: 16 }}>
        <div
          className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={e => { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={36} style={{ marginBottom: 10, opacity: 0.6 }} />
          <h3>拖放照片 / 视频到此处</h3>
          <p style={{ marginTop: 6 }}>支持 JPG · PNG · TIFF · MP4 · MOV · AVI</p>
          {files.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
              已选 {files.length} 个文件 · {formatSize(totalSize)}
            </div>
          )}
        </div>
        <input
          ref={inputRef} type="file" multiple
          accept=".jpg,.jpeg,.png,.tiff,.tif,.mp4,.mov,.avi"
          style={{ display: 'none' }}
          onChange={e => addFiles(e.target.files)}
        />
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            已选文件 <span className="accent">{files.length}</span>
          </div>
          <div style={{ padding: '8px 12px' }}>
            <div className="file-list">
              {files.map((f, i) => (
                <div key={i} className="file-item">
                  {f.type.startsWith('video') ? <Film size={12} /> : <Image size={12} />}
                  <span className="name">{f.name}</span>
                  <span className="size">{formatSize(f.size)}</span>
                  <X size={12} className="remove" onClick={() => removeFile(i)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 设置面板 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">任务设置</div>
        <div style={{ padding: 12 }}>
          <div className="form-group">
            <label className="form-label">任务名称（可留空）</label>
            <input
              className="form-input"
              placeholder={`工地任务_${new Date().toLocaleDateString('zh-CN')}`}
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">图像来源</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {MATCHER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setColmapMatcher(opt.value)}
                  style={{
                    flex: 1, padding: '8px 4px', textAlign: 'center', cursor: 'pointer',
                    background: colmapMatcher === opt.value ? 'var(--accent-dim)' : 'var(--bg-primary)',
                    border: `1px solid ${colmapMatcher === opt.value ? 'rgba(240,165,0,0.5)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', transition: 'all 0.2s'
                  }}
                >
                  <div style={{
                    fontSize: 12, fontWeight: 600, marginBottom: 2,
                    color: colmapMatcher === opt.value ? 'var(--accent)' : 'var(--text-primary)'
                  }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{opt.detail}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">重建质量</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {QUALITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setQuality(opt.value)}
                  style={{
                    flex: 1, padding: '8px 4px', textAlign: 'center', cursor: 'pointer',
                    background: quality === opt.value ? 'var(--accent-dim)' : 'var(--bg-primary)',
                    border: `1px solid ${quality === opt.value ? 'rgba(240,165,0,0.5)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', transition: 'all 0.2s'
                  }}
                >
                  <div style={{
                    fontSize: 12, fontWeight: 600, marginBottom: 3,
                    color: quality === opt.value ? 'var(--accent)' : 'var(--text-primary)'
                  }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{opt.detail}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 12,
          background: 'rgba(255,77,77,0.1)', border: '1px solid rgba(255,77,77,0.3)',
          borderRadius: 'var(--radius)', color: 'var(--red)',
          fontSize: 13, display: 'flex', gap: 8, alignItems: 'center'
        }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      {/* 提交按钮 */}
      <button
        className="btn btn-primary btn-full"
        disabled={files.length === 0}
        onClick={handleSubmit}
      >
        <Upload size={16} />
        开始建模（{files.length} 个文件）
      </button>

      {/* 提示 */}
      <div style={{
        marginTop: 12, padding: '12px 14px',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.9
      }}>
        <div style={{ color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 4 }}>💡 拍摄建议</div>
        <div>• 建议 50 ~ 300 张，覆盖目标区域各个角度</div>
        <div>• 相邻照片重叠度 &gt; 60%，光线均匀</div>
        <div>• 避免运动物体、纯反光表面</div>
      </div>
    </div>
  )
}
