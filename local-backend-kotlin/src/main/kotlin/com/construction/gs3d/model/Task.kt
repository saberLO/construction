package com.construction.gs3d.model

import com.fasterxml.jackson.annotation.JsonAlias
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty

enum class TaskStatus { pending, running, completed, failed }

@JsonInclude(JsonInclude.Include.NON_NULL)
data class Task(
    @JsonProperty("task_id")
    @JsonAlias("taskId")
    val taskId: String,
    var name: String,
    var status: TaskStatus = TaskStatus.pending,
    var stage: TaskStage = TaskStage.CREATED,
    var progress: Int = 0,
    var message: String = "任务已创建，准备上传...",
    val quality: String = "medium",
    @JsonProperty("colmap_matcher")
    @JsonAlias("colmapMatcher")
    val colmapMatcher: String = "exhaustive",
    @JsonProperty("file_count")
    @JsonAlias("fileCount")
    val fileCount: Int = 0,
    @JsonProperty("local_input_dir")
    @JsonAlias("localInputDir")
    var localInputDir: String? = null,
    @JsonProperty("remote_root")
    @JsonAlias("remoteRoot")
    var remoteRoot: String? = null,
    var iterations: Int? = null,
    @JsonProperty("created_at")
    @JsonAlias("createdAt")
    val createdAt: String,
    @JsonProperty("updated_at")
    @JsonAlias("updatedAt")
    var updatedAt: String,
    var result: TaskResult? = null,
)

data class TaskResult(
    @JsonProperty("splat_url")
    @JsonAlias("splatUrl")
    val splatUrl: String,
    @JsonProperty("splat_size")
    @JsonAlias("splatSize")
    val splatSize: String,
    /** 与 splat 配套的 COLMAP 相机 JSON（若云端成功导出），如 `/models/{id}/cameras.json` */
    @JsonProperty("cameras_url")
    @JsonAlias("camerasUrl")
    val camerasUrl: String? = null,
)
