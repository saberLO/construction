package com.construction.gs3d.controller

import com.construction.gs3d.model.Task
import com.construction.gs3d.model.TaskStatus
import com.construction.gs3d.service.PipelineService
import com.construction.gs3d.service.TaskService
import org.springframework.core.io.FileSystemResource
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import java.io.File
import java.time.Instant
import java.util.UUID

@RestController
class TaskController(
    private val taskService: TaskService,
    private val pipeline: PipelineService,
) {
    private fun badId() = ResponseEntity.badRequest().body(mapOf("error" to "无效的任务ID"))
    private fun notFound() = ResponseEntity.status(HttpStatus.NOT_FOUND).body(mapOf("error" to "任务不存在"))

    // 提交任务
    @PostMapping("/tasks")
    fun createTask(
        @RequestParam("files") files: List<MultipartFile>,
        @RequestParam(defaultValue = "medium") quality: String,
        @RequestParam(defaultValue = "") name: String,
        @RequestParam("colmap_matcher", defaultValue = "exhaustive") colmapMatcher: String,
    ): ResponseEntity<*> {
        if (files.isEmpty()) return ResponseEntity.badRequest().body(mapOf("error" to "请上传至少一张照片"))
        val allowedExt = setOf("jpg", "jpeg", "png", "tiff", "tif", "mp4", "mov", "avi")
        val allowedQuality = setOf("low", "medium", "high")
        if (quality !in allowedQuality) return ResponseEntity.badRequest().body(mapOf("error" to "quality 参数无效"))

        val taskId = UUID.randomUUID().toString()
        val inputDir = File(taskService.tasksDir, "$taskId/input").also { it.mkdirs() }

        for (file in files) {
            val originalName = file.originalFilename ?: continue
            val ext = originalName.substringAfterLast('.', "").lowercase()
            if (ext !in allowedExt) continue  // 跳过非法文件类型
            val dest = File(inputDir, originalName)
            file.transferTo(dest.absoluteFile)
        }

        val savedCount = inputDir.listFiles()?.size ?: 0
        if (savedCount == 0) {
            inputDir.parentFile?.deleteRecursively()
            return ResponseEntity.badRequest().body(mapOf("error" to "上传的文件中没有合法格式（支持 jpg/png/tiff/mp4/mov/avi）"))
        }

        val now = Instant.now().toString()
        val task = Task(
            taskId = taskId,
            name = name.ifBlank { "任务_${now.take(10)}" },
            quality = quality,
            colmapMatcher = if (colmapMatcher == "sequential") "sequential" else "exhaustive",
            fileCount = savedCount,
            localInputDir = inputDir.absolutePath,
            createdAt = now,
            updatedAt = now,
        )
        taskService.put(task)
        pipeline.run(taskId)
        return ResponseEntity.ok(mapOf("task_id" to taskId, "status" to "pending"))
    }

    // 续跑任务
    @PostMapping("/tasks/{id}/resume")
    fun resumeTask(@PathVariable id: String): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        val task = taskService.get(id) ?: return notFound()
        if (task.status == TaskStatus.completed) return ResponseEntity.badRequest().body(mapOf("error" to "任务已完成"))
        if (task.status == TaskStatus.running)   return ResponseEntity.badRequest().body(mapOf("error" to "任务正在运行中"))
        taskService.update(id) { status = TaskStatus.pending; message = "收到续跑请求，准备继续执行..." }
        pipeline.run(id)
        return ResponseEntity.ok(mapOf("ok" to true))
    }

    // 查询单个任务
    @GetMapping("/tasks/{id}")
    fun getTask(@PathVariable id: String): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        return taskService.get(id)?.let { ResponseEntity.ok(it) } ?: notFound()
    }

    // 任务列表（分页）
    @GetMapping("/tasks")
    fun listTasks(
        @RequestParam(defaultValue = "1") page: Int,
        @RequestParam("page_size", defaultValue = "20") pageSize: Int,
    ): Map<String, Any> {
        val all = taskService.all()
        val start = ((page - 1) * pageSize).coerceAtLeast(0)
        return mapOf("tasks" to all.drop(start).take(pageSize), "total" to all.size, "page" to page)
    }

    // 删除任务
    @DeleteMapping("/tasks/{id}")
    fun deleteTask(@PathVariable id: String): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        taskService.delete(id)
        return ResponseEntity.ok(mapOf("ok" to true))
    }

    // 读取标注
    @GetMapping("/tasks/{id}/annotations")
    fun getAnnotations(@PathVariable id: String): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        val file = File(taskService.tasksDir, "$id/annotations.json")
        return if (file.exists()) ResponseEntity.ok(file.readText())
        else ResponseEntity.ok("""{"annotations":[]}""")
    }

    // 保存标注
    @PutMapping("/tasks/{id}/annotations")
    fun saveAnnotations(@PathVariable id: String, @RequestBody body: String): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        val dir = File(taskService.tasksDir, id)
        if (!dir.exists()) return notFound()
        File(dir, "annotations.json").writeText(body)
        return ResponseEntity.ok(mapOf("ok" to true))
    }

    // 完整日志
    @GetMapping("/tasks/{id}/logs")
    fun getLogs(@PathVariable id: String): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        val logFile = taskService.logFile(id)
        if (!logFile.exists()) return ResponseEntity.ok(mapOf("logs" to emptyList<String>(), "message" to "暂无日志"))
        val lines = logFile.readLines().filter { it.isNotBlank() }
        return ResponseEntity.ok(mapOf("logs" to lines, "total" to lines.size))
    }

    // 最新 N 行日志
    @GetMapping("/tasks/{id}/logs/tail")
    fun tailLogs(@PathVariable id: String, @RequestParam(defaultValue = "50") n: Int): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        val logFile = taskService.logFile(id)
        if (!logFile.exists()) return ResponseEntity.ok(mapOf("logs" to emptyList<String>(), "message" to "暂无日志"))
        val lines = logFile.readLines().filter { it.isNotBlank() }
        val eta = lines.lastOrNull { it.contains("预计剩余") }
            ?.let { Regex("预计剩余 (.+)$").find(it)?.groupValues?.get(1) }
        return ResponseEntity.ok(mapOf("logs" to lines.takeLast(n), "total" to lines.size, "eta" to eta))
    }

    // 下载日志文件
    @GetMapping("/tasks/{id}/logs/download")
    fun downloadLog(@PathVariable id: String): ResponseEntity<*> {
        if (!taskService.validateId(id)) return badId()
        val logFile = taskService.logFile(id)
        if (!logFile.exists()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(mapOf("error" to "日志不存在"))
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"task_${id.take(8)}.log\"")
            .contentType(MediaType.TEXT_PLAIN)
            .body(FileSystemResource(logFile))
    }

    // 健康检查
    @GetMapping("/health")
    fun health() = mapOf("status" to "ok", "tasks" to taskService.all().size)
}
