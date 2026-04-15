package com.construction.gs3d.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.UrlBasedCorsConfigurationSource
import org.springframework.web.filter.CorsFilter

@ConfigurationProperties(prefix = "ssh")
data class SshProperties(
    val host: String = "",
    val port: Int = 22,
    val username: String = "",
    val password: String = "",
)

@ConfigurationProperties(prefix = "remote")
data class RemoteProperties(
    val workDir: String = "",
    val pythonBin: String = "",
    val trainScript: String = "",
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
