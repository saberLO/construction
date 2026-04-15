package com.construction.gs3d.service

import com.construction.gs3d.config.RemoteProperties
import com.construction.gs3d.model.TaskStage
import com.construction.gs3d.model.TaskStatus
import com.construction.gs3d.ssh.downloadFile
import com.construction.gs3d.ssh.execRemote
import com.construction.gs3d.ssh.uploadDirectoryResume
import net.schmizz.sshj.SSHClient
import java.io.File

/**
 * 管线各阶段的独立执行函数，从 PipelineService.run() 中抽取。
 * 每个函数只做一件事，方便测试和复用。
 */
object PipelineStages {

    /** Step 1: 上传照片到云端（断点续传） */
    fun executeUpload(
        ssh: SSHClient,
        taskId: String,
        taskService: TaskService,
        localInputDir: File,
        remoteInput: String,
    ) {
        taskService.updateProgress(taskId, 5, "上传照片到云端（支持断点续传）...")
        ssh.uploadDirectoryResume(localInputDir, remoteInput) { done, total, filename ->
            val pct = (5 + done.toDouble() / total * 20).toInt()
            taskService.update(taskId) { progress = pct; message = "上传照片 $done/$total：$filename" }
        }
        taskService.updateProgress(taskId, 25, "照片上传完成", stage = TaskStage.UPLOADED)
    }

    /** Step 2: COLMAP 特征提取 + 稀疏重建 */
    fun executeColmap(
        ssh: SSHClient,
        taskId: String,
        taskService: TaskService,
        remote: RemoteProperties,
        remoteRoot: String,
        colmapMatcher: String,
    ) {
        taskService.updateProgress(taskId, 26, "COLMAP 特征提取中...")
        val colmapStart = System.currentTimeMillis()
        val matcherArg = if (colmapMatcher == "sequential") "--colmap_matcher sequential_matcher" else ""
        ssh.execRemote("cd /data/gaussian-splatting && ${remote.pythonBin} convert.py -s $remoteRoot $matcherArg".trim()) { line ->
            taskService.writeLog(taskId, "COLMAP", line.replace(Regex("\\[std\\w+\\] "), "").trim())
            when {
                line.contains("Processed file") ->
                    line.findMatch(Regex("\\[(\\d+)/(\\d+)\\]"))?.let {
                        taskService.update(taskId) { progress = 28; message = "COLMAP 特征提取 ${it.groupValues[1]}/${it.groupValues[2]} 张" }
                    }
                line.contains("Matching block") -> taskService.update(taskId) { progress = 33; message = "COLMAP 特征匹配中..." }
                line.contains("Registering image") -> taskService.update(taskId) { progress = 38; message = "COLMAP 稀疏重建中..." }
                line.contains("Global bundle adjustment") -> taskService.update(taskId) { progress = 40; message = "COLMAP 全局优化中..." }
                line.contains("ndistort") -> taskService.update(taskId) { progress = 41; message = "COLMAP 畸变校正中..." }
            }
        }
        ssh.execRemote(
            "test -f $remoteRoot/sparse/0/cameras.bin && echo 'sparse OK' || " +
            "{ echo 'COLMAP失败：sparse/0/cameras.bin 不存在'; exit 1; }"
        ) { taskService.writeLog(taskId, "INFO ", it.replace(Regex("\\[std\\w+\\] "), "")) }

        var imgCount = 0
        ssh.execRemote("ls $remoteRoot/images/ 2>/dev/null | wc -l") { line ->
            imgCount = line.replace(Regex("\\[stdout\\] "), "").trim().toIntOrNull() ?: 0
        }
        val colmapSec = (System.currentTimeMillis() - colmapStart) / 1000
        taskService.updateProgress(taskId, 42, "COLMAP 完成（${imgCount}张图片，耗时${colmapSec}s）", stage = TaskStage.COLMAP_MAPPED)
    }

