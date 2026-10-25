using System.Collections.Concurrent;

namespace LyricIsland.MediaHelper.Protocol;

public interface IMessageSink
{
    void Send(Message message);
}

/// <summary>
/// Escritura en stdout mediante una cola única (un solo hilo escribe) para no entrelazar líneas,
/// con flush tras cada mensaje (regla 8 de 11.2).
/// </summary>
public sealed class NdjsonWriter : IMessageSink, IDisposable
{
    private readonly BlockingCollection<string> _queue = new();
    private readonly TextWriter _out;
    private readonly Thread _thread;

    public NdjsonWriter(TextWriter output)
    {
        _out = output;
        _thread = new Thread(Run) { IsBackground = true, Name = "ndjson-writer" };
        _thread.Start();
    }

    public void Send(Message message)
    {
        if (!_queue.IsAddingCompleted) _queue.Add(ProtocolJson.Serialize(message));
    }

    private void Run()
    {
        foreach (var line in _queue.GetConsumingEnumerable())
        {
            try
            {
                _out.Write(line);
                _out.Write('\n');
                _out.Flush();
            }
            catch (IOException)
            {
                return; // Electron cerró la tubería
            }
        }
    }

    /// <summary>Vacía la cola y espera a que el hilo termine.</summary>
    public void Dispose()
    {
        _queue.CompleteAdding();
        _thread.Join(TimeSpan.FromSeconds(2));
    }
}
