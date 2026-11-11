/// Errors from the audio layer.
#[derive(thiserror::Error, Debug)]
pub enum AudioError {
    #[error("no audio output device: {0}")]
    NoDevice(String),
    #[error("text-to-speech error: {0}")]
    Tts(String),
    #[error("stream error: {0}")]
    Stream(String),
    #[error("decode error: {0}")]
    Decode(String),
    #[error("timed out")]
    Timeout,
}