    /** Step 3: 3DGS 训练 */
    fun executeTraining(
        ssh: SSHClient,
        taskId: String,
        taskService: TaskService,
        remote: RemoteProperties,
        remoteRoot: String,
        remoteOutput: String,
        iters: Int,
    ) {
        taskService.updateProgress(taskId, 45, "3DGS 训练开始（$iters 迭代）...")
        val trainStart = System.currentTimeMillis()
        var lastPsnr: Double? = null
        ssh.execRemote(
            "${remote.pythonBin} ${remote.trainScript} -s $remoteRoot -m $remoteOutput --iterations $iters --save_iterations $iters"
        ) { line ->
            val clean = line.replace(Regex("\\[std\\w+\\] "), "").trim()
            if (line.startsWith("[stderr]") || clean.contains("traceback", ignoreCase = true) ||
                clean.contains("error", ignoreCase = true) || clean.contains("exception", ignoreCase = true) ||
                clean.contains("cuda", ignoreCase = true) || clean.contains("memory", ignoreCase = true)
            ) {
                taskService.writeLog(taskId, "TRAIN", clean)
            }
            if (clean.contains("[ITER") && clean.contains("PSNR")) {
                taskService.writeLog(taskId, "INFO ", "[训练] $clean")
                clean.findMatch(Regex("PSNR ([\\d.]+)"))?.let { lastPsnr = it.groupValues[1].toDoubleOrNull() }
            }
            clean.findMatch(Regex("Training progress.*?(\\d+)%.*?(\\d+)/(\\d+)"))?.let { m ->
                val done = m.groupValues[2].toInt(); val total = m.groupValues[3].toInt()
                val pct = (45 + done.toDouble() / total * 43).toInt()
                val elapsed = (System.currentTimeMillis() - trainStart) / 1000.0
                val remaining = if (elapsed > 0) ((total - done) / (done / elapsed)).toLong() else 0L
                val eta = if (remaining > 60) "${remaining / 60}分${remaining % 60}秒" else "${remaining}秒"
                taskService.update(taskId) {
                    progress = pct
                    message = "3DGS训练 $done/$total 轮${lastPsnr?.let { "  PSNR=${"%.1f".format(it)}dB" } ?: ""}  预计剩余 $eta"
                }
            }
        }
        val trainSec = (System.currentTimeMillis() - trainStart) / 1000
        taskService.writeLog(taskId, "INFO ", "3DGS训练完成，耗时${trainSec / 60}分${trainSec % 60}秒，最终PSNR=${lastPsnr?.let { "${"%.2f".format(it)}dB" } ?: "N/A"}")
        taskService.update(taskId) { stage = TaskStage.TRAINED }
    }

    /** Step 4: PLY→SPLAT 转换 + 下载模型 */
    fun executeConvertAndDownload(
        ssh: SSHClient,
        taskId: String,
        taskService: TaskService,
        remote: RemoteProperties,
        remoteRoot: String,
        remoteOutput: String,
        localModelDir: File,
        iters: Int,
    ): File {
        taskService.updateProgress(taskId, 89, "转换为 splat 格式...")
        val remotePly = "$remoteOutput/point_cloud/iteration_$iters/point_cloud.ply"
        val remoteSplat = "$remoteRoot/scene.splat"
        ssh.execRemote("${remote.pythonBin} ${remote.ply2splatScript} $remotePly $remoteSplat")

        taskService.updateProgress(taskId, 92, "下载模型到本地...")
        val localSplat = File(localModelDir, "scene.splat")
        ssh.downloadFile(remoteSplat, localSplat) { transferred, total ->
            val pct = (92 + transferred.toDouble() / total * 7).toInt()
            taskService.update(taskId) { progress = pct; message = "下载模型 ${formatBytes(transferred)} / ${formatBytes(total)}" }
        }
        return localSplat
    }

    fun formatBytes(b: Long): String =
        if (b < 1024 * 1024) "${"%.1f".format(b / 1024.0)} KB"
        else "${"%.1f".format(b / 1024.0 / 1024)} MB"

    private fun String.findMatch(regex: Regex) = regex.find(this)
}
