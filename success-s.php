<?php
require_once 'vendor/autoload.php';

use Dotenv\Dotenv;

// Load .env
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();

header('Content-Type: text/html; charset=UTF-8');

// Stripe session ID
$stripeSessionId = $_GET['session_id'] ?? null;

// Store info
$storeName = "My Awesome Store";
$storeEmail = "support@example.com";
$storePhone = "+1 (555) 123-4567";

// Defaults
$paymentMethod = 'stripe';
$paymentStatus = 'processing';
$orderId = 'N/A';
$orderAmount = null;
$currency = 'GBP';
$customerEmail = null;
$customerName = null;
$transactionId = null;
$lineItems = [];
$metadata = [];
$shippingAddress = null;
$billingAddress = null;
$shippingCost = null;
$subtotal = null;

// ========================
// FETCH STRIPE SESSION
// ========================
if ($stripeSessionId) {
    $orderId = $stripeSessionId;
    $apiBaseUrl = $_ENV['API_BASE_URL'] ?? getenv('API_BASE_URL');

    $apiUrl = rtrim($apiBaseUrl, '/') . '/api/stripe/sessions/' . urlencode($stripeSessionId);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response && $httpCode === 200) {
        $data = json_decode($response, true);
        if (!empty($data['success'])) {
            $s = $data['data'] ?? [];
            $paymentStatus = $s['paymentStatus'] ?? 'processing';
            $orderAmount = isset($s['amountTotal']) ? $s['amountTotal'] / 100 : null;
            $currency = strtoupper($s['currency'] ?? 'GBP');
            $customerEmail = $s['customerEmail'] ?? null;
            $customerName = $s['customerDetails']['name'] ?? null;
            $transactionId = $s['paymentIntent']['id'] ?? $stripeSessionId;
            $lineItems = $s['lineItems']['data'] ?? [];
            $metadata = $s['metadata'] ?? [];
            $shippingAddress = $s['shippingAddress'] ?? null;
            $billingAddress = $s['billingAddress'] ?? null;
            $shippingCost = isset($s['shippingCost']['amount_total']) ? $s['shippingCost']['amount_total'] / 100 : null;
            $subtotal = isset($s['amountSubtotal']) ? $s['amountSubtotal'] / 100 : null;
        }
    }
}

// ========================
// VERIFY PAYMENT
// ========================
if ($stripeSessionId && $paymentStatus === 'processing') {
    $verifyUrl = rtrim($_ENV['API_BASE_URL'], '/') . '/api/stripe/verify-payment';

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $verifyUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['sessionId' => $stripeSessionId]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response && $httpCode === 200) {
        $v = json_decode($response, true);
        if (!empty($v['success']) && !empty($v['data']['isPaid'])) {
            $paymentStatus = 'paid';
        }
    }
}

// ========================
// DISPLAY LOGIC
// ========================
$isSuccess = in_array(strtolower($paymentStatus), ['paid', 'completed', 'succeeded']);
$isProcessing = in_array(strtolower($paymentStatus), ['processing', 'pending']);
$isFailed = in_array(strtolower($paymentStatus), ['failed', 'canceled', 'expired']);
$isMissing = strtolower($paymentStatus) === 'missing';

