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
$lineItems = [];
$shippingAddress = null;
$billingAddress = null;
$shippingCost = null;
$subtotal = null;

// ========================
// HANDLE STRIPE PAYMENTS (Updated for new RESTful endpoints)
// ========================
if ($stripeSessionId) {
    $orderId = $stripeSessionId;
    
    // API configuration
    $apiBaseUrl = $_ENV['API_BASE_URL'] ?? getenv('API_BASE_URL');
    
    // Option 1: Try new RESTful endpoint first
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
        
        if (isset($data['success']) && $data['success'] === true) {
            // New RESTful endpoint response
            $sessionData = $data['data'] ?? [];
            $paymentStatus = $sessionData['paymentStatus'] ?? 'processing';
            $orderAmount = isset($sessionData['amountTotal']) ? $sessionData['amountTotal'] / 100 : null;
            $currency = strtoupper($sessionData['currency'] ?? 'GBP');
            $customerEmail = $sessionData['customerEmail'] ?? null;
            $customerName = $sessionData['customerDetails']['name'] ?? null;
            $transactionId = $sessionData['paymentIntent']['id'] ?? $stripeSessionId;
            $lineItems = $sessionData['lineItems']['data'] ?? [];
            $shippingAddress = $sessionData['shippingAddress'] ?? null;
            $billingAddress = $sessionData['billingAddress'] ?? null;
            $shippingCost = isset($sessionData['shippingCost']['amount_total']) ? $sessionData['shippingCost']['amount_total'] / 100 : null;
            $subtotal = isset($sessionData['amountSubtotal']) ? $sessionData['amountSubtotal'] / 100 : null;
        }
    }
    
    // Option 2: Fallback to legacy endpoint if new one fails
    if (!$response || $httpCode !== 200 || !isset($data['success'])) {
        $legacyUrl = $apiBaseUrl . '/api?action=get_session&session_id=' . urlencode($stripeSessionId);
        
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $legacyUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
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
            $lineItems = $data['line_items']['data'] ?? [];
            $shippingAddress = $data['shipping_details']['address'] ?? null;
            $billingAddress = $data['customer_details']['address'] ?? null;
            $shippingCost = isset($data['shipping_cost']['amount_total']) ? $data['shipping_cost']['amount_total'] / 100 : null;
            $subtotal = isset($data['amount_subtotal']) ? $data['amount_subtotal'] / 100 : null;
        }
    }
} else {
    // No session ID provided
    $paymentStatus = 'missing';
}

// ========================
// VERIFY PAYMENT (Additional verification)
// ========================
if ($stripeSessionId && $paymentStatus === 'processing') {
    // Use the verify endpoint for additional verification
    $apiBaseUrl = $_ENV['API_BASE_URL'] ?? getenv('API_BASE_URL');
    $verifyUrl = rtrim($apiBaseUrl, '/') . '/api/stripe/verify-payment';
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $verifyUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['sessionId' => $stripeSessionId]),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json'
        ],
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($response && $httpCode === 200) {
        $data = json_decode($response, true);
        if (isset($data['success']) && $data['success'] === true) {
            $verifyData = $data['data'] ?? [];
            if (isset($verifyData['isPaid']) && $verifyData['isPaid'] === true) {
                $paymentStatus = 'paid';
                $orderAmount = isset($verifyData['amountTotal']) ? $verifyData['amountTotal'] / 100 : $orderAmount;
                $currency = strtoupper($verifyData['currency'] ?? $currency);
                $customerEmail = $verifyData['customerEmail'] ?? $customerEmail;
            }
        }
    }
}

// ========================
// DETERMINE DISPLAY
// ========================
$isSuccess = in_array(strtolower($paymentStatus), ['paid', 'complete', 'completed', 'succeeded']);
$isProcessing = in_array(strtolower($paymentStatus), ['processing', 'pending', 'unpaid']);
$isFailed = in_array(strtolower($paymentStatus), ['failed', 'canceled', 'expired', 'cancelled']);
$isMissing = strtolower($paymentStatus) === 'missing';

if ($isSuccess) {
    $icon = 'âœ“';
    $color = '#4CAF50';
    $title = 'Payment Successful!';
    $message = 'Thank you for your purchase! Your order has been confirmed and is being processed.';
} elseif ($isProcessing) {
    $icon = 'â³';
    $color = '#FFC107';
    $title = 'Payment Processing';
    $message = 'Your Stripe payment is being processed. This may take a few moments.';
} elseif ($isFailed) {
    $icon = 'âš ï¸';
    $color = '#F44336';
    $title = 'Payment Issue';
    $message = 'There was an issue with your Stripe payment. Please try again or contact support.';
} elseif ($isMissing) {
    $icon = 'â“';
    $color = '#9E9E9E';
    $title = 'Session Missing';
    $message = 'No Stripe session ID provided. Please return to checkout and try again.';
} else {
    $icon = 'â“';
    $color = '#9E9E9E';
    $title = 'Payment Status';
    $message = 'We\'re checking your Stripe payment status.';
}

