using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace LyricIsland.MediaHelper.Media;

/// <summary>Reduce la carátula a un máximo de 256 × 256 px y la codifica en PNG (regla 3 del protocolo).</summary>
public static class ArtworkResizer
{
    public const uint MaxSide = 256;

    public static (uint Width, uint Height) FitWithin(uint width, uint height, uint max = MaxSide)
    {
        if (width == 0 || height == 0) return (0, 0);
        if (width <= max && height <= max) return (width, height);
        var scale = Math.Min((double)max / width, (double)max / height);
        return ((uint)Math.Max(1, Math.Round(width * scale)), (uint)Math.Max(1, Math.Round(height * scale)));
    }

    public static async Task<byte[]?> ToPngAsync(IRandomAccessStream input)
    {
        var decoder = await BitmapDecoder.CreateAsync(input);
        var (w, h) = FitWithin(decoder.OrientedPixelWidth, decoder.OrientedPixelHeight);
        if (w == 0) return null;
        var transform = new BitmapTransform
        {
            ScaledWidth = w,
            ScaledHeight = h,
            InterpolationMode = BitmapInterpolationMode.Fant,
        };
        var pixels = await decoder.GetPixelDataAsync(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Premultiplied,
            transform,
            ExifOrientationMode.RespectExifOrientation,
            ColorManagementMode.DoNotColorManage);

        using var output = new InMemoryRandomAccessStream();
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, output);
        encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, w, h, 96, 96, pixels.DetachPixelData());
        await encoder.FlushAsync();
        return await ReadAllAsync(output);
    }

    internal static async Task<byte[]> ReadAllAsync(IRandomAccessStream stream)
    {
        stream.Seek(0);
        var size = (uint)stream.Size;
        using var reader = new DataReader(stream.GetInputStreamAt(0));
        await reader.LoadAsync(size);
        var bytes = new byte[size];
        reader.ReadBytes(bytes);
        return bytes;
    }
}
