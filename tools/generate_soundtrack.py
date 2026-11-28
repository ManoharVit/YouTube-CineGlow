#!/usr/bin/env python3
"""YouTube CineGlow Pro — Soundtrack Synthesizer.

Generates a broadcast-quality, synchronized 48-second stereo electronic tech
soundtrack matching the 6 scenes of the CineGlow Pro demo video.

Tempo: 120 BPM (1 bar = 2.0s, 4 bars = 8.0s per scene)
Sample Rate: 48,000 Hz, 16-bit PCM Stereo
"""

import os
import wave

import numpy as np

SAMPLE_RATE = 48000
DURATION_SEC = 48.0
BPM = 120.0
BEAT_SEC = 60.0 / BPM
RNG_SEED = 42

# Synth & mix constants
PAD_CHUNK_SEC = 0.25
DETUNE_DOWN = 0.998
DETUNE_UP = 1.002
TREMOLO_BASE = 0.85
TREMOLO_DEPTH = 0.15
TREMOLO_RATE_HZ = 1.5
PAD_MIX = 0.28

BASS_START_SEC = 2.0
BASS_STEP_SEC = 0.5
BASS_BOOST_START_SEC = 16.0
BASS_BOOST_END_SEC = 24.0
BASS_BOOST_GAIN = 1.4
BASS_MIX = 0.35

ARP_STEP_SEC = 0.125
ARP_START_SEC = 4.0
ARP_END_SEC = 46.0
ARP_MIX = 0.22
ARP_PATTERN = (0, 2, 4, 1, 3, 2, 4, 3)

PERC_START_SEC = 8.0
KICK_END_SEC = 42.0
HAT_END_SEC = 41.5
HAT_STEP_SEC = 0.25

TRANSITION_TIMES_SEC = (7.5, 15.5, 23.5, 31.5, 39.5)
TRANSITION_DURATION_SEC = 0.8

FADE_IN_SEC = 1.5
FADE_OUT_SEC = 3.5
LIMITER_CEILING = 0.95
MIN_PEAK_FLOOR = 0.001

CHORDS: list[list[float]] = [
    [110.0, 164.8, 196.0, 246.9, 329.6],  # Am9
    [87.3, 130.8, 164.8, 220.0, 261.6],   # Fmaj7
    [65.4, 130.8, 196.0, 246.9, 293.7],   # Cmaj9
    [98.0, 146.8, 196.0, 246.9, 329.6],   # G6
]


def get_chord(time_sec: float) -> list[float]:
    """Return chord voice frequencies active at time_sec."""
    if not CHORDS:
        raise ValueError("CHORDS progression must not be empty")
    cycle = (time_sec % 16.0) / 4.0
    chord_index = int(cycle) % len(CHORDS)
    return CHORDS[chord_index]


def add_pad_layer(
    left: np.ndarray,
    right: np.ndarray,
    time_axis: np.ndarray,
    sample_rate: int,
) -> None:
    """Synthesize warm stereo-detuned ambient chord pads into left/right buffers."""
    total_samples = len(time_axis)
    pad_left = np.zeros(total_samples, dtype=np.float32)
    pad_right = np.zeros(total_samples, dtype=np.float32)
    chunk_len = max(1, int(sample_rate * PAD_CHUNK_SEC))

    for sample_idx in range(0, total_samples, chunk_len):
        end_idx = min(sample_idx + chunk_len, total_samples)
        chord = get_chord(sample_idx / sample_rate)
        sub_time = time_axis[sample_idx:end_idx]

        layer_l = np.zeros(len(sub_time), dtype=np.float32)
        layer_r = np.zeros(len(sub_time), dtype=np.float32)
        for freq_hz in chord:
            freq_l = freq_hz * DETUNE_DOWN
            freq_r = freq_hz * DETUNE_UP
            layer_l += (
                np.sin(2 * np.pi * freq_l * sub_time) * 0.6
                + np.sin(4 * np.pi * freq_l * sub_time) * 0.2
            )
            layer_r += (
                np.sin(2 * np.pi * freq_r * sub_time) * 0.6
                + np.sin(4 * np.pi * freq_r * sub_time) * 0.2
            )

        pad_left[sample_idx:end_idx] = layer_l / len(chord)
        pad_right[sample_idx:end_idx] = layer_r / len(chord)

    tremolo = TREMOLO_BASE + TREMOLO_DEPTH * np.sin(
        2 * np.pi * TREMOLO_RATE_HZ * time_axis
    )
    left[:] += pad_left * tremolo * PAD_MIX
    right[:] += pad_right * tremolo * PAD_MIX


