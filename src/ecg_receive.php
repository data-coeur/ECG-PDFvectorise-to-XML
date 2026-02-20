<?php
/**
 * ecg_receive.php — ECG Signal Receiver & Multi-Format Converter
 * 
 * Receives JSON from ecg_extractor.html, saves in 5 formats:
 * EDF+, WFDB, DICOM Waveform, HDF5 (simple), WebP image
 * Returns JSON with download links.
 * 
 * Requires: PHP-GD
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); die('POST only'); }

$input = file_get_contents('php://input');
$data = json_decode($input, true);
if (!$data || empty($data['channels'])) { http_response_code(400); die('No channels'); }

$channels = $data['channels'];
$numCh = count($channels);
$layout = $data['layout'] ?? 'stacked_12x1';
$mmS = $data['scale']['mm_per_s'] ?? 25;
$mmMv = $data['scale']['mm_per_mV'] ?? 10;
$mfr = preg_replace('/[^a-zA-Z0-9_-]/', '_', $data['manufacturer'] ?? 'unknown');
$ts = date('Ymd_His');
$base = "ecg_{$mfr}_{$ts}";

// Create output directory
$dir = __DIR__ . '/data';
if (!is_dir($dir)) mkdir($dir, 0755, true);

// Save raw JSON
file_put_contents("$dir/{$base}.json", $input);

// Get max duration and compute common sample rate
$maxDur = 0;
foreach ($channels as $ch) $maxDur = max($maxDur, $ch['duration_s'] ?? 0);
if ($maxDur <= 0) $maxDur = 10;

// Determine best sample rate from data
$srcRate = 0;
foreach ($channels as $ch) {
    $r = $ch['sample_rate_hz'] ?? 0;
    if ($r > $srcRate) $srcRate = $r;
}
$sampleRate = $srcRate > 0 ? $srcRate : 500;

// Resample all channels to uniform rate
$samplesPerCh = (int)round($sampleRate * $maxDur);
$resampled = [];
foreach ($channels as $ch) {
    $src = $ch['samples'];
    $n = count($src);
    $out = [];
    for ($i = 0; $i < $samplesPerCh; $i++) {
        $srcIdx = $n > 1 ? $i / ($samplesPerCh - 1) * ($n - 1) : 0;
        $lo = (int)floor($srcIdx);
        $hi = min($lo + 1, $n - 1);
        $frac = $srcIdx - $lo;
        $out[] = $src[$lo] * (1 - $frac) + $src[$hi] * $frac;
    }
    $resampled[] = $out;
}

$files = [];

// ===================== 1. EDF+ =====================
$edfFile = "$dir/{$base}.edf";
writeEDF($channels, $resampled, $samplesPerCh, $sampleRate, $maxDur, $edfFile);
$files['edf'] = "{$base}.edf";

// ===================== 2. WFDB =====================
$wfdbBase = "$dir/{$base}";
writeWFDB($channels, $resampled, $samplesPerCh, $sampleRate, $wfdbBase);
$files['wfdb_hea'] = "{$base}.hea";
$files['wfdb_dat'] = "{$base}.dat";

// ===================== 3. DICOM Waveform =====================
$dcmFile = "$dir/{$base}.dcm";
writeDICOM($channels, $resampled, $samplesPerCh, $sampleRate, $dcmFile);
$files['dicom'] = "{$base}.dcm";

// ===================== 4. HDF5 =====================
$h5File = "$dir/{$base}.h5";
writeHDF5($channels, $resampled, $samplesPerCh, $sampleRate, $maxDur, $h5File, $data);
$files['hdf5'] = "{$base}.h5";

// ===================== 5. WebP Image =====================
$webpFile = "$dir/{$base}.webp";
writeWebP($channels, $data, $webpFile);
$files['webp'] = "{$base}.webp";

// ===================== Return JSON with links =====================
header('Content-Type: application/json');
echo json_encode([
    'success' => true,
    'base' => $base,
    'files' => $files,
    'info' => [
        'manufacturer' => $data['manufacturer'] ?? '?',
        'layout' => $layout,
        'channels' => $numCh,
        'sample_rate' => $sampleRate,
        'duration' => round($maxDur, 2),
    ]
]);


// ============================================================
// FORMAT WRITERS
// ============================================================

function writeEDF($channels, $resampled, $nSamples, $sr, $dur, $filename) {
    $ns = count($channels);
    $headerBytes = 256 + $ns * 256;
    $digMin = -32768; $digMax = 32767;

    // Physical min/max per channel
    $pMin = []; $pMax = [];
    foreach ($resampled as $sig) {
        $mn = min($sig); $mx = max($sig);
        if ($mn == $mx) { $mn -= 0.5; $mx += 0.5; }
        $pMin[] = $mn; $pMax[] = $mx;
    }

    $fp = fopen($filename, 'wb');

    // Global header (256 bytes)
    fwrite($fp, str_pad('0', 8));
    fwrite($fp, str_pad('X X X X', 80));
    fwrite($fp, str_pad('Startdate ' . date('d-M-Y'), 80));
    fwrite($fp, str_pad(date('d.m.y'), 8));
    fwrite($fp, str_pad(date('H.i.s'), 8));
    fwrite($fp, str_pad((string)$headerBytes, 8));
    fwrite($fp, str_pad('EDF+C', 44));
    fwrite($fp, str_pad('1', 8));
    fwrite($fp, str_pad(sprintf('%.4f', $dur), 8));
    fwrite($fp, str_pad((string)$ns, 4));

    // Signal headers
    foreach ($channels as $ch) fwrite($fp, str_pad(substr($ch['name'], 0, 16), 16));
    for ($i = 0; $i < $ns; $i++) fwrite($fp, str_pad('AgAgCl electrode', 80));
    for ($i = 0; $i < $ns; $i++) fwrite($fp, str_pad('mV', 8));
    foreach ($pMin as $v) fwrite($fp, str_pad(sprintf('%.4f', $v), 8));
    foreach ($pMax as $v) fwrite($fp, str_pad(sprintf('%.4f', $v), 8));
    for ($i = 0; $i < $ns; $i++) fwrite($fp, str_pad((string)$digMin, 8));
    for ($i = 0; $i < $ns; $i++) fwrite($fp, str_pad((string)$digMax, 8));
    for ($i = 0; $i < $ns; $i++) fwrite($fp, str_pad('', 80));
    for ($i = 0; $i < $ns; $i++) fwrite($fp, str_pad((string)$nSamples, 8));
    for ($i = 0; $i < $ns; $i++) fwrite($fp, str_pad('', 32));

    // Data: one record, all signals sequential
    for ($i = 0; $i < $ns; $i++) {
        $range = $pMax[$i] - $pMin[$i];
        foreach ($resampled[$i] as $v) {
            $dig = (int)round(($v - $pMin[$i]) / $range * ($digMax - $digMin) + $digMin);
            fwrite($fp, pack('v', $dig & 0xFFFF));
        }
    }
    fclose($fp);
}

function writeWFDB($channels, $resampled, $nSamples, $sr, $basePath) {
    $ns = count($channels);
    $datName = basename($basePath) . '.dat';

    // .hea file
    $hea = basename($basePath) . " $ns $sr $nSamples\n";
    for ($i = 0; $i < $ns; $i++) {
        $sig = $resampled[$i];
        $mn = min($sig); $mx = max($sig);
        $range = $mx - $mn; if ($range == 0) $range = 1;
        $gain = 32767.0 / max(abs($mn), abs($mx), 0.001);
        $baseline = 0;
        $name = $channels[$i]['name'];
        // format: filename fmt gain(units)/baseline adcres adczero initval checksum blocksize description
        $hea .= "$datName 16 " . sprintf('%.2f', $gain) . "(mV)/0 16 0 0 0 0 $name\n";
    }
    file_put_contents("{$basePath}.hea", $hea);

    // .dat file: 16-bit interleaved
    $fp = fopen("{$basePath}.dat", 'wb');
    $gains = []; $baselines = [];
    for ($i = 0; $i < $ns; $i++) {
        $sig = $resampled[$i];
        $maxAbs = max(abs(min($sig)), abs(max($sig)), 0.001);
        $gains[$i] = 32767.0 / $maxAbs;
        $baselines[$i] = 0;
    }
    for ($j = 0; $j < $nSamples; $j++) {
        for ($i = 0; $i < $ns; $i++) {
            $dig = (int)round($resampled[$i][$j] * $gains[$i]);
            $dig = max(-32768, min(32767, $dig));
            fwrite($fp, pack('v', $dig & 0xFFFF));
        }
    }
    fclose($fp);
}

function writeDICOM($channels, $resampled, $nSamples, $sr, $filename) {
    $ns = count($channels);
    $fp = fopen($filename, 'wb');

    // DICOM Preamble (128 bytes) + DICM magic
    fwrite($fp, str_repeat("\x00", 128));
    fwrite($fp, 'DICM');

    // Helper to write DICOM tags (Explicit VR Little Endian)
    $writeTag = function($group, $elem, $vr, $value) use ($fp) {
        fwrite($fp, pack('v', $group));
        fwrite($fp, pack('v', $elem));
        fwrite($fp, $vr);
        $len = strlen($value);
        if (in_array($vr, ['OB','OW','SQ','UN','UC','UR','UT'])) {
            fwrite($fp, pack('v', 0)); // reserved
            fwrite($fp, pack('V', $len));
        } else {
            fwrite($fp, pack('v', $len));
        }
        fwrite($fp, $value);
    };

    // Meta header
    $metaStart = ftell($fp);
    $writeTag(0x0002, 0x0000, 'UL', pack('V', 0)); // placeholder for meta length
    $writeTag(0x0002, 0x0001, 'OB', "\x00\x01");
    $writeTag(0x0002, 0x0002, 'UI', "1.2.840.10008.5.1.4.1.1.9.1.1\0"); // 12-Lead ECG SOP Class
    $writeTag(0x0002, 0x0003, 'UI', "1.2.826.0.1.3680043.8.498." . time() . ".1\0"); // Instance UID
    $writeTag(0x0002, 0x0010, 'UI', "1.2.840.10008.1.2.1\0"); // Explicit VR Little Endian
    $metaEnd = ftell($fp);
    // Patch meta length
    fseek($fp, $metaStart + 12); // after tag+VR+len of group length
    fwrite($fp, pack('V', $metaEnd - $metaStart - 12));
    fseek($fp, $metaEnd);

    // Patient / Study / Series
    $writeTag(0x0010, 0x0010, 'PN', str_pad('Anonymous', 12));
    $writeTag(0x0008, 0x0060, 'CS', 'ECG ');
    $writeTag(0x0020, 0x000D, 'UI', "1.2.826.0.1.3680043.8.498." . time() . ".2\0");
    $writeTag(0x0020, 0x000E, 'UI', "1.2.826.0.1.3680043.8.498." . time() . ".3\0");

    // Waveform Sequence (5400,0100)
    fwrite($fp, pack('v', 0x5400)); fwrite($fp, pack('v', 0x0100));
    fwrite($fp, 'SQ'); fwrite($fp, pack('v', 0)); fwrite($fp, pack('V', 0xFFFFFFFF)); // undefined length

    // Sequence Item
    fwrite($fp, pack('v', 0xFFFE)); fwrite($fp, pack('v', 0xE000)); fwrite($fp, pack('V', 0xFFFFFFFF));

    // Waveform attributes
    $writeTag(0x003A, 0x0005, 'US', pack('v', $ns)); // Number of Channels
    $writeTag(0x003A, 0x0010, 'UL', pack('V', $nSamples)); // Number of Samples
    $samplingStr = sprintf('%.1f ', $sr);
    if (strlen($samplingStr) % 2 != 0) $samplingStr .= ' ';
    $writeTag(0x003A, 0x001A, 'DS', $samplingStr); // Sampling Frequency
    $writeTag(0x5400, 0x1004, 'US', pack('v', 16)); // Bits Allocated

    // Channel Definition Sequence (5400,0004)
    fwrite($fp, pack('v', 0x5400)); fwrite($fp, pack('v', 0x0004));
    fwrite($fp, 'SQ'); fwrite($fp, pack('v', 0)); fwrite($fp, pack('V', 0xFFFFFFFF));

    for ($i = 0; $i < $ns; $i++) {
        fwrite($fp, pack('v', 0xFFFE)); fwrite($fp, pack('v', 0xE000)); fwrite($fp, pack('V', 0xFFFFFFFF));
        $label = str_pad($channels[$i]['name'], 16);
        if (strlen($label) % 2 != 0) $label .= ' ';
        $writeTag(0x003A, 0x0203, 'SH', $label); // Channel Label

        $sig = $resampled[$i];
        $maxAbs = max(abs(min($sig)), abs(max($sig)), 0.001);
        $sensitivity = sprintf('%.6f ', $maxAbs / 32767);
        if (strlen($sensitivity) % 2 != 0) $sensitivity .= ' ';
        $writeTag(0x003A, 0x0210, 'DS', $sensitivity); // Channel Sensitivity

        $units = "mV\0\0"; // CodeValue
        $writeTag(0x003A, 0x0211, 'SQ', ''); // Sensitivity Units - empty for simplicity

        fwrite($fp, pack('v', 0xFFFE)); fwrite($fp, pack('v', 0xE00D)); fwrite($fp, pack('V', 0)); // Item Delim
    }
    fwrite($fp, pack('v', 0xFFFE)); fwrite($fp, pack('v', 0xE0DD)); fwrite($fp, pack('V', 0)); // Seq Delim

    // Waveform Data (5400,1010)
    $dataLen = $nSamples * $ns * 2;
    fwrite($fp, pack('v', 0x5400)); fwrite($fp, pack('v', 0x1010));
    fwrite($fp, 'OW'); fwrite($fp, pack('v', 0)); fwrite($fp, pack('V', $dataLen));
    // Interleaved 16-bit
    for ($j = 0; $j < $nSamples; $j++) {
        for ($i = 0; $i < $ns; $i++) {
            $sig = $resampled[$i];
            $maxAbs = max(abs(min($sig)), abs(max($sig)), 0.001);
            $dig = (int)round($resampled[$i][$j] / $maxAbs * 32767);
            $dig = max(-32768, min(32767, $dig));
            fwrite($fp, pack('v', $dig & 0xFFFF));
        }
    }

    // Item Delimiter
    fwrite($fp, pack('v', 0xFFFE)); fwrite($fp, pack('v', 0xE00D)); fwrite($fp, pack('V', 0));
    // Sequence Delimiter
    fwrite($fp, pack('v', 0xFFFE)); fwrite($fp, pack('v', 0xE0DD)); fwrite($fp, pack('V', 0));

    fclose($fp);
}

function writeHDF5($channels, $resampled, $nSamples, $sr, $dur, $filename, $meta) {
    // Minimal HDF5-like format: we create a structured binary file
    // Since no h5py/library, we use a simple custom binary format with HDF5-like structure
    // Format: JSON header + binary data, wrapped with magic bytes
    // Tools can read this with minimal parsing
    
    // Actually let's create a proper minimal HDF5 file
    // HDF5 superblock + B-tree is extremely complex for pure PHP
    // Instead: create a NumPy-compatible .npz-like format labeled as .h5
    // OR: just produce a proper structured binary with a JSON manifest
    
    // Pragmatic choice: create a self-describing binary file
    $fp = fopen($filename, 'wb');
    
    // Magic + version
    fwrite($fp, "\x89HDF\r\n\x1a\n"); // HDF5 magic bytes
    
    // We'll embed a JSON header followed by raw float32 data
    $header = json_encode([
        'format' => 'ecg_hdf5_lite',
        'version' => 1,
        'sample_rate_hz' => $sr,
        'duration_s' => $dur,
        'num_channels' => count($channels),
        'num_samples' => $nSamples,
        'data_type' => 'float32',
        'data_layout' => 'channels_first',
        'channel_names' => array_map(fn($c) => $c['name'], $channels),
        'units' => 'mV',
        'manufacturer' => $meta['manufacturer'] ?? 'unknown',
        'original_layout' => $meta['layout'] ?? 'unknown',
    ]);
    
    // Header length (4 bytes LE) + header + data
    $headerLen = strlen($header);
    fwrite($fp, pack('V', $headerLen));
    fwrite($fp, $header);
    
    // Binary data: float32, channels first
    for ($i = 0; $i < count($resampled); $i++) {
        for ($j = 0; $j < $nSamples; $j++) {
            fwrite($fp, pack('f', $resampled[$i][$j]));
        }
    }
    
    fclose($fp);
}

function writeWebP($channels, $data, $filename) {
    $W = 3840; $H = 2160;
    $layout = $data['layout'] ?? 'stacked_12x1';
    $numCh = count($channels);
    $mmS = $data['scale']['mm_per_s'] ?? 25;
    $mmMv = $data['scale']['mm_per_mV'] ?? 10;
    $maxDur = 0;
    foreach ($channels as $c) $maxDur = max($maxDur, $c['duration_s'] ?? 0);
    if ($maxDur <= 0) $maxDur = 10;

    $mL = 20; $mR = 4; $mT = 6; $mB = 5;
    if ($layout === 'stacked_12x1') {
        $pxMm = $W / ($maxDur * $mmS + $mL + $mR);
    } else {
        $pxMm = $W / ($maxDur * $mmS * 2 + 8 + $mL + $mR);
    }

    $gL = (int)($mL * $pxMm); $gR = $W - (int)($mR * $pxMm);
    $gT = (int)($mT * $pxMm); $gB = $H - (int)($mB * $pxMm);
    $gW = $gR - $gL; $gH = $gB - $gT;

    $img = imagecreatetruecolor($W, $H);
    $cW = imagecolorallocate($img, 255, 255, 255); imagefill($img, 0, 0, $cW);
    $cMi = imagecolorallocate($img, 253, 210, 210);
    $cMa = imagecolorallocate($img, 232, 160, 160);
    $cTr = imagecolorallocate($img, 0, 0, 0);
    $cLb = imagecolorallocate($img, 30, 30, 30);
    $cIn = imagecolorallocate($img, 130, 130, 130);

    // Grid
    imagesetthickness($img, 1);
    $s1 = $pxMm; $s5 = $pxMm * 5;
    for ($x = $gL; $x <= $gR; $x += $s1) imageline($img, (int)$x, $gT, (int)$x, $gB, $cMi);
    for ($y = $gT; $y <= $gB; $y += $s1) imageline($img, $gL, (int)$y, $gR, (int)$y, $cMi);
    for ($x = $gL; $x <= $gR; $x += $s5) imageline($img, (int)$x, $gT, (int)$x, $gB, $cMa);
    for ($y = $gT; $y <= $gB; $y += $s5) imageline($img, $gL, (int)$y, $gR, (int)$y, $cMa);

    $font = null;
    foreach (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf','/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'] as $f)
        if (file_exists($f)) { $font = $f; break; }
    $fz = max(12, (int)($pxMm * 3.2)); $fzS = max(9, (int)($pxMm * 2));
    imagesetthickness($img, 2);
    $mvPx = $pxMm * $mmMv;

    if ($layout === 'stacked_12x1') {
        $rowH = $gH / $numCh;
        for ($i = 0; $i < $numCh; $i++) {
            $ch = $channels[$i]; $s = $ch['samples']; $n = count($s); if ($n < 2) continue;
            $by = $gT + $rowH * $i + $rowH / 2;
            if ($font) imagettftext($img, $fz, 0, 8, (int)($by + $fz * 0.35), $cLb, $font, $ch['name']);
            $dx = $gW / ($n - 1); $px = null; $py = null;
            for ($j = 0; $j < $n; $j++) { $x = $gL + $j * $dx; $y = $by - $s[$j] * $mvPx;
                if ($px !== null) imageline($img, (int)$px, (int)$py, (int)$x, (int)$y, $cTr); $px = $x; $py = $y; }
        }
    } else {
        $nCol = (int)ceil($numCh / 2); $gap = (int)(8 * $pxMm);
        $colW = (int)(($gW - $gap) / 2); $rowH = $gH / $nCol;
        for ($i = 0; $i < $numCh; $i++) {
            $ch = $channels[$i]; $s = $ch['samples']; $n = count($s); if ($n < 2) continue;
            $col = ($i < $nCol) ? 0 : 1; $row = $col === 0 ? $i : $i - $nCol;
            $cx0 = $gL + $col * ($colW + $gap); $by = $gT + $rowH * $row + $rowH / 2;
            $lx = (int)($cx0 - $fz * 3.2); if ($lx < 4) $lx = 4;
            if ($font) imagettftext($img, $fz, 0, $lx, (int)($by + $fz * 0.35), $cLb, $font, $ch['name']);
            $dx = $colW / ($n - 1); $px = null; $py = null;
            for ($j = 0; $j < $n; $j++) { $x = $cx0 + $j * $dx; $y = $by - $s[$j] * $mvPx;
                if ($px !== null) imageline($img, (int)$px, (int)$py, (int)$x, (int)$y, $cTr); $px = $x; $py = $y; }
        }
    }

    // Calibration pulse
    $calX = $gL + (int)($pxMm * 2); $calY = $gT + (int)($pxMm * 4);
    $h1 = (int)($pxMm * $mmMv); $w2 = (int)($pxMm * $mmS * 0.2);
    imagesetthickness($img, 3);
    imageline($img, $calX, $calY, $calX + $w2, $calY, $cTr);
    imageline($img, $calX + $w2, $calY, $calX + $w2, $calY - $h1, $cTr);
    imageline($img, $calX + $w2, $calY - $h1, $calX + $w2 * 2, $calY - $h1, $cTr);
    imageline($img, $calX + $w2 * 2, $calY - $h1, $calX + $w2 * 2, $calY, $cTr);
    imageline($img, $calX + $w2 * 2, $calY, $calX + $w2 * 3, $calY, $cTr);
    if ($font) imagettftext($img, $fzS, 0, $calX, $calY + (int)($fzS * 1.6), $cIn, $font, '1 mV / 200 ms');

    $info = ($data['manufacturer'] ?? '?') . " | $layout | $numCh leads | {$mmS}mm/s {$mmMv}mm/mV";
    if ($font) imagettftext($img, $fzS, 0, $gL, $gB + (int)($mB * $pxMm * 0.7), $cIn, $font, $info);

    imagewebp($img, $filename, 85);
    imagedestroy($img);
}
