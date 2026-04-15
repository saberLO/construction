import { useState } from 'react'
import { Download, ArrowRight, FileBox, AlertCircle, Clock } from 'lucide-react'

const FORMATS = [
  { ext: 'PLY',   desc: '点云通用格式', note: '兼容 CloudCompare、MeshLab' },
  { ext: 'OBJ',   desc: '三角网格',     note: '兼容 AutoCAD、3ds Max' },
  { ext: 'GLB',   desc: 'WebGL 格式',   note: '兼容 Web 渲染器、Blender' },
  { ext: 'E57',   desc: '工程点云',     note: '兼容 Revit、Recap' },
  { ext: 'LAS',   desc: '激光雷达格式', note: '兼容 ArcGIS、LiDAR360' },
  { ext: 'SPLAT', desc: '3DGS 原生',    note: '高斯泼溅实时渲染', available: true },
]

export default function FormatConverter({ taskId, taskName, taskStatus }) {
  const [selected, setSelected] = useState(null)
  const isCompleted = taskStatus === 'completed'

  if (!taskId) {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <div className="icon">🔄</div>
        <h3>格式转换</h3>
        <p>从左侧任务列表选择一个已完成的建模任务</p>
      </div>
    )
  }

  const selectedFormat = FORMATS.find(f => f.ext === selected)
  const canDownload = selectedFormat?.available && isCompleted

  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>

      {/* 源文件信息 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          源文件 <span className="accent">.SPLAT</span>
        </div>
        <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileBox size={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {taskName || `任务 ${taskId?.slice(0, 8)}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              3D Gaussian Splat · ID: {taskId?.slice(0, 8)}
            </div>
          </div>
        </div>
      </div>

      {/* 目标格式选择 */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">选择目标格式</div>
        <div style={{ padding: 12 }}>
          <div className="format-grid">
            {FORMATS.map(f => (
              <div
                key={f.ext}
                className={`format-card ${selected === f.ext ? 'selected' : ''}`}
                onClick={() => setSelected(prev => prev === f.ext ? null : f.ext)}
              >
                <div className="ext" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  .{f.ext}
                  {!f.available && (
                    <Clock size={12} style={{ color: 'var(--text-muted)', opacity: 0.7 }} />
                  )}
                </div>
                <div className="desc">{f.desc}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{f.note}</div>
                {!f.available && (
                  <div style={{ fontSize: 10, color: 'var(--blue)', marginTop: 4, fontWeight: 500 }}>即将推出</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 转换预览 */}
      {selected && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
          padding: '12px 16px', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)'
        }}>
          <span style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)', fontWeight: 700 }}>
            .SPLAT
          </span>
          <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontFamily: 'var(--font-display)', color: 'var(--blue)', fontWeight: 700 }}>
            .{selected}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {selectedFormat?.note}
          </span>
        </div>
      )}

      {/* 任务未完成提示 */}
      {!isCompleted && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.3)',
          borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontSize: 12,
          display: 'flex', gap: 8, alignItems: 'center'
        }}>
          <Clock size={14} style={{ flexShrink: 0, color: 'orange' }} />
          当前任务尚未完成，完成后方可下载模型文件
        </div>
      )}

      {/* 说明 */}
      <div style={{
        padding: '12px 14px', background: 'rgba(45,156,255,0.08)',
        border: '1px solid rgba(45,156,255,0.2)', borderRadius: 'var(--radius)',
        fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.9, marginBottom: 16
      }}>
        <div style={{
          color: 'var(--blue)', fontWeight: 500, marginBottom: 6,
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          <AlertCircle size={13} /> 格式转换说明
        </div>
        <div>• <b style={{ color: 'var(--accent)' }}>.SPLAT</b> 格式可直接从「模型查看器」工具栏下载</div>
        <div>• OBJ / GLB / E57 / LAS 格式转换功能正在开发中</div>
        <div>• 可用 <b style={{ color: 'var(--text-secondary)' }}>CloudCompare</b> 在本地将 PLY 转为其他格式</div>
        <div>• PLY 格式暂未提供在线下载，可从服务器训练输出目录获取</div>
      </div>

      {/* 转换按钮 */}
      {selected && (
        canDownload ? (
          <a
            className="btn btn-primary btn-full"
            href={`/models/${taskId}/scene.splat`}
            download="scene.splat"
            style={{ textDecoration: 'none' }}
          >
            <Download size={16} />
            下载 .{selected}
          </a>
        ) : (
          <button
            className="btn btn-primary btn-full"
            disabled
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
          >
            <Clock size={16} />
            {selectedFormat?.available && !isCompleted
              ? '任务未完成，暂不可下载'
              : `.${selected} 格式转换即将推出`}
          </button>
        )
      )}
    </div>
  )
}
