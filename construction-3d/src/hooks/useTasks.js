import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listTasks, deleteTask, resumeTask, submitTask } from '../services/api'
import useUIStore from '../stores/uiStore'

const TASKS_KEY = ['tasks']

/**
 * 任务列表查询 — 5s 轮询，后台标签页暂停
 */
export function useTasks() {
  return useQuery({
    queryKey: TASKS_KEY,
    queryFn: () => listTasks(1, 20),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    select: (data) => ({
      tasks: data.tasks || [],
      total: data.total || 0,
    }),
  })
}

/**
 * 从 react-query 缓存中派生当前选中的完整 task 对象
 */
export function useSelectedTask() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId)
  const { data } = useTasks()

  if (!selectedTaskId || !data?.tasks) return null
  return data.tasks.find((t) => t.task_id === selectedTaskId) || null
}

/**
 * 删除任务 mutation
 */
export function useDeleteTask() {
  const queryClient = useQueryClient()
  const selectedTaskId = useUIStore((s) => s.selectedTaskId)
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId)

  return useMutation({
    mutationFn: (taskId) => deleteTask(taskId),
    onSuccess: (_data, taskId) => {
      // 乐观更新：从缓存中移除
      queryClient.setQueryData(TASKS_KEY, (old) => {
        if (!old) return old
        return {
          ...old,
          tasks: (old.tasks || []).filter((t) => t.task_id !== taskId),
          total: Math.max(0, (old.total || 0) - 1),
        }
      })
      // 若删除的是当前选中任务，清除选中
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null)
      }
    },
  })
}

/**
 * 续跑任务 mutation
 */
export function useResumeTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId) => resumeTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}

/**
 * 提交任务 mutation
 */
export function useSubmitTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ files, options, onProgress }) =>
      submitTask(files, options, onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}
