#!/usr/bin/env python3
"""
YouTube CineGlow Pro — Soundtrack Synthesizer
Generates a broadcast-quality, synchronized 48-second stereo electronic tech soundtrack
matching the 6 scenes of the CineGlow Pro demo video.

Tempo: 120 BPM (1 bar = 2.0s, 4 bars = 8.0s per scene)
Sample Rate: 48,000 Hz, 16-bit PCM Stereo
"""

import math
import numpy as np
import wave
import os

SAMPLE_RATE = 48000
DURATION = 48.0
TOTAL_SAMPLES = int(SAMPLE_RATE * DURATION)
BPM = 120.0
BEAT_DUR = 60.0 / BPM  # 0.5s
BAR_DUR = BEAT_DUR * 4  # 2.0s

t = np.linspace(0, DURATION, TOTAL_SAMPLES, endpoint=False)
left = np.zeros(TOTAL_SAMPLES, dtype=np.float32)
right = np.zeros(TOTAL_SAMPLES, dtype=np.float32)

# Musical Chord Progression (each chord 2 bars = 4.0s):
# Am9 -> Fmaj7 -> Cmaj9 -> G6 (repeated 6 times across 48s)
# Root frequencies:
# Am9:   A2 (110.0), C3 (130.8), E3 (164.8), G3 (196.0), B3 (246.9)
# Fmaj7: F2 (87.3),  A2 (110.0), C3 (130.8), E3 (164.8)
# Cmaj9: C2 (65.4),  E2 (82.4),  G2 (98.0),  B2 (123.5), D3 (146.8)
# G6:    G2 (98.0),  B2 (123.5), D3 (146.8), E3 (164.8)

CHORDS = [
    # Am9
    [110.0, 164.8, 196.0, 246.9, 329.6],
    # Fmaj7
    [87.3, 130.8, 164.8, 220.0, 261.6],
    # Cmaj9
    [65.4, 130.8, 196.0, 246.9, 293.7],
    # G6
    [98.0, 146.8, 196.0, 246.9, 329.6],
]

def get_chord(time_sec):
    cycle = (time_sec % 16.0) / 4.0
    idx = int(cycle) % len(CHORDS)
    return CHORDS[idx]

print("Synthesizing warm ambient pads...")
# 1. Warm Ambient Pads with stereo detuning
pad_left = np.zeros(TOTAL_SAMPLES, dtype=np.float32)
pad_right = np.zeros(TOTAL_SAMPLES, dtype=np.float32)

# Sample chord at intervals of 0.25s
chunk_len = int(SAMPLE_RATE * 0.25)
for i in range(0, TOTAL_SAMPLES, chunk_len):
    cur_t = i / SAMPLE_RATE
    chord = get_chord(cur_t)
    sub_t = t[i:min(i + chunk_len, TOTAL_SAMPLES)]
    
    layer_l = np.zeros(len(sub_t), dtype=np.float32)
    layer_r = np.zeros(len(sub_t), dtype=np.float32)
    
    for f in chord:
        # Detuned saw/sine hybrid for warm analog pad
        f_l = f * 0.998
        f_r = f * 1.002
        # Soft envelope filter
        layer_l += (np.sin(2 * np.pi * f_l * sub_t) * 0.6 + np.sin(4 * np.pi * f_l * sub_t) * 0.2)
        layer_r += (np.sin(2 * np.pi * f_r * sub_t) * 0.6 + np.sin(4 * np.pi * f_r * sub_t) * 0.2)
        
    pad_left[i:min(i + chunk_len, TOTAL_SAMPLES)] = layer_l / len(chord)
    pad_right[i:min(i + chunk_len, TOTAL_SAMPLES)] = layer_r / len(chord)

# Gentle tremolo on pad
tremolo = 0.85 + 0.15 * np.sin(2 * np.pi * 1.5 * t)
left += pad_left * tremolo * 0.28
right += pad_right * tremolo * 0.28

