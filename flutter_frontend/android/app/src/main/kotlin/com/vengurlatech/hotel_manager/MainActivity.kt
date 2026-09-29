package com.vengurlatech.hotel_manager

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Writes a downloaded report/receipt straight into the public Downloads
 * folder, the way Chrome or WhatsApp does — visible in any file manager and
 * in the Downloads app, not tucked away in this app's private storage — and
 * opens it back up again for the Snackbar's "Open" action.
 *
 * On Android 10+ [MediaStore.Downloads] is the sanctioned way in: no storage
 * permission needed, unlike the legacy public-directory write it replaces.
 */
class MainActivity : FlutterActivity() {
    private val channelName = "hotel_manager/downloads"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "saveToDownloads" -> {
                        val fileName = call.argument<String>("fileName")
                            ?: throw IllegalArgumentException("fileName is required")
                        val mimeType = call.argument<String>("mimeType") ?: "application/octet-stream"
                        val bytes = call.argument<ByteArray>("bytes")
                            ?: throw IllegalArgumentException("bytes is required")
                        result.success(saveToDownloads(fileName, mimeType, bytes))
                    }
                    "openFile" -> {
                        val path = call.argument<String>("uri")
                            ?: throw IllegalArgumentException("uri is required")
                        val mimeType = call.argument<String>("mimeType") ?: "*/*"
                        openFile(path, mimeType)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("DOWNLOADS_CHANNEL_FAILED", e.message, null)
            }
        }
    }

    private fun saveToDownloads(fileName: String, mimeType: String, bytes: ByteArray): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Could not create the file in Downloads")
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("Could not open the file for writing")
            return uri.toString()
        }

        // Pre-Android 10: no scoped storage, so a direct write to the public
        // Downloads directory needs no MediaStore ceremony.
        @Suppress("DEPRECATION")
        val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!downloads.exists()) downloads.mkdirs()
        val file = File(downloads, fileName)
        file.writeBytes(bytes)
        return file.absolutePath
    }

    private fun openFile(path: String, mimeType: String) {
        // A MediaStore save (Android 10+) already hands back a content:// uri
        // with its own permission grant; a legacy plain file path needs the
        // FileProvider detour so the viewer app is allowed to read it at all.
        val uri = if (path.startsWith("content://")) {
            Uri.parse(path)
        } else {
            FileProvider.getUriForFile(this, "$packageName.fileprovider", File(path))
        }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mimeType)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }
}
