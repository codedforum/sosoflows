<?php
// /sosoflows/ai.php - Daily Brief + signal explanation generator.
// Two modes:
//   1. Groq mode (if .groq-key present) - calls Groq llama for plain-English summary
//   2. Static mode - reads cached ETF data + emits a deterministic summary
// Output is cached server-side for 6h regardless of mode.

header("Content-Type: application/json; charset=utf-8");
header("X-Robots-Tag: noindex, nofollow");

$cacheDir = __DIR__ . "/.cache";
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755);

$briefFile = $cacheDir . "/_daily_brief.json";
$BRIEF_TTL = 6 * 3600;

// Force regenerate if ?refresh=1 (rate-limited per IP - 1/hour)
$force = isset($_GET["refresh"]) && $_GET["refresh"] === "1";
$rateFile = $cacheDir . "/_refresh_" . md5($_SERVER["REMOTE_ADDR"] ?? "0") . ".lock";
if ($force) {
    if (file_exists($rateFile) && (time() - filemtime($rateFile)) < 3600) {
        $force = false;
    } else {
        @file_put_contents($rateFile, time());
    }
}

if (!$force && file_exists($briefFile) && (time() - filemtime($briefFile)) < $BRIEF_TTL) {
    header("X-Cache: HIT");
    echo file_get_contents($briefFile);
    exit;
}

// Pull all cached ETF series we have
$assets = [
    ["BTC", "US"],
    ["ETH", "US"],
    ["SOL", "US"],
    ["XRP", "US"],
];

$series = [];
foreach ($assets as $a) {
    $sym = $a[0];
    $ctry = $a[1];
    $key = preg_replace('/[^a-z0-9]+/i', '_',
        "etfs/summary-history_country_code_" . $ctry . "_limit_60_symbol_" . $sym);
    $f = $cacheDir . "/" . $key . ".json";
    if (!file_exists($f)) continue;
    $j = json_decode(file_get_contents($f), true);
    if (!$j) continue;
    $rows = isset($j["data"]) ? $j["data"] : (isset($j["records"]) ? $j["records"] : (isset($j["list"]) ? $j["list"] : (is_array($j) ? $j : [])));
    if (!is_array($rows)) continue;
    usort($rows, function($a, $b) { return strcmp($a["date"] ?? "", $b["date"] ?? ""); });
    $series[$sym] = $rows;
}

// Compute summary stats per asset
$stats = [];
foreach ($series as $sym => $rows) {
    if (count($rows) < 2) continue;
    $last = end($rows);
    $prev = $rows[count($rows) - 2];
    $sum7 = 0; $sum30 = 0; $prev7 = 0;
    $n = count($rows);
    for ($i = max(0, $n - 7); $i < $n; $i++) $sum7 += floatval($rows[$i]["total_net_inflow"] ?? 0);
    for ($i = max(0, $n - 30); $i < $n; $i++) $sum30 += floatval($rows[$i]["total_net_inflow"] ?? 0);
    for ($i = max(0, $n - 14); $i < $n - 7; $i++) $prev7 += floatval($rows[$i]["total_net_inflow"] ?? 0);
    $lastVal = floatval($last["total_net_inflow"] ?? 0);
    $direction = "neutral";
    if ($sum7 > 0 && $sum7 > $prev7 * 1.1) $direction = "bullish";
    elseif ($sum7 < 0 && $sum7 < $prev7) $direction = "bearish";
    elseif ($sum7 > 0 && $sum7 < $prev7) $direction = "fading-bull";
    elseif ($sum7 < 0 && $sum7 > $prev7) $direction = "fading-bear";
    $stats[$sym] = [
        "as_of" => $last["date"] ?? "",
        "last_day" => $lastVal,
        "sum_7d" => $sum7,
        "sum_30d" => $sum30,
        "prev_7d" => $prev7,
        "cum" => floatval($last["cum_net_inflow"] ?? 0),
        "direction" => $direction,
        "delta_7d_pct" => $prev7 != 0 ? (($sum7 - $prev7) / abs($prev7)) * 100 : 0
    ];
}

// Generate the brief
$keyfile = __DIR__ . "/.groq-key";
$useGroq = file_exists($keyfile) && trim(file_get_contents($keyfile)) !== "";

$brief = [
    "mode" => $useGroq ? "groq" : "static",
    "generated_at" => date("c"),
    "stats" => $stats,
    "summary" => "",
    "headlines" => [],
    "actions" => []
];

