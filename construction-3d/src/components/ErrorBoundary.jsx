import { Component } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          background: 'var(--bg-primary)', padding: 32,
        }}>
          <AlertCircle size={48} style={{ color: 'var(--red)', opacity: 0.8 }} />
          <h3 style={{
            fontFamily: 'var(--font-display)', fontSize: 18,
            fontWeight: 600, letterSpacing: 1, color: 'var(--text-primary)',
          }}>
            {this.props.title || '渲染出错'}
          </h3>
          <p style={{
            fontSize: 13, color: 'var(--text-muted)',
            textAlign: 'center', maxWidth: 420, lineHeight: 1.8,
          }}>
            {this.state.error?.message || '组件渲染过程中发生了意外错误'}
          </p>
          <button className="btn btn-secondary" onClick={this.handleRetry}>
            <RotateCcw size={14} /> 重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
