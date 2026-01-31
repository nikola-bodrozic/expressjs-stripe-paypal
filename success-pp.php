<?php
require_once 'vendor/autoload.php';

use Dotenv\Dotenv;

// Load .env file
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();

header('Content-Type: text/html; charset=UTF-8');

// Get PayPal parameters
$paypalToken = $_GET['token'] ?? null;
$payerId = $_GET['PayerID'] ?? null;

// Store configuration
$storeName = "My Awesome Store";
$storeEmail = "support@example.com";
$storePhone = "+1 (555) 123-4567";

// Defaults
$paymentMethod = 'paypal';
$paymentStatus = 'processing';
$orderId = 'N/A';
$orderAmount = null;
$currency = 'GBP';
$customerEmail = null;
$customerName = null;
$transactionId = null;
$cartId = null;

// ========================
// HANDLE PAYPAL PAYMENT
// ========================
if ($paypalToken) {
    $orderId = $paypalToken;

    try {
        $apiBaseUrl = $_ENV['API_BASE_URL'] ?? getenv('API_BASE_URL') ?? 'http://localhost:3000';

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $apiBaseUrl . '/api/paypal/capture-order/' . urlencode($paypalToken),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json'
            ],
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response && $httpCode === 200) {
            $captureData = json_decode($response, true);

            if (!empty($captureData['success']) && !empty($captureData['data'])) {
                $paypalData = $captureData['data'];
                $paymentStatus = strtolower($paypalData['status'] ?? 'processing');

                // Amount + transaction
                if (isset($paypalData['purchase_units'][0]['payments']['captures'][0])) {
                    $capture = $paypalData['purchase_units'][0]['payments']['captures'][0];
                    $orderAmount = $capture['amount']['value'] ?? null;
                    $currency = $capture['amount']['currency_code'] ?? $currency;
                    $transactionId = $capture['id'] ?? null;
                }

                // Customer
                if (isset($paypalData['payer'])) {
                    $customerEmail = $paypalData['payer']['email_address'] ?? null;
                    $customerName =
                        ($paypalData['payer']['name']['given_name'] ?? '') . ' ' .
                        ($paypalData['payer']['name']['surname'] ?? '');
                }

                // ✅ Cart ID (critical)
                if (isset($paypalData['purchase_units'][0])) {
                    $pu = $paypalData['purchase_units'][0];
                    $cartId = $pu['reference_id'] ?? $pu['custom_id'] ?? null;
                }
            } else {
                $paymentStatus = 'failed';
            }
        } else {
            $paymentStatus = 'failed';
        }
    } catch (Throwable $e) {
        $paymentStatus = 'error';
    }
} else {
    $paymentStatus = 'missing';
}

// ========================
// DISPLAY STATE
// ========================
$isSuccess = in_array($paymentStatus, ['completed', 'approved', 'succeeded']);
$isProcessing = in_array($paymentStatus, ['processing', 'pending', 'created']);
$isFailed = in_array($paymentStatus, ['failed', 'canceled', 'expired', 'error']);
$isMissing = $paymentStatus === 'missing';

