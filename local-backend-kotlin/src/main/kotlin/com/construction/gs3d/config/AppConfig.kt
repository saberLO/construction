package com.construction.gs3d.config

import jakarta.validation.constraints.NotBlank
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.validation.annotation.Validated
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.UrlBasedCorsConfigurationSource
import org.springframework.web.filter.CorsFilter

@Validated
@ConfigurationProperties(prefix = "ssh")
data class SshProperties(
    @field:NotBlank(message = "ssh.host 不能为空，请设置 SSH_HOST 环境变量")
    val host: String = "",
    val port: Int = 22,
    @field:NotBlank(message = "ssh.username 不能为空，请设置 SSH_USERNAME 环境变量")
    val username: String = "",
    @field:NotBlank(message = "ssh.password 不能为空，请设置 SSH_PASSWORD 环境变量")
    val password: String = "",
)

@Validated
@ConfigurationProperties(prefix = "remote")
data class RemoteProperties(
    @field:NotBlank(message = "remote.work-dir 不能为空")
    val workDir: String = "",
    @field:NotBlank(message = "remote.python-bin 不能为空")
    val pythonBin: String = "",
    @field:NotBlank(message = "remote.train-script 不能为空")
    val trainScript: String = "",
    @field:NotBlank(message = "remote.ply2splat-script 不能为空")
    val ply2splatScript: String = "",
)

@ConfigurationProperties(prefix = "iterations")
data class IterationProperties(
    val low: Int = 7000,
    val medium: Int = 15000,
    val high: Int = 30000,
) {
    fun forQuality(q: String) = when (q) {
        "low" -> low; "high" -> high; else -> medium
    }
}

@ConfigurationProperties(prefix = "vision")
data class VisionProperties(
    val modelDir: String = "../model",
    val pythonBin: String = "python",
    val scriptPath: String = "./scripts/yolo_infer.py",
    val confidence: Double = 0.25,
    val iou: Double = 0.45,
    val imageSize: Int = 1280,
    val timeoutSeconds: Long = 120,
)

@Configuration
@EnableConfigurationProperties(
    SshProperties::class,
    RemoteProperties::class,
    IterationProperties::class,
    VisionProperties::class,
)
class AppConfig(@Value("\${app.cors-origins:*}") private val corsOrigins: String) {

    @Bean
    fun corsFilter(): CorsFilter {
        val config = CorsConfiguration().apply {
            allowedOriginPatterns = listOf(corsOrigins)
            allowedMethods = listOf("GET", "POST", "PUT", "DELETE", "OPTIONS")
            allowedHeaders = listOf("*")
        }
        return CorsFilter(UrlBasedCorsConfigurationSource().apply {
            registerCorsConfiguration("/**", config)
        })
    }
}
