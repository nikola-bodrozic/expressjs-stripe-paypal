<?php
require_once 'vendor/autoload.php';

use Dotenv\Dotenv;

// Load .env file
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();

header('Content-Type: text/html; charset=UTF-8');

// Get Stripe session ID
$stripeSessionId = $_GET['session_id'] ?? null;

// Store configuration
$storeName = "My Awesome Store";
$storeEmail = "support@example.com";
$storePhone = "+1 (555) 123-4567";

// Default values
$paymentMethod = 'stripe';
$paymentStatus = 'processing';
$orderId = 'N/A';
$orderAmount = null;
$currency = 'GBP';
$customerEmail = null;
$customerName = null;
$transactionId = null;

// ========================
// HANDLE STRIPE PAYMENTS
// ========================
if ($stripeSessionId) {
    $orderId = $stripeSessionId;
    $transactionId = $stripeSessionId;
    
    // Get session details from Express API
    $apiBaseUrl = $_ENV['API_BASE_URL'] ?? getenv('API_BASE_URL');
    $apiUrl = $apiBaseUrl . '/api?action=get_session&session_id=' . urlencode($stripeSessionId);
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($response && $httpCode === 200) {
        $data = json_decode($response, true);
        
        $paymentStatus = $data['payment_status'] ?? ($data['status'] ?? 'processing');
        $orderAmount = isset($data['amount_total']) ? $data['amount_total'] / 100 : null;
        $currency = strtoupper($data['currency'] ?? 'GBP');
        $customerEmail = $data['customer_details']['email'] ?? null;
        $customerName = $data['customer_details']['name'] ?? null;
        $transactionId = $data['payment_intent']['id'] ?? $stripeSessionId;
    }
} else {
    // No session ID provided
    $paymentStatus = 'missing';
}

// ========================
// DETERMINE DISPLAY
// ========================
$isSuccess = in_array(strtolower($paymentStatus), ['paid', 'complete', 'completed', 'succeeded']);
$isProcessing = in_array(strtolower($paymentStatus), ['processing', 'pending', 'unpaid']);
$isFailed = in_array(strtolower($paymentStatus), ['failed', 'canceled', 'expired']);
$isMissing = strtolower($paymentStatus) === 'missing';

if ($isSuccess) {
    $icon = '✓';
    $color = '#4CAF50';
    $title = 'Payment Successful!';
    $message = 'Thank you for your purchase! Your order has been confirmed and is being processed.';
} elseif ($isProcessing) {
    $icon = '⏳';
    $color = '#FFC107';
    $title = 'Payment Processing';
    $message = 'Your Stripe payment is being processed. This may take a few moments.';
} elseif ($isFailed) {
    $icon = '⚠️';
    $color = '#F44336';
    $title = 'Payment Issue';
    $message = 'There was an issue with your Stripe payment. Please try again or contact support.';
} elseif ($isMissing) {
    $icon = '❓';
    $color = '#9E9E9E';
    $title = 'Session Missing';
    $message = 'No Stripe session ID provided. Please return to checkout and try again.';
} else {
    $icon = '❓';
    $color = '#9E9E9E';
    $title = 'Payment Status';
    $message = 'We\'re checking your Stripe payment status.';
}

// Format currency
function formatCurrency($amount, $currency) {
    if (!$amount) return 'N/A';
    
    $symbols = [
        'GBP' => '£',
        'USD' => '$',
        'EUR' => '€',
        'CAD' => 'C$',
        'AUD' => 'A$',
    ];
    
    $symbol = $symbols[$currency] ?? $currency . ' ';
    return $symbol . number_format($amount, 2);
}

// Get payment method display
function getPaymentMethodDisplay($method) {
    $methods = [
        'stripe' => ['name' => 'Stripe', 'icon' => '💳', 'color' => '#635BFF'],
        'default' => ['name' => 'Card Payment', 'icon' => '💳', 'color' => '#666']
    ];
    
    return $methods[$method] ?? $methods['default'];
}

