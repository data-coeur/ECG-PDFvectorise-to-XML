<?php
/**
 * ECG Pipeline - Landing page
 * Routes to extractor or API
 */
$uri = $_SERVER['REQUEST_URI'];

// API endpoint for ECG analysis status
if ($uri === '/api/status') {
    header('Content-Type: application/json');
    echo json_encode(['status' => 'ok', 'services' => [
        'extractor' => true,
        'deepecg' => filter_var(@file_get_contents('http://deepecg-backend:8000/api/health'), FILTER_VALIDATE_URL) !== false,
    ]]);
    exit;
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ECG Pipeline - data-coeur</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #0a0e17; color: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .container { text-align: center; max-width: 600px; }
        h1 { color: #22d3ee; font-size: 2rem; margin-bottom: 0.5rem; }
        p { color: #94a3b8; }
        .links { display: flex; gap: 1rem; justify-content: center; margin-top: 2rem; flex-wrap: wrap; }
        a { background: #1a2236; border: 1px solid #2a3654; color: #22d3ee; padding: 1rem 2rem; border-radius: 8px; text-decoration: none; transition: 0.2s; }
        a:hover { border-color: #22d3ee; background: rgba(34,211,238,0.1); }
    </style>
</head>
<body>
    <div class="container">
        <h1>ECG Pipeline</h1>
        <p>Extract ECG signals from vectorized PDFs and analyze with AI</p>
        <div class="links">
            <a href="/ecg_extractor.html">ECG Extractor</a>
            <a href="/ecg_receive.php">API Receiver</a>
        </div>
    </div>
</body>
</html>