print("Synthesizing bassline...")
# 2. Warm Sub & Mid Bass (active after 4 seconds)
bass = np.zeros(TOTAL_SAMPLES, dtype=np.float32)
bass_step_samples = int(SAMPLE_RATE * 0.5)  # 8th notes
for i in range(0, TOTAL_SAMPLES, bass_step_samples):
    cur_t = i / SAMPLE_RATE
    if cur_t < 2.0:
        continue
    chord = get_chord(cur_t)
    root_f = chord[0]
    
    sub_t = t[i:min(i + bass_step_samples, TOTAL_SAMPLES)]
    rel_t = sub_t - cur_t
    env = np.exp(-rel_t * 5.0)  # plucky bass decay
    
    # Extra boost during Scene 3 (Audio DSP: 16s - 24s)
    boost = 1.4 if (16.0 <= cur_t < 24.0) else 1.0
    
    bass_note = (np.sin(2 * np.pi * root_f * sub_t) * 0.8 + 
                 np.sin(2 * np.pi * (root_f * 2) * sub_t) * 0.3) * env * boost
    bass[i:min(i + bass_step_samples, TOTAL_SAMPLES)] += bass_note

left += bass * 0.35
right += bass * 0.35

print("Synthesizing arpeggiated synth motif...")
# 3. 16th-note Tech Arpeggio (ping-pong panning)
arp_step = int(SAMPLE_RATE * 0.125)  # 16th note at 120 bpm = 0.125s
arp_l = np.zeros(TOTAL_SAMPLES, dtype=np.float32)
arp_r = np.zeros(TOTAL_SAMPLES, dtype=np.float32)

arp_pattern = [0, 2, 4, 1, 3, 2, 4, 3]  # chord indices
for step_idx, i in enumerate(range(0, TOTAL_SAMPLES, arp_step)):
    cur_t = i / SAMPLE_RATE
    if cur_t < 4.0 or cur_t > 46.0:
        continue
    chord = get_chord(cur_t)
    note_idx = arp_pattern[step_idx % len(arp_pattern)]
    note_f = chord[note_idx % len(chord)] * 2.0  # one octave up
    
    sub_t = t[i:min(i + arp_step, TOTAL_SAMPLES)]
    rel_t = sub_t - cur_t
    env = np.exp(-rel_t * 22.0)  # crisp pluck decay
    
    tone = np.sin(2 * np.pi * note_f * sub_t) * env
    # Ping-pong pan alternating every note
    pan_l = 0.8 if (step_idx % 2 == 0) else 0.2
    pan_r = 1.0 - pan_l
    
    arp_l[i:min(i + arp_step, TOTAL_SAMPLES)] += tone * pan_l
    arp_r[i:min(i + arp_step, TOTAL_SAMPLES)] += tone * pan_r

left += arp_l * 0.22
right += arp_r * 0.22

print("Synthesizing subtle percussion & groove...")
# 4. Modern Tech Beat (Kick on beats 1, 2, 3, 4; crisp hat on offbeats)
# Active from 8.0s to 42.0s
beat_samples = int(SAMPLE_RATE * BEAT_DUR)  # 0.5s
for i in range(0, TOTAL_SAMPLES, beat_samples):
    cur_t = i / SAMPLE_RATE
    if cur_t < 8.0 or cur_t > 42.0:
        continue
    
    # Kick Drum: rapid pitch drop from 140Hz to 45Hz
    kick_len = int(SAMPLE_RATE * 0.18)
    sub_t = t[i:min(i + kick_len, TOTAL_SAMPLES)]
    rel_t = sub_t - cur_t
    kick_freq = 45.0 + 95.0 * np.exp(-rel_t * 35.0)
    kick_phase = 2 * np.pi * np.cumsum(kick_freq) / SAMPLE_RATE
    kick_env = np.exp(-rel_t * 18.0)
    kick_wave = np.sin(kick_phase) * kick_env * 0.45
    
    left[i:min(i + kick_len, TOTAL_SAMPLES)] += kick_wave
    right[i:min(i + kick_len, TOTAL_SAMPLES)] += kick_wave

