<?php
/**
 * setup.php — One-time password hash generator
 *
 * HOW TO USE:
 *   1. Upload this file to your server alongside config.php
 *   2. Visit https://yoursite.com/storymap/setup.php in your browser
 *   3. Enter your desired editor password
 *   4. Copy the generated hash into config.php → EDITOR_PASSWORD_HASH
 *   5. DELETE this file from your server immediately
 *
 * This file has no other purpose. It cannot access or modify any stories.
 */

$hash    = '';
$error   = '';
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $password = $_POST['password']  ?? '';
    $confirm  = $_POST['confirm']   ?? '';

    if (strlen($password) < 8) {
        $error = 'Password must be at least 8 characters.';
    } elseif ($password !== $confirm) {
        $error = 'Passwords do not match.';
    } else {
        // Generate a secure bcrypt hash (cost factor 12)
        $hash    = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $success = true;
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GeoNarrative Setup</title>
  <style>
    body { font-family: Georgia, serif; max-width: 600px; margin: 60px auto; padding: 0 24px; color: #1a1a2e; }
    h1   { font-size: 1.6rem; margin-bottom: 4px; }
    .sub { color: #888; font-style: italic; font-size: 0.9rem; margin-bottom: 32px; }
    label { display: block; font-size: 0.9rem; margin-bottom: 6px; font-weight: bold; }
    input[type=password] {
      width: 100%; padding: 10px 14px; border: 1px solid #ccc;
      border-radius: 4px; font-size: 1rem; margin-bottom: 20px;
      font-family: inherit;
    }
    button {
      padding: 10px 28px; background: #c0392b; color: white;
      border: none; border-radius: 4px; font-size: 0.95rem;
      cursor: pointer; font-family: inherit;
    }
    .error   { background: #fdecea; border-left: 4px solid #c0392b; padding: 12px 16px; margin-bottom: 20px; }
    .success { background: #eafaf1; border-left: 4px solid #27ae60; padding: 16px 20px; margin-bottom: 20px; }
    .hash-box {
      background: #1a1a2e; color: #faf8f4; padding: 14px 18px;
      border-radius: 4px; font-family: monospace; font-size: 0.85rem;
      word-break: break-all; margin: 12px 0;
      user-select: all;
    }
    .warning { background: #fff8e1; border-left: 4px solid #f39c12; padding: 12px 16px; margin-top: 20px; font-size: 0.88rem; }
    ol { padding-left: 20px; line-height: 2; font-size: 0.92rem; }
    code { background: #f0ece4; padding: 2px 6px; border-radius: 3px; font-size: 0.88rem; }
  </style>
</head>
<body>

  <h1>GeoNarrative Setup</h1>
  <p class="sub">One-time password hash generator</p>

  <?php if ($error): ?>
    <div class="error"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>

  <?php if ($success): ?>
    <div class="success">
      <strong>✓ Hash generated successfully.</strong>
      <p style="margin:10px 0 6px">Copy this entire hash string:</p>
      <div class="hash-box"><?= htmlspecialchars($hash) ?></div>
      <ol>
        <li>Open <code>config.php</code></li>
        <li>Replace the value of <code>EDITOR_PASSWORD_HASH</code> with the hash above</li>
        <li><strong>Delete <code>setup.php</code> from your server</strong></li>
      </ol>
    </div>
    <div class="warning">
      ⚠ <strong>Delete this file after use.</strong> It should not remain on a production server.
    </div>

  <?php else: ?>
    <form method="POST">
      <label for="password">Choose editor password</label>
      <input type="password" id="password" name="password"
             placeholder="Minimum 8 characters" required>

      <label for="confirm">Confirm password</label>
      <input type="password" id="confirm" name="confirm"
             placeholder="Repeat password" required>

      <button type="submit">Generate Hash</button>
    </form>
  <?php endif; ?>

</body>
</html>
