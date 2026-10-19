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
import subprocess
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TMP_DIR = os.path.join(BASE_DIR, '.narration_tmp')
BGM_WAV = os.path.join(BASE_DIR, 'soundtrack.wav')
OUTPUT_WAV = os.path.join(BASE_DIR, 'soundtrack_with_narration.wav')

# Narration script precisely calibrated for each 8.0-second scene window
SCENE_SCRIPTS = [
    (
        'scene_1',
        'Welcome to YouTube CineGlow Pro, bringing dynamic, multi-edge ambient lighting beyond your video player.',
        '+15%',
        500   # Delay: 0.5s into Scene 1 (0.0s - 8.0s)
    ),
    (
        'scene_2',
        'Fine-tune every setting in a compact popup with directional glow toggles, balanced presets, and quick tab reloading.',
        '+12%',
        8400  # Delay: 8.4s into Scene 2 (8.0s - 16.0s)
    ),
    (
        'scene_3',
        'Upgrade your audio with the built-in DSP suite, featuring studio dynamic normalization and a five-band equalizer.',
        '+12%',
        16400 # Delay: 16.4s into Scene 3 (16.0s - 24.0s)
    ),
    (
        'scene_4',
        'Maximize your screen with auto-crop black bars, twenty-one-to-nine ultrawide zoom, and distraction-free theater mode.',
        '+12%',
        24400 # Delay: 24.4s into Scene 4 (24.0s - 32.0s)
    ),
    (
        'scene_5',
        'Inspect live playback performance with the real-time Stats HUD, and grab uncompressed 4K video frame screenshots.',
        '+12%',
        32400 # Delay: 32.4s into Scene 5 (32.0s - 40.0s)
    ),
    (
        'scene_6',
        'Built on Manifest V3 by Giri Manohar Vemula. Try YouTube CineGlow Pro on the Chrome Web Store today.',
        '+15%',
        40400 # Delay: 40.4s into Scene 6 (40.0s - 48.0s)
    ),
]

def generate_voiceover():
    os.makedirs(TMP_DIR, exist_ok=True)
    print("Generating neural studio voiceover narration with edge-tts...")
    
    # Locate uvx
    uvx_path = '/Users/girimanoharv/.local/bin/uvx'
    if not os.path.exists(uvx_path):
        uvx_path = 'uvx'

    for name, text, rate, delay_ms in SCENE_SCRIPTS:
        out_mp3 = os.path.join(TMP_DIR, f"{name}.mp3")
        cmd = [
            uvx_path, 'edge-tts',
            '--voice', 'en-US-ChristopherNeural',
            '--rate', rate,
            '--text', text,
            '--write-media', out_mp3
        ]
        print(f"  -> Synthesizing {name} ({rate})...")
        subprocess.run(cmd, check=True)

    print("All scene voiceover clips synthesized successfully.")

def mix_soundtrack():
    print(f"Mixing narration with background music: {BGM_WAV}...")

    # Build ffmpeg filter_complex
    inputs = ['-i', BGM_WAV]
    for name, _, _, _ in SCENE_SCRIPTS:
        inputs.extend(['-i', os.path.join(TMP_DIR, f"{name}.mp3")])

    filter_parts = []
    # Duck background music to 0.18 (-15 dB) so narration stays crystal clear
    filter_parts.append('[0:a]volume=0.18[bgm_ducked];')

    for i, (_, _, _, delay_ms) in enumerate(SCENE_SCRIPTS):
        idx = i + 1
        filter_parts.append(f'[{idx}:a]adelay={delay_ms}|{delay_ms},volume=1.2[v{idx}];')

    voice_inputs = ''.join([f'[v{i+1}]' for i in range(len(SCENE_SCRIPTS))])
    filter_parts.append(f'{voice_inputs}amix=inputs={len(SCENE_SCRIPTS)}:normalize=0[voice];')
    filter_parts.append('[bgm_ducked][voice]amix=inputs=2:normalize=0[out]')

    cmd = [
        '/opt/homebrew/bin/ffmpeg', '-y',
        *inputs,
        '-filter_complex', ''.join(filter_parts),
        '-map', '[out]',
        '-t', '48.0',
        '-ar', '48000',
        '-ac', '2',
        OUTPUT_WAV
    ]

    subprocess.run(cmd, check=True)
    print(f"Master soundtrack with narration generated at: {OUTPUT_WAV}")

if __name__ == '__main__':
    generate_voiceover()
    mix_soundtrack()