// Format currency
function formatCurrency($amount, $currency) {
    if (!$amount) return 'N/A';
    
    $symbols = [
        'GBP' => 'Â£',
        'USD' => '$',
        'EUR' => 'â‚¬',
        'CAD' => 'C$',
        'AUD' => 'A$',
    ];
    
    $symbol = $symbols[$currency] ?? $currency . ' ';
    return $symbol . number_format($amount, 2);
}

// Get payment method display
function getPaymentMethodDisplay($method) {
    $methods = [
        'stripe' => ['name' => 'Stripe', 'icon' => 'í ½í²³', 'color' => '#635BFF'],
        'default' => ['name' => 'Card Payment', 'icon' => 'í ½í²³', 'color' => '#666']
    ];
    
    return $methods[$method] ?? $methods['default'];
}

$paymentInfo = getPaymentMethodDisplay($paymentMethod);

// Prepare order items for display
$orderItems = [];
if (!empty($lineItems)) {
    foreach ($lineItems as $item) {
        $price = $item['price'] ?? [];
        $product = $price['product'] ?? [];
        $orderItems[] = [
            'name' => $product['name'] ?? 'Product',
            'quantity' => $item['quantity'] ?? 1,
            'price' => isset($price['unit_amount']) ? $price['unit_amount'] / 100 : 0,
            'total' => isset($item['amount_total']) ? $item['amount_total'] / 100 : 0,
            'currency' => strtoupper($price['currency'] ?? 'GBP')
        ];
    }
}
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
            max-width: 800px;
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
        
        .stripe-badge {
            background: rgba(255,255,255,0.2);
            padding: 2px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
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
        
        .details-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 30px 0;
        }
        
        @media (max-width: 768px) {
            .details-section {
                grid-template-columns: 1fr;
            }
        }
        
        .details-card {
            background: #f8f9fa;
            border-radius: 15px;
            padding: 25px;
            border: 1px solid #e9ecef;
        }
        
        .details-card h3 {
            color: #495057;
            margin-bottom: 20px;
            font-size: 18px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .details-card h3 i {
            color: <?php echo $paymentInfo['color']; ?>;
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
            flex-shrink: 0;
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
        
        .order-items {
            grid-column: 1 / -1;
        }
        
        .order-items-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        
        .order-items-table th {
            text-align: left;
            padding: 12px;
            background: #e9ecef;
            border-bottom: 2px solid #dee2e6;
            color: #495057;
            font-weight: 600;
        }
        
        .order-items-table td {
            padding: 12px;
            border-bottom: 1px solid #e9ecef;
        }
        
        .order-items-table tr:last-child td {
            border-bottom: none;
        }
        
        .order-items-table .total-row {
            font-weight: 700;
            background: #f8f9fa;
        }
        
        .address-display {
            font-style: normal;
            line-height: 1.5;
        }
        
        .address-display div {
            margin-bottom: 3px;
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
        
        .btn-stripe {
            background: #635BFF;
            color: white;
            border-color: #635BFF;
        }
        
        .btn-stripe:hover {
            background: #544ee5;
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(99, 91, 255, 0.2);
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
            flex-wrap: wrap;
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
            
            .order-items-table {
                font-size: 14px;
            }
            
            .order-items-table th,
            .order-items-table td {
                padding: 8px;
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
            
            <div class="details-section">
                <!-- Payment Details -->
                <div class="details-card">
                    <h3><i class="fas fa-credit-card"></i> Payment Details</h3>
                    
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
                    
                    <?php if ($subtotal && $shippingCost): ?>
                    <div class="detail-item">
                        <div class="detail-label">Subtotal</div>
                        <div class="detail-value"><?php echo formatCurrency($subtotal, $currency); ?></div>
                    </div>
                    
                    <div class="detail-item">
                        <div class="detail-label">Shipping</div>
                        <div class="detail-value"><?php echo formatCurrency($shippingCost, $currency); ?></div>
                    </div>
                    <?php endif; ?>
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
                
                <!-- Customer Details -->
                <div class="details-card">
                    <h3><i class="fas fa-user"></i> Customer Details</h3>
                    
                    <?php if ($customerEmail): ?>
                    <div class="detail-item">
                        <div class="detail-label">Email</div>
                        <div class="detail-value"><?php echo htmlspecialchars($customerEmail); ?></div>
                    </div>
                    <?php endif; ?>
                    
                    <?php if ($customerName): ?>
                    <div class="detail-item">
                        <div class="detail-label">Name</div>
                        <div class="detail-value"><?php echo htmlspecialchars($customerName); ?></div>
                    </div>
                    <?php endif; ?>
                    
                    <?php if ($billingAddress): ?>
                    <div class="detail-item">
                        <div class="detail-label">Billing Address</div>
                        <div class="detail-value">
                            <div class="address-display">
                                <?php if (!empty($billingAddress['line1'])): ?>
                                <div><?php echo htmlspecialchars($billingAddress['line1']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($billingAddress['line2'])): ?>
                                <div><?php echo htmlspecialchars($billingAddress['line2']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($billingAddress['city'])): ?>
                                <div><?php echo htmlspecialchars($billingAddress['city']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($billingAddress['state'])): ?>
                                <div><?php echo htmlspecialchars($billingAddress['state']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($billingAddress['postal_code'])): ?>
                                <div><?php echo htmlspecialchars($billingAddress['postal_code']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($billingAddress['country'])): ?>
                                <div><?php echo htmlspecialchars($billingAddress['country']); ?></div>
                                <?php endif; ?>
                            </div>
                        </div>
                    </div>
                    <?php endif; ?>
                    
                    <?php if ($shippingAddress): ?>
                    <div class="detail-item">
                        <div class="detail-label">Shipping Address</div>
                        <div class="detail-value">
                            <div class="address-display">
                                <?php if (!empty($shippingAddress['line1'])): ?>
                                <div><?php echo htmlspecialchars($shippingAddress['line1']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($shippingAddress['line2'])): ?>
                                <div><?php echo htmlspecialchars($shippingAddress['line2']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($shippingAddress['city'])): ?>
                                <div><?php echo htmlspecialchars($shippingAddress['city']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($shippingAddress['state'])): ?>
                                <div><?php echo htmlspecialchars($shippingAddress['state']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($shippingAddress['postal_code'])): ?>
                                <div><?php echo htmlspecialchars($shippingAddress['postal_code']); ?></div>
                                <?php endif; ?>
                                <?php if (!empty($shippingAddress['country'])): ?>
                                <div><?php echo htmlspecialchars($shippingAddress['country']); ?></div>
                                <?php endif; ?>
                            </div>
                        </div>
                    </div>
                    <?php endif; ?>
                </div>
                
                <!-- Order Items -->
                <?php if (!empty($orderItems)): ?>
                <div class="details-card order-items">
                    <h3><i class="fas fa-shopping-bag"></i> Order Items</h3>
                    
                    <table class="order-items-table">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Quantity</th>
                                <th>Price</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php 
                            $totalItems = 0;
                            $totalAmount = 0;
                            foreach ($orderItems as $item): 
                                $totalItems += $item['quantity'];
                                $totalAmount += $item['total'];
                            ?>
                            <tr>
                                <td><?php echo htmlspecialchars($item['name']); ?></td>
                                <td><?php echo $item['quantity']; ?></td>
                                <td><?php echo formatCurrency($item['price'], $item['currency']); ?></td>
                                <td><?php echo formatCurrency($item['total'], $item['currency']); ?></td>
                            </tr>
                            <?php endforeach; ?>
                            <tr class="total-row">
                                <td colspan="3" style="text-align: right;"><strong>Total:</strong></td>
                                <td><strong><?php echo formatCurrency($totalAmount, $currency); ?></strong></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <?php endif; ?>
            </div>
            
            <div class="actions">
                <a href="/" class="btn btn-primary">
                    <i class="fas fa-shopping-bag"></i>
                    Continue Shopping
                </a>
                
                <?php if ($isSuccess && $transactionId): ?>
                <a href="https://dashboard.stripe.com/payments/<?php echo urlencode($transactionId); ?>" 
                   target="_blank" 
                   class="btn btn-stripe">
                    <i class="fas fa-external-link-alt"></i>
                    View in Stripe
                </a>
                <?php endif; ?>
                
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
                    <div class="contact-item">
                        <i class="fas fa-shield-alt"></i>
                        <span>Secure Payment by Stripe</span>
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
        const countdownElement = document.createElement('div');
        countdownElement.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.8);color:white;padding:10px 15px;border-radius:10px;font-size:14px;z-index:1000;';
        document.body.appendChild(countdownElement);
        
        const countdown = setInterval(function() {
            countdownElement.textContent = 'Checking payment status in ' + seconds + 's...';
            seconds--;
            if (seconds <= 0) {
                clearInterval(countdown);
                countdownElement.textContent = 'Refreshing...';
            }
        }, 1000);
    </script>
    <?php endif; ?>
    
    <?php if ($isSuccess): ?>
    <script>
        // Track successful payment for analytics
        setTimeout(function() {
            console.log('Stripe payment successful: <?php echo $orderId; ?>');
            
            // Optional: Send to analytics
            if (typeof gtag !== 'undefined') {
                gtag('event', 'purchase', {
                    transaction_id: '<?php echo $orderId; ?>',
                    value: <?php echo $orderAmount ?: 0; ?>,
                    currency: '<?php echo $currency; ?>',
                    items: <?php echo json_encode($orderItems); ?>
                });
            }
        }, 1000);
    </script>
    <?php endif; ?>
</body>
</html>