def add_bass_layer(
    left: np.ndarray,
    right: np.ndarray,
    time_axis: np.ndarray,
    sample_rate: int,
) -> None:
    """Synthesize 8th-note sub/mid bass pulses into left/right buffers."""
    total_samples = len(time_axis)
    bass = np.zeros(total_samples, dtype=np.float32)
    step_samples = max(1, int(sample_rate * BASS_STEP_SEC))

    for sample_idx in range(0, total_samples, step_samples):
        cur_sec = sample_idx / sample_rate
        if cur_sec < BASS_START_SEC:
            continue
        end_idx = min(sample_idx + step_samples, total_samples)
        root_freq = get_chord(cur_sec)[0]

        rel_time = time_axis[sample_idx:end_idx] - cur_sec
        attack = np.minimum(1.0, rel_time / 0.005).astype(np.float32)
        envelope = np.exp(-rel_time * 5.0) * attack
        boost = (
            BASS_BOOST_GAIN
            if BASS_BOOST_START_SEC <= cur_sec < BASS_BOOST_END_SEC
            else 1.0
        )

        bass_note = (
            np.sin(2 * np.pi * root_freq * rel_time) * 0.8
            + np.sin(2 * np.pi * (root_freq * 2) * rel_time) * 0.3
        ) * envelope * boost
        bass[sample_idx:end_idx] += bass_note

    left[:] += bass * BASS_MIX
    right[:] += bass * BASS_MIX


def add_arpeggio_layer(
    left: np.ndarray,
    right: np.ndarray,
    time_axis: np.ndarray,
    sample_rate: int,
) -> None:
    """Synthesize ping-pong panned 16th-note arpeggio tones."""
    total_samples = len(time_axis)
    arp_left = np.zeros(total_samples, dtype=np.float32)
    arp_right = np.zeros(total_samples, dtype=np.float32)
    step_samples = max(1, int(sample_rate * ARP_STEP_SEC))

    for step_idx, sample_idx in enumerate(range(0, total_samples, step_samples)):
        cur_sec = sample_idx / sample_rate
        if cur_sec < ARP_START_SEC or cur_sec > ARP_END_SEC:
            continue
        end_idx = min(sample_idx + step_samples, total_samples)
        chord = get_chord(cur_sec)
        note_slot = ARP_PATTERN[step_idx % len(ARP_PATTERN)]
        note_freq = chord[note_slot % len(chord)] * 2.0

        rel_time = time_axis[sample_idx:end_idx] - cur_sec
        attack = np.minimum(1.0, rel_time / 0.003).astype(np.float32)
        envelope = np.exp(-rel_time * 22.0) * attack
        tone = np.sin(2 * np.pi * note_freq * rel_time) * envelope

        pan_left = 0.8 if (step_idx % 2 == 0) else 0.2
        arp_left[sample_idx:end_idx] += tone * pan_left
        arp_right[sample_idx:end_idx] += tone * (1.0 - pan_left)

    left[:] += arp_left * ARP_MIX
    right[:] += arp_right * ARP_MIX


def add_percussion_layers(
    left: np.ndarray,
    right: np.ndarray,
    time_axis: np.ndarray,
    sample_rate: int,
    rng: np.random.Generator,
) -> None:
    """Synthesize four-on-the-floor kick and off-beat hi-hat hits."""
    total_samples = len(time_axis)
    beat_samples = max(1, int(sample_rate * BEAT_SEC))
    kick_len = max(1, int(sample_rate * 0.18))

    for sample_idx in range(0, total_samples, beat_samples):
        cur_sec = sample_idx / sample_rate
        if cur_sec < PERC_START_SEC or cur_sec > KICK_END_SEC:
            continue
        end_idx = min(sample_idx + kick_len, total_samples)
        rel_time = time_axis[sample_idx:end_idx] - cur_sec
        kick_freq = 45.0 + 95.0 * np.exp(-rel_time * 35.0)
        kick_phase = 2 * np.pi * np.cumsum(kick_freq) / sample_rate
        kick_wave = np.sin(kick_phase) * np.exp(-rel_time * 18.0) * 0.45
        left[sample_idx:end_idx] += kick_wave
        right[sample_idx:end_idx] += kick_wave

    hat_step = max(1, int(sample_rate * HAT_STEP_SEC))
    hat_len = max(1, int(sample_rate * 0.05))
    for sample_idx in range(hat_step, total_samples, hat_step * 2):
        cur_sec = sample_idx / sample_rate
        if cur_sec < PERC_START_SEC or cur_sec > HAT_END_SEC:
            continue
        end_idx = min(sample_idx + hat_len, total_samples)
        rel_time = time_axis[sample_idx:end_idx] - cur_sec
        noise = rng.uniform(-1.0, 1.0, len(rel_time)).astype(np.float32)
        hat_wave = noise * np.exp(-rel_time * 60.0) * 0.12 * 0.7
        left[sample_idx:end_idx] += hat_wave
        right[sample_idx:end_idx] += hat_wave