# Hi-hat on 8th note off-beats (cur_t + 0.25s)
hat_step = int(SAMPLE_RATE * 0.25)
for i in range(hat_step, TOTAL_SAMPLES, hat_step * 2):
    cur_t = i / SAMPLE_RATE
    if cur_t < 8.0 or cur_t > 41.5:
        continue
    hat_len = int(SAMPLE_RATE * 0.05)
    sub_t = t[i:min(i + hat_len, TOTAL_SAMPLES)]
    rel_t = sub_t - cur_t
    noise = (np.random.rand(len(sub_t)) * 2 - 1).astype(np.float32)
    hat_env = np.exp(-rel_t * 60.0)
    hat_wave = noise * hat_env * 0.12
    left[i:min(i + hat_len, TOTAL_SAMPLES)] += hat_wave * 0.7
    right[i:min(i + hat_len, TOTAL_SAMPLES)] += hat_wave * 0.7

print("Synthesizing scene transition swooshes...")
# 5. Scene Transition Risers / Whooshes (every 8 seconds: 7.5s, 15.5s, 23.5s, 31.5s, 39.5s)
trans_times = [7.5, 15.5, 23.5, 31.5, 39.5]
for tr_t in trans_times:
    tr_start = int(SAMPLE_RATE * tr_t)
    tr_len = int(SAMPLE_RATE * 0.8)
    sub_t = t[tr_start:min(tr_start + tr_len, TOTAL_SAMPLES)]
    rel_t = (sub_t - tr_t) / 0.8  # 0 to 1
    
    # White noise sweep with rising sine pitch
    noise = (np.random.rand(len(sub_t)) * 2 - 1).astype(np.float32)
    rise_f = 200.0 + 800.0 * (rel_t ** 2)
    rise_phase = 2 * np.pi * np.cumsum(rise_f) / SAMPLE_RATE
    rise_tone = np.sin(rise_phase)
    
    env = np.sin(np.pi * rel_t)  # bell-shaped envelope
    swoosh = (noise * 0.6 + rise_tone * 0.4) * env * 0.18
    left[tr_start:min(tr_start + tr_len, TOTAL_SAMPLES)] += swoosh
    right[tr_start:min(tr_start + tr_len, TOTAL_SAMPLES)] += swoosh

print("Applying master limiter & fade in/out envelopes...")
# 6. Master Volume Envelope (1.5s fade in, 3.5s outro fade out)
master_env = np.ones(TOTAL_SAMPLES, dtype=np.float32)
# Fade in
fade_in_samples = int(SAMPLE_RATE * 1.5)
master_env[:fade_in_samples] = np.linspace(0.0, 1.0, fade_in_samples)
# Fade out
fade_out_samples = int(SAMPLE_RATE * 3.5)
master_env[-fade_out_samples:] = np.linspace(1.0, 0.0, fade_out_samples)

left *= master_env
right *= master_env

# Soft saturation limiter to prevent digital clipping
max_peak = max(np.max(np.abs(left)), np.max(np.abs(right)), 0.001)
left = np.tanh(left / max_peak * 0.95)
right = np.tanh(right / max_peak * 0.95)

# Convert to 16-bit PCM
left_i16 = (left * 32767).astype(np.int16)
right_i16 = (right * 32767).astype(np.int16)

# Interleave stereo channels
stereo_i16 = np.empty((TOTAL_SAMPLES * 2,), dtype=np.int16)
stereo_i16[0::2] = left_i16
stereo_i16[1::2] = right_i16

output_wav = os.path.join(os.path.dirname(__file__), 'soundtrack.wav')
with wave.open(output_wav, 'wb') as wf:
    wf.setnchannels(2)
    wf.setsampwidth(2)
    wf.setframerate(SAMPLE_RATE)
    wf.writeframes(stereo_i16.tobytes())

wav_size_mb = os.path.getsize(output_wav) / (1024 * 1024)
print(f"Generated soundtrack: {output_wav} ({wav_size_mb:.2f} MB, {DURATION}s @ {SAMPLE_RATE} Hz stereo)")
