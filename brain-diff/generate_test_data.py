#!/usr/bin/env python3
"""
脳画像差分ツール用テストDICOMデータ生成スクリプト

2シリーズ（baseline / follow-up）の合成脳CTデータを生成する。
follow-upには小さな高吸収域（模擬病変）と軽微な位置ずれを追加。

使い方:
  python3 generate_test_data.py

出力:
  test_baseline/  (20スライス)
  test_followup/  (20スライス)
"""

import struct
import os
import math
import random

# ── パラメータ ──
ROWS = 256
COLS = 256
NUM_SLICES = 20
SLICE_THICKNESS = 5.0  # mm
PIXEL_SPACING = [1.0, 1.0]  # mm

# 位置ずれ（follow-up）
SHIFT_X = 3  # pixels (3mm)
SHIFT_Y = 2  # pixels (2mm)

# 模擬病変（follow-up に追加）
LESION_CENTER = (140, 130)  # (x, y) in pixels
LESION_RADIUS = 12  # pixels
LESION_SLICE_RANGE = (8, 14)  # 出現スライス範囲
LESION_HU = 60  # HU (灰白質より若干高い → 出血を模擬)


def make_brain_phantom(rows, cols, slice_idx, num_slices):
    """合成脳CTファントムの1スライスを生成（HU値）"""
    cx, cy = cols // 2, rows // 2
    data = [0] * (rows * cols)

    # スライス位置に応じた頭蓋の大きさ（楕円）
    z_ratio = abs(slice_idx - num_slices / 2) / (num_slices / 2)
    scale = max(0.3, 1.0 - z_ratio * 0.6)
    skull_rx = int(100 * scale)
    skull_ry = int(85 * scale)

    for y in range(rows):
        for x in range(cols):
            dx = x - cx
            dy = y - cy

            # 楕円距離
            r_skull = math.sqrt((dx / max(skull_rx, 1)) ** 2 + (dy / max(skull_ry, 1)) ** 2)

            if r_skull > 1.05:
                # 空気
                val = -1000
            elif r_skull > 0.95:
                # 頭蓋骨
                val = 800 + random.randint(-50, 50)
            elif r_skull > 0.88:
                # CSF（脳脊髄液）
                val = 5 + random.randint(-3, 3)
            else:
                # 脳実質
                # 灰白質と白質のパターン
                r_brain = r_skull / 0.88
                if r_brain > 0.7:
                    # 灰白質（皮質）
                    val = 35 + random.randint(-5, 5)
                else:
                    # 白質
                    val = 25 + random.randint(-5, 5)

                # 脳室（中心付近の低吸収域）
                ventricle_r = math.sqrt((dx / 20) ** 2 + (dy / 15) ** 2)
                if ventricle_r < 1.0 and 0.3 < z_ratio < 0.7:
                    pass  # 上下端では脳室なし
                elif ventricle_r < 1.0:
                    val = 5 + random.randint(-3, 3)

            # HU → stored value (rescale slope=1, intercept=-1024)
            stored = val + 1024
            data[y * cols + x] = max(0, min(65535, stored))

    return data


def add_lesion(data, rows, cols, cx, cy, radius, hu_value):
    """円形の模擬病変を追加"""
    for y in range(max(0, cy - radius - 2), min(rows, cy + radius + 2)):
        for x in range(max(0, cx - radius - 2), min(cols, cx + radius + 2)):
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            if dist < radius:
                # ガウシアンぼかし的な遷移
                blend = max(0, 1.0 - (dist / radius) ** 2)
                stored = (hu_value + 1024)
                orig = data[y * cols + x]
                data[y * cols + x] = int(orig * (1 - blend) + stored * blend)
    return data


def shift_image(data, rows, cols, dx, dy):
    """画像をシフト（平行移動）"""
    shifted = [0] * (rows * cols)
    for y in range(rows):
        for x in range(cols):
            sx = x - dx
            sy = y - dy
            if 0 <= sx < cols and 0 <= sy < rows:
                shifted[y * cols + x] = data[sy * cols + sx]
    return shifted


