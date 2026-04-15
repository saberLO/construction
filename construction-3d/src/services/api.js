/**
 * api.js — 与后端服务器通信的所有接口
 *
 * 后端端点：
 *   POST /tasks          → 提交建模任务（上传图片/视频）
 *   GET  /tasks/:id      → 查询任务状态
 *   GET  /tasks          → 任务列表
 *   DELETE /tasks/:id    → 删除任务
 *   POST /tasks/:id/resume → 续跑任务
 */

import axios from 'axios'

const BASE_URL = '/api'

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
})

const httpUpload = axios.create({
  baseURL: BASE_URL,
  timeout: 0,
})

/* ─── 全局响应拦截器 ─────────────────────────────────────── */

function setupInterceptors(instance) {
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      // 网络完全断开（没有 response 对象）
      if (!error.response) {
        if (error.code === 'ECONNABORTED') {
          error.message = '请求超时，请检查网络连接或后端服务状态'
        } else {
          error.message = '无法连接到后端服务，请检查网络连接'
        }
        console.warn('[API] 网络错误:', error.message)
        return Promise.reject(error)
      }

      const { status, data } = error.response

      // 标准化错误消息
      switch (status) {
        case 400:
          error.message = data?.error || '请求参数错误'
          break
        case 404:
          error.message = data?.error || '资源不存在'
          break
        case 503:
          error.message = data?.error || '服务繁忙，请稍后再试'
          break
        case 500:
          error.message = data?.error || '服务器内部错误，请查看后端日志'
          break
        default:
          error.message = data?.error || `请求失败 (HTTP ${status})`
      }

      return Promise.reject(error)
    },
  )
}

setupInterceptors(http)
setupInterceptors(httpUpload)

/* ─── API 函数 ───────────────────────────────────────────── */

/**
 * 提交建模任务（上传图片/视频文件）
 * @param {FileList | File[]} files
 * @param {Object} options - { quality, name, colmap_matcher }
 * @param {Function} onProgress - (percent: number) => void
 * @returns {Promise<{task_id: string, status: string}>}
 */
export async function submitTask(files, options = {}, onProgress) {
  const formData = new FormData()

  Array.from(files).forEach(file => {
    formData.append('files', file)
  })

  formData.append('quality', options.quality || 'medium')
  formData.append('name', options.name || `task_${Date.now()}`)
  formData.append('colmap_matcher', options.colmap_matcher || 'exhaustive')

  const response = await httpUpload.post('/tasks', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
  })

  return response.data
}

/**
 * 查询任务状态
 */
export async function getTaskStatus(taskId) {
  const response = await http.get(`/tasks/${taskId}`)
  return response.data
}

/**
 * 获取任务列表（分页）
 */
export async function listTasks(page = 1, pageSize = 10) {
  const response = await http.get('/tasks', { params: { page, page_size: pageSize } })
  return response.data
}

/**
 * 删除任务
 */
export async function deleteTask(taskId) {
  const response = await http.delete(`/tasks/${taskId}`)
  return response.data
}

/**
 * 续跑/重试失败的任务（断点续跑）
 */
export async function resumeTask(taskId) {
  const response = await http.post(`/tasks/${taskId}/resume`)
  return response.data
}

/**
 * 保存标注信息
 */
export async function saveAnnotations(taskId, annotations) {
  const response = await http.put(`/tasks/${taskId}/annotations`, { annotations })
  return response.data
}

/**
 * 加载标注信息
 */
export async function loadAnnotations(taskId) {
  const response = await http.get(`/tasks/${taskId}/annotations`)
  return response.data
}

/**
 * YOLO models available on the backend.
 */
export async function listVisionModels() {
  const response = await http.get('/vision/models')
  return response.data
}

/**
 * Run YOLO detection for a single image and return annotated output metadata.
 */
export async function detectVision(image, options = {}) {
  const formData = new FormData()
  formData.append('image', image)

  if (options.model) formData.append('model', options.model)
  if (options.confidence != null) formData.append('confidence', String(options.confidence))
  if (options.iou != null) formData.append('iou', String(options.iou))

  const response = await httpUpload.post('/vision/detect', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

  return response.data
}
