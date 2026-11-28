#!/usr/bin/env python3
"""
YouTube CineGlow Pro — Studio Audio Narration & Soundtrack Mix Generator
Generates natural neural studio voiceover narration across all 6 showcase scenes
and mixes it with dynamic ducked background music for the 1080p demo video.

Developer & Lead Architect: Giri Manohar Vemula
LinkedIn: https://www.linkedin.com/in/manoharv511
GitHub: https://github.com/ManoharVit
"""

import os
import shutil
import subprocess
import tempfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BGM_WAV = os.path.join(BASE_DIR, 'soundtrack.wav')
OUTPUT_WAV = os.path.join(BASE_DIR, 'soundtrack_with_narration.wav')

VOICE_NAME = 'en-US-ChristopherNeural'
BGM_DUCK_GAIN = 0.18
VOICE_GAIN = 1.2
OUTPUT_SAMPLE_RATE = '48000'
OUTPUT_CHANNELS = '2'

# Narration script precisely calibrated for each 8.0-second scene window
SCENE_SCRIPTS = [
    (
        'scene_1',
        'Welcome to YouTube CineGlow Pro, bringing dynamic, multi-edge ambient lighting beyond your video player.',
        '+15%',
        500    # Delay: 0.5s into Scene 1 (0.0s - 8.0s)
    ),
    (
        'scene_2',
        'Fine-tune every setting in a compact popup with directional glow toggles, balanced presets, and quick tab reloading.',
        '+12%',
        8400   # Delay: 8.4s into Scene 2 (8.0s - 16.0s)
    ),
    (
        'scene_3',
        'Upgrade your audio with the built-in DSP suite, featuring studio dynamic normalization and a five-band equalizer.',
        '+12%',
        16400  # Delay: 16.4s into Scene 3 (16.0s - 24.0s)
    ),
    (
        'scene_4',
        'Maximize your screen with auto-crop black bars, twenty-one-to-nine ultrawide zoom, and distraction-free theater mode.',
        '+12%',
        24400  # Delay: 24.4s into Scene 4 (24.0s - 32.0s)
    ),
    (
        'scene_5',
        'Inspect live playback performance with the real-time Stats HUD, and grab uncompressed 4K video frame screenshots.',
        '+12%',
        32400  # Delay: 32.4s into Scene 5 (32.0s - 40.0s)
    ),
    (
        'scene_6',
        'Built on Manifest V3 by Giri Manohar Vemula. Try YouTube CineGlow Pro on the Chrome Web Store today.',
        '+15%',
        40400  # Delay: 40.4s into Scene 6 (40.0s - 48.0s)
    ),
]


def resolve_binary(preferred_path: str | None, fallback_name: str) -> str:
    """Return runnable preferred_path or locate fallback_name on PATH."""
    if (
        preferred_path
        and os.path.isfile(preferred_path)
        and os.access(preferred_path, os.X_OK)
    ):
        return preferred_path
    resolved = shutil.which(fallback_name)
    if not resolved:
        raise FileNotFoundError(
            f"Required executable '{fallback_name}' not found "
            f"(checked '{preferred_path}' and PATH)"
        )
    return resolved


def generate_voiceover(tmp_dir: str) -> None:
    """Synthesize per-scene TTS narration clips into tmp_dir via edge-tts."""
    if not SCENE_SCRIPTS:
        raise ValueError("SCENE_SCRIPTS must not be empty")
    os.makedirs(tmp_dir, exist_ok=True)
    print("Generating neural studio voiceover narration with edge-tts...")

    preferred_uvx = os.environ.get('UVX_BIN') or os.path.expanduser('~/.local/bin/uvx')
    uvx_path = resolve_binary(preferred_uvx, 'uvx')

    for name, text, rate, _delay_ms in SCENE_SCRIPTS:
        out_mp3 = os.path.join(tmp_dir, f"{name}.mp3")
        cmd = [
            uvx_path, 'edge-tts',
            '--voice', VOICE_NAME,
            '--rate', rate,
            '--text', text,
            '--write-media', out_mp3,
        ]
        print(f"  -> Synthesizing {name} ({rate})...")
        try:
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(
                f"edge-tts failed for '{name}' with exit code {exc.returncode}"
            ) from exc

    print("All scene voiceover clips synthesized successfully.")


def mix_soundtrack(tmp_dir: str) -> None:
    """Mix synthesized narration clips with BGM_WAV into OUTPUT_WAV via ffmpeg."""
    if not SCENE_SCRIPTS:
        raise ValueError("SCENE_SCRIPTS must not be empty")
    if not os.path.isfile(BGM_WAV):
        raise FileNotFoundError(f"Background soundtrack not found: {BGM_WAV}")
    preferred_ffmpeg = os.environ.get('FFMPEG_PATH') or '/opt/homebrew/bin/ffmpeg'
    ffmpeg_bin = resolve_binary(preferred_ffmpeg, 'ffmpeg')

    print(f"Mixing narration with background music: {BGM_WAV}...")

    inputs = ['-i', BGM_WAV]
    filter_parts = [f'[0:a]volume={BGM_DUCK_GAIN}[bgm_ducked];']
    voice_labels: list[str] = []

    for idx, (name, _, _, delay_ms) in enumerate(SCENE_SCRIPTS, start=1):
        clip_path = os.path.join(tmp_dir, f"{name}.mp3")
        if not os.path.isfile(clip_path):
            raise FileNotFoundError(f"Synthesized voice clip not found: {clip_path}")
        inputs.extend(['-i', clip_path])
        filter_parts.append(
            f'[{idx}:a]adelay={delay_ms}|{delay_ms},volume={VOICE_GAIN}[v{idx}];'
        )
        voice_labels.append(f'[v{idx}]')

    filter_parts.append(
        f"{''.join(voice_labels)}amix=inputs={len(SCENE_SCRIPTS)}:normalize=0[voice];"
    )
    filter_parts.append('[bgm_ducked][voice]amix=inputs=2:normalize=0[out]')

    cmd = [
        ffmpeg_bin, '-y',
        *inputs,
        '-filter_complex', ''.join(filter_parts),
        '-map', '[out]',
        '-ar', OUTPUT_SAMPLE_RATE,
        '-ac', OUTPUT_CHANNELS,
        OUTPUT_WAV,
    ]

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"ffmpeg mix failed with exit code {exc.returncode}"
        ) from exc
    print(f"Master soundtrack with narration generated at: {OUTPUT_WAV}")


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='cineglow_narration_') as tmp_dir:
        generate_voiceover(tmp_dir)
        mix_soundtrack(tmp_dir)
