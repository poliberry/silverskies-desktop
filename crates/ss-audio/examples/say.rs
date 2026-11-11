//! Smoke test: `cargo run -p ss-audio --example say`

use std::time::Duration;

use ss_audio::{AudioEngine, TtsHandle};

fn main() {
    let tts = TtsHandle::spawn().expect("tts init");
    tts.speak_now("Silver Skies audio check");
    std::thread::sleep(Duration::from_millis(800));
    while tts.is_busy() {
        std::thread::sleep(Duration::from_millis(100));
    }

    let engine = AudioEngine::new().expect("audio device");
    let h = engine.play_attention_tone(2.0, 0.35);
    while !h.is_finished() {
        std::thread::sleep(Duration::from_millis(50));
    }
    println!("done");
}
