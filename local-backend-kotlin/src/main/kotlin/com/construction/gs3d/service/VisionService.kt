package com.construction.gs3d.service

import com.construction.gs3d.config.VisionProperties
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

data class VisionModelInfo(
    val name: String,
    val sizeBytes: Long,
    val updatedAt: String,
)

data class VisionImageMeta(
    val width: Int = 0,
    val height: Int = 0,
)

data class VisionBox(
    val x1: Double = 0.0,
    val y1: Double = 0.0,
    val x2: Double = 0.0,
    val y2: Double = 0.0,
)

data class VisionDetection(
    val classId: Int = 0,
    val className: String = "",
    val confidence: Double = 0.0,
    val box: VisionBox = VisionBox(),
)

data class VisionScriptResult(
    val model: String = "",
    val image: VisionImageMeta = VisionImageMeta(),
    val detections: List<VisionDetection> = emptyList(),
    val count: Int = 0,
)

data class VisionDetectResponse(
    val resultId: String,
    val model: String,
    val confidence: Double,
    val iou: Double,
    val image: VisionImageMeta,
    val detections: List<VisionDetection>,
    val count: Int,
    val imageUrl: String,
    val generatedAt: String,
)

@Service
class VisionService(
    @Value("\${app.data-dir}") dataDir: String,
    private val mapper: ObjectMapper,
    private val vision: VisionProperties,
) {
    private val allowedExt = setOf("jpg", "jpeg", "png", "bmp", "webp")
    private val dataRoot = File(dataDir).canonicalFile
    private val resultRoot = File(dataRoot, "vision").also { it.mkdirs() }

    fun listModels(): List<VisionModelInfo> {
        val dir = modelDir()
        if (!dir.exists() || !dir.isDirectory) return emptyList()
        return dir.listFiles()
            ?.filter { it.isFile && it.extension.equals("pt", ignoreCase = true) }
            ?.sortedBy { it.name.lowercase() }
            ?.map {
                VisionModelInfo(
                    name = it.name,
                    sizeBytes = it.length(),
                    updatedAt = Instant.ofEpochMilli(it.lastModified()).toString(),
                )
            }
            ?: emptyList()
    }

    fun detect(
        image: MultipartFile,
        requestedModel: String?,
        requestedConfidence: Double?,
        requestedIou: Double?,
    ): VisionDetectResponse {
        require(!image.isEmpty) { "Please upload an image file first." }

        val ext = detectExtension(image)
        require(ext in allowedExt) { "Only JPG, JPEG, PNG, BMP, and WEBP images are supported." }

        val modelInfo = resolveModel(requestedModel)
        val scriptFile = File(vision.scriptPath).absoluteFile
        check(scriptFile.exists()) { "YOLO script not found: ${scriptFile.path}" }

        val resultId = UUID.randomUUID().toString()
        val jobDir = File(resultRoot, resultId).also { it.mkdirs() }.canonicalFile
        val inputFile = File(jobDir, "input.$ext").absoluteFile
        val outputImage = File(jobDir, "annotated.jpg").absoluteFile
        val outputJson = File(jobDir, "result.json").absoluteFile

        inputFile.parentFile?.mkdirs()
        image.transferTo(inputFile.absoluteFile)

        val confidence = (requestedConfidence ?: vision.confidence).coerceIn(0.01, 0.99)
        val iou = (requestedIou ?: vision.iou).coerceIn(0.01, 0.99)

        runInference(
            listOf(
                vision.pythonBin,
                scriptFile.path,
                "--model", modelInfo.path,
                "--image", inputFile.path,
                "--output-image", outputImage.path,
                "--output-json", outputJson.path,
                "--conf", confidence.toString(),
                "--iou", iou.toString(),
                "--imgsz", vision.imageSize.coerceAtLeast(320).toString(),
            )
        )

        check(outputJson.exists()) { "YOLO inference finished without result metadata." }
        check(outputImage.exists()) { "YOLO inference finished without annotated image." }

        val result = mapper.readValue(outputJson, VisionScriptResult::class.java)
        val response = VisionDetectResponse(
            resultId = resultId,
            model = result.model.ifBlank { modelInfo.name },
            confidence = confidence,
            iou = iou,
            image = result.image,
            detections = result.detections,
            count = result.count,
            imageUrl = "/api/vision/results/$resultId/image",
            generatedAt = Instant.now().toString(),
        )
        mapper.writerWithDefaultPrettyPrinter().writeValue(File(jobDir, "response.json"), response)
        return response
    }

    fun resultImage(resultId: String): File? {
        val file = File(resultRoot, "$resultId/annotated.jpg")
        return file.takeIf { it.exists() && it.isFile }
    }

    private fun detectExtension(image: MultipartFile): String {
        val nameExt = image.originalFilename
            ?.substringAfterLast('.', "")
            ?.lowercase()
            ?.takeIf { it.isNotBlank() }
        if (nameExt != null) return nameExt
        return when (image.contentType?.lowercase()) {
            "image/jpeg" -> "jpg"
            "image/png" -> "png"
            "image/bmp" -> "bmp"
            "image/webp" -> "webp"
            else -> ""
        }
    }

    private fun resolveModel(requestedModel: String?): ResolvedVisionModel {
        val available = modelDir()
            .listFiles()
            ?.filter { it.isFile && it.extension.equals("pt", ignoreCase = true) }
            ?.associateBy { it.name }
            ?: emptyMap()

        require(available.isNotEmpty()) { "No YOLO model files were found in ${modelDir().path}." }

        val selected = requestedModel?.trim().takeUnless { it.isNullOrBlank() }
            ?: available.keys.sorted().first()
        val file = available[selected]
            ?: throw IllegalArgumentException("Model not found: $selected")

        return ResolvedVisionModel(file.name, file.absolutePath)
    }

    private fun modelDir(): File = File(vision.modelDir).absoluteFile

    private fun runInference(command: List<String>) {
        val process = ProcessBuilder(command)
            .directory(File(".").absoluteFile)
            .start()

        val stdout = StringBuilder()
        val stderr = StringBuilder()

        val stdoutThread = thread(start = true, isDaemon = true, name = "vision-stdout") {
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { stdout.appendLine(it) }
            }
        }
        val stderrThread = thread(start = true, isDaemon = true, name = "vision-stderr") {
            process.errorStream.bufferedReader().useLines { lines ->
                lines.forEach { stderr.appendLine(it) }
            }
        }

        val finished = process.waitFor(vision.timeoutSeconds, TimeUnit.SECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            throw IllegalStateException("YOLO inference timed out after ${vision.timeoutSeconds} seconds.")
        }

        stdoutThread.join()
        stderrThread.join()

        if (process.exitValue() != 0) {
            val detail = stderr.toString().trim().ifBlank { stdout.toString().trim() }
            throw IllegalStateException(detail.ifBlank { "YOLO inference failed with exit code ${process.exitValue()}." })
        }
    }

    private data class ResolvedVisionModel(
        val name: String,
        val path: String,
    )
}
