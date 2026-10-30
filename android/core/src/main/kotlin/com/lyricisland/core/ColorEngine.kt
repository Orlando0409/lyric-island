package com.lyricisland.core

import kotlin.math.atan2
import kotlin.math.cbrt
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

// ColorEngine. Puerto de color.ts. La extracción de swatches la hace androidx.palette en la app.

enum class SwatchName { Vibrant, DarkVibrant, Muted, DarkMuted, LightVibrant, LightMuted, Dominant }

data class Swatch(val hex: String, val population: Int)

data class Oklch(val l: Double, val c: Double, val h: Double)

object ColorEngine {
    val NEUTRAL_PALETTE = Palette("#1C1C1E", "#2C2C2E", "#FFFFFF", "#FFFFFF73", "#FFFFFF8C", "#A1A1A6")
    const val BG_L_MIN = 0.22
    const val BG_L_MAX = 0.38
    const val BG_C_MAX = 0.16
    const val MIN_CONTRAST = 4.5
    const val MIN_POPULATION_SHARE = 0.02
    private val BACKGROUND_ORDER = listOf(SwatchName.DarkVibrant, SwatchName.Vibrant, SwatchName.DarkMuted, SwatchName.Muted, SwatchName.Dominant)
    private val HEX = Regex("^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$")
    private val HEX6 = Regex("^#?[0-9a-fA-F]{6}$")

    fun hexToRgb(hex: String): IntArray {
        val m = HEX.find(hex.trim()) ?: throw IllegalArgumentException("color inválido: $hex")
        val n = m.groupValues[1].toInt(16)
        return intArrayOf((n shr 16) and 255, (n shr 8) and 255, n and 255)
    }

    fun rgbToHex(r: Double, g: Double, b: Double): String {
        fun h(v: Double) = jsRound(minOf(255.0, maxOf(0.0, v))).toString(16).padStart(2, '0')
        return "#${h(r)}${h(g)}${h(b)}".uppercase()
    }

    private fun toLinear(c: Int): Double {
        val v = c / 255.0
        return if (v <= 0.04045) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
    }

    private fun fromLinear(v: Double): Double = (if (v <= 0.0031308) 12.92 * v else 1.055 * v.pow(1 / 2.4) - 0.055) * 255

    fun hexToOklch(hex: String): Oklch {
        val (r8, g8, b8) = hexToRgb(hex).toList()
        val r = toLinear(r8)
        val g = toLinear(g8)
        val b = toLinear(b8)
        val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        val bigL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
        val bigA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
        val bigB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        var h = atan2(bigB, bigA) * 180 / Math.PI
        if (h < 0) h += 360
        return Oklch(bigL, sqrt(bigA * bigA + bigB * bigB), h)
    }

    private fun oklchToLinear(c: Oklch): DoubleArray {
        val hr = c.h * Math.PI / 180
        val a = c.c * cos(hr)
        val b = c.c * sin(hr)
        val l = (c.l + 0.3963377774 * a + 0.2158037573 * b).pow(3)
        val m = (c.l - 0.1055613458 * a - 0.0638541728 * b).pow(3)
        val s = (c.l - 0.0894841775 * a - 1.291485548 * b).pow(3)
        return doubleArrayOf(
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        )
    }

    private fun inGamut(rgb: DoubleArray) = rgb.all { it >= -1e-4 && it <= 1 + 1e-4 }

    fun oklchToHex(color: Oklch): String {
        val l = minOf(1.0, maxOf(0.0, color.l))
        var rgb = oklchToLinear(color.copy(l = l))
        if (!inGamut(rgb)) {
            var lo = 0.0
            var hi = color.c
            repeat(24) {
                val mid = (lo + hi) / 2
                if (inGamut(oklchToLinear(Oklch(l, mid, color.h)))) lo = mid else hi = mid
            }
            rgb = oklchToLinear(Oklch(l, lo, color.h))
        }
        val (r, g, b) = rgb.map { fromLinear(minOf(1.0, maxOf(0.0, it))) }
        return rgbToHex(r, g, b)
    }

