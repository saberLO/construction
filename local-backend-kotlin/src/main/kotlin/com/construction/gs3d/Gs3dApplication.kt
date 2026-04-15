package com.construction.gs3d

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableAsync

@SpringBootApplication
@EnableAsync
class Gs3dApplication

fun main(args: Array<String>) {
    runApplication<Gs3dApplication>(*args)
}
