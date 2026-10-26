# kotlinx.serialization se usa solo con el API de JsonElement (sin reflexión).
-dontwarn org.slf4j.**
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# kuromoji carga su diccionario (recursos del jar) por nombre de clase.
-keep class com.atilika.kuromoji.** { *; }
