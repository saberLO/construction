package com.construction.gs3d.ssh

import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.transport.verification.PromiscuousVerifier
import net.schmizz.sshj.xfer.FileSystemFile
import net.schmizz.sshj.xfer.LocalDestFile
import com.construction.gs3d.config.SshProperties
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import jakarta.annotation.PreDestroy

/**
 * SSH 连接池工厂。
 *
 * - 最多保持 [maxPoolSize] 个空闲连接
 * - 通过 [Semaphore] 限制最大并发 SSH 连接数为 [maxConcurrent]
 * - 连接断开时自动重建
 * - 应用关闭时清理所有连接
 */
@Component
class SshClientFactory(private val sshProps: SshProperties) {

    private val log = LoggerFactory.getLogger(javaClass)

    /** 最大并发 SSH 连接（包含正在使用的 + 空闲池中的） */
    private val maxConcurrent = 3
    /** 空闲连接池上限 */
    private val maxPoolSize = 2
    /** 获取连接的超时时间 */
    private val acquireTimeoutSec = 60L

    private val semaphore = Semaphore(maxConcurrent)
    private val pool = ConcurrentLinkedDeque<SSHClient>()

    /**
     * 从池中取一个连接，或新建。
     * 调用方必须在使用完毕后调用 [release] 归还，而非直接 close。
     */
    fun acquire(): SSHClient {
        if (!semaphore.tryAcquire(acquireTimeoutSec, TimeUnit.SECONDS)) {
            throw RuntimeException("获取 SSH 连接超时（${acquireTimeoutSec}s），所有连接均被占用")
        }
        // 从池中取一个仍然存活的连接
        while (true) {
            val cached = pool.pollFirst() ?: break
            if (cached.isConnected && cached.isAuthenticated) {
                return cached
            }
            // 连接已断开，静默关闭
            runCatching { cached.close() }
        }
        // 池中无可用连接，新建
        return try {
            createConnection()
        } catch (e: Exception) {
            semaphore.release()
            throw e
        }
    }

    /**
     * 归还连接到池中。若连接已断开或池满则直接关闭。
     */
    fun release(client: SSHClient) {
        try {
            if (client.isConnected && client.isAuthenticated && pool.size < maxPoolSize) {
                pool.offerFirst(client)
            } else {
                runCatching { client.close() }
            }
        } finally {
            semaphore.release()
        }
    }

    /**
     * 归还并关闭连接（出错时使用，不放回池中）。
     */
    fun destroy(client: SSHClient) {
        try {
            runCatching { client.close() }
        } finally {
            semaphore.release()
        }
    }

    /**
     * 兼容旧代码：创建一个不经过池管理的独立连接。
     * 新代码应使用 acquire()/release() 模式。
     */
    fun connect(): SSHClient = createConnection()

    private fun createConnection(): SSHClient = SSHClient().apply {
        addHostKeyVerifier(PromiscuousVerifier())
        connection.keepAlive.keepAliveInterval = 30  // 30s keepalive 防止空闲断开
        connect(sshProps.host, sshProps.port)
        authPassword(sshProps.username, sshProps.password)
    }

    @PreDestroy
    fun shutdown() {
        log.info("关闭 SSH 连接池，清理 {} 个空闲连接", pool.size)
        while (pool.isNotEmpty()) {
            val c = pool.pollFirst() ?: break
            runCatching { c.close() }
        }
    }
}

/**
 * 使用连接池的便捷扩展：自动 acquire/release，出错自动 destroy。
 */
inline fun <T> SshClientFactory.withConnection(block: (SSHClient) -> T): T {
    val ssh = acquire()
    var success = false
    return try {
        val result = block(ssh)
        success = true
        result
    } finally {
        if (success) release(ssh) else destroy(ssh)
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
