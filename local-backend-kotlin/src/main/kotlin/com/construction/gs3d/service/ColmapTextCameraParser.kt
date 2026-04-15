package com.construction.gs3d.service

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.io.File

/**
 * 解析 COLMAP model_converter 导出的文本 cameras.txt / images.txt，
 * 生成与 antimatter15/splat 兼容的 cameras.json（供前端一键跳转拍摄视角）。
 */
object ColmapTextCameraParser {

    private val mapper = jacksonObjectMapper()

    private data class CameraRow(
        val id: Int,
        val model: String,
        val width: Int,
        val height: Int,
        val params: DoubleArray,
    )

    fun writeViewerJson(camerasTxt: File, imagesTxt: File, outJson: File) {
        val cameras = parseCamerasFile(camerasTxt)
        val presets = parseImagesFile(imagesTxt, cameras)
        if (presets.isEmpty()) error("未解析到任何相机位姿")
        mapper.writerWithDefaultPrettyPrinter().writeValue(outJson, presets)
    }

    private fun parseCamerasFile(f: File): Map<Int, CameraRow> {
        val map = mutableMapOf<Int, CameraRow>()
        f.readLines().forEach { line ->
            val t = line.trim()
            if (t.isEmpty() || t.startsWith("#")) return@forEach
            val parts = t.split(Regex("\\s+"))
            if (parts.size < 5) return@forEach
            val id = parts[0].toIntOrNull() ?: return@forEach
            val model = parts[1]
            val width = parts[2].toIntOrNull() ?: return@forEach
            val height = parts[3].toIntOrNull() ?: return@forEach
            val params = parts.drop(4).mapNotNull { it.toDoubleOrNull() }.toDoubleArray()
            map[id] = CameraRow(id, model, width, height, params)
        }
        return map
    }

    private fun parseImagesFile(f: File, cameras: Map<Int, CameraRow>): List<Map<String, Any>> {
        val lines = f.readLines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
        val out = mutableListOf<Map<String, Any>>()
        var idx = 0
        var i = 0
        while (i < lines.size) {
            val parts = lines[i].split(Regex("\\s+"))
            if (parts.size < 10) {
                i++
                continue
            }
            val qw = parts[1].toDoubleOrNull()
            val qx = parts[2].toDoubleOrNull()
            val qy = parts[3].toDoubleOrNull()
            val qz = parts[4].toDoubleOrNull()
            val tx = parts[5].toDoubleOrNull()
            val ty = parts[6].toDoubleOrNull()
            val tz = parts[7].toDoubleOrNull()
            val camId = parts[8].toIntOrNull()
            if (qw == null || qx == null || qy == null || qz == null ||
                tx == null || ty == null || tz == null || camId == null
            ) {
                i++
                continue
            }
            val name = parts.drop(9).joinToString(" ")

            val cam = cameras[camId]
            if (cam == null) {
                i += 2
                continue
            }

            val R = quatToRotMat(qw, qx, qy, qz)
            val tvec = doubleArrayOf(tx, ty, tz)
            val center = cameraCenterWorld(R, tvec)
            val (fx, fy) = focalXY(cam)

            out.add(
                mapOf(
                    "id" to idx,
                    "img_name" to name,
                    "width" to cam.width,
                    "height" to cam.height,
                    "position" to center.toList(),
                    "rotation" to listOf(
                        listOf(R[0], R[1], R[2]),
                        listOf(R[3], R[4], R[5]),
                        listOf(R[6], R[7], R[8]),
                    ),
                    "fy" to fy,
                    "fx" to fx,
                ),
            )
            idx++
            i += 2
        }
        return out
    }

    private fun focalXY(cam: CameraRow): Pair<Double, Double> {
        val p = cam.params
        return when (cam.model.uppercase()) {
            "SIMPLE_PINHOLE" -> {
                if (p.size >= 1) {
                    val f = p[0]
                    f to f
                } else 1.0 to 1.0
            }
            "PINHOLE" -> {
                if (p.size >= 2) p[0] to p[1]
                else 1.0 to 1.0
            }
            "SIMPLE_RADIAL", "RADIAL" -> {
                if (p.size >= 1) {
                    val f = p[0]
                    f to f
                } else 1.0 to 1.0
            }
            else -> {
                if (p.isNotEmpty()) {
                    val f = p[0]
                    f to f
                } else 1.0 to 1.0
            }
        }
    }

    /** COLMAP qvec (w,x,y,z) -> 世界到相机旋转矩阵 R（行主序 9 元素） */
    private fun quatToRotMat(w: Double, x: Double, y: Double, z: Double): DoubleArray {
        val r = DoubleArray(9)
        r[0] = 1.0 - 2.0 * (y * y + z * z)
        r[1] = 2.0 * (x * y - w * z)
        r[2] = 2.0 * (x * z + w * y)
        r[3] = 2.0 * (x * y + w * z)
        r[4] = 1.0 - 2.0 * (x * x + z * z)
        r[5] = 2.0 * (y * z - w * x)
        r[6] = 2.0 * (x * z - w * y)
        r[7] = 2.0 * (y * z + w * x)
        r[8] = 1.0 - 2.0 * (x * x + y * y)
        return r
    }

    /** 相机中心 C = -R^T * t，其中 X_cam = R * X_world + t */
    private fun cameraCenterWorld(R: DoubleArray, t: DoubleArray): DoubleArray {
        val c = DoubleArray(3)
        c[0] = -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2])
        c[1] = -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2])
        c[2] = -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2])
        return c
    }
}
