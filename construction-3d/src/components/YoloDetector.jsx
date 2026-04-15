import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Image as ImageIcon, Loader, Upload } from 'lucide-react'
import { detectVision, listVisionModels } from '../services/api'
import { formatSize } from '../utils/format'

function formatScore(value) {
  return `${Math.round(value * 100)}%`
}

function formatBox(box) {
  return `(${Math.round(box.x1)}, ${Math.round(box.y1)}) - (${Math.round(box.x2)}, ${Math.round(box.y2)})`
}

export default function YoloDetector() {
  const inputRef = useRef(null)
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [confidence, setConfidence] = useState(0.25)
  const [iou, setIou] = useState(0.45)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [result, setResult] = useState(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadModels() {
      setLoadingModels(true)
      try {
        const response = await listVisionModels()
        if (!active) return
        const nextModels = response.models || []
        setModels(nextModels)
        setSelectedModel(current => current || response.default_model || nextModels[0]?.name || '')
        setError('')
      } catch (err) {
        if (!active) return
        setError(err?.response?.data?.error || err.message || '模型列表加载失败')
      } finally {
        if (active) setLoadingModels(false)
      }
    }

    loadModels()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return undefined
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const detectionSummary = useMemo(() => {
    if (!result?.detections?.length) return []
    const counts = new Map()
    result.detections.forEach(item => {
      counts.set(item.className, (counts.get(item.className) || 0) + 1)
    })
    return Array.from(counts.entries())
  }, [result])

  const handleSelectFile = (nextFile) => {
    if (!nextFile) return
    if (!nextFile.type.startsWith('image/')) {
      setError('只支持上传图片文件')
      return
    }
    setFile(nextFile)
    setResult(null)
    setError('')
  }

  const handleDetect = async () => {
    if (!file) {
      setError('请先选择一张图片')
      return
    }
    if (!selectedModel) {
      setError('当前没有可用的 YOLO 模型')
      return
    }

    setDetecting(true)
    setError('')

    try {
      const response = await detectVision(file, { model: selectedModel, confidence, iou })
      setResult(response)
    } catch (err) {
      setError(err?.response?.data?.error || err.message || '检测失败')
      setResult(null)
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
      <div className="vision-layout">
        <section className="panel">
          <div className="panel-header">
            YOLO 图片检测
            <span className="accent">{loadingModels ? '加载模型...' : `${models.length} 个模型`}</span>
          </div>

          <div style={{ padding: 16 }}>
            <div className="form-group">
              <label className="form-label">模型权重</label>
              <select
                className="form-select"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={loadingModels || models.length === 0}
              >
                {models.length === 0 && <option value="">暂无可用模型</option>}
                {models.map(model => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
              {selectedModel && (
                <div className="vision-help">
                  当前模型：<span>{selectedModel}</span>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">置信度阈值 {confidence.toFixed(2)}</label>
              <input
                className="filter-range"
                type="range"
                min="0.05"
                max="0.95"
                step="0.05"
                value={confidence}
                onChange={e => setConfidence(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">IoU 阈值 {iou.toFixed(2)}</label>
              <input
                className="filter-range"
                type="range"
                min="0.05"
                max="0.95"
                step="0.05"
                value={iou}
                onChange={e => setIou(Number(e.target.value))}
              />
            </div>

            <div
              className="upload-zone"
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                handleSelectFile(e.dataTransfer.files?.[0])
              }}
            >
              <Upload size={36} style={{ marginBottom: 10, opacity: 0.6 }} />
              <h3>拖放一张图片到这里</h3>
              <p style={{ marginTop: 6 }}>支持 JPG / PNG / BMP / WEBP</p>
              {file && (
                <div className="vision-file-chip">
                  <ImageIcon size={14} />
                  <span>{file.name}</span>
                  <span>{formatSize(file.size)}</span>
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => handleSelectFile(e.target.files?.[0])}
            />

            {error && (
              <div className="vision-alert vision-alert-error">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <button
              className="btn btn-primary btn-full"
              disabled={detecting || loadingModels || !file || !selectedModel}
              onClick={handleDetect}
            >
              {detecting ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={16} />}
              {detecting ? '正在检测...' : '开始检测'}
            </button>

            <div className="vision-help" style={{ marginTop: 12 }}>
              推理依赖后端本机 Python 环境中的 <span>ultralytics</span>。如果模型列表为空，请先确认根目录 <span>model/</span> 下存在 `.pt` 文件。
            </div>
          </div>
        </section>

        <section className="vision-results">
          <div className="vision-preview-grid">
            <div className="panel">
              <div className="panel-header">原始图片</div>
              <div className="vision-preview-card">
                {previewUrl ? (
                  <img className="vision-preview-image" src={previewUrl} alt="原始图片" />
                ) : (
                  <div className="empty-state" style={{ minHeight: 260 }}>
                    <div className="icon">IMG</div>
                    <h3>尚未选择图片</h3>
                    <p>上传一张图片后即可开始检测</p>
                  </div>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                检测结果
                {result ? <span className="accent">{result.count} 个目标</span> : null}
              </div>
              <div className="vision-preview-card">
                {result?.imageUrl ? (
                  <img className="vision-preview-image" src={result.imageUrl} alt="检测结果" />
                ) : (
                  <div className="empty-state" style={{ minHeight: 260 }}>
                    <div className="icon">AI</div>
                    <h3>等待检测结果</h3>
                    <p>执行检测后，这里会显示带框可视化图片</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="vision-metrics">
            <div className="panel">
              <div className="panel-header">检测摘要</div>
              <div style={{ padding: 16 }}>
                {!result && (
                  <div className="vision-help">
                    结果会显示模型名称、检测数量、图片尺寸以及各类别出现次数。
                  </div>
                )}

                {result && (
                  <>
                    <div className="vision-summary-grid">
                      <div className="vision-stat-card">
                        <div className="vision-stat-label">模型</div>
                        <div className="vision-stat-value">{result.model}</div>
                      </div>
                      <div className="vision-stat-card">
                        <div className="vision-stat-label">目标数量</div>
                        <div className="vision-stat-value">{result.count}</div>
                      </div>
                      <div className="vision-stat-card">
                        <div className="vision-stat-label">图像尺寸</div>
                        <div className="vision-stat-value">{result.image.width} x {result.image.height}</div>
                      </div>
                      <div className="vision-stat-card">
                        <div className="vision-stat-label">阈值</div>
                        <div className="vision-stat-value">{confidence.toFixed(2)} / {iou.toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="vision-class-summary">
                      {detectionSummary.length > 0 ? detectionSummary.map(([name, count]) => (
                        <span key={name} className="vision-class-chip">
                          {name} x {count}
                        </span>
                      )) : (
                        <div className="vision-alert vision-alert-success">
                          <CheckCircle2 size={15} />
                          <span>这张图片中没有检测到目标</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                检测框列表
                {result ? <span className="accent">{result.detections.length} 条</span> : null}
              </div>
              <div style={{ padding: 16 }}>
                {!result && (
                  <div className="vision-help">
                    检测完成后会在这里列出类别、置信度和像素坐标。
                  </div>
                )}

                {result?.detections?.length > 0 && (
                  <div className="vision-detection-list">
                    {result.detections.map((item, index) => (
                      <div className="vision-detection-item" key={`${item.className}-${index}`}>
                        <div className="vision-detection-head">
                          <strong>{item.className}</strong>
                          <span>{formatScore(item.confidence)}</span>
                        </div>
                        <div className="vision-detection-meta">类别 ID: {item.classId}</div>
                        <div className="vision-detection-meta">{formatBox(item.box)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