def write_dicom(filepath, pixel_data, rows, cols, slice_idx, num_slices,
                series_uid, series_desc, instance_number):
    """最小限のDICOMファイルを書き出す"""

    # DICOM preamble (128 bytes) + DICM magic
    preamble = b'\x00' * 128 + b'DICM'

    def make_tag(group, element, vr, value_bytes):
        """Explicit VR Little Endian タグを作成"""
        tag = struct.pack('<HH', group, element)
        vr_bytes = vr.encode('ascii')

        long_vrs = {'OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT'}
        if vr in long_vrs:
            length = struct.pack('<HI', 0, len(value_bytes))
        else:
            length = struct.pack('<H', len(value_bytes))

        return tag + vr_bytes + length + value_bytes

    def str_tag(group, element, vr, text):
        b = text.encode('ascii')
        if len(b) % 2 != 0:
            b += b' '
        return make_tag(group, element, vr, b)

    def us_tag(group, element, value):
        return make_tag(group, element, 'US', struct.pack('<H', value))

    def ds_tag(group, element, text):
        return str_tag(group, element, 'DS', text)

    def is_tag(group, element, text):
        return str_tag(group, element, 'IS', text)

    # Transfer Syntax UID (Explicit VR Little Endian)
    ts_uid = '1.2.840.10008.1.2.1'

    # Meta header
    meta_tags = b''
    # (0002,0001) File Meta Information Version
    meta_tags += make_tag(0x0002, 0x0001, 'OB', b'\x00\x01')
    # (0002,0002) Media Storage SOP Class UID (CT Image Storage)
    meta_tags += str_tag(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.2')
    # (0002,0003) Media Storage SOP Instance UID
    sop_uid = f'1.2.826.0.1.3680043.8.1.{series_uid}.{instance_number}'
    meta_tags += str_tag(0x0002, 0x0003, 'UI', sop_uid)
    # (0002,0010) Transfer Syntax UID
    meta_tags += str_tag(0x0002, 0x0010, 'UI', ts_uid)
    # (0002,0012) Implementation Class UID
    meta_tags += str_tag(0x0002, 0x0012, 'UI', '1.2.826.0.1.3680043.8.1')

    # Meta header length tag
    meta_length = struct.pack('<HH', 0x0002, 0x0000) + b'UL' + struct.pack('<H', 4) + struct.pack('<I', len(meta_tags))

    # Dataset tags
    dataset = b''
    # (0008,0008) Image Type
    dataset += str_tag(0x0008, 0x0008, 'CS', 'ORIGINAL\\PRIMARY\\AXIAL')
    # (0008,0016) SOP Class UID
    dataset += str_tag(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2')
    # (0008,0018) SOP Instance UID
    dataset += str_tag(0x0008, 0x0018, 'UI', sop_uid)
    # (0008,0060) Modality
    dataset += str_tag(0x0008, 0x0060, 'CS', 'CT')
    # (0008,103E) Series Description
    dataset += str_tag(0x0008, 0x103E, 'LO', series_desc)

    # (0010,0010) Patient Name - anonymized
    dataset += str_tag(0x0010, 0x0010, 'PN', 'TEST^PHANTOM')
    # (0010,0020) Patient ID
    dataset += str_tag(0x0010, 0x0020, 'LO', 'TEST001')

    # (0018,0050) Slice Thickness
    dataset += ds_tag(0x0018, 0x0050, f'{SLICE_THICKNESS:.2f}')

    # (0020,000D) Study Instance UID
    dataset += str_tag(0x0020, 0x000D, 'UI', f'1.2.826.0.1.3680043.8.2.{series_uid}')
    # (0020,000E) Series Instance UID
    dataset += str_tag(0x0020, 0x000E, 'UI', f'1.2.826.0.1.3680043.8.3.{series_uid}')
    # (0020,0013) Instance Number
    dataset += is_tag(0x0020, 0x0013, str(instance_number))
    # (0020,0032) Image Position Patient
    z_pos = slice_idx * SLICE_THICKNESS
    dataset += ds_tag(0x0020, 0x0032, f'0.0\\0.0\\{z_pos:.2f}')
    # (0020,0037) Image Orientation Patient
    dataset += ds_tag(0x0020, 0x0037, '1.0\\0.0\\0.0\\0.0\\1.0\\0.0')

    # (0028,0002) Samples per Pixel
    dataset += us_tag(0x0028, 0x0002, 1)
    # (0028,0004) Photometric Interpretation
    dataset += str_tag(0x0028, 0x0004, 'CS', 'MONOCHROME2')
    # (0028,0010) Rows
    dataset += us_tag(0x0028, 0x0010, rows)
    # (0028,0011) Columns
    dataset += us_tag(0x0028, 0x0011, cols)
    # (0028,0030) Pixel Spacing
    dataset += ds_tag(0x0028, 0x0030, f'{PIXEL_SPACING[0]:.4f}\\{PIXEL_SPACING[1]:.4f}')
    # (0028,0100) Bits Allocated
    dataset += us_tag(0x0028, 0x0100, 16)
    # (0028,0101) Bits Stored
    dataset += us_tag(0x0028, 0x0101, 16)
    # (0028,0102) High Bit
    dataset += us_tag(0x0028, 0x0102, 15)
    # (0028,0103) Pixel Representation (unsigned)
    dataset += us_tag(0x0028, 0x0103, 0)
    # (0028,1050) Window Center
    dataset += ds_tag(0x0028, 0x1050, '40')
    # (0028,1051) Window Width
    dataset += ds_tag(0x0028, 0x1051, '80')
    # (0028,1052) Rescale Intercept
    dataset += ds_tag(0x0028, 0x1052, '-1024')
    # (0028,1053) Rescale Slope
    dataset += ds_tag(0x0028, 0x1053, '1')

    # (7FE0,0010) Pixel Data
    pixel_bytes = b''
    for val in pixel_data:
        pixel_bytes += struct.pack('<H', val)

    pixel_tag = struct.pack('<HH', 0x7FE0, 0x0010) + b'OW' + struct.pack('<HI', 0, len(pixel_bytes)) + pixel_bytes

    dataset += pixel_tag

    # Write file
    with open(filepath, 'wb') as f:
        f.write(preamble)
        f.write(meta_length)
        f.write(meta_tags)
        f.write(dataset)


def main():
    import sys
    random.seed(42)  # 再現性のため

    if len(sys.argv) >= 2:
        out_dir = sys.argv[1]
    else:
        out_dir = os.path.dirname(os.path.abspath(__file__))

    baseline_dir = os.path.join(out_dir, 'test_baseline')
    followup_dir = os.path.join(out_dir, 'test_followup')

    os.makedirs(baseline_dir, exist_ok=True)
    os.makedirs(followup_dir, exist_ok=True)

    print(f'生成パラメータ:')
    print(f'  マトリクス: {COLS}x{ROWS}')
    print(f'  スライス数: {NUM_SLICES}')
    print(f'  PixelSpacing: {PIXEL_SPACING[0]:.1f} x {PIXEL_SPACING[1]:.1f} mm')
    print(f'  SliceThickness: {SLICE_THICKNESS:.1f} mm')
    print(f'  Follow-up位置ずれ: ({SHIFT_X}, {SHIFT_Y}) pixels')
    print(f'  模擬病変: 中心=({LESION_CENTER[0]}, {LESION_CENTER[1]}), '
          f'半径={LESION_RADIUS}px, HU={LESION_HU}, '
          f'スライス={LESION_SLICE_RANGE[0]}-{LESION_SLICE_RANGE[1]}')
    print()

    baseline_uid = '100001'
    followup_uid = '100002'

    for i in range(NUM_SLICES):
        # 同じシードでベースライン生成
        random.seed(42 + i * 1000)
        data = make_brain_phantom(ROWS, COLS, i, NUM_SLICES)

        # Baseline保存
        fname = f'slice_{i+1:03d}.dcm'
        write_dicom(
            os.path.join(baseline_dir, fname),
            data, ROWS, COLS, i, NUM_SLICES,
            baseline_uid, 'Brain CT Axial', i + 1
        )
        print(f'  Baseline: {fname}')

        # Follow-up: 同じデータに位置ずれ + 病変追加
        random.seed(42 + i * 1000)  # 同じノイズパターン
        fu_data = make_brain_phantom(ROWS, COLS, i, NUM_SLICES)

        # 模擬病変追加
        if LESION_SLICE_RANGE[0] <= i <= LESION_SLICE_RANGE[1]:
            # スライス位置に応じた病変サイズ
            lesion_center_z = (LESION_SLICE_RANGE[0] + LESION_SLICE_RANGE[1]) / 2
            z_dist = abs(i - lesion_center_z) / max(1, (LESION_SLICE_RANGE[1] - LESION_SLICE_RANGE[0]) / 2)
            r = int(LESION_RADIUS * max(0.3, 1.0 - z_dist))
            fu_data = add_lesion(fu_data, ROWS, COLS, LESION_CENTER[0], LESION_CENTER[1], r, LESION_HU)

        # 位置ずれ適用
        fu_data = shift_image(fu_data, ROWS, COLS, SHIFT_X, SHIFT_Y)

        write_dicom(
            os.path.join(followup_dir, fname),
            fu_data, ROWS, COLS, i, NUM_SLICES,
            followup_uid, 'Brain CT Axial', i + 1
        )
        print(f'  Follow-up: {fname}')

    print()
    print(f'生成完了:')
    print(f'  Baseline: {baseline_dir}/ ({NUM_SLICES} files)')
    print(f'  Follow-up: {followup_dir}/ ({NUM_SLICES} files)')
    print()
    print('テスト手順:')
    print('  1. ブラウザで /brain-diff/ を開く')
    print('  2. Baseline欄に test_baseline/ の全ファイルをドラッグ&ドロップ')
    print('  3. Follow-up欄に test_followup/ の全ファイルをドラッグ&ドロップ')
    print('  4. 「位置合わせ開始」をクリック')
    print('  5. スライス8-14付近に赤いオーバーレイ（模擬病変）が表示されることを確認')


if __name__ == '__main__':
    main()
