package com.construction.gs3d.controller

import com.construction.gs3d.service.VisionService
import org.springframework.core.io.FileSystemResource
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile

@RestController
@RequestMapping("/vision")
class VisionController(
    private val visionService: VisionService,
) {
    @GetMapping("/models")
    fun listModels(): Map<String, Any?> {
        val models = visionService.listModels()
        return mapOf(
            "models" to models,
            "default_model" to models.firstOrNull()?.name,
        )
    }

    @PostMapping("/detect")
    fun detect(
        @RequestParam("image") image: MultipartFile,
        @RequestParam(required = false) model: String?,
        @RequestParam(required = false) confidence: Double?,
        @RequestParam(required = false) iou: Double?,
    ): ResponseEntity<*> = try {
        ResponseEntity.ok(visionService.detect(image, model, confidence, iou))
    } catch (e: IllegalArgumentException) {
        ResponseEntity.badRequest().body(mapOf("error" to (e.message ?: "Invalid YOLO request.")))
    } catch (e: IllegalStateException) {
        ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(mapOf("error" to (e.message ?: "YOLO inference failed.")))
    }

    @GetMapping("/results/{id}/image")
    fun getResultImage(@PathVariable id: String): ResponseEntity<*> {
        if (!id.matches(Regex("[0-9a-f\\-]{36}"))) {
            return ResponseEntity.badRequest().body(mapOf("error" to "Invalid result id."))
        }
        val file = visionService.resultImage(id)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).body(mapOf("error" to "Result image not found."))

        return ResponseEntity.ok()
            .contentType(MediaType.IMAGE_JPEG)
            .header("Access-Control-Allow-Origin", "*")
            .body(FileSystemResource(file))
    }
}
