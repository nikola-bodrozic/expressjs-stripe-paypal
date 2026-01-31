<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Cancelled - <?php echo getenv('STORE_NAME') ?: 'Our Store'; ?></title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
            background-color: #f4f4f4;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
            max-width: 600px;
            margin: 0 auto;
        }
        .cancel-icon {
            color: #ff9800;
            font-size: 60px;
            margin-bottom: 20px;
        }
        .btn {
            display: inline-block;
            padding: 10px 20px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 10px;
        }
        .btn.retry {
            background: #ff9800;
        }
        .btn.retry:hover {
            background: #e68900;
        }
        .btn:hover {
            background: #0056b3;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="cancel-icon">✕</div>
        <h1>Payment Cancelled</h1>
        
        <?php
        $token = $_GET['token'] ?? null;
        ?>
        
        <p>Your payment process was cancelled. No charges have been made to your account.</p>
        
        <?php if ($token): ?>
        <div style="background: #fff8e1; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Order Reference:</strong> <?php echo htmlspecialchars($token); ?></p>
            <p style="font-size: 0.9em; color: #666;">
                You can retry the payment using the same order reference.
            </p>
        </div>
        <?php endif; ?>
    </div>
</body>
</html>