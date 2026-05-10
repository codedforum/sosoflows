<?php
// /sosoflows/api.php - cached proxy to openapi.sosovalue.com
// Demo plan = 10 calls/month total. Cache aggressively (6h TTL) so reloads serve from disk.

header("Content-Type: application/json; charset=utf-8");
header("X-Robots-Tag: noindex, nofollow");

$keyfile = __DIR__ . "/.api-key";
$apiKey = "";
if (file_exists($keyfile)) {
    $apiKey = trim(file_get_contents($keyfile));
}

$path = isset($_GET["path"]) ? $_GET["path"] : "";
$allowed = [
    "indices",
    "etfs/summary-history",
    "etfs/list",
    "etfs/market-snapshot",
    "etfs/history",
    "indices/constituents",
    "indices/market-snapshot",
    "indices/historical-klines",
    "feeds/featured",
    "feeds/trending"
];
if (!in_array($path, $allowed, true)) {
    http_response_code(400);
    echo json_encode(["error" => "path not allowed", "got" => $path]);
    exit;
}

$qs = $_GET;
unset($qs["path"]);
ksort($qs);
$query = http_build_query($qs);

$cacheDir = __DIR__ . "/.cache";
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755);
$cacheKey = preg_replace('/[^a-z0-9]+/i', '_', $path . "_" . $query);
$cacheFile = $cacheDir . "/" . $cacheKey . ".json";
$TTL = 7 * 24 * 3600; // 7 days - Demo plan is 10 calls/month, prefer stale data over quota burn

// Serve from cache when fresh
if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $TTL) {
    header("X-Cache: HIT");
    header("X-Cache-Age: " . (time() - filemtime($cacheFile)));
    header("Cache-Control: public, max-age=" . max(60, $TTL - (time() - filemtime($cacheFile))));
    echo file_get_contents($cacheFile);
    exit;
}

if ($apiKey === "") {
    // Stale-while-no-key: serve stale cache if we have any, else demo error
    if (file_exists($cacheFile)) {
        header("X-Cache: STALE-NO-KEY");
        echo file_get_contents($cacheFile);
        exit;
    }
    http_response_code(503);
    echo json_encode([
        "demo" => true,
        "error" => "no api key set on server",
        "hint" => "drop your x-soso-api-key into /sosoflows/.api-key"
    ]);
    exit;
}

$url = "https://openapi.sosovalue.com/openapi/v1/" . $path . ($query ? "?" . $query : "");

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_HTTPHEADER => [
        "x-soso-api-key: " . $apiKey,
        "Accept: application/json",
        "User-Agent: smartcoded-sosoflows/1.0"
    ]
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

if ($body === false || $code >= 500 || $code === 0) {
    // Upstream failure: serve stale cache if available
    if (file_exists($cacheFile)) {
        header("X-Cache: STALE-UPSTREAM-FAIL");
        echo file_get_contents($cacheFile);
        exit;
    }
    http_response_code(502);
    echo json_encode(["error" => "upstream failed", "detail" => $err, "status" => $code]);
    exit;
}

// Rate-limited (429) or quota exhausted: serve stale if we have it
if ($code === 429 && file_exists($cacheFile)) {
    header("X-Cache: STALE-429");
    echo file_get_contents($cacheFile);
    exit;
}

// Only persist 2xx to disk
if ($code >= 200 && $code < 300) {
    @file_put_contents($cacheFile, $body);
    header("X-Cache: MISS-WROTE");
} else {
    header("X-Cache: MISS-NO-WRITE");
}

http_response_code($code);
echo $body;
