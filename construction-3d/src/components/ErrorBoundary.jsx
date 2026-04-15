import { Component } from 'react'
import { AlertCircle, RotateCcw, WifiOff } from 'lucide-react'

/**
 * 增强版错误边界：
 * - 捕获子组件渲染错误
 * - 提供错误详情折叠展示
 * - 支持通过 key 变化自动恢复（外部 modelUrl 变化等）
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, showDetail: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', this.props.title || '', error, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, showDetail: false })
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || '组件渲染过程中发生了意外错误'
      const isNetworkError = msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')

      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          background: 'var(--bg-primary)', padding: 32,
        }}>
          {isNetworkError ? (
            <WifiOff size={48} style={{ color: 'var(--orange)', opacity: 0.8 }} />
          ) : (
            <AlertCircle size={48} style={{ color: 'var(--red)', opacity: 0.8 }} />
          )}
          <h3 style={{
            fontFamily: 'var(--font-display)', fontSize: 18,
            fontWeight: 600, letterSpacing: 1, color: 'var(--text-primary)',
          }}>
            {this.props.title || (isNetworkError ? '网络异常' : '渲染出错')}
          </h3>
          <p style={{
            fontSize: 13, color: 'var(--text-muted)',
            textAlign: 'center', maxWidth: 420, lineHeight: 1.8,
          }}>
            {isNetworkError
              ? '无法连接到后端服务，请检查网络连接或后端是否正在运行'
              : msg}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={this.handleRetry}>
              <RotateCcw size={14} /> 重新加载
            </button>
            {!isNetworkError && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => this.setState(s => ({ showDetail: !s.showDetail }))}
              >
                {this.state.showDetail ? '收起详情' : '查看详情'}
              </button>
            )}
          </div>
          {this.state.showDetail && this.state.error?.stack && (
            <pre style={{
              marginTop: 8, padding: 12, fontSize: 11, lineHeight: 1.6,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', color: 'var(--text-muted)',
              maxWidth: '100%', maxHeight: 200, overflow: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {this.state.error.stack}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