    fun relativeLuminance(hex: String): Double {
        val (r, g, b) = hexToRgb(hex).map(::toLinear)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    fun contrastRatio(a: String, b: String): Double {
        val la = relativeLuminance(a)
        val lb = relativeLuminance(b)
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }

    private fun adjustBackground(c: Oklch) = Oklch(minOf(BG_L_MAX, maxOf(BG_L_MIN, c.l)), minOf(c.c, BG_C_MAX), c.h)

    fun validSwatches(swatches: Map<SwatchName, Swatch?>?): Set<SwatchName> {
        if (swatches == null) return emptySet()
        val total = swatches.values.sumOf { it?.population ?: 0 }
        if (total <= 0) return emptySet()
        return swatches.filter { (_, s) -> s != null && HEX6.matches(s.hex) && s.population.toDouble() / total >= MIN_POPULATION_SHARE }.keys
    }

    fun buildPalette(swatches: Map<SwatchName, Swatch?>?): Palette {
        val valid = validSwatches(swatches)
        val ordered = BACKGROUND_ORDER.filter { it in valid }.map { swatches!![it]!!.hex }
        if (ordered.isEmpty()) return NEUTRAL_PALETTE

        var bg = adjustBackground(hexToOklch(ordered[0]))
        val altSource = ordered.drop(1).firstOrNull { !it.equals(ordered[0], ignoreCase = true) }
        var alt = if (altSource != null) adjustBackground(hexToOklch(altSource)) else bg.copy(l = maxOf(0.0, bg.l - 0.06))

        val textPrimary = "#FFFFFF"
        var bgHex = oklchToHex(bg)
        var altHex = oklchToHex(alt)
        for (step in 0 until 10) {
            val okBg = contrastRatio(textPrimary, bgHex) >= MIN_CONTRAST
            val okAlt = contrastRatio(textPrimary, altHex) >= MIN_CONTRAST
            if (okBg && okAlt) break
            if (!okBg) bg = bg.copy(l = maxOf(0.0, bg.l - 0.02))
            if (!okAlt) alt = alt.copy(l = maxOf(0.0, alt.l - 0.02))
            bgHex = oklchToHex(bg)
            altHex = oklchToHex(alt)
        }

        val accent = when {
            SwatchName.LightVibrant in valid -> swatches!![SwatchName.LightVibrant]!!.hex.uppercase()
            SwatchName.Vibrant in valid -> oklchToHex(hexToOklch(swatches!![SwatchName.Vibrant]!!.hex).copy(l = 0.75))
            else -> oklchToHex(bg.copy(l = 0.75))
        }
        return Palette(bgHex, altHex, textPrimary, "#FFFFFF73", "#FFFFFF8C", if (accent.startsWith("#")) accent else "#$accent")
    }

    /**
     * Color de degradado elegido por el usuario → fondo legible: si el texto blanco no llega a contraste 4.5,
     * se oscurece en OKLCH (mismo tono) hasta llegar.
     */
    fun readableBackground(hex: String): String {
        val rgb = hexToRgb(hex)
        val input = rgbToHex(rgb[0].toDouble(), rgb[1].toDouble(), rgb[2].toDouble())
        if (contrastRatio("#FFFFFF", input) >= MIN_CONTRAST) return input
        var c = hexToOklch(input)
        var out = input
        var step = 0
        while (step < 50 && contrastRatio("#FFFFFF", out) < MIN_CONTRAST) {
            c = c.copy(l = maxOf(0.0, c.l - 0.02))
            out = oklchToHex(c)
            step++
        }
        return out
    }

    fun mixOklch(a: String, b: String, t: Double): String {
        val ca = hexToOklch(a)
        val cb = hexToOklch(b)
        var ha = ca.h
        var hb = cb.h
        if (ca.c < 0.002) ha = hb
        if (cb.c < 0.002) hb = ha
        var dh = hb - ha
        if (dh > 180) dh -= 360
        if (dh < -180) dh += 360
        val k = clamp(t, 0.0, 1.0)
        var h = ha + dh * k
        if (h < 0) h += 360
        if (h >= 360) h -= 360
        return oklchToHex(Oklch(ca.l + (cb.l - ca.l) * k, ca.c + (cb.c - ca.c) * k, h))
    }

    /** Color #RRGGBB o #RRGGBBAA → ARGB (para Compose: Color(argb)). */
    fun toArgb(hex: String): Long {
        val h = hex.removePrefix("#")
        val rgb = h.substring(0, 6).toLong(16)
        val alpha = if (h.length == 8) h.substring(6, 8).toLong(16) else 0xFF
        return (alpha shl 24) or rgb
    }
}