def add_transition_swooshes(
    left: np.ndarray,
    right: np.ndarray,
    time_axis: np.ndarray,
    sample_rate: int,
    rng: np.random.Generator,
) -> None:
    """Synthesize filtered noise/sine risers at 8-second scene boundaries."""
    total_samples = len(time_axis)
    swoosh_len = max(1, int(sample_rate * TRANSITION_DURATION_SEC))

    for start_sec in TRANSITION_TIMES_SEC:
        start_idx = int(sample_rate * start_sec)
        if start_idx >= total_samples:
            continue
        end_idx = min(start_idx + swoosh_len, total_samples)
        sub_time = time_axis[start_idx:end_idx]
        if len(sub_time) == 0:
            continue

        rel_progress = (sub_time - start_sec) / TRANSITION_DURATION_SEC
        noise = rng.uniform(-1.0, 1.0, len(sub_time)).astype(np.float32)
        rise_freq = 200.0 + 800.0 * (rel_progress ** 2)
        rise_phase = 2 * np.pi * np.cumsum(rise_freq) / sample_rate
        rise_tone = np.sin(rise_phase)

        envelope = np.sin(np.pi * rel_progress)
        swoosh = (noise * 0.6 + rise_tone * 0.4) * envelope * 0.18
        left[start_idx:end_idx] += swoosh
        right[start_idx:end_idx] += swoosh


def export_master_wav(
    left: np.ndarray,
    right: np.ndarray,
    sample_rate: int,
    output_wav: str,
) -> float:
    """Apply master fade envelope, soft limiter, and write 16-bit stereo WAV."""
    total_samples = len(left)
    master_env = np.ones(total_samples, dtype=np.float32)
    fade_in = min(int(sample_rate * FADE_IN_SEC), total_samples)
    if fade_in > 0:
        master_env[:fade_in] = np.linspace(0.0, 1.0, fade_in)
    fade_out = min(int(sample_rate * FADE_OUT_SEC), total_samples)
    if fade_out > 0:
        master_env[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)

    out_left = left * master_env
    out_right = right * master_env

    max_peak = max(
        float(np.max(np.abs(out_left))),
        float(np.max(np.abs(out_right))),
        MIN_PEAK_FLOOR,
    )
    limited_l = np.tanh(out_left / max_peak * LIMITER_CEILING)
    limited_r = np.tanh(out_right / max_peak * LIMITER_CEILING)

    int16_max = np.iinfo(np.int16).max
    stereo_i16 = np.empty((total_samples * 2,), dtype=np.int16)
    stereo_i16[0::2] = (limited_l * int16_max).astype(np.int16)
    stereo_i16[1::2] = (limited_r * int16_max).astype(np.int16)

    with wave.open(output_wav, 'wb') as wav_file:
        wav_file.setnchannels(2)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(stereo_i16.tobytes())

    return os.path.getsize(output_wav) / (1024 * 1024)


def main() -> None:
    """Synthesize and write the 48s stereo soundtrack WAV to tools/soundtrack.wav."""
    total_samples = int(SAMPLE_RATE * DURATION_SEC)
    if SAMPLE_RATE <= 0 or DURATION_SEC <= 0 or total_samples <= 0:
        raise ValueError(
            f"SAMPLE_RATE and DURATION_SEC must be positive "
            f"(got {SAMPLE_RATE}, {DURATION_SEC})"
        )
    if not CHORDS or not all(CHORDS):
        raise ValueError("CHORDS must contain at least one non-empty chord")

    time_axis = np.linspace(
        0, DURATION_SEC, total_samples, endpoint=False, dtype=np.float32
    )
    left = np.zeros(total_samples, dtype=np.float32)
    right = np.zeros(total_samples, dtype=np.float32)
    rng = np.random.default_rng(RNG_SEED)

    print("Synthesizing warm ambient pads...")
    add_pad_layer(left, right, time_axis, SAMPLE_RATE)

    print("Synthesizing bassline...")
    add_bass_layer(left, right, time_axis, SAMPLE_RATE)

    print("Synthesizing arpeggiated synth motif...")
    add_arpeggio_layer(left, right, time_axis, SAMPLE_RATE)

    print("Synthesizing subtle percussion & groove...")
    add_percussion_layers(left, right, time_axis, SAMPLE_RATE, rng)

    print("Synthesizing scene transition swooshes...")
    add_transition_swooshes(left, right, time_axis, SAMPLE_RATE, rng)

    print("Applying master limiter & fade in/out envelopes...")
    output_dir = os.path.dirname(os.path.abspath(__file__))
    output_wav = os.path.join(output_dir, 'soundtrack.wav')
    wav_size_mb = export_master_wav(left, right, SAMPLE_RATE, output_wav)
    print(
        f"Generated soundtrack: {output_wav} "
        f"({wav_size_mb:.2f} MB, {DURATION_SEC}s @ {SAMPLE_RATE} Hz stereo)"
    )


if __name__ == '__main__':
    main()
