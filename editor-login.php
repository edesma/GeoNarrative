<?php
/**
 * editor-login.php — Editor Login Page
 *
 * Handles both GET (show form) and POST (process login).
 * On success: redirects to editor.php (or original destination).
 * On failure: shows error message with a deliberate delay (brute-force mitigation).
 */

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/config.php';

// Already logged in? Go straight to editor
if (is_authenticated()) {
    header('Location: editor.php');
    exit;
}

$error    = '';
$timeout  = isset($_GET['timeout']);
$redirect = $_GET['redirect'] ?? 'editor.php';

// Sanitize redirect — only allow relative URLs within the app
if (!preg_match('/^[\/a-zA-Z0-9_\-\.?=&%]+$/', $redirect)) {
    $redirect = 'editor.php';
}

// ── Handle login form submission ──────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $password = $_POST['password'] ?? '';

    // Small deliberate delay — makes brute-force attacks much slower
    // (200ms is imperceptible to a human, but multiplies attacker cost 5×)
    usleep(200000);

    if (do_login($password)) {
        header('Location: ' . $redirect);
        exit;
    } else {
        $error = 'Incorrect password. Please try again.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Editor Login — <?= APP_NAME ?></title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Serif+4:opsz,wght@8..60,300;8..60,400&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #1a1a2e; --paper: #faf8f4; --paper-dark: #f0ece4;
      --accent: #c0392b; --gold: #b8860b;
      --serif: 'Playfair Display', Georgia, serif;
      --body:  'Source Serif 4', Georgia, serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--body);
      background: var(--ink);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .login-card {
      background: var(--paper);
      border-radius: 6px;
      width: 100%;
      max-width: 400px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }

    .card-header {
      background: var(--ink);
      padding: 32px 36px 28px;
      border-bottom: 3px solid var(--accent);
    }
    .card-header h1 {
      font-family: var(--serif);
      font-size: 1.6rem;
      color: var(--paper);
      margin-bottom: 4px;
    }
    .card-header p {
      font-size: 0.78rem;
      color: rgba(250,248,244,0.5);
      font-style: italic;
    }

    .card-body {
      padding: 32px 36px;
    }

    /* Timeout / error notices */
    .notice {
      padding: 11px 14px;
      border-radius: 4px;
      font-size: 0.84rem;
      margin-bottom: 22px;
    }
    .notice-warning {
      background: #fff8e1;
      border-left: 3px solid #f39c12;
      color: #7d5a00;
    }
    .notice-error {
      background: #fdecea;
      border-left: 3px solid var(--accent);
      color: #7b1a1a;
    }

    label {
      display: block;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink);
      margin-bottom: 8px;
    }

    input[type="password"] {
      width: 100%;
      padding: 11px 14px;
      border: 1.5px solid rgba(26,26,46,0.2);
      border-radius: 4px;
      font-family: var(--body);
      font-size: 1rem;
      color: var(--ink);
      background: white;
      transition: border-color 0.2s;
      margin-bottom: 24px;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: var(--accent);
    }

    button[type="submit"] {
      width: 100%;
      padding: 12px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 4px;
      font-family: var(--body);
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.03em;
      transition: background 0.2s, transform 0.1s;
    }
    button[type="submit"]:hover  { background: #a93226; }
    button[type="submit"]:active { transform: scale(0.98); }

    .card-footer {
      padding: 16px 36px;
      border-top: 1px solid var(--paper-dark);
      text-align: center;
    }
    .card-footer a {
      font-size: 0.78rem;
      color: var(--gold);
      text-decoration: none;
    }
    .card-footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>

  <div class="login-card">

    <div class="card-header">
      <h1><?= APP_NAME ?></h1>
      <p>Story Editor — secure access</p>
    </div>

    <div class="card-body">

      <?php if ($timeout): ?>
        <div class="notice notice-warning">
          Your session timed out after inactivity. Please log in again.
        </div>
      <?php endif; ?>

      <?php if ($error): ?>
        <div class="notice notice-error">
          <?= htmlspecialchars($error) ?>
        </div>
      <?php endif; ?>

      <form method="POST" action="editor-login.php?redirect=<?= urlencode($redirect) ?>">

        <label for="password">Editor Password</label>
        <input type="password" id="password" name="password"
               autofocus autocomplete="current-password"
               placeholder="Enter your password" required>

        <button type="submit">Sign In →</button>

      </form>
    </div>

    <div class="card-footer">
      <a href="gallery.php">← Back to story gallery</a>
    </div>

  </div>

</body>
</html>
