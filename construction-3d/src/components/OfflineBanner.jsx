import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

/**
 * 离线横幅：浏览器断网时在页面顶部显示提示条。
 */
export default function OfflineBanner() {
  const online = useOnlineStatus()

  if (online) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '8px 16px',
      background: 'rgba(255, 165, 0, 0.95)',
      color: '#fff', fontSize: 13, fontWeight: 600,
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      <WifiOff size={15} />
      网络已断开，部分功能不可用。请检查网络连接。
    </div>
  )
}
