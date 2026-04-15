import { useState, lazy, Suspense } from 'react'
import { Upload, Box, ArrowLeftRight, HardDrive, Layers, Search } from 'lucide-react'
import TaskSubmit from './components/TaskSubmit'
import FormatConverter from './components/FormatConverter'
import TaskList from './components/TaskList'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/index.css'

const ModelViewer = lazy(() => import('./components/ModelViewer'))
const LocalModelUpload = lazy(() => import('./components/LocalModelUpload'))
const Ply2SplatViewer = lazy(() => import('./components/Ply2SplatViewer'))
const YoloDetector = lazy(() => import('./components/YoloDetector'))

function Loading3D() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>加载模块中...</div>
    </div>
  )
}

const TABS = [
  { id: 'submit', label: '1.9.1 云端建模', icon: Upload },
  { id: 'viewer', label: '1.9.2 模型查看', icon: Box },
  { id: 'convert', label: '1.9.3 格式转换', icon: ArrowLeftRight },
  { id: 'local', label: '本地模型查看', icon: HardDrive },
  { id: 'ply2splat', label: 'PLY→SPLAT', icon: ArrowLeftRight },
  { id: 'yolo', label: 'YOLO识别', icon: Search },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('submit')
  const [selectedTask, setSelectedTask] = useState(null)

  const handleTabChange = (tabId) => {
    setActiveTab(tabId)
    if (tabId === 'submit') {
      setSelectedTask(null)
    }
  }

  const handleTaskCreated = (task) => {
    setSelectedTask(task)
    setActiveTab('viewer')
  }

  const handleSelectTask = (task, options = {}) => {
    const { shouldOpenViewer = true } = options
    setSelectedTask(task)
    if (!shouldOpenViewer || !task) return

    if (task.status === 'completed') {
      setActiveTab('viewer')
      return
    }

    setActiveTab('submit')
  }

  const modelUrl = selectedTask?.result?.splat_url
    || selectedTask?.result?.ply_url
    || null

  const modelFormat = selectedTask?.result?.splat_url ? 'splat' : 'ply'

  const camerasUrl = selectedTask?.result?.cameras_url
    || selectedTask?.result?.camerasUrl
    || null

  return (
    <>
      <header className="header">
        <div className="header-logo">
          <div className="dot" />
          <Layers size={18} />
          工地三维重建系统
        </div>

        <nav className="header-nav" role="tablist" aria-label="功能导航">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`nav-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => handleTabChange(tab.id)}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </header>

      <div className="main-layout">
        <aside className="sidebar" aria-label="任务列表">
          <TaskList
            selectedTaskId={selectedTask?.task_id}
            onSelectTask={handleSelectTask}
          />
        </aside>

        <main className="content-area">
          <div style={{ display: activeTab === 'submit' ? 'block' : 'none', flex: 1, overflowY: 'auto' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ padding: '16px 16px 0', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
                  云端建模任务提交
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  上传无人机拍摄的照片或视频，系统将自动运行 COLMAP + 3DGS 完成三维重建
                </p>
              </div>
              <TaskSubmit
                currentTask={selectedTask}
                onTaskCreated={handleTaskCreated}
              />
            </div>
          </div>

          <div style={{ display: activeTab === 'viewer' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <ErrorBoundary title="3D 模型查看器">
              <Suspense fallback={<Loading3D />}>
                <ModelViewer
                  modelUrl={modelUrl}
                  modelFormat={modelFormat}
                  camerasUrl={camerasUrl}
                />
              </Suspense>
            </ErrorBoundary>
          </div>

          <div style={{ display: activeTab === 'convert' ? 'block' : 'none', flex: 1, overflowY: 'auto' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ padding: '16px 16px 0', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
                  模型格式转换
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  将已完成的 3DGS 模型导出为其他格式，方便在不同工具链中复用。
                </p>
              </div>
              <FormatConverter
                taskId={selectedTask?.task_id}
                taskName={selectedTask?.name}
                taskStatus={selectedTask?.status}
              />
            </div>
          </div>

          <div style={{ display: activeTab === 'local' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <ErrorBoundary title="本地模型查看">
              <Suspense fallback={<Loading3D />}>
                <LocalModelUpload />
              </Suspense>
            </ErrorBoundary>
          </div>

          <div style={{ display: activeTab === 'ply2splat' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <ErrorBoundary title="PLY 转 SPLAT">
              <Suspense fallback={<Loading3D />}>
                <Ply2SplatViewer />
              </Suspense>
            </ErrorBoundary>
          </div>

          <div style={{ display: activeTab === 'yolo' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <ErrorBoundary title="YOLO 识别">
              <Suspense fallback={<Loading3D />}>
                <YoloDetector />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </>
  )
}
