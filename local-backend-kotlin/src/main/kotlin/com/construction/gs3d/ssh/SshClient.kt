package com.construction.gs3d.ssh

import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.transport.verification.PromiscuousVerifier
import net.schmizz.sshj.xfer.FileSystemFile
import net.schmizz.sshj.xfer.LocalDestFile
import com.construction.gs3d.config.SshProperties
import org.springframework.stereotype.Component
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

@Component
class SshClientFactory(private val sshProps: SshProperties) {

    fun connect(): SSHClient = SSHClient().apply {
        addHostKeyVerifier(PromiscuousVerifier())
        connect(sshProps.host, sshProps.port)
        authPassword(sshProps.username, sshProps.password)
    }
}

/** 在单个 SFTP 会话中串行上传目录内所有图片/视频文件（断点续传：跳过云端已有文件） */
fun SSHClient.uploadDirectoryResume(
    localDir: File,
    remoteDir: String,
    onProgress: (done: Int, total: Int, filename: String) -> Unit,
) {
    val allowed = setOf(".jpg", ".jpeg", ".png", ".tiff", ".tif", ".mp4", ".mov", ".avi")
    val allFiles = localDir.listFiles { f -> f.extension.lowercase().let { ".${it}" } in allowed }
        ?.toList() ?: emptyList()

    val sftp: SFTPClient = newSFTPClient()
    try {
        val remoteFiles = try {
            sftp.ls(remoteDir).associate { it.name to it.attributes.size }
        } catch (_: Exception) { emptyMap() }

        val toUpload = allFiles.filter { file ->
            val remoteSize = remoteFiles[file.name]
            remoteSize == null || remoteSize != file.length()
        }
        val alreadyDone = allFiles.size - toUpload.size

        toUpload.forEachIndexed { idx, file ->
            sftp.put(FileSystemFile(file), "$remoteDir/${file.name}")
            onProgress(alreadyDone + idx + 1, allFiles.size, file.name)
        }
        if (toUpload.isEmpty()) onProgress(allFiles.size, allFiles.size, "已全部存在，跳过上传")
    } finally {
        sftp.close()
    }
}

/** 下载单个文件，回调进度 */
fun SSHClient.downloadFile(
    remotePath: String,
    localFile: File,
    onProgress: (transferred: Long, total: Long) -> Unit,
) {
    val sftp = newSFTPClient()
    try {
        val stat = sftp.stat(remotePath)
        val total = stat.size
        var transferred = if (localFile.exists()) localFile.length() else 0L

        sftp.get(remotePath, object : LocalDestFile {
            override fun getTargetFile(filename: String): LocalDestFile = this
            override fun getTargetDirectory(dirname: String): LocalDestFile = this
            override fun getChild(name: String): LocalDestFile = this
            override fun getLength(): Long = if (localFile.exists()) localFile.length() else 0L
            override fun getOutputStream(): OutputStream {
                return object : FileOutputStream(localFile) {
                    override fun write(b: ByteArray, off: Int, len: Int) {
                        super.write(b, off, len)
                        transferred += len
                        onProgress(transferred, total)
                    }
                }
            }
            override fun getOutputStream(append: Boolean): OutputStream {
                return object : FileOutputStream(localFile, append) {
                    override fun write(b: ByteArray, off: Int, len: Int) {
                        super.write(b, off, len)
                        transferred += len
                        onProgress(transferred, total)
                    }
                }
            }
            override fun setPermissions(perms: Int) {}
            override fun setLastAccessedTime(t: Long) {}
            override fun setLastModifiedTime(t: Long) {}
        })
    } finally {
        sftp.close()
    }
}

/** 执行远程命令，实时回调每行输出，非零退出码抛异常 */
fun SSHClient.execRemote(command: String, onLine: ((String) -> Unit)? = null) {
    startSession().use { session ->
        session.exec(command).use { cmd ->
            // 用后台线程并发读 stderr，避免 stdout/stderr 管道互相阻塞导致死锁
            val stderrThread = Thread {
                cmd.errorStream.bufferedReader().forEachLine { onLine?.invoke("[stderr] $it") }
            }.also { it.isDaemon = true; it.start() }
            cmd.inputStream.bufferedReader().forEachLine { onLine?.invoke("[stdout] $it") }
            stderrThread.join()
            cmd.join()
            val code = cmd.exitStatus ?: -1
            if (code != 0) throw RuntimeException("命令退出码 $code：${command.take(80)}")
        }
    }
}
