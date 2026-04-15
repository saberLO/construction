import { create } from 'zustand'

const useUIStore = create((set) => ({
  activeTab: 'submit',
  selectedTaskId: null,

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  /** Tab 切换时：若切回 submit 则清除选中 */
  switchTab: (tab) => set((state) => ({
    activeTab: tab,
    selectedTaskId: tab === 'submit' ? null : state.selectedTaskId,
  })),

  /** 任务创建后：选中该任务，自动跳转到 viewer */
  onTaskCreated: (taskId) => set({
    selectedTaskId: taskId,
    activeTab: 'viewer',
  }),

  /** 在 TaskList 中点击任务 */
  selectTask: (taskId, taskStatus, options = {}) => set((state) => {
    const { shouldOpenViewer = true } = options

    // 再次点击已选中任务 → 取消选中
    if (state.selectedTaskId === taskId) {
      return { selectedTaskId: null }
    }

    const nextTab = !shouldOpenViewer
      ? state.activeTab
      : taskStatus === 'completed'
        ? 'viewer'
        : 'submit'

    return { selectedTaskId: taskId, activeTab: nextTab }
  }),
}))

export default useUIStore