function formatCurrency($amount, $currency) {
    if (!$amount) return 'N/A';
    return strtoupper($currency) . ' ' . number_format($amount, 2);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Stripe Payment - <?php echo htmlspecialchars($storeName); ?></title>
</head>
<body>

<h1>
<?php
if ($isSuccess) echo 'Payment Successful';
elseif ($isProcessing) echo 'Payment Processing';
elseif ($isFailed) echo 'Payment Failed';
elseif ($isMissing) echo 'Missing Stripe Session';
else echo 'Payment Status';
?>
</h1>

<p>
<?php
if ($isSuccess) echo 'Thank you! Your Stripe payment was completed successfully.';
elseif ($isProcessing) echo 'Your Stripe payment is still being processed.';
elseif ($isFailed) echo 'There was a problem with your Stripe payment.';
elseif ($isMissing) echo 'No Stripe session ID was provided.';
else echo 'We are checking your payment status.';
?>
</p>

<hr>

<h2>Order Details</h2>
<ul>
    <li><strong>Stripe Session ID:</strong> <?php echo htmlspecialchars($orderId); ?></li>
    <?php if ($transactionId): ?>
        <li><strong>Transaction ID:</strong> <?php echo htmlspecialchars($transactionId); ?></li>
    <?php endif; ?>
    <?php if ($orderAmount): ?>
        <li><strong>Amount Paid:</strong> <?php echo formatCurrency($orderAmount, $currency); ?></li>
    <?php endif; ?>
    <li><strong>Status:</strong> <?php echo strtoupper($paymentStatus); ?></li>
    <li><strong>Date:</strong> <?php echo date('Y-m-d H:i:s'); ?></li>
</ul>

<?php if (!empty($metadata)): ?>
<h3>Order Metadata</h3>
<ul>
    <?php foreach ($metadata as $key => $value): ?>
        <li><strong><?php echo htmlspecialchars($key); ?>:</strong> <?php echo htmlspecialchars($value); ?></li>
    <?php endforeach; ?>
</ul>
<?php endif; ?>

<?php if (!empty($lineItems)): ?>
<h3>Items</h3>
<ul>
    <?php foreach ($lineItems as $item): ?>
        <li>
            <?php
            $name = $item['price']['product']['name'] ?? 'Product';
            $qty = $item['quantity'] ?? 1;
            $priceAmount = isset($item['price']['unit_amount']) ? $item['price']['unit_amount']/100 : 0;
            $priceCurrency = strtoupper($item['price']['currency'] ?? $currency);
            echo htmlspecialchars($name) . ' × ' . $qty . ' (' . formatCurrency($priceAmount, $priceCurrency) . ')';
            ?>
        </li>
    <?php endforeach; ?>
</ul>
<?php endif; ?>

<?php if ($subtotal !== null || $shippingCost !== null): ?>
<h3>Order Summary</h3>
<ul>
    <?php if ($subtotal !== null): ?>
        <li><strong>Subtotal:</strong> <?php echo formatCurrency($subtotal, $currency); ?></li>
    <?php endif; ?>
    <?php if ($shippingCost !== null): ?>
        <li><strong>Shipping:</strong> <?php echo formatCurrency($shippingCost, $currency); ?></li>
    <?php endif; ?>
    <li><strong>Total:</strong> <?php echo formatCurrency($orderAmount, $currency); ?></li>
</ul>
<?php endif; ?>

<hr>

<h3>Customer</h3>
<ul>
    <?php if ($customerName): ?>
        <li><strong>Name:</strong> <?php echo htmlspecialchars($customerName); ?></li>
    <?php endif; ?>
    <?php if ($customerEmail): ?>
        <li><strong>Email:</strong> <?php echo htmlspecialchars($customerEmail); ?></li>
    <?php endif; ?>
</ul>

<?php if ($billingAddress || $shippingAddress): ?>
<h3>Addresses</h3>
<ul>
    <?php if ($billingAddress): ?>
        <li><strong>Billing:</strong> 
            <?php echo htmlspecialchars(implode(', ', array_filter($billingAddress))); ?>
        </li>
    <?php endif; ?>
    <?php if ($shippingAddress): ?>
        <li><strong>Shipping:</strong> 
            <?php echo htmlspecialchars(implode(', ', array_filter($shippingAddress))); ?>
        </li>
    <?php endif; ?>
</ul>
<?php endif; ?>

<hr>

<p>
Need help? Contact us at
<a href="mailto:<?php echo htmlspecialchars($storeEmail); ?>">
<?php echo htmlspecialchars($storeEmail); ?>
</a>
or call <?php echo htmlspecialchars($storePhone); ?>.
</p>

<p>
<a href="/">Continue shopping</a> |
<a href="/orders">View orders</a>
</p>

<?php if ($isProcessing): ?>
<script>
    setTimeout(function () {
        location.reload();
    }, 10000);
</script>
<?php endif; ?>

</body>
</html>
