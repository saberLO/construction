package com.construction.gs3d.service

import com.construction.gs3d.config.IterationProperties
import com.construction.gs3d.config.RemoteProperties
import com.construction.gs3d.model.TaskResult
import com.construction.gs3d.model.TaskStage
import com.construction.gs3d.model.TaskStatus
import com.construction.gs3d.ssh.SshClientFactory
import com.construction.gs3d.ssh.downloadFile
import com.construction.gs3d.ssh.execRemote
import net.schmizz.sshj.SSHClient
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Service
import java.io.File

@Service
class PipelineService(
    private val taskService: TaskService,
    private val sshFactory: SshClientFactory,
    private val remote: RemoteProperties,
    private val iterations: IterationProperties,
) {
    private fun info(id: String, msg: String) = taskService.writeLog(id, "INFO ", msg)
    private fun error(id: String, msg: String) = taskService.writeLog(id, "ERROR", msg)

    @Async("pipelineExecutor")
    fun run(taskId: String) {
        val task = taskService.get(taskId) ?: return
        val iters = iterations.forQuality(task.quality)
        val remoteRoot = "${remote.workDir}/$taskId"
        val remoteInput = "$remoteRoot/input"
        val remoteOutput = "$remoteRoot/output"
        val localModelDir = File(taskService.modelsDir, taskId).also { it.mkdirs() }

        info(taskId, "=".repeat(60))
        info(taskId, "任务启动  质量=${task.quality}  迭代=$iters  图片=${task.fileCount}")
        info(taskId, "=".repeat(60))

        val ssh = try {
            taskService.updateProgress(taskId, 2, "连接云端服务器...", status = TaskStatus.running)
            sshFactory.acquire().also { info(taskId, "SSH 连接成功（连接池）") }
        } catch (e: Exception) {
            error(taskId, "SSH 连接失败: ${e.message}")
            taskService.update(taskId) { status = TaskStatus.failed; message = "SSH 连接失败: ${e.message}" }
            return
        }

        try {
            taskService.update(taskId) { this.remoteRoot = remoteRoot; this.iterations = iters }
            if (task.stage != TaskStage.CREATED || task.remoteRoot != null) {
                terminateRemoteTaskProcesses(ssh, taskId, remoteRoot)
            }

            // Step 1: 创建云端目录
            taskService.updateProgress(taskId, 4, "初始化云端目录...")
            ssh.execRemote("mkdir -p $remoteInput $remoteOutput")

            // Step 2: 上传图片（断点续传）
            if (!task.stage.isAtLeast(TaskStage.UPLOADED)) {
                val inputDir = task.localInputDir?.let { File(it) }
                    ?: throw RuntimeException("找不到本地输入目录，请重新上传照片")
                PipelineStages.executeUpload(ssh, taskId, taskService, inputDir, remoteInput)
            } else {
                taskService.updateProgress(taskId, 25, "已上传完成，跳过上传")
            }

            // Step 3: COLMAP
            if (!task.stage.isAtLeast(TaskStage.COLMAP_MAPPED)) {
                resetIncompleteColmapWorkspace(ssh, taskId, remoteRoot)
                PipelineStages.executeColmap(ssh, taskId, taskService, remote, remoteRoot, task.colmapMatcher)
            }

            // Step 4: 3DGS 训练
            if (!task.stage.isAtLeast(TaskStage.TRAINED)) {
                PipelineStages.executeTraining(ssh, taskId, taskService, remote, remoteRoot, remoteOutput, iters)
            }

            // Step 5+6: PLY → SPLAT + 下载模型
            val localSplat = PipelineStages.executeConvertAndDownload(
                ssh, taskId, taskService, remote, remoteRoot, remoteOutput, localModelDir, iters
            )

            taskService.updateProgress(taskId, 99, "导出相机参数...")
            tryExportColmapCameras(ssh, remoteRoot, localModelDir, taskId)

            sshFactory.release(ssh)

            val sizeMB = "%.1f".format(localSplat.length().toDouble() / 1024 / 1024)
            info(taskId, "=".repeat(60))
            info(taskId, "任务完成！模型大小: ${sizeMB}MB")
            info(taskId, "=".repeat(60))
            val camerasJson = File(localModelDir, "cameras.json")
            taskService.update(taskId) {
                status = TaskStatus.completed; progress = 100
                stage = TaskStage.COMPLETED
                message = "建模完成！模型大小 $sizeMB MB"
                result = TaskResult(
                    splatUrl = "/models/$taskId/scene.splat",
                    splatSize = sizeMB,
                    camerasUrl = if (camerasJson.exists()) "/models/$taskId/cameras.json" else null,
                )
            }

            // 任务完成后清理本地输入目录
            task.localInputDir?.let { File(it).deleteRecursively() }

        } catch (e: Exception) {
            error(taskId, "任务失败: ${e.message}")
            sshFactory.destroy(ssh)
            taskService.update(taskId) { status = TaskStatus.failed; message = e.message ?: "训练失败，请查看后端日志" }
        }
    }

    private fun terminateRemoteTaskProcesses(ssh: SSHClient, taskId: String, remoteRoot: String) {
        val qRoot = shQuote(remoteRoot)
        val cmd = """
            for pid in $(pgrep -f $qRoot || true); do
              if [ "${'$'}pid" != "${'$'}${'$'}" ]; then kill "${'$'}pid" 2>/dev/null || true; fi
            done
            sleep 1
            for pid in $(pgrep -f $qRoot || true); do
              if [ "${'$'}pid" != "${'$'}${'$'}" ]; then kill -9 "${'$'}pid" 2>/dev/null || true; fi
            done
            true
        """.trimIndent().replace("\n", "; ")

        runCatching {
            ssh.execRemote(cmd)
            info(taskId, "续跑前已清理该任务残留的远端进程")
        }.onFailure {
            info(taskId, "检查/清理远端残留进程失败，继续续跑: ${it.message}")
        }
    }

    private fun resetIncompleteColmapWorkspace(ssh: SSHClient, taskId: String, remoteRoot: String) {
        val targets = listOf(
            "$remoteRoot/distorted",
            "$remoteRoot/images",
            "$remoteRoot/sparse",
            "$remoteRoot/stereo",
            "$remoteRoot/database.db",
            "$remoteRoot/database.db-shm",
            "$remoteRoot/database.db-wal",
            "$remoteRoot/database.db-journal",
        ).joinToString(" ") { shQuote(it) }

        ssh.execRemote("rm -rf $targets && mkdir -p ${shQuote("$remoteRoot/input")} ${shQuote("$remoteRoot/output")}")
        info(taskId, "续跑前已重置未完成的 COLMAP 中间产物和 SQLite 数据库")
    }

    private fun shQuote(value: String): String = "'${value.replace("'", "'\"'\"'")}'"

    /**
     * 在远端将 sparse/0 转为文本并下载，生成前端可用的 cameras.json。
     * 依赖远端 PATH 中的 `colmap` 命令；失败时仅打日志，不影响主流程。
     */
    private fun tryExportColmapCameras(ssh: SSHClient, remoteRoot: String, localModelDir: File, taskId: String) {
        val txtDir = "$remoteRoot/sparse_txt"
        val remoteCameras = "$txtDir/cameras.txt"
        val remoteImages = "$txtDir/images.txt"
        taskService.update(taskId) { progress = 99; message = "导出 COLMAP 文本模型..." }
        runCatching {
            ssh.execRemote("mkdir -p $txtDir")
            ssh.execRemote("colmap model_converter --input_path $remoteRoot/sparse/0 --output_path $txtDir --output_type TXT")
        }.onFailure {
            info(taskId, "COLMAP 相机导出跳过（需远端安装 colmap 且 sparse/0 存在）: ${it.message}")
        }

        val tmpCam = File(localModelDir, "_cameras_txt.tmp")
        val tmpImg = File(localModelDir, "_images_txt.tmp")
        val gotCam = runCatching {
            ssh.downloadFile(remoteCameras, tmpCam) { transferred, total ->
                taskService.update(taskId) {
                    progress = 99
                    message = "下载相机参数 cameras.txt ${PipelineStages.formatBytes(transferred)} / ${PipelineStages.formatBytes(total)}"
                }
            }
            tmpCam.exists() && tmpCam.length() > 0L
        }.getOrDefault(false)
        val gotImg = if (gotCam) {
            runCatching {
                ssh.downloadFile(remoteImages, tmpImg) { transferred, total ->
                    taskService.update(taskId) {
                        progress = 99
                        message = "下载相机参数 images.txt ${PipelineStages.formatBytes(transferred)} / ${PipelineStages.formatBytes(total)}"
                    }
                }
                tmpImg.exists() && tmpImg.length() > 0L
            }.getOrDefault(false)
        } else {
            false
        }

        if (gotCam && gotImg) {
            runCatching {
                taskService.update(taskId) { progress = 99; message = "生成 cameras.json..." }
                ColmapTextCameraParser.writeViewerJson(tmpCam, tmpImg, File(localModelDir, "cameras.json"))
                info(taskId, "已生成本地 cameras.json（拍摄视角预设）")
            }.onFailure {
                info(taskId, "解析 COLMAP 文本相机失败: ${it.message}")
            }
        }
        tmpCam.delete()
        tmpImg.delete()
    }
}