// Helpers
function formatCurrency($amount, $currency) {
    if (!$amount) return 'N/A';
    return strtoupper($currency) . ' ' . number_format($amount, 2);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>PayPal Payment - <?php echo htmlspecialchars($storeName); ?></title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: #333;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.15);
            width: 100%;
            max-width: 600px;
            overflow: hidden;
            position: relative;
        }
        
        .status-bar {
            height: 6px;
            background: <?php echo $color; ?>;
        }
        
        .content {
            padding: 40px;
        }
        
        .status-icon {
            font-size: 80px;
            text-align: center;
            margin: 20px 0;
            color: <?php echo $color; ?>;
        }
        
        .payment-method {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 8px 20px;
            background: <?php echo $paymentInfo['color']; ?>;
            color: white;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 20px;
        }
        
        h1 {
            color: <?php echo $color; ?>;
            margin-bottom: 15px;
            font-size: 32px;
            font-weight: 700;
        }
        
        .message {
            color: #666;
            font-size: 18px;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        
        .status-badge {
            display: inline-block;
            padding: 10px 25px;
            background: <?php echo $color; ?>;
            color: white;
            border-radius: 50px;
            font-weight: 700;
            font-size: 16px;
            margin-bottom: 30px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .details-card {
            background: #f8f9fa;
            border-radius: 15px;
            padding: 25px;
            margin: 30px 0;
            border: 1px solid #e9ecef;
        }
        
        .detail-item {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #e9ecef;
        }
        
        .detail-item:last-child {
            border-bottom: none;
        }
        
        .detail-label {
            font-weight: 600;
            color: #495057;
        }
        
        .detail-value {
            color: #212529;
            text-align: right;
            word-break: break-all;
            max-width: 60%;
        }
        
        .order-id {
            font-family: 'Courier New', monospace;
            background: #e9ecef;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 14px;
            display: block;
            margin-top: 5px;
        }
        
        .amount {
            font-size: 28px;
            font-weight: 700;
            color: #212529;
        }
        
        .actions {
            display: flex;
            gap: 15px;
            margin-top: 40px;
            flex-wrap: wrap;
            justify-content: center;
        }
        
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 16px 32px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }
        
        .btn-primary {
            background: #4CAF50;
            color: white;
        }
        
        .btn-primary:hover {
            background: #45a049;
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(76, 175, 80, 0.2);
        }
        
        .btn-secondary {
            background: white;
            color: #495057;
            border-color: #dee2e6;
        }
        
        .btn-secondary:hover {
            background: #f8f9fa;
            border-color: #adb5bd;
            transform: translateY(-2px);
        }
        
        .footer {
            margin-top: 40px;
            padding-top: 25px;
            border-top: 1px solid #e9ecef;
            color: #6c757d;
            font-size: 14px;
            text-align: center;
        }
        
        .contact-info {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-top: 15px;
            font-size: 13px;
        }
        
        .contact-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        @media (max-width: 640px) {
            .content {
                padding: 30px 20px;
            }
            
            h1 {
                font-size: 28px;
            }
            
            .message {
                font-size: 16px;
            }
            
            .actions {
                flex-direction: column;
            }
            
            .btn {
                width: 100%;
                justify-content: center;
            }
            
            .detail-item {
                flex-direction: column;
                gap: 5px;
            }
            
            .detail-value {
                max-width: 100%;
                text-align: left;
            }
        }
    </style>
</head>
<body>

<h1>
<?php
if ($isSuccess) echo 'Payment Successful';
elseif ($isProcessing) echo 'Payment Processing';
elseif ($isFailed) echo 'Payment Failed';
elseif ($isMissing) echo 'Missing PayPal Token';
else echo 'Payment Status';
?>
</h1>

<p>
<?php
if ($isSuccess) echo 'Thank you! Your PayPal payment was completed successfully.';
elseif ($isProcessing) echo 'Your PayPal payment is still being processed.';
elseif ($isFailed) echo 'There was a problem with your PayPal payment.';
elseif ($isMissing) echo 'No PayPal token was provided.';
else echo 'We are checking your payment status.';
?>
</p>

<hr>

<h2>Order Details</h2>

<ul>
    <li><strong>Payment Method:</strong> PayPal</li>

    <li>
        <strong>PayPal Order ID:</strong><br>
        <?php echo htmlspecialchars($orderId); ?>
    </li>

    <?php if ($cartId): ?>
    <li>
        <strong>Cart ID (Your Order Reference):</strong><br>
        <?php echo htmlspecialchars($cartId); ?>
    </li>
    <?php endif; ?>

    <?php if ($payerId): ?>
    <li>
        <strong>Payer ID:</strong><br>
        <?php echo htmlspecialchars($payerId); ?>
    </li>
    <?php endif; ?>

    <?php if ($transactionId): ?>
    <li>
        <strong>Transaction ID:</strong><br>
        <?php echo htmlspecialchars($transactionId); ?>
    </li>
    <?php endif; ?>

    <?php if ($orderAmount): ?>
    <li>
        <strong>Amount Paid:</strong><br>
        <?php echo formatCurrency($orderAmount, $currency); ?>
    </li>
    <?php endif; ?>

    <?php if ($customerEmail): ?>
    <li>
        <strong>Customer Email:</strong><br>
        <?php echo htmlspecialchars($customerEmail); ?>
    </li>
    <?php endif; ?>

    <?php if ($customerName): ?>
    <li>
        <strong>Customer Name:</strong><br>
        <?php echo htmlspecialchars(trim($customerName)); ?>
    </li>
    <?php endif; ?>

    <li>
        <strong>Status:</strong><br>
        <?php echo strtoupper(htmlspecialchars($paymentStatus)); ?>
    </li>

    <li>
        <strong>Date:</strong><br>
        <?php echo date('Y-m-d H:i:s'); ?>
    </li>
</ul>

<hr>

<p>
If you have any questions, contact us at
<a href="mailto:<?php echo htmlspecialchars($storeEmail); ?>">
<?php echo htmlspecialchars($storeEmail); ?>
</a>
or call <?php echo htmlspecialchars($storePhone); ?>.
</p>

<p>
<a href="/">Continue shopping</a>
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
