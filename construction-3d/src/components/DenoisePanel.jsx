import { Sparkles, RotateCw, X } from 'lucide-react'

/**
 * 去噪设置面板：不透明度阈值、距离保留、应用/还原按钮、统计信息。
 */
export default function DenoisePanel({
  filterSettings,
  setFilterSettings,
  filterStats,
  filtering,
  analysisCount,
  onApply,
  onReset,
  onClose,
}) {
  return (
    <div className="filter-panel">
      <div className="filter-panel-header">
        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
        <span>模型去噪</span>
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto', padding: '2px 4px' }}
          onClick={onClose}
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
            onClick={onApply}
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
              onClick={onReset}
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

        {analysisCount != null && !filterStats && (
          <div className="filter-stats" style={{ color: 'var(--text-muted)' }}>
            模型共 {analysisCount.toLocaleString()} 个高斯点
          </div>
        )}
      </div>
    </div>
  )
}
