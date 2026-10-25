package com.lyricisland.app.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.lyricisland.core.CacheEntry
import com.lyricisland.core.Candidate
import com.lyricisland.core.LyricsCache
import com.lyricisland.core.LyricsRepository
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

// Caché de letras (8.4) en Room: LRU de 5 000 entradas + offsets del usuario sin TTL.

@Entity(tableName = "lyrics_cache")
data class CachedLyricsEntity(
    @PrimaryKey val key: String,
    val hit: Boolean,
    val storedAt: Long,
    val recordJson: String?,
    val lastAccess: Long,
)

@Entity(tableName = "user_offsets")
data class UserOffsetEntity(@PrimaryKey val key: String, val offsetMs: Long)

@Dao
interface LyricsDao {
    @Query("SELECT * FROM lyrics_cache WHERE `key` = :key")
    suspend fun get(key: String): CachedLyricsEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(e: CachedLyricsEntity)

    @Query("UPDATE lyrics_cache SET lastAccess = :at WHERE `key` = :key")
    suspend fun touch(key: String, at: Long)

    @Query("DELETE FROM lyrics_cache WHERE `key` NOT IN (SELECT `key` FROM lyrics_cache ORDER BY lastAccess DESC LIMIT :max)")
    suspend fun trim(max: Int)

    @Query("SELECT COUNT(*) FROM lyrics_cache")
    suspend fun count(): Int

    @Query("DELETE FROM lyrics_cache")
    suspend fun clear()

    @Query("SELECT offsetMs FROM user_offsets WHERE `key` = :key")
    suspend fun offset(key: String): Long?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putOffset(e: UserOffsetEntity)

    @Query("DELETE FROM user_offsets WHERE `key` = :key")
    suspend fun deleteOffset(key: String)

    @Query("DELETE FROM user_offsets")
    suspend fun clearOffsets()

    @Query("SELECT COUNT(*) FROM user_offsets")
    suspend fun offsetCount(): Int
}

@Database(entities = [CachedLyricsEntity::class, UserOffsetEntity::class], version = 1, exportSchema = true)
abstract class LyricsDatabase : RoomDatabase() {
    abstract fun dao(): LyricsDao

    companion object {
        fun create(context: Context) = Room.databaseBuilder(context, LyricsDatabase::class.java, "lyrics.db").build()
    }
}

class RoomLyricsCache(private val dao: LyricsDao, private val now: () -> Long = System::currentTimeMillis) : LyricsCache {
    companion object {
        const val MAX_ENTRIES = 5000

        fun encode(c: Candidate): String = buildJsonObject {
            put("id", JsonPrimitive(c.id))
            put("trackName", JsonPrimitive(c.trackName))
            put("artistName", JsonPrimitive(c.artistName))
            put("albumName", c.albumName?.let(::JsonPrimitive) ?: JsonNull)
            put("duration", c.duration?.let(::JsonPrimitive) ?: JsonNull)
            put("instrumental", JsonPrimitive(c.instrumental))
            put("plainLyrics", c.plainLyrics?.let(::JsonPrimitive) ?: JsonNull)
            put("syncedLyrics", c.syncedLyrics?.let(::JsonPrimitive) ?: JsonNull)
            put("hasWordSync", JsonPrimitive(c.hasWordSync))
            put("lyricsfile", c.lyricsfile?.let(::JsonPrimitive) ?: JsonNull)
        }.toString()

        fun decode(s: String?): Candidate? = s?.let { runCatching { LyricsRepository.toCandidate(Json.parseToJsonElement(it)) }.getOrNull() }
    }

    override suspend fun get(key: String): CacheEntry? {
        val e = dao.get(key) ?: return null
        dao.touch(key, now())
        return CacheEntry(e.hit, e.storedAt, decode(e.recordJson))
    }

    override suspend fun set(key: String, entry: CacheEntry) {
        dao.put(CachedLyricsEntity(key, entry.hit, entry.storedAt, entry.record?.let(::encode), now()))
        if (dao.count() > MAX_ENTRIES) dao.trim(MAX_ENTRIES)
    }
}
