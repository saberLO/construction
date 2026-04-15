package com.construction.gs3d.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue

/**
 * 任务阶段枚举，替代原来的字符串比较。
 * JSON 序列化使用小写 snake_case（与前端一致）。
 */
enum class TaskStage {
    CREATED,
    UPLOADED,
    COLMAP_MAPPED,
    TRAINED,
    SPLAT_READY,
    DOWNLOADED,
    COMPLETED;

    /** 判断当前阶段是否 >= 目标阶段 */
    fun isAtLeast(target: TaskStage): Boolean = this.ordinal >= target.ordinal

    /** JSON 序列化输出小写 */
    @JsonValue
    fun toJson(): String = name.lowercase()

    companion object {
        /** 兼容旧版 task.json 中的字符串值 */
        @JvmStatic
        @JsonCreator
        fun fromLegacy(value: String): TaskStage {
            // 先尝试精确匹配（大小写不敏感）
            return entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
                // 再尝试匹配 JSON 值
                ?: entries.firstOrNull { it.toJson() == value }
                // 默认回退到 CREATED
                ?: CREATED
        }
    }
}
