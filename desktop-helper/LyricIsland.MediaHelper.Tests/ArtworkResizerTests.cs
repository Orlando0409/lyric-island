using LyricIsland.MediaHelper.Media;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace LyricIsland.MediaHelper.Tests;

public class ArtworkResizerTests
{
    [Theory]
    [InlineData(512u, 512u, 256u, 256u)]
    [InlineData(1000u, 500u, 256u, 128u)]
    [InlineData(300u, 900u, 85u, 256u)]
    [InlineData(100u, 50u, 100u, 50u)]
    [InlineData(0u, 50u, 0u, 0u)]
    public void FitWithin(uint w, uint h, uint ew, uint eh) => Assert.Equal((ew, eh), ArtworkResizer.FitWithin(w, h));

    private static async Task<InMemoryRandomAccessStream> MakeImage(uint w, uint h, Guid encoderId)
    {
        var pixels = new byte[w * h * 4];
        for (var i = 0; i < pixels.Length; i += 4)
        {
            pixels[i] = (byte)(i % 251);
            pixels[i + 1] = 80;
            pixels[i + 2] = 200;
            pixels[i + 3] = 255;
        }
        var stream = new InMemoryRandomAccessStream();
        var enc = await BitmapEncoder.CreateAsync(encoderId, stream);
        enc.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, w, h, 96, 96, pixels);
        await enc.FlushAsync();
        stream.Seek(0);
        return stream;
    }

    [Fact]
    public async Task ReduceA256YCodificaPng()
    {
        using var input = await MakeImage(640, 480, BitmapEncoder.JpegEncoderId);
        var png = await ArtworkResizer.ToPngAsync(input);
        Assert.NotNull(png);
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, png![..4]);

        using var check = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(check))
        {
            writer.WriteBytes(png);
            await writer.StoreAsync();
            writer.DetachStream();
        }
        check.Seek(0);
        var dec = await BitmapDecoder.CreateAsync(check);
        Assert.Equal(256u, dec.PixelWidth);
        Assert.Equal(192u, dec.PixelHeight);
    }

    [Fact]
    public async Task ImagenPequenaNoSeAgranda_YHashEstable()
    {
        using var a = await MakeImage(64, 64, BitmapEncoder.PngEncoderId);
        using var b = await MakeImage(64, 64, BitmapEncoder.PngEncoderId);
        var pa = await ArtworkResizer.ToPngAsync(a);
        var pb = await ArtworkResizer.ToPngAsync(b);
        Assert.Equal(MediaTracker.Sha1Hex(pa!), MediaTracker.Sha1Hex(pb!));
    }
}