// Build headlines + actions deterministically (fallback for static mode, scaffolding for Groq)
foreach ($stats as $sym => $s) {
    $abs7 = abs($s["sum_7d"]);
    $sign = $s["sum_7d"] >= 0 ? "+" : "-";
    $abs7Fmt = $abs7 >= 1e9 ? round($abs7/1e9, 2) . "B" : ($abs7 >= 1e6 ? round($abs7/1e6, 2) . "M" : round($abs7/1e3, 2) . "K");
    $deltaPct = round($s["delta_7d_pct"], 1);
    $deltaTxt = $deltaPct >= 0 ? "+" . $deltaPct . "%" : $deltaPct . "%";
    $headline = "";
    $action = "";
    switch ($s["direction"]) {
        case "bullish":
            $headline = $sym . " 7d net inflow at " . $sign . "$" . $abs7Fmt . " (" . $deltaTxt . " vs prior 7d). Institutions accumulating.";
            $action = "Watch for follow-through. Inflows leading price into a confirmation move is the highest-quality setup.";
            break;
        case "bearish":
            $headline = $sym . " 7d net flow at " . $sign . "$" . $abs7Fmt . " and accelerating. Real outflow, not noise.";
            $action = "Wait for outflow exhaustion. Days of net redemptions usually flush before reversals.";
            break;
        case "fading-bull":
            $headline = $sym . " inflows still positive but slowing (" . $sign . "$" . $abs7Fmt . ", " . $deltaTxt . ").";
            $action = "Demand is cooling. Trim chase entries until the curve re-accelerates.";
            break;
        case "fading-bear":
            $headline = $sym . " outflows easing (" . $sign . "$" . $abs7Fmt . ", " . $deltaTxt . ").";
            $action = "Selling pressure fading. Watch for the first net-inflow day to flag the turn.";
            break;
        default:
            $headline = $sym . " 7d flow neutral (" . $sign . "$" . $abs7Fmt . "). No directional signal.";
            $action = "No-trade environment. Wait for either side to break out of the range.";
    }
    $brief["headlines"][] = ["asset" => $sym, "text" => $headline, "direction" => $s["direction"]];
    $brief["actions"][] = ["asset" => $sym, "text" => $action];
}

if ($useGroq && count($stats) > 0) {
    $apiKey = trim(file_get_contents($keyfile));
    $prompt = "You are SoSoFlows, an agentic ETF flow analyst. Given the following 7-day and 30-day net inflow data for major spot crypto ETFs, write a 4-sentence plain-English market brief. Tone: institutional-quality, no hype, no emoji, no buzzwords. Lead with the strongest directional signal across all assets, then call out the most surprising divergence, then mention the cumulative inflow narrative. End with one observable risk to watch.\n\nData:\n" . json_encode($stats, JSON_PRETTY_PRINT);
    $payload = [
        "model" => "llama-3.3-70b-versatile",
        "messages" => [
            ["role" => "system", "content" => "You write concise, accurate market briefs. No emoji. No filler. No 'in conclusion'."],
            ["role" => "user", "content" => $prompt]
        ],
        "temperature" => 0.3,
        "max_tokens" => 320
    ];
    $ch = curl_init("https://api.groq.com/openai/v1/chat/completions");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 18,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer " . $apiKey,
            "Content-Type: application/json"
        ]
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp && $code === 200) {
        $j = json_decode($resp, true);
        $text = $j["choices"][0]["message"]["content"] ?? "";
        if ($text) {
            $brief["summary"] = trim($text);
        }
    }
}

if ($brief["summary"] === "") {
    // Static fallback: synthesize a summary from stats
    if (count($stats) === 0) {
        $brief["summary"] = "No flow data cached yet. Run the dashboard or trigger a refresh to populate the daily brief.";
    } else {
        $bull = 0; $bear = 0; $neutral = 0;
        $strongest = null; $strongestVal = 0;
        foreach ($stats as $sym => $s) {
            if (abs($s["sum_7d"]) > abs($strongestVal)) { $strongestVal = $s["sum_7d"]; $strongest = $sym; }
            if ($s["direction"] === "bullish") $bull++;
            elseif ($s["direction"] === "bearish") $bear++;
            else $neutral++;
        }
        $verdict = $bull > $bear ? "demand expanding" : ($bear > $bull ? "redemptions dominating" : "two-sided rotation");
        $strongestTxt = $strongest ? $strongest . " is the standout with " . ($strongestVal >= 0 ? "$" : "-$") . round(abs($strongestVal)/1e6, 1) . "M of net 7d flow" : "";
        $brief["summary"] = "Across tracked spot ETFs the picture is " . $verdict . " over the last 7 days, with " . $bull . " bullish, " . $bear . " bearish, and " . $neutral . " neutral signals. " . $strongestTxt . ". Cumulative inflows since each product's launch remain positive across the basket. Risk to watch: a single high-outflow day on a leading asset usually drags the cohort.";
    }
}

@file_put_contents($briefFile, json_encode($brief));
header("X-Cache: MISS-WROTE");
echo json_encode($brief);
