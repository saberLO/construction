package com.construction.gs3d.controller

import com.construction.gs3d.service.TaskService
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.FileSystemResource
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.io.File

@RestController
@RequestMapping("/models")
class ModelController(
    private val taskService: TaskService,
) {
    @GetMapping("/{taskId}/scene.splat")
    fun getModel(@PathVariable taskId: String): ResponseEntity<*> {
        if (!taskService.validateId(taskId)) return ResponseEntity.badRequest().body(mapOf("error" to "无效的任务ID"))
        val file = File(taskService.modelsDir, "$taskId/scene.splat")
        if (!file.exists()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(mapOf("error" to "模型不存在"))
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header("Access-Control-Allow-Origin", "*")
            .body(FileSystemResource(file))
    }

    /** COLMAP 相机列表（antimatter15/splat 兼容 JSON）；需流水线在云端成功执行 colmap model_converter */
    @GetMapping("/{taskId}/cameras.json")
    fun getCamerasJson(@PathVariable taskId: String): ResponseEntity<*> {
        if (!taskService.validateId(taskId)) return ResponseEntity.badRequest().body(mapOf("error" to "无效的任务ID"))
        val file = File(taskService.modelsDir, "$taskId/cameras.json")
        if (!file.exists()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(mapOf("error" to "暂无相机数据"))
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_JSON)
            .header("Access-Control-Allow-Origin", "*")
            .body(FileSystemResource(file))
    }
}
