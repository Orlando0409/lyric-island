package com.lyricisland.app.data

import com.lyricisland.app.BuildConfig
import com.lyricisland.core.HttpGet
import com.lyricisland.core.HttpResponse
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** HTTP a LRCLIB con OkHttp: User-Agent identificable (8.1) y timeout total por petición. */
class LrclibHttp(private val client: OkHttpClient = OkHttpClient()) : HttpGet {
    companion object {
        val USER_AGENT = "LyricIsland/${BuildConfig.VERSION_NAME} (Android; lyrics overlay)"
    }

    override suspend fun get(url: String, timeoutMs: Long): HttpResponse {
        val call = client.newCall(Request.Builder().url(url).header("User-Agent", USER_AGENT).build())
        call.timeout().timeout(timeoutMs, TimeUnit.MILLISECONDS)
        return suspendCancellableCoroutine { cont ->
            cont.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
                override fun onResponse(call: Call, response: Response) {
                    response.use { cont.resume(HttpResponse(it.code, it.body?.string() ?: "")) }
                }
            })
        }
    }
}