$paymentInfo = getPaymentMethodDisplay($paymentMethod);
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($title); ?> - <?php echo htmlspecialchars($storeName); ?></title>
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
    <div class="container">
        <div class="status-bar"></div>
        
        <div class="content">
            <div class="payment-method">
                <span><?php echo $paymentInfo['icon']; ?></span>
                <span><?php echo htmlspecialchars($paymentInfo['name']); ?></span>
                <span class="stripe-badge">STRIPE</span>
            </div>
            
            <div class="status-icon"><?php echo $icon; ?></div>
            
            <h1><?php echo htmlspecialchars($title); ?></h1>
            
            <p class="message"><?php echo $message; ?></p>
            
            <div class="status-badge">
                <?php echo strtoupper($paymentStatus); ?>
            </div>
            
            <div class="details-card">
                <div class="detail-item">
                    <div class="detail-label">Stripe Session ID</div>
                    <div class="detail-value">
                        <span class="order-id"><?php echo htmlspecialchars($orderId); ?></span>
                    </div>
                </div>
                
                <?php if ($transactionId && $transactionId !== $orderId): ?>
                <div class="detail-item">
                    <div class="detail-label">Transaction ID</div>
                    <div class="detail-value">
                        <span class="order-id"><?php echo htmlspecialchars($transactionId); ?></span>
                    </div>
                </div>
                <?php endif; ?>
                
                <?php if ($orderAmount): ?>
                <div class="detail-item">
                    <div class="detail-label">Amount Paid</div>
                    <div class="detail-value">
                        <div class="amount"><?php echo formatCurrency($orderAmount, $currency); ?></div>
                    </div>
                </div>
                <?php endif; ?>
                
                <?php if ($customerEmail): ?>
                <div class="detail-item">
                    <div class="detail-label">Customer Email</div>
                    <div class="detail-value"><?php echo htmlspecialchars($customerEmail); ?></div>
                </div>
                <?php endif; ?>
                
                <?php if ($customerName): ?>
                <div class="detail-item">
                    <div class="detail-label">Customer Name</div>
                    <div class="detail-value"><?php echo htmlspecialchars($customerName); ?></div>
                </div>
                <?php endif; ?>
                
                <div class="detail-item">
                    <div class="detail-label">Payment Method</div>
                    <div class="detail-value">
                        <strong>Stripe</strong> (Credit/Debit Card)
                    </div>
                </div>
                
                <div class="detail-item">
                    <div class="detail-label">Date & Time</div>
                    <div class="detail-value"><?php echo date('F j, Y, g:i a'); ?></div>
                </div>
            </div>
            
            <div class="actions">
                <a href="/" class="btn btn-primary">
                    <i class="fas fa-shopping-bag"></i>
                    Continue Shopping
                </a>
                
                <a href="/orders" class="btn btn-secondary">
                    <i class="fas fa-receipt"></i>
                    View Orders
                </a>
                
                <?php if ($isFailed || $isMissing): ?>
                <a href="/checkout?session_id=<?php echo urlencode($stripeSessionId); ?>" class="btn btn-secondary" style="background: #FF9800; border-color: #FF9800;">
                    <i class="fas fa-redo"></i>
                    Retry Payment
                </a>
                <?php endif; ?>
            </div>
            
            <div class="footer">
                <p>Thank you for choosing <strong><?php echo htmlspecialchars($storeName); ?></strong></p>
                <p>Your Stripe reference: <strong><?php echo htmlspecialchars($orderId); ?></strong></p>
                
                <div class="contact-info">
                    <div class="contact-item">
                        <i class="fas fa-envelope"></i>
                        <span><?php echo htmlspecialchars($storeEmail); ?></span>
                    </div>
                    <div class="contact-item">
                        <i class="fas fa-phone"></i>
                        <span><?php echo htmlspecialchars($storePhone); ?></span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <?php if ($isProcessing): ?>
    <script>
        // Auto-refresh for processing payments
        setTimeout(function() {
            window.location.reload();
        }, 10000);
        
        // Optional: Show countdown
        let seconds = 10;
        const countdown = setInterval(function() {
            seconds--;
            if (seconds <= 0) {
                clearInterval(countdown);
            }
        }, 1000);
    </script>
    <?php endif; ?>
</body>
</html>