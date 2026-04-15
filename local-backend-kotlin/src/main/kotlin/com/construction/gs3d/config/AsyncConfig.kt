package com.construction.gs3d.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableAsync
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
import java.util.concurrent.Executor

@Configuration
@EnableAsync
class AsyncConfig {

    /**
     * 管线执行器：
     * - corePoolSize=1: 默认只有 1 个线程执行任务
     * - maxPoolSize=2:  队列满后最多扩展到 2 个并发任务
     * - queueCapacity=10: 最多排队 10 个任务
     * - 第 13+ 个任务会抛出 RejectedExecutionException（由 Controller 捕获返回 503）
     */
    @Bean("pipelineExecutor")
    fun pipelineExecutor(): Executor {
        val executor = ThreadPoolTaskExecutor()
        executor.corePoolSize = 1
        executor.maxPoolSize = 2
        executor.queueCapacity = 10
        executor.setThreadNamePrefix("pipeline-")
        executor.setWaitForTasksToCompleteOnShutdown(true)
        executor.setAwaitTerminationSeconds(30)
        executor.initialize()
        return executor
    }
}
