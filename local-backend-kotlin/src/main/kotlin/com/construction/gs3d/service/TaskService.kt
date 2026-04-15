package com.construction.gs3d.service

import com.construction.gs3d.model.Task
import com.construction.gs3d.model.TaskStage
import com.construction.gs3d.model.TaskStatus
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.io.File
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import jakarta.annotation.PostConstruct

@Service
class TaskService(
    @Value("\${app.data-dir}") dataDir: String,
    private val mapper: ObjectMapper,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    val dataRoot = File(dataDir).canonicalFile
    val tasksDir = File(dataRoot, "tasks").also { it.mkdirs() }
    val modelsDir = File(dataRoot, "models").also { it.mkdirs() }
    val logsDir = File(dataRoot, "logs").also { it.mkdirs() }

    private val store = ConcurrentHashMap<String, Task>()

    @PostConstruct
    fun loadTasks() {
        tasksDir.listFiles()?.forEach { dir ->
            val meta = File(dir, "task.json")
            if (!meta.exists()) return@forEach
            runCatching {
                val task = mapper.readValue<Task>(meta)
                if (task.status == TaskStatus.running) {
                    log.warn("任务 {} 在服务重启时处于 running 状态（stage={}），标记为 failed", task.taskId, task.stage)
                    store[task.taskId] = task.copy(
                        status = TaskStatus.failed,
                        message = "服务重启，任务中断（stage=${task.stage.toJson()}），请断点续跑"
                    ).also { save(it) }
                } else {
                    store[task.taskId] = task
                }
            }.onFailure { log.warn("加载任务失败: ${dir.name}", it) }
        }
        log.info("恢复 ${store.size} 个历史任务")
    }

    fun get(id: String): Task? = store[id]

    fun all(): List<Task> = store.values.sortedByDescending { it.createdAt }

    fun put(task: Task) {
        store[task.taskId] = task
        save(task)
    }

    fun update(id: String, block: Task.() -> Unit) {
        val task = store[id] ?: return
        task.block()
        task.updatedAt = Instant.now().toString()
        save(task)
    }

    /**
     * 便捷方法：更新进度、消息、阶段和状态，同时写日志。
     * 由 PipelineService 和 PipelineStages 使用。
     */
    fun updateProgress(id: String, progress: Int, message: String, stage: TaskStage? = null, status: TaskStatus? = null) {
        update(id) {
            this.progress = progress
            this.message = message
            stage?.let { this.stage = it }
            status?.let { this.status = it }
        }
        writeLog(id, "INFO ", message)
    }

    fun delete(id: String) {
        store.remove(id)
        File(tasksDir, id).deleteRecursively()
        File(modelsDir, id).deleteRecursively()
        File(logsDir, "$id.log").delete()
    }

    fun logFile(id: String) = File(logsDir, "$id.log")

    fun writeLog(id: String, level: String, msg: String) {
        val ts = Instant.now().toString().replace("T", " ").take(19)
        val line = "[$ts] [$level] $msg\n"
        logFile(id).appendText(line)
        MDC.put("taskId", id.take(8))
        try {
            log.info("[${id.take(8)}] $msg")
        } finally {
            MDC.remove("taskId")
        }
    }

    private fun save(task: Task) {
        val dir = File(tasksDir, task.taskId).also { it.mkdirs() }
        mapper.writerWithDefaultPrettyPrinter().writeValue(File(dir, "task.json"), task)
    }

    /** 防路径遍历：确保 taskId 是合法 UUID 格式 */
    fun validateId(id: String): Boolean =
        id.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
}
