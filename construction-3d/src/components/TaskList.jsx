import { RefreshCw, Trash2, RotateCcw } from 'lucide-react'
import { useTasks, useDeleteTask, useResumeTask } from '../hooks/useTasks'
import useUIStore from '../stores/uiStore'
import { formatTime } from '../utils/format'

function StatusBadge({ status }) {
  const configs = {
    pending:   { cls: 'badge-pending', label: '等待中' },
    running:   { cls: 'badge-running', label: '训练中' },
    completed: { cls: 'badge-success', label: '已完成' },
    failed:    { cls: 'badge-failed',  label: '失败' },
  }
  const cfg = configs[status] || configs.pending
  return (
    <span className={`badge ${cfg.cls}`}>
      <span className="badge-dot" />
      {cfg.label}
    </span>
  )
}

export default function TaskList() {
  const { data, isLoading, refetch } = useTasks()
  const tasks = data?.tasks || []
  const total = data?.total || 0

  const selectedTaskId = useUIStore((s) => s.selectedTaskId)
  const selectTask = useUIStore((s) => s.selectTask)

  const deleteMutation = useDeleteTask()
  const resumeMutation = useResumeTask()

  const handleDelete = async (e, taskId) => {
    e.stopPropagation()
    if (!confirm('确认删除此任务及其模型文件？')) return
    try {
      await deleteMutation.mutateAsync(taskId)
    } catch (err) {
      alert('删除失败：' + err.message)
    }
  }

  const handleResume = async (e, taskId) => {
    e.stopPropagation()
    try {
      await resumeMutation.mutateAsync(taskId)
    } catch (err) {
      alert('续跑失败：' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700,
          letterSpacing: 1, color: 'var(--text-secondary)', textTransform: 'uppercase'
        }}>
          任务列表 {total > 0 && <span style={{ color: 'var(--accent)' }}>({total})</span>}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => refetch()}
          disabled={isLoading}
          title="刷新"
          aria-label="刷新任务列表"
        >
          <RefreshCw size={13} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tasks.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>📋</div>
            <div>暂无任务</div>
            <div style={{ marginTop: 4 }}>在「云端建模」提交第一个任务</div>
          </div>
        ) : (
          tasks.map(task => (
            <div
              key={task.task_id}
              className={`task-item ${selectedTaskId === task.task_id ? 'active' : ''}`}
              onClick={() => selectTask(task.task_id, task.status)}
            >
              <div className="task-name" title={task.name}>{task.name}</div>
              <div className="task-meta" style={{ marginTop: 4 }}>
                <StatusBadge status={task.status} />
                <span>{formatTime(task.created_at)}</span>
              </div>

              {task.status === 'running' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                      {task.message}
                    </span>
                    <span style={{ flexShrink: 0 }}>{task.progress}%</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${task.progress}%` }} />
                  </div>
                </div>
              )}

              {task.status === 'failed' && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--red)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
                    {task.message}
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{
                      width: '100%', padding: '5px 0',
                      background: 'rgba(45,156,255,0.12)', color: 'var(--blue)',
                      border: '1px solid rgba(45,156,255,0.3)', borderRadius: 'var(--radius)',
                      fontSize: 11, fontWeight: 600, gap: 6,
                    }}
                    disabled={resumeMutation.isPending && resumeMutation.variables === task.task_id}
                    onClick={e => handleResume(e, task.task_id)}
                    aria-label={`断点续跑任务 ${task.name}`}
                  >
                    <RotateCcw size={11} style={{
                      animation: (resumeMutation.isPending && resumeMutation.variables === task.task_id)
                        ? 'spin 1s linear infinite' : 'none'
                    }} />
                    {resumeMutation.isPending && resumeMutation.variables === task.task_id
                      ? '正在重试...' : '断点续跑'}
                  </button>
                </div>
              )}

              {task.status === 'failed' && task.stage && task.stage !== 'created' && (
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                  上次进度：{task.stage}
                </div>
              )}

              <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {task.file_count} 张照片
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--red)', padding: '2px 6px' }}
                  onClick={e => handleDelete(e, task.task_id)}
                  title="删除任务"
                  aria-label={`删除任务 ${task.name}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